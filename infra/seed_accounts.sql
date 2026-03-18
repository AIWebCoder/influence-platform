-- Run this script using:
-- docker exec -it ip_postgres psql -U ipuser -d influence_platform -f /infra/seed_accounts.sql

INSERT INTO accounts (id, username, password_hash, niche, status, health_score, proxy_url)
VALUES
    ('seed_bot_01', 'fitness_bot_01', 'placeholder_encrypted_password_for_testing', 'fitness', 'active', 98, NULL),
    ('seed_bot_02', 'startup_bot_02', 'placeholder_encrypted_password_for_testing', 'business', 'warming', 75, NULL),
    ('seed_bot_03', 'food_bot_03', 'placeholder_encrypted_password_for_testing', 'food', 'active', 88, NULL),
    ('seed_bot_04', 'travel_bot_04', 'placeholder_encrypted_password_for_testing', 'travel', 'inactive', 45, NULL),
    ('seed_bot_05', 'lifestyle_bot_05', 'placeholder_encrypted_password_for_testing', 'lifestyle', 'warming', 62, NULL)
ON CONFLICT (id) DO NOTHING;
