-- Seed demo accounts (columns must match infra/init.sql `accounts`).
-- Run from host, e.g.:
--   docker compose exec -T postgres psql -U ipuser -d influence_platform -f path/to/seed_accounts.sql

INSERT INTO accounts (id, username, password_encrypted, status, health_score, metadata)
VALUES
    (uuid_generate_v4(), 'fitness_bot_01', 'placeholder_encrypted_password_for_testing', 'active', 98, '{"niche":"fitness"}'::jsonb),
    (uuid_generate_v4(), 'startup_bot_02', 'placeholder_encrypted_password_for_testing', 'warming', 75, '{"niche":"business"}'::jsonb),
    (uuid_generate_v4(), 'food_bot_03', 'placeholder_encrypted_password_for_testing', 'active', 88, '{"niche":"food"}'::jsonb),
    (uuid_generate_v4(), 'travel_bot_04', 'placeholder_encrypted_password_for_testing', 'inactive', 45, '{"niche":"travel"}'::jsonb),
    (uuid_generate_v4(), 'lifestyle_bot_05', 'placeholder_encrypted_password_for_testing', 'warming', 62, '{"niche":"lifestyle"}'::jsonb)
ON CONFLICT (username) DO NOTHING;
