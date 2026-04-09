-- Proxy protocol metadata + persistent emulator/bridge bindings
ALTER TABLE proxies
    ADD COLUMN IF NOT EXISTS proxy_type VARCHAR(16) NOT NULL DEFAULT 'http'
    CHECK (proxy_type IN ('http', 'https', 'socks5'));

ALTER TABLE proxies
    ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(16) NOT NULL DEFAULT 'credentials'
    CHECK (auth_mode IN ('credentials', 'ip_whitelist', 'none'));

ALTER TABLE proxies
    ADD COLUMN IF NOT EXISTS rotation_hint VARCHAR(64);

ALTER TABLE proxies
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(128);

CREATE TABLE IF NOT EXISTS emulator_proxy_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    emulator_serial VARCHAR(64) NOT NULL,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    proxy_id UUID REFERENCES proxies(id) ON DELETE SET NULL,
    bridge_host VARCHAR(128) NOT NULL,
    bridge_port INTEGER NOT NULL CHECK (bridge_port > 0),
    bridge_id VARCHAR(128) NOT NULL,
    last_applied_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'error', 'stale')),
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (emulator_serial),
    UNIQUE (account_id)
);

CREATE INDEX IF NOT EXISTS idx_emulator_proxy_bindings_proxy_id
    ON emulator_proxy_bindings(proxy_id);

CREATE OR REPLACE FUNCTION update_emulator_proxy_bindings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_emulator_proxy_bindings_updated_at ON emulator_proxy_bindings;
CREATE TRIGGER trigger_emulator_proxy_bindings_updated_at
    BEFORE UPDATE ON emulator_proxy_bindings
    FOR EACH ROW EXECUTE FUNCTION update_emulator_proxy_bindings_updated_at();
