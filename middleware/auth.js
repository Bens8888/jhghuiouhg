const jwt = require('jsonwebtoken');

function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.admin_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { adminAuth };
