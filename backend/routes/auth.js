const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticate, allowRoles } = require('../middleware/auth');

const ROLES = ['yard_operator', 'gate_operator', 'shipment_operator', 'supervisor', 'viewer', 'admin'];

async function audit(pool, { userId = null, action, outcome = 'success', metadata = null }) {
  await pool.execute(
    'INSERT INTO AuditLogs (user_id, action, record_type, record_id, change_metadata, outcome) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, 'user', userId, metadata ? JSON.stringify(metadata) : null, outcome],
  );
}

async function validateYards(pool, role, input) {
  const yardIds = [...new Set((Array.isArray(input) ? input : []).map(Number))];
  if (yardIds.some((id) => !Number.isInteger(id) || id < 1)) throw Object.assign(new Error('Select valid yard access.'), { status: 400 });
  if (role !== 'admin' && yardIds.length === 0) throw Object.assign(new Error('Assign at least one yard to this role.'), { status: 400 });
  if (yardIds.length) {
    const [rows] = await pool.query('SELECT id FROM Yards WHERE is_active=TRUE AND id IN (?)', [yardIds]);
    if (rows.length !== yardIds.length) throw Object.assign(new Error('One or more selected yards are inactive or missing.'), { status: 400 });
  }
  return yardIds;
}

async function validateGates(pool, yardIds, input) {
  const gateIds=[...new Set((Array.isArray(input)?input:[]).map(Number))];
  if(gateIds.some(id=>!Number.isInteger(id)||id<1))throw Object.assign(new Error('Select valid gate access.'),{status:400});
  if(gateIds.length){const [rows]=await pool.query(`SELECT id FROM Gates WHERE is_active=TRUE AND id IN (?)${yardIds.length?' AND yard_id IN (?)':''}`,
    yardIds.length?[gateIds,yardIds]:[gateIds]);if(rows.length!==gateIds.length)throw Object.assign(new Error('One or more selected gates are inactive or outside the selected yards.'),{status:400});}
  return gateIds;
}

module.exports = function createAuthRouter(pool) {
  const router = express.Router();

  router.post('/auth/login', async (req, res, next) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      if (!email || !password) return res.status(400).json({ error: 'Enter email and password.' });
      const [[user]] = await pool.execute(
        'SELECT id, display_name, email, password_hash, role, is_active FROM Users WHERE email = ?', [email]);
      if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
        await pool.execute("INSERT INTO AuditLogs (action,record_type,change_metadata,outcome) VALUES ('Login failed','user',JSON_OBJECT('email',?),'failure')", [email]);
        return res.status(401).json({ error: 'Email or password is incorrect.' });
      }
      const [yardRows] = await pool.execute('SELECT yard_id AS yardId FROM UserYards WHERE user_id = ?', [user.id]);
      const yardIds = yardRows.map((row) => Number(row.yardId));
      const [gateRows] = await pool.execute('SELECT gate_id AS gateId FROM UserGates WHERE user_id = ?', [user.id]);
      const gateIds = gateRows.map((row) => Number(row.gateId));
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '12h' });
      await audit(pool, { userId: user.id, action: 'Login successful' });
      res.json({ token, user: { id: user.id, displayName: user.display_name, email: user.email, role: user.role, yardIds, gateIds } });
    } catch (err) { next(err); }
  });

  router.get('/auth/me', authenticate, (req, res) => res.json({ user: req.user }));

  router.get('/admin/users', authenticate, allowRoles('admin'), async (_req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT u.id, u.display_name AS displayName, u.email, u.role,
          u.is_active AS isActive, u.created_at AS createdAt,
          GROUP_CONCAT(DISTINCT uy.yard_id ORDER BY uy.yard_id) AS yardIds,
          GROUP_CONCAT(DISTINCT ug.gate_id ORDER BY ug.gate_id) AS gateIds
         FROM Users u LEFT JOIN UserYards uy ON uy.user_id=u.id LEFT JOIN UserGates ug ON ug.user_id=u.id
         GROUP BY u.id ORDER BY u.display_name`);
      res.json(rows.map((row) => ({ ...row, yardIds: row.yardIds ? row.yardIds.split(',').map(Number) : [],gateIds:row.gateIds?row.gateIds.split(',').map(Number):[] })));
    } catch (err) { next(err); }
  });

  router.post('/admin/users', authenticate, allowRoles('admin'), async (req, res, next) => {
    let conn;
    try {
      const displayName = String(req.body.displayName || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const role = String(req.body.role || '');
      if (!displayName || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10 || !ROLES.includes(role)) {
        return res.status(400).json({ error: 'Provide a name, valid email, password (10+ characters), and valid role.' });
      }
      const yardIds = await validateYards(pool, role, req.body.yardIds);
      const gateIds = await validateGates(pool,yardIds,req.body.gateIds);
      const hash = await bcrypt.hash(password, 12);
      conn = await pool.getConnection(); await conn.beginTransaction();
      const [result] = await conn.execute(
        'INSERT INTO Users (display_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [displayName, email, hash, role]);
      for (const yardId of yardIds) await conn.execute('INSERT INTO UserYards (user_id,yard_id) VALUES (?,?)', [result.insertId, yardId]);
      for (const gateId of gateIds) await conn.execute('INSERT INTO UserGates (user_id,gate_id) VALUES (?,?)',[result.insertId,gateId]);
      await conn.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',
        [req.user.id, 'User created', 'user', result.insertId, JSON.stringify({ email, role, yardIds })]);
      await conn.commit();
      res.status(201).json({ id: result.insertId, displayName, email, role, yardIds, gateIds, isActive: true });
    } catch (err) {
      if (conn) await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email already has an account.' });
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    } finally { conn?.release(); }
  });

  router.patch('/admin/users/:id', authenticate, allowRoles('admin'), async (req, res, next) => {
    let conn;
    try {
      const id = Number(req.params.id);
      const displayName = String(req.body.displayName || '').trim();
      const email = String(req.body.email || '').trim().toLowerCase();
      const role = String(req.body.role || '');
      const isActive = req.body.isActive !== false;
      if (!Number.isInteger(id) || id < 1 || !displayName || !/^\S+@\S+\.\S+$/.test(email) || !ROLES.includes(role)) {
        return res.status(400).json({ error: 'Provide a valid name, email, and role.' });
      }
      if (id === Number(req.user.id) && !isActive) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
      const yardIds = await validateYards(pool, role, req.body.yardIds);
      const gateIds = await validateGates(pool,yardIds,req.body.gateIds);
      conn = await pool.getConnection(); await conn.beginTransaction();
      const [result] = await conn.execute('UPDATE Users SET display_name=?,email=?,role=?,is_active=? WHERE id=?', [displayName,email,role,isActive,id]);
      if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'User not found.' }); }
      await conn.execute('DELETE FROM UserYards WHERE user_id=?', [id]);
      for (const yardId of yardIds) await conn.execute('INSERT INTO UserYards (user_id,yard_id) VALUES (?,?)', [id,yardId]);
      await conn.execute('DELETE FROM UserGates WHERE user_id=?',[id]);
      for (const gateId of gateIds) await conn.execute('INSERT INTO UserGates (user_id,gate_id) VALUES (?,?)',[id,gateId]);
      await conn.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',
        [req.user.id,'User updated','user',id,JSON.stringify({email,role,isActive,yardIds})]);
      await conn.commit();
      res.json({ id, displayName, email, role, yardIds, gateIds, isActive });
    } catch (err) {
      if (conn) await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That email already has an account.' });
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    } finally { conn?.release(); }
  });

  router.patch('/admin/users/:id/active', authenticate, allowRoles('admin'), async (req, res, next) => {
    try {
      const id = Number(req.params.id); const active = Boolean(req.body.isActive);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid user.' });
      if (id === Number(req.user.id) && !active) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
      const [result] = await pool.execute('UPDATE Users SET is_active = ? WHERE id = ?', [active, id]);
      if (!result.affectedRows) return res.status(404).json({ error: 'User not found.' });
      await audit(pool, { userId: req.user.id, action: active ? 'User activated' : 'User deactivated', metadata: { targetUserId: id } });
      res.json({ message: 'User access updated.' });
    } catch (err) { next(err); }
  });

  return router;
};
