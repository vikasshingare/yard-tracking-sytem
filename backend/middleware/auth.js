const jwt = require('jsonwebtoken');

async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const pool = req.app.locals.pool;
    const [[user]] = await pool.execute('SELECT id, display_name, role, is_active FROM Users WHERE id = ?', [claims.id]);
    if (!user || !user.is_active) return res.status(401).json({ error: 'This account is inactive. Contact an administrator.' });
    const [yards] = await pool.execute('SELECT yard_id AS yardId FROM UserYards WHERE user_id = ?', [user.id]);
    const [gates] = await pool.execute('SELECT gate_id AS gateId FROM UserGates WHERE user_id = ?', [user.id]);
    req.user = { id: user.id, role: user.role, name: user.display_name, yardIds: yards.map((row) => Number(row.yardId)),gateIds:gates.map(row=>Number(row.gateId)) };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    }
    return next(err);
  }
}

function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ error: 'Your account role cannot do this action.' });
}

function canAccessYard(user, yardId) {
  if (user?.role === 'admin') return true;
  return Number.isInteger(Number(yardId)) && user?.yardIds?.includes(Number(yardId));
}

module.exports = { authenticate, allowRoles, canAccessYard };
