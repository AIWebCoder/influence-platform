const express = require('express');
const PersonaService = require('../persona/personaService');
const ProxyHttpClient = require('../persona/proxyHttpClient');
const { recordProxyRequest } = require('../persona/personaMetrics');
const { allowsPersona, forbidViewerWrite } = require('../core/accessScope');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const rows = await PersonaService.listPersonas({ status, scope: req.accessScope });
    return res.json({ personas: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  try {
    const { name, proxy_id, timezone, locale, status } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const persona = await PersonaService.createPersona({
      name: String(name).trim(),
      proxy_id: proxy_id || null,
      timezone,
      locale,
      status,
      organization_id: req.accessScope?.organizationId || null,
    });
    return res.status(201).json(persona);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const persona = await PersonaService.getPersonaById(req.params.id);
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    if (!allowsPersona(req.accessScope, persona.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const accounts = await PersonaService.getAccountsForPersona(req.params.id);
    return res.json({ ...persona, accounts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  try {
    if (!allowsPersona(req.accessScope, req.params.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await PersonaService.deletePersona(req.params.id);
    if (!result) return res.status(404).json({ error: 'Persona not found' });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/:id/proxy/assign', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  if (!allowsPersona(req.accessScope, req.params.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const proxyId = req.body?.proxy_id;
    if (!proxyId) return res.status(400).json({ error: 'proxy_id is required' });
    const persona = await PersonaService.assignProxyToPersona(req.params.id, proxyId);
    return res.json({ success: true, persona });
  } catch (err) {
    const status = err.message.includes('already assigned') ? 409 : 400;
    return res.status(status).json({ error: err.message });
  }
});

router.post('/:id/device/bind', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  if (!allowsPersona(req.accessScope, req.params.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const { emulator_serial, adb_port, appium_port } = req.body || {};
    if (!emulator_serial) return res.status(400).json({ error: 'emulator_serial is required' });
    const binding = await PersonaService.bindDevice(req.params.id, String(emulator_serial), {
      adb_port,
      appium_port,
    });
    return res.json({ success: true, binding });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/:id/accounts/:accountId', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  if (!allowsPersona(req.accessScope, req.params.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    await PersonaService.assignAccountToPersona(req.params.accountId, req.params.id);
    const accounts = await PersonaService.getAccountsForPersona(req.params.id);
    return res.json({ success: true, accounts });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.get('/:id/proxy-credentials', async (req, res) => {
  try {
    const persona = await PersonaService.getPersonaById(req.params.id);
    if (!persona?.proxy_id) return res.status(404).json({ error: 'No proxy on persona' });
    const config = await PersonaService.resolveProxyConfigForPersona(req.params.id);
    return res.json({
      persona_id: req.params.id,
      proxy_id: config.proxy_id,
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      proxy_type: config.proxy_type,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** Verify egress IP for persona (ipify through proxy). */
router.post('/:id/verify-egress', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  if (!allowsPersona(req.accessScope, req.params.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const started = Date.now();
  try {
    const { egress_ip, proxy } = await ProxyHttpClient.verifyEgressForPersona(req.params.id);
    recordProxyRequest({
      personaId: req.params.id,
      platform: 'egress-check',
      success: true,
      durationMs: Date.now() - started,
      stage: 'ipify',
    });
    return res.json({
      success: true,
      egress_ip,
      persona_id: req.params.id,
      proxy_host: proxy.host,
      proxy_port: proxy.port,
    });
  } catch (err) {
    recordProxyRequest({
      personaId: req.params.id,
      platform: 'egress-check',
      success: false,
      durationMs: Date.now() - started,
    });
    const status = err.status || 502;
    return res.status(status).json({
      error: err.message,
      code: err.code || null,
      hint: err.hint || ProxyHttpClient.PROXY_UNREACHABLE_HINT,
      detail: err.detail || null,
      proxy: err.proxy || null,
    });
  }
});

module.exports = router;
