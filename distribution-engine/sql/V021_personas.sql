-- V021: Digital personas (see docs/architecture/persona-digital-identity-architecture.md)

CREATE TABLE IF NOT EXISTS personas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(120) NOT NULL,
    proxy_id UUID REFERENCES proxies(id) ON DELETE SET NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
    locale VARCHAR(16) NOT NULL DEFAULT 'fr-FR',
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'warming', 'suspended', 'banned')),
    risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_name_lower ON personas (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_personas_status ON personas (status);
CREATE INDEX IF NOT EXISTS idx_personas_proxy_id ON personas (proxy_id);

CREATE TABLE IF NOT EXISTS persona_fingerprints (
    persona_id UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
    user_agent TEXT,
    viewport_width INTEGER,
    viewport_height INTEGER,
    device_scale NUMERIC(4,2),
    platform VARCHAR(32),
    device_model VARCHAR(64),
    os_version VARCHAR(32),
    extra JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS persona_behavior_profiles (
    persona_id UUID PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
    posting_window_start TIME,
    posting_window_end TIME,
    min_action_delay_ms INTEGER NOT NULL DEFAULT 1200,
    max_action_delay_ms INTEGER NOT NULL DEFAULT 4500,
    max_posts_per_day INTEGER NOT NULL DEFAULT 3,
    max_likes_per_hour INTEGER NOT NULL DEFAULT 20,
    max_follows_per_day INTEGER NOT NULL DEFAULT 15,
    randomization_seed INTEGER,
    extra JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS persona_device_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    emulator_serial VARCHAR(64) NOT NULL,
    adb_port INTEGER,
    appium_port INTEGER,
    active_session BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMPTZ,
    status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'offline', 'error', 'maintenance')),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (persona_id),
    UNIQUE (emulator_serial)
);

CREATE INDEX IF NOT EXISTS idx_persona_device_bindings_status ON persona_device_bindings (status);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES personas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_persona_id ON accounts (persona_id);

ALTER TABLE emulator_proxy_bindings ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES personas(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_emulator_proxy_bindings_persona_id ON emulator_proxy_bindings (persona_id);

ALTER TABLE proxies ADD COLUMN IF NOT EXISTS assigned_persona_id UUID REFERENCES personas(id) ON DELETE SET NULL;

INSERT INTO personas (id, name, proxy_id, timezone, locale, status, risk_score)
SELECT uuid_generate_v4(), 'persona-' || LEFT(a.id::text, 8), a.proxy_id,
       COALESCE(NULLIF(TRIM(a.metadata->>'timezone'), ''), 'Europe/Paris'),
       COALESCE(NULLIF(TRIM(a.metadata->>'locale'), ''), 'fr-FR'),
       CASE WHEN a.status IN ('banned', 'suspended') THEN a.status WHEN a.status = 'active' THEN 'active' ELSE 'warming' END,
       GREATEST(0, LEAST(100, 100 - COALESCE(a.health_score, 100)))
FROM accounts a
WHERE a.persona_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM personas p WHERE p.name = 'persona-' || LEFT(a.id::text, 8));

UPDATE accounts a SET persona_id = p.id FROM personas p
WHERE a.persona_id IS NULL AND p.name = 'persona-' || LEFT(a.id::text, 8);

UPDATE proxies pr SET assigned_persona_id = pe.id FROM personas pe
WHERE pe.proxy_id = pr.id AND pr.assigned_persona_id IS NULL;

UPDATE emulator_proxy_bindings epb SET persona_id = a.persona_id FROM accounts a
WHERE epb.account_id = a.id AND epb.persona_id IS NULL AND a.persona_id IS NOT NULL;
