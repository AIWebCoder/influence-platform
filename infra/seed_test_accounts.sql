-- Seed script for testing real Instagram accounts (Phase 2 J19-J20)
-- Replace 'your_test_username' and 'your_hashed_password' before running if testing locally.

INSERT INTO niches (id, name, description)
VALUES 
    ('niche_test_real', 'Real Testing Niche', 'Niche for end-to-end real account testing')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, username, password_hash, niche, status, health_score, proxy_url)
VALUES
    (
        'test_acc_001', 
        'test_username_1', 
        -- This should be a properly hashed password using bcrypt in a real scenario
        '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 
        'niche_test_real', 
        'active', 
        100, 
        'http://proxy-user:proxy-pass@proxy.example.com:8000'
    ),
    (
        'test_acc_002', 
        'test_username_2', 
        '$2a$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', 
        'niche_test_real', 
        'active', 
        100, 
        'http://proxy-user:proxy-pass@proxy.example.com:8000'
    )
ON CONFLICT (username) DO NOTHING;
