const { getPool } = require('../core/database');
const { v4: uuidv4 } = require('uuid');
const { decryptProxyPassword } = require('./proxyCredentials');

const PROXY_STRICT_ONE_TO_ONE = process.env.PROXY_STRICT_ONE_TO_ONE !== 'false';

class PersonaService {
  async listPersonas({ status, limit = 100, offset = 0 } = {}) {
    const pool = getPool();
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE p.status = $${params.length}`;
    }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT p.*,
              pr.host AS proxy_host, pr.port AS proxy_port, pr.is_active AS proxy_is_active,
              pdb.emulator_serial,
              (SELECT COUNT(*)::int FROM accounts a WHERE a.persona_id = p.id) AS account_count
       FROM personas p
       LEFT JOIN proxies pr ON pr.id = p.proxy_id
       LEFT JOIN persona_device_bindings pdb ON pdb.persona_id = p.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return result.rows;
  }

  async getPersonaById(personaId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.*, pr.host AS proxy_host, pr.port AS proxy_port, pr.proxy_type, pr.is_active AS proxy_is_active,
              pdb.emulator_serial, pdb.status AS device_status, pdb.last_seen_at
       FROM personas p
       LEFT JOIN proxies pr ON pr.id = p.proxy_id
       LEFT JOIN persona_device_bindings pdb ON pdb.persona_id = p.id
       WHERE p.id = $1`,
      [personaId],
    );
    return result.rows[0] || null;
  }

  async getPersonaForAccount(accountId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.*
       FROM accounts a
       JOIN personas p ON p.id = a.persona_id
       WHERE a.id = $1`,
      [accountId],
    );
    if (result.rows.length > 0) return result.rows[0];

    // Legacy fallback: synthesize view from account.proxy_id
    const legacy = await pool.query(
      `SELECT a.id AS legacy_account_id, a.proxy_id, a.username
       FROM accounts a WHERE a.id = $1`,
      [accountId],
    );
    if (legacy.rows.length === 0 || !legacy.rows[0].proxy_id) return null;
    return {
      id: null,
      name: `legacy-${legacy.rows[0].username}`,
      proxy_id: legacy.rows[0].proxy_id,
      timezone: 'Europe/Paris',
      locale: 'fr-FR',
      status: 'active',
      _legacy: true,
    };
  }

  async getAccountsForPersona(personaId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, username, platform, status, health_score, ig_user_id,
              (ig_access_token IS NOT NULL AND btrim(ig_access_token) <> '') AS ig_token_configured
       FROM accounts WHERE persona_id = $1 ORDER BY platform, username`,
      [personaId],
    );
    return result.rows;
  }

  async resolveProxyConfigForPersona(personaId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT pr.id AS proxy_id, pr.host, pr.port, pr.username, pr.password_encrypted,
              pr.proxy_type, pr.auth_mode, pr.is_active
       FROM personas p
       JOIN proxies pr ON pr.id = p.proxy_id
       WHERE p.id = $1 AND pr.is_active = true`,
      [personaId],
    );
    if (result.rows.length === 0) return null;
    return this._rowToProxyConfig(result.rows[0]);
  }

  async resolveProxyConfigForAccount(accountId) {
    const persona = await this.getPersonaForAccount(accountId);
    if (persona?.id) {
      return this.resolveProxyConfigForPersona(persona.id);
    }
    if (persona?.proxy_id) {
      const pool = getPool();
      const result = await pool.query(
        `SELECT id AS proxy_id, host, port, username, password_encrypted, proxy_type, auth_mode, is_active
         FROM proxies WHERE id = $1 AND is_active = true`,
        [persona.proxy_id],
      );
      if (result.rows.length === 0) return null;
      return this._rowToProxyConfig(result.rows[0]);
    }
    const pool = getPool();
    const direct = await pool.query(
      `SELECT pr.id AS proxy_id, pr.host, pr.port, pr.username, pr.password_encrypted, pr.proxy_type, pr.auth_mode
       FROM accounts a
       JOIN proxies pr ON pr.id = a.proxy_id
       WHERE a.id = $1 AND pr.is_active = true`,
      [accountId],
    );
    if (direct.rows.length === 0) return null;
    return this._rowToProxyConfig(direct.rows[0]);
  }

  _rowToProxyConfig(row) {
    return {
      proxy_id: row.proxy_id,
      host: row.host,
      port: Number(row.port),
      proxy_type: row.proxy_type || 'http',
      auth_mode: row.auth_mode || 'credentials',
      username: row.username || null,
      password: decryptProxyPassword(row.password_encrypted),
    };
  }

  async createPersona({
    name,
    proxy_id = null,
    timezone = 'Europe/Paris',
    locale = 'fr-FR',
    status = 'active',
  }) {
    const pool = getPool();
    const id = uuidv4();
    const result = await pool.query(
      `INSERT INTO personas (id, name, proxy_id, timezone, locale, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, name, proxy_id, timezone, locale, status],
    );
    await pool.query(
      `INSERT INTO persona_behavior_profiles (persona_id) VALUES ($1)
       ON CONFLICT (persona_id) DO NOTHING`,
      [id],
    );
    await pool.query(
      `INSERT INTO persona_fingerprints (persona_id) VALUES ($1)
       ON CONFLICT (persona_id) DO NOTHING`,
      [id],
    );
    if (proxy_id) {
      await pool.query('UPDATE proxies SET assigned_persona_id = $1 WHERE id = $2', [id, proxy_id]);
    }
    return result.rows[0];
  }

  async assignProxyToPersona(personaId, proxyId) {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (PROXY_STRICT_ONE_TO_ONE) {
        const taken = await client.query(
          `SELECT id FROM personas WHERE proxy_id = $1 AND id <> $2 LIMIT 1`,
          [proxyId, personaId],
        );
        if (taken.rows.length > 0) {
          throw new Error('Proxy already assigned to another persona');
        }
      }
      await client.query(
        `UPDATE personas SET proxy_id = $1, updated_at = NOW() WHERE id = $2`,
        [proxyId, personaId],
      );
      await client.query(
        'UPDATE proxies SET assigned_persona_id = NULL WHERE assigned_persona_id = $1',
        [personaId],
      );
      await client.query(
        'UPDATE proxies SET assigned_persona_id = $1 WHERE id = $2',
        [personaId, proxyId],
      );
      await client.query(
        'UPDATE accounts SET proxy_id = $1 WHERE persona_id = $2',
        [proxyId, personaId],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return this.getPersonaById(personaId);
  }

  async assignAccountToPersona(accountId, personaId) {
    const pool = getPool();
    const persona = await this.getPersonaById(personaId);
    if (!persona) throw new Error('Persona not found');
    await pool.query(
      `UPDATE accounts SET persona_id = $1, proxy_id = $2, updated_at = NOW() WHERE id = $3`,
      [personaId, persona.proxy_id, accountId],
    );
    return this.getPersonaForAccount(accountId);
  }

  async bindDevice(personaId, emulatorSerial, { adb_port = null, appium_port = null } = {}) {
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO persona_device_bindings (persona_id, emulator_serial, adb_port, appium_port, last_seen_at, status)
       VALUES ($1, $2, $3, $4, NOW(), 'active')
       ON CONFLICT (persona_id)
       DO UPDATE SET emulator_serial = EXCLUDED.emulator_serial,
                     adb_port = EXCLUDED.adb_port,
                     appium_port = EXCLUDED.appium_port,
                     last_seen_at = NOW(),
                     status = 'active',
                     updated_at = NOW()
       RETURNING *`,
      [personaId, emulatorSerial, adb_port, appium_port],
    );
    return result.rows[0];
  }

  async getPersonaForDevice(emulatorSerial) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT p.*, pdb.emulator_serial, pdb.status AS device_binding_status
       FROM persona_device_bindings pdb
       JOIN personas p ON p.id = pdb.persona_id
       WHERE pdb.emulator_serial = $1`,
      [emulatorSerial],
    );
    return result.rows[0] || null;
  }

  async deletePersona(personaId) {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT id FROM personas WHERE id = $1', [personaId]);
      if (existing.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('UPDATE accounts SET persona_id = NULL WHERE persona_id = $1', [personaId]);
      await client.query('UPDATE proxies SET assigned_persona_id = NULL WHERE assigned_persona_id = $1', [
        personaId,
      ]);
      await client.query('DELETE FROM personas WHERE id = $1', [personaId]);
      await client.query('COMMIT');
      return { deleted: true, id: personaId };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getProxyCredentialsPayload(accountId) {
    const proxyConfig = await this.resolveProxyConfigForAccount(accountId);
    if (!proxyConfig) {
      const err = new Error('No proxy configured for account persona');
      err.statusCode = 404;
      throw err;
    }
    const persona = await this.getPersonaForAccount(accountId);
    return {
      persona_id: persona?.id || null,
      proxy_id: proxyConfig.proxy_id,
      host: proxyConfig.host,
      port: proxyConfig.port,
      username: proxyConfig.username,
      password: proxyConfig.password,
      proxy_type: proxyConfig.proxy_type,
      auth_mode: proxyConfig.auth_mode,
    };
  }
}

module.exports = new PersonaService();
