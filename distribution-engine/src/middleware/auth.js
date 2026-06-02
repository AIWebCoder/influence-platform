const jwt = require('jsonwebtoken');
const { loadAccessScope } = require('../core/accessScope');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice('Bearer '.length).trim();
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(401).json({ error: 'JWT_SECRET is not configured' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  loadAccessScope(decoded)
    .then((scope) => {
      req.accessScope = scope;
      return next();
    })
    .catch((err) => {
      console.error('access scope resolution failed:', err.message || err);
      return res.status(500).json({
        error: 'Failed to resolve access scope',
        details: process.env.NODE_ENV === 'development' ? String(err.message || err) : undefined,
      });
    });
}

module.exports = authMiddleware;