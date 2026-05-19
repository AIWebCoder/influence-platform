const net = require('net');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const PersonaService = require('./personaService');

const ENFORCE_PERSONA_EGRESS = process.env.PERSONA_ENFORCE_EGRESS !== 'false';
const USE_PERSONA_PROXY_FOR_GRAPH = process.env.USE_PERSONA_PROXY_FOR_GRAPH !== 'false';
function getProxyLocalHostAlias() {
  return process.env.PROXY_LOCAL_HOST_ALIAS || 'host.docker.internal';
}
const EGRESS_CHECK_URLS = (process.env.PERSONA_EGRESS_CHECK_URLS || 'https://api.ipify.org,https://ifconfig.me/ip')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const PROXY_UNREACHABLE_HINT =
  'The distribution engine must reach an HTTP/SOCKS proxy listener at host:port. ' +
  'Public IPs (e.g. 5.135.7.102) only work if a proxy daemon listens there; otherwise use ' +
  '127.0.0.1:11xx local forwarders and PROXY_LOCAL_HOST_ALIAS=host.docker.internal in compose.';

/** Map proxy row port 101 → local bridge 19101 (PROXY_BRIDGE_PORT_BASE + port). */
const PROXY_BRIDGE_PORT_BASE = parseInt(process.env.PROXY_BRIDGE_PORT_BASE || '19000', 10);

/** @typedef {{ proxy_id: string, host: string, port: number, proxy_type: string, username?: string|null, password?: string|null }} ProxyConfig */

/** Expand mistaken host `5.135.7` + port `102` → canonical `5.135.7.102`. */
function canonicalProxyHost(host, port) {
  const h = String(host || '').trim();
  const p = Number(port);
  if (h === '5.135.7' && p >= 101 && p <= 199) return `5.135.7.${p}`;
  return h;
}

function localBridgePortForProxyRow(host, port) {
  const p = Number(port);
  if (!Number.isFinite(p) || p < 101 || p > 199) return null;
  const h = String(host || '').trim();
  if (h === '5.135.7' || /^5\.135\.7\.\d+$/.test(h)) {
    return PROXY_BRIDGE_PORT_BASE + p;
  }
  return null;
}

/**
 * Where the distribution engine should connect for egress (Docker cannot use bare `5.135.7`).
 * Prefers emulator bridge binding, then local bridge port convention, then upstream host.
 */
async function resolveEgressConnectConfig(proxyConfig, personaId) {
  const bridge = await PersonaService.getBridgeBindingForPersona(personaId);
  if (bridge?.bridge_port) {
    return {
      ...proxyConfig,
      host: '127.0.0.1',
      port: Number(bridge.bridge_port),
      connect_via: 'emulator_bridge',
    };
  }
  const localPort = localBridgePortForProxyRow(proxyConfig.host, proxyConfig.port);
  if (localPort) {
    return {
      ...proxyConfig,
      host: '127.0.0.1',
      port: localPort,
      connect_via: 'local_bridge',
      canonical_host: canonicalProxyHost(proxyConfig.host, proxyConfig.port),
    };
  }
  return { ...proxyConfig, connect_via: 'upstream' };
}

/** Map localhost proxy rows to a host reachable from inside Docker. */
function rewriteProxyHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  if (normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1') {
    return getProxyLocalHostAlias();
  }
  return String(host || '').trim();
}

function buildProxyUrl(config) {
  const type = String(config.proxy_type || 'http').toLowerCase();
  const host = rewriteProxyHost(config.host);
  const port = config.port;
  const auth =
    config.username != null && String(config.username).length > 0
      ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password || '')}@`
      : '';
  if (type === 'socks5' || type === 'socks') {
    return `socks5://${auth}${host}:${port}`;
  }
  if (type === 'https') {
    return `https://${auth}${host}:${port}`;
  }
  return `http://${auth}${host}:${port}`;
}

function createAgent(proxyUrl) {
  if (proxyUrl.startsWith('socks')) {
    return new SocksProxyAgent(proxyUrl);
  }
  return new HttpsProxyAgent(proxyUrl);
}

/**
 * Axios instance that routes all traffic through the persona proxy.
 * @param {ProxyConfig} proxyConfig
 * @param {{ timeout?: number, personaId?: string, accountId?: string }} [meta]
 */
function createProxyAxios(proxyConfig, meta = {}) {
  if (!proxyConfig?.host || !proxyConfig?.port) {
    if (ENFORCE_PERSONA_EGRESS) {
      const err = new Error('PERSONA_PROXY_REQUIRED: no proxy configured for outbound request');
      err.code = 'PERSONA_PROXY_REQUIRED';
      throw err;
    }
    return axios.create({ timeout: meta.timeout || 30_000 });
  }

  const proxyUrl = buildProxyUrl(proxyConfig);
  const agent = createAgent(proxyUrl);
  const instance = axios.create({
    timeout: meta.timeout || 30_000,
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
  });

  instance.interceptors.request.use((cfg) => {
    cfg.headers = cfg.headers || {};
    if (meta.personaId) cfg.headers['x-persona-id'] = meta.personaId;
    if (meta.accountId) cfg.headers['x-account-id'] = meta.accountId;
    cfg.headers['x-egress-via'] = 'persona-proxy';
    return cfg;
  });

  return instance;
}

async function getAxiosForAccount(accountId, options = {}) {
  const proxyConfig = withRuntimeProxyHost(await PersonaService.resolveProxyConfigForAccount(accountId));
  const persona = await PersonaService.getPersonaForAccount(accountId);
  return createProxyAxios(proxyConfig, {
    timeout: options.timeout,
    personaId: persona?.id,
    accountId,
  });
}

function withRuntimeProxyHost(proxyConfig) {
  if (!proxyConfig) return proxyConfig;
  return { ...proxyConfig, host: rewriteProxyHost(proxyConfig.host) };
}

async function getAxiosForPersona(personaId, options = {}) {
  const proxyConfig = withRuntimeProxyHost(await PersonaService.resolveProxyConfigForPersona(personaId));
  return createProxyAxios(proxyConfig, { timeout: options.timeout, personaId });
}

function testTcpReachability(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve();
    });
    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connect timeout'));
    });
  });
}

async function verifyEgressIp(axiosInstance) {
  let lastErr;
  for (const url of EGRESS_CHECK_URLS) {
    try {
      const resp = await axiosInstance.get(url, { timeout: 15_000 });
      const body = String(resp.data || '').trim();
      const ip = body.match(/\d{1,3}(?:\.\d{1,3}){3}/);
      if (ip) return ip[0];
      if (body) return body;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Egress check failed for all configured URLs');
}

/**
 * Verify persona egress via ipify (or fallbacks) through assigned proxy.
 * @param {string} personaId
 */
async function verifyEgressForPersona(personaId) {
  const proxyConfig = await PersonaService.resolveProxyConfigForPersona(personaId);
  if (!proxyConfig?.host || !proxyConfig?.port) {
    const assigned = await PersonaService.getAssignedProxyForPersona(personaId);
    if (assigned?.proxy_id) {
      const err = new Error(
        `Proxy ${assigned.host}:${assigned.port} is assigned but inactive (health check failed or disabled). ` +
          'Fix the proxy host/port, ensure a listener is running, re-enable it on the Proxies page, or assign another proxy.',
      );
      err.code = 'PROXY_INACTIVE';
      err.status = 409;
      err.proxy = { host: assigned.host, port: assigned.port, is_active: false };
      throw err;
    }
    const err = new Error('No proxy assigned to this persona. Assign one on the Personas page first.');
    err.code = 'NO_ACTIVE_PROXY';
    err.status = 404;
    throw err;
  }

  const connectConfig = await resolveEgressConnectConfig(proxyConfig, personaId);
  const runtimeConfig = withRuntimeProxyHost(connectConfig);
  const displayHost = connectConfig.canonical_host || proxyConfig.host;
  try {
    await testTcpReachability(runtimeConfig.host, runtimeConfig.port);
  } catch (tcpErr) {
    const via = connectConfig.connect_via || 'upstream';
    const err = new Error(
      `Cannot reach proxy at ${displayHost}:${proxyConfig.port} (from DE: ${runtimeConfig.host}:${runtimeConfig.port}, via=${via})`,
    );
    err.code = 'PROXY_UNREACHABLE';
    err.status = 502;
    err.hint =
      via === 'local_bridge' || via === 'emulator_bridge'
        ? `${PROXY_UNREACHABLE_HINT} Start the proxy bridge: bind the persona device on Emulators and assign the proxy to the account so emulator-controller opens port ${connectConfig.port}.`
        : PROXY_UNREACHABLE_HINT;
    err.detail = tcpErr.message;
    err.proxy = {
      host: displayHost,
      port: proxyConfig.port,
      connect_host: runtimeConfig.host,
      connect_port: runtimeConfig.port,
      connect_via: via,
    };
    throw err;
  }

  const client = createProxyAxios(connectConfig, { timeout: 20_000, personaId });

  try {
    const ip = await verifyEgressIp(client);
    return {
      egress_ip: ip,
      proxy: {
        host: displayHost,
        port: proxyConfig.port,
        connect_host: runtimeConfig.host,
        connect_port: runtimeConfig.port,
        connect_via: connectConfig.connect_via,
      },
    };
  } catch (err) {
    const wrapped = new Error(
      `Proxy reachable but egress check failed via ${displayHost}:${proxyConfig.port}: ${err.message}`,
    );
    wrapped.code = err.code || 'EGRESS_CHECK_FAILED';
    wrapped.status = 502;
    wrapped.hint = PROXY_UNREACHABLE_HINT;
    wrapped.detail = err.message;
    wrapped.proxy = {
      host: displayHost,
      port: proxyConfig.port,
      connect_host: runtimeConfig.host,
      connect_port: runtimeConfig.port,
    };
    throw wrapped;
  }
}

module.exports = {
  ENFORCE_PERSONA_EGRESS,
  USE_PERSONA_PROXY_FOR_GRAPH,
  PROXY_UNREACHABLE_HINT,
  rewriteProxyHost,
  buildProxyUrl,
  createProxyAxios,
  getAxiosForAccount,
  getAxiosForPersona,
  testTcpReachability,
  verifyEgressIp,
  verifyEgressForPersona,
};
