-- V028: Organization boundaries + operator persona assignments
-- Run on existing DBs after deploy; backfill is included (idempotent).

INSERT INTO organizations (id, name, slug, plan, status, is_active, max_accounts, max_users)
VALUES (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'Influence Platform',
    'influence',
    'scale',
    'active',
    true,
    500,
    50
)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE personas ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS ix_personas_organization_id ON personas(organization_id);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS ix_accounts_organization_id ON accounts(organization_id);

CREATE TABLE IF NOT EXISTS user_persona_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, persona_id)
);

CREATE INDEX IF NOT EXISTS ix_upa_user_id ON user_persona_assignments(user_id);
CREATE INDEX IF NOT EXISTS ix_upa_persona_id ON user_persona_assignments(persona_id);

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS ix_generation_jobs_organization_id ON generation_jobs(organization_id);
CREATE INDEX IF NOT EXISTS ix_generation_jobs_created_by_user_id ON generation_jobs(created_by_user_id);

UPDATE users SET organization_id = '00000000-0000-4000-8000-000000000001'::uuid WHERE organization_id IS NULL;
UPDATE personas SET organization_id = '00000000-0000-4000-8000-000000000001'::uuid WHERE organization_id IS NULL;
UPDATE accounts SET organization_id = '00000000-0000-4000-8000-000000000001'::uuid WHERE organization_id IS NULL;
UPDATE accounts a SET organization_id = p.organization_id FROM personas p WHERE a.persona_id = p.id AND a.organization_id IS DISTINCT FROM p.organization_id AND p.organization_id IS NOT NULL;
UPDATE generation_jobs SET organization_id = '00000000-0000-4000-8000-000000000001'::uuid WHERE organization_id IS NULL;