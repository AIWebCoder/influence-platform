const { getPool } = require('./database');

const DEFAULT_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

const ROLE_ALIASES = {
  operateur: 'operator',
  'opérateur': 'operator',
  lecteur: 'viewer',
};

function normalizeRole(role) {
  const raw = String(role || 'viewer').trim().toLowerCase();
  const mapped = ROLE_ALIASES[raw] || raw;
  if (mapped === 'admin' || mapped === 'operator' || mapped === 'viewer') return mapped;
  return 'viewer';
}

function accessMode() {
  const mode = (process.env.ACCESS_MODE || 'scoped').trim().toLowerCase();
  return mode === 'fleet' ? 'fleet' : 'scoped';
}

async function resolveUserRow(pool, claims) {
  if (claims.user_id) {
    const byId = await pool.query(
      `SELECT id, email, role, organization_id FROM users WHERE id = $1::uuid LIMIT 1`,
      [claims.user_id],
    );
    if (byId.rows[0]) return byId.rows[0];
  }
  const email = String(claims.sub || claims.email || '').trim().toLowerCase();
  if (!email) return null;
  const byEmail = await pool.query(
    `SELECT id, email, role, organization_id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [email],
  );
  return byEmail.rows[0] || null;
}

function scopeFromClaims(claims, row, personaIds) {
  const role = normalizeRole(row?.role || claims.role);
  const mode = accessMode();
  const organizationId = row?.organization_id
    ? String(row.organization_id)
    : claims.organization_id
      ? String(claims.organization_id)
      : DEFAULT_ORGANIZATION_ID;
  const userId = row?.id ? String(row.id) : claims.user_id ? String(claims.user_id) : null;
  const isAdmin = role === 'admin';
  const isFleet = mode === 'fleet' || isAdmin;
  return {
    userId,
    organizationId,
    role,
    mode,
    personaIds,
    isAdmin,
    isFleet,
    isViewer: role === 'viewer',
  };
}

async function loadAccessScope(claims) {
  const pool = getPool();
  try {
    const row = await resolveUserRow(pool, claims);
    const role = normalizeRole(row?.role || claims.role);
    const organizationId = row?.organization_id
      ? String(row.organization_id)
      : claims.organization_id
        ? String(claims.organization_id)
        : DEFAULT_ORGANIZATION_ID;
    let userId = row?.id ? String(row.id) : claims.user_id ? String(claims.user_id) : null;
    if (!userId && row?.id) userId = String(row.id);

    let personaIds = null;
    if (accessMode() === 'scoped' && role !== 'admin' && userId) {
      const res = await pool.query(
        `SELECT upa.persona_id::text
         FROM user_persona_assignments upa
         JOIN personas p ON p.id = upa.persona_id
         WHERE upa.user_id = $1::uuid
           AND (p.organization_id = $2::uuid OR p.organization_id IS NULL)`,
        [userId, organizationId],
      );
      personaIds = res.rows.map((r) => r.persona_id);
    }

    return scopeFromClaims(claims, row, personaIds);
  } catch (err) {
    console.error('[accessScope] loadAccessScope failed:', err.message || err);
    return scopeFromClaims(claims, null, []);
  }
}

function allowsPersona(scope, personaId) {
  if (!personaId) return scope.isFleet;
  if (scope.isFleet) return true;
  if (!scope.personaIds || scope.personaIds.length === 0) return false;
  return scope.personaIds.includes(String(personaId));
}

function forbidViewerWrite(scope, res) {
  if (scope?.isViewer) {
    res.status(403).json({ error: 'Read-only access for viewer role' });
    return true;
  }
  return false;
}

async function getAllowedAccountIds(pool, scope) {
  if (scope.isFleet) {
    const res = await pool.query(
      `SELECT id::text AS id FROM accounts
       WHERE organization_id = $1::uuid OR organization_id IS NULL`,
      [scope.organizationId],
    );
    return res.rows.map((r) => r.id);
  }
  if (!scope.personaIds || scope.personaIds.length === 0) return [];
  const res = await pool.query(
    `SELECT id::text AS id FROM accounts
     WHERE persona_id = ANY($1::uuid[])
       AND (organization_id = $2::uuid OR organization_id IS NULL)`,
    [scope.personaIds, scope.organizationId],
  );
  return res.rows.map((r) => r.id);
}

async function assertAccountAccess(pool, scope, accountId) {
  const id = String(accountId || '').trim();
  if (!id) {
    const err = new Error('account_id required');
    err.statusCode = 400;
    throw err;
  }
  const allowed = await getAllowedAccountIds(pool, scope);
  if (!allowed.includes(id)) {
    const err = new Error('Access denied for this account');
    err.statusCode = 403;
    throw err;
  }
  return id;
}

function buildPersonaScope(scope, alias = 'p', startIndex = 1) {
  const params = [];
  let i = startIndex;
  const parts = [`(${alias}.organization_id = $${i}::uuid OR ${alias}.organization_id IS NULL)`];
  params.push(scope.organizationId);
  i += 1;
  if (!scope.isFleet) {
    if (!scope.personaIds || scope.personaIds.length === 0) {
      parts.push('FALSE');
    } else {
      parts.push(`${alias}.id = ANY($${i}::uuid[])`);
      params.push(scope.personaIds);
      i += 1;
    }
  }
  return { clause: parts.join(' AND '), params, nextIndex: i };
}

function buildAccountScope(scope, alias = 'a', startIndex = 1) {
  const params = [];
  let i = startIndex;
  const parts = [`(${alias}.organization_id = $${i}::uuid OR ${alias}.organization_id IS NULL)`];
  params.push(scope.organizationId);
  i += 1;
  if (!scope.isFleet) {
    if (!scope.personaIds || scope.personaIds.length === 0) {
      parts.push('FALSE');
    } else {
      parts.push(`${alias}.persona_id = ANY($${i}::uuid[])`);
      params.push(scope.personaIds);
      i += 1;
    }
  }
  return { clause: parts.join(' AND '), params, nextIndex: i };
}

function redactProxyRow(row, scope) {
  if (!row || scope.isAdmin) return row;
  const copy = { ...row };
  delete copy.password_encrypted;
  delete copy.username;
  return copy;
}

function filterProxiesForScope(rows, scope) {
  if (scope.isFleet) {
    return scope.isAdmin ? rows : rows.map((r) => redactProxyRow(r, scope));
  }
  if (!scope.personaIds || scope.personaIds.length === 0) return [];
  const allowed = new Set(scope.personaIds.map(String));
  return rows
    .filter((r) => r.assigned_persona_id && allowed.has(String(r.assigned_persona_id)))
    .map((r) => redactProxyRow(r, scope));
}

module.exports = {
  DEFAULT_ORGANIZATION_ID,
  accessMode,
  normalizeRole,
  loadAccessScope,
  allowsPersona,
  forbidViewerWrite,
  getAllowedAccountIds,
  assertAccountAccess,
  buildPersonaScope,
  buildAccountScope,
  redactProxyRow,
  filterProxiesForScope,
};