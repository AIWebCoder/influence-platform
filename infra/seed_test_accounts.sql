-- Optional real-account test seeds (Phase 2). Replace password_encrypted with a real stored secret before use.

INSERT INTO niches (name, description, hashtags, posting_times)
SELECT 'Real Testing Niche', 'Niche for end-to-end real account testing', '[]'::jsonb, '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM niches WHERE name = 'Real Testing Niche');

INSERT INTO accounts (id, username, password_encrypted, status, health_score, metadata)
VALUES
    (
        uuid_generate_v4(),
        'test_username_1',
        '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        'active',
        100,
        '{"niche":"Real Testing Niche"}'::jsonb
    ),
    (
        uuid_generate_v4(),
        'test_username_2',
        '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        'active',
        100,
        '{"niche":"Real Testing Niche"}'::jsonb
    )
ON CONFLICT (username) DO NOTHING;
