const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const serviceUsername = process.env.DISTRIBUTION_API_USERNAME;
  const servicePassword = process.env.DISTRIBUTION_API_PASSWORD;
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({ error: 'JWT_SECRET is not configured' });
  }
  if (!serviceUsername || !servicePassword) {
    return res.status(500).json({ error: 'Distribution API credentials are not configured' });
  }
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (username !== serviceUsername || password !== servicePassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { sub: username, role: 'service', type: 'access' },
    secret,
    { expiresIn: '12h' }
  );
  return res.json({ access_token: token, token_type: 'bearer' });
});

module.exports = router;

