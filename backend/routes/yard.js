const express = require('express');
const crypto = require('node:crypto');
const { authenticate, allowRoles } = require('../middleware/auth');

function validGeo(body) {
  const { geoLat, geoLong } = body;
  const valid = (v, min, max) => v === undefined || v === null ||
    (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max);
  return valid(geoLat, -90, 90) && valid(geoLong, -180, 180);
}

function cleanBarcode(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function writeTransaction(conn, { containerId, actionType, fromLocationId = null,
  toLocationId = null, body }) {
  return conn.execute(
    `INSERT INTO Transactions
      (container_id, action_type, from_location_id, to_location_id, geo_lat, geo_long, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [containerId, actionType, fromLocationId, toLocationId,
      body.geoLat ?? null, body.geoLong ?? null, body.authUserId ?? null],
  );
}

module.exports = function createYardRouter(pool) {
  const router = express.Router();
  const signedIn = authenticate;

  router.use(signedIn);
  router.use((req, _res, next) => {
    req.body = { ...(req.body || {}), authUserId: req.user.id };
    next();
  });

  router.get('/locations', async (_req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT id, zone_name AS zoneName, block_name AS blockName,
          row_name AS rowName, position_name AS positionName, barcode_id AS barcodeId,
          CONCAT_WS(' / ', zone_name, CONCAT('Block ', block_name), CONCAT('Row ', row_name), CONCAT('Position ', position_name)) AS label
         FROM Locations WHERE is_active = TRUE ORDER BY zone_name, block_name, row_name, position_name`,
      );
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.get('/inventory', async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 15));
      const offset = (page - 1) * limit;
      const search = String(req.query.search || '').trim();
      const searchClause = search ? ' AND (original_barcode LIKE ? OR internal_tracking_barcode LIKE ?)' : '';
      const countParams = search ? [`%${search}%`, `%${search}%`] : [];
      const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM Containers WHERE status = 'in-yard'${searchClause}`, countParams);
      const listParams = [...countParams, limit, offset];
      const [rows] = await pool.execute(
        `SELECT c.id, c.original_barcode AS originalBarcode,
          c.internal_tracking_barcode AS trackingBarcode, c.status,
          c.current_yard_location AS locationId,
          CONCAT_WS(' / ', l.zone_name, CONCAT('Block ', l.block_name), CONCAT('Row ', l.row_name), CONCAT('Position ', l.position_name)) AS locationName,
          l.barcode_id AS locationBarcode, c.created_at AS createdAt
         FROM Containers c LEFT JOIN Locations l ON l.id = c.current_yard_location
         WHERE c.status = 'in-yard'${searchClause.replaceAll('original_barcode', 'c.original_barcode').replaceAll('internal_tracking_barcode', 'c.internal_tracking_barcode')} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, listParams,
      );
      res.json({ rows, page, limit, total: Number(total) });
    } catch (err) { next(err); }
  });

  router.get('/history', async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 15));
      const offset = (page - 1) * limit;
      const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM Transactions');
      const [rows] = await pool.execute(
        `SELECT t.id, t.container_id AS containerId, c.original_barcode AS originalBarcode,
          c.internal_tracking_barcode AS trackingBarcode, t.action_type AS actionType,
          t.geo_lat AS geoLat, t.geo_long AS geoLong, t.timestamp,
          CONCAT_WS(' / ', fromLoc.zone_name, CONCAT('Block ', fromLoc.block_name), CONCAT('Row ', fromLoc.row_name), CONCAT('Position ', fromLoc.position_name)) AS fromLocation,
          CONCAT_WS(' / ', toLoc.zone_name, CONCAT('Block ', toLoc.block_name), CONCAT('Row ', toLoc.row_name), CONCAT('Position ', toLoc.position_name)) AS toLocation,
          u.display_name AS userName
         FROM Transactions t JOIN Containers c ON c.id = t.container_id
         LEFT JOIN Locations fromLoc ON fromLoc.id = t.from_location_id
         LEFT JOIN Locations toLoc ON toLoc.id = t.to_location_id
         LEFT JOIN Users u ON u.id = t.user_id
         ORDER BY t.timestamp DESC, t.id DESC LIMIT ? OFFSET ?`, [limit, offset],
      );
      res.json({ rows, page, limit, total: Number(total) });
    } catch (err) { next(err); }
  });

  router.get('/containers/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid container.' });
      const [[container]] = await pool.execute(
        `SELECT c.id, c.original_barcode AS originalBarcode,
          c.internal_tracking_barcode AS trackingBarcode, c.status,
          c.current_yard_location AS locationId,
          CONCAT_WS(' / ', l.zone_name, CONCAT('Block ', l.block_name), CONCAT('Row ', l.row_name), CONCAT('Position ', l.position_name)) AS locationName,
          c.created_at AS createdAt, c.updated_at AS updatedAt
         FROM Containers c LEFT JOIN Locations l ON l.id = c.current_yard_location WHERE c.id = ?`, [id]);
      if (!container) return res.status(404).json({ error: 'Container not found.' });
      const [transactions] = await pool.execute(
        `SELECT t.id, t.action_type AS actionType, t.geo_lat AS geoLat, t.geo_long AS geoLong,
          t.timestamp,
          CONCAT_WS(' / ', fromLoc.zone_name, CONCAT('Block ', fromLoc.block_name), CONCAT('Row ', fromLoc.row_name), CONCAT('Position ', fromLoc.position_name)) AS fromLocation,
          CONCAT_WS(' / ', toLoc.zone_name, CONCAT('Block ', toLoc.block_name), CONCAT('Row ', toLoc.row_name), CONCAT('Position ', toLoc.position_name)) AS toLocation,
          u.display_name AS userName, u.role AS userRole
         FROM Transactions t
         LEFT JOIN Locations fromLoc ON fromLoc.id = t.from_location_id
         LEFT JOIN Locations toLoc ON toLoc.id = t.to_location_id
         LEFT JOIN Users u ON u.id = t.user_id
         WHERE t.container_id = ? ORDER BY t.timestamp DESC, t.id DESC`, [id]);
      res.json({ ...container, transactions });
    } catch (err) { next(err); }
  });

  router.get('/admin/containers', allowRoles('supervisor', 'admin'), async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const offset = (page - 1) * limit;
      const search = String(req.query.search || '').trim();
      const status = String(req.query.status || '');
      const clauses = [];
      const params = [];
      if (search) {
        clauses.push('(c.original_barcode LIKE ? OR c.internal_tracking_barcode LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }
      if (['in-yard', 'shipped'].includes(status)) { clauses.push('c.status = ?'); params.push(status); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM Containers c ${where}`, params);
      const [rows] = await pool.execute(
        `SELECT c.id, c.original_barcode AS originalBarcode,
          c.internal_tracking_barcode AS trackingBarcode, c.status,
          c.current_yard_location AS locationId,
          CONCAT_WS(' / ', l.zone_name, CONCAT('Block ', l.block_name), CONCAT('Row ', l.row_name), CONCAT('Position ', l.position_name)) AS locationName,
          c.created_at AS createdAt, c.updated_at AS updatedAt
         FROM Containers c LEFT JOIN Locations l ON l.id = c.current_yard_location
         ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );
      res.json({ rows, page, limit, total: Number(total) });
    } catch (err) { next(err); }
  });

  router.get('/admin/history', allowRoles('supervisor', 'admin'), async (req, res, next) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const offset = (page - 1) * limit;
      const search = String(req.query.search || '').trim();
      const actionType = String(req.query.actionType || '');
      const clauses = [];
      const params = [];
      if (search) {
        clauses.push('(c.original_barcode LIKE ? OR c.internal_tracking_barcode LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }
      if (['Gate In', 'Put Away', 'Move', 'Gate Out'].includes(actionType)) {
        clauses.push('t.action_type = ?'); params.push(actionType);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const [[{ total }]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM Transactions t JOIN Containers c ON c.id = t.container_id ${where}`, params);
      const [rows] = await pool.execute(
        `SELECT t.id, t.container_id AS containerId, c.original_barcode AS originalBarcode,
          c.internal_tracking_barcode AS trackingBarcode, t.action_type AS actionType,
          t.geo_lat AS geoLat, t.geo_long AS geoLong, t.timestamp,
          CONCAT_WS(' / ', fromLoc.zone_name, CONCAT('Block ', fromLoc.block_name), CONCAT('Row ', fromLoc.row_name), CONCAT('Position ', fromLoc.position_name)) AS fromLocation,
          CONCAT_WS(' / ', toLoc.zone_name, CONCAT('Block ', toLoc.block_name), CONCAT('Row ', toLoc.row_name), CONCAT('Position ', toLoc.position_name)) AS toLocation,
          u.display_name AS userName, u.role AS userRole
         FROM Transactions t JOIN Containers c ON c.id = t.container_id
         LEFT JOIN Locations fromLoc ON fromLoc.id = t.from_location_id
         LEFT JOIN Locations toLoc ON toLoc.id = t.to_location_id
         LEFT JOIN Users u ON u.id = t.user_id ${where}
         ORDER BY t.timestamp DESC, t.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ rows, page, limit, total: Number(total) });
    } catch (err) { next(err); }
  });

  router.get('/admin/locations', allowRoles('admin'), async (_req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT id, zone_name AS zoneName, block_name AS blockName,
          row_name AS rowName, position_name AS positionName, barcode_id AS barcodeId,
          is_active AS isActive, created_at AS createdAt,
          CONCAT_WS(' / ', zone_name, CONCAT('Block ', block_name), CONCAT('Row ', row_name), CONCAT('Position ', position_name)) AS label
         FROM Locations ORDER BY zone_name, block_name, row_name, position_name`);
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.post('/admin/locations', allowRoles('admin'), async (req, res, next) => {
    const zoneName = String(req.body.zoneName || '').trim();
    const blockName = String(req.body.blockName || '').trim();
    const rowName = String(req.body.rowName || '').trim();
    const positionName = String(req.body.positionName || '').trim();
    if (![zoneName, blockName, rowName, positionName].every((value) => value && value.length <= 80)) {
      return res.status(400).json({ error: 'Enter zone, block, row, and position (80 characters maximum each).' });
    }
    const barcodeId = `LOC-${[zoneName, blockName, rowName, positionName].join('-')}`
      .toUpperCase().replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 120);
    try {
      const [result] = await pool.execute(
        'INSERT INTO Locations (zone_name, block_name, row_name, position_name, barcode_id) VALUES (?, ?, ?, ?, ?)',
        [zoneName, blockName, rowName, positionName, barcodeId]);
      res.status(201).json({ id: result.insertId, zoneName, blockName, rowName, positionName, barcodeId, label: `${zoneName} / Block ${blockName} / Row ${rowName} / Position ${positionName}`, isActive: true });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That location or location barcode already exists.' });
      next(err);
    }
  });

  router.patch('/admin/locations/:id/active', allowRoles('admin'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid location.' });
      const [result] = await pool.execute('UPDATE Locations SET is_active = ? WHERE id = ?', [Boolean(req.body.isActive), id]);
      if (!result.affectedRows) return res.status(404).json({ error: 'Location not found.' });
      res.json({ message: 'Location status updated.' });
    } catch (err) { next(err); }
  });

  router.post('/admin/containers', allowRoles('admin'), async (req, res, next) => {
    const originalBarcode = cleanBarcode(req.body.originalBarcode);
    const locationId = req.body.locationId === '' || req.body.locationId === undefined || req.body.locationId === null
      ? null : Number(req.body.locationId);
    if (!originalBarcode || originalBarcode.length > 160 || !validGeo(req.body) ||
      (locationId !== null && (!Number.isInteger(locationId) || locationId < 1))) {
      return res.status(400).json({ error: 'Enter a valid container barcode and optional active location.' });
    }
    const trackingBarcode = `YRD-${crypto.randomUUID().toUpperCase()}`;
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      if (locationId !== null) {
        const [[location]] = await conn.execute('SELECT id FROM Locations WHERE id = ? AND is_active = TRUE', [locationId]);
        if (!location) { await conn.rollback(); return res.status(404).json({ error: 'Choose an active location.' }); }
      }
      const [result] = await conn.execute(
        "INSERT INTO Containers (original_barcode, internal_tracking_barcode, status, current_yard_location) VALUES (?, ?, 'in-yard', ?)",
        [originalBarcode, trackingBarcode, locationId]);
      await writeTransaction(conn, { containerId: result.insertId, actionType: 'Gate In', body: req.body });
      if (locationId !== null) {
        await writeTransaction(conn, { containerId: result.insertId, actionType: 'Put Away', toLocationId: locationId, body: req.body });
      }
      await conn.commit();
      res.status(201).json({ message: 'Manual gate entry created.', containerId: result.insertId, originalBarcode, trackingBarcode, locationId });
    } catch (err) {
      if (conn) await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This container barcode is already registered.' });
      next(err);
    } finally { conn?.release(); }
  });

  router.get('/admin/overview', allowRoles('supervisor', 'admin'), async (_req, res, next) => {
    try {
      const [[counts]] = await pool.execute(
        `SELECT COUNT(*) AS total,
          SUM(status = 'in-yard') AS inYard,
          SUM(status = 'shipped') AS shipped
         FROM Containers`);
      const [[events]] = await pool.execute(
        `SELECT COUNT(*) AS todayEvents FROM Transactions WHERE DATE(timestamp) = CURDATE()`);
      res.json({ total: Number(counts.total), inYard: Number(counts.inYard || 0), shipped: Number(counts.shipped || 0), todayEvents: Number(events.todayEvents) });
    } catch (err) { next(err); }
  });

  router.get('/admin/containers/:id', allowRoles('supervisor', 'admin'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid container.' });
      const [[container]] = await pool.execute(
        `SELECT c.id, c.original_barcode AS originalBarcode,
          c.internal_tracking_barcode AS trackingBarcode, c.status,
          c.current_yard_location AS locationId,
          CONCAT_WS(' / ', l.zone_name, CONCAT('Block ', l.block_name), CONCAT('Row ', l.row_name), CONCAT('Position ', l.position_name)) AS locationName,
          c.created_at AS createdAt, c.updated_at AS updatedAt
         FROM Containers c LEFT JOIN Locations l ON l.id = c.current_yard_location WHERE c.id = ?`, [id]);
      if (!container) return res.status(404).json({ error: 'Container not found.' });
      const [transactions] = await pool.execute(
        `SELECT t.id, t.action_type AS actionType, t.geo_lat AS geoLat, t.geo_long AS geoLong,
          t.timestamp, t.from_location_id AS fromLocationId,
          CONCAT_WS(' / ', fromLoc.zone_name, CONCAT('Block ', fromLoc.block_name), CONCAT('Row ', fromLoc.row_name), CONCAT('Position ', fromLoc.position_name)) AS fromLocation,
          t.to_location_id AS toLocationId,
          CONCAT_WS(' / ', toLoc.zone_name, CONCAT('Block ', toLoc.block_name), CONCAT('Row ', toLoc.row_name), CONCAT('Position ', toLoc.position_name)) AS toLocation,
          u.display_name AS userName, u.role AS userRole
         FROM Transactions t
         LEFT JOIN Locations fromLoc ON fromLoc.id = t.from_location_id
         LEFT JOIN Locations toLoc ON toLoc.id = t.to_location_id
         LEFT JOIN Users u ON u.id = t.user_id
         WHERE t.container_id = ? ORDER BY t.timestamp DESC, t.id DESC`, [id]);
      res.json({ ...container, transactions });
    } catch (err) { next(err); }
  });

  router.post('/gate-in', allowRoles('gate_operator', 'supervisor', 'admin'), async (req, res, next) => {
    const originalBarcode = cleanBarcode(req.body.originalBarcode);
    if (!originalBarcode) return res.status(400).json({ error: 'Scan the container barcode.' });
    if (originalBarcode.length > 160 || !validGeo(req.body))
      return res.status(400).json({ error: 'Barcode or location data is invalid.' });
    const trackingBarcode = `YRD-${crypto.randomUUID().toUpperCase()}`;
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [result] = await conn.execute(
        'INSERT INTO Containers (original_barcode, internal_tracking_barcode, status) VALUES (?, ?, \'in-yard\')',
        [originalBarcode, trackingBarcode],
      );
      await writeTransaction(conn, { containerId: result.insertId, actionType: 'Gate In', body: req.body });
      await conn.commit();
      res.status(201).json({ message: 'Container entered.', containerId: result.insertId, originalBarcode, trackingBarcode });
    } catch (err) {
      if (conn) await conn.rollback();
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This container is already registered.' });
      next(err);
    } finally { conn?.release(); }
  });

  router.post('/put-away', allowRoles('worker', 'supervisor', 'admin'), async (req, res, next) => {
    const trackingBarcode = cleanBarcode(req.body.trackingBarcode);
    const locationId = Number(req.body.locationId);
    if (!trackingBarcode || !Number.isInteger(locationId) || locationId < 1 || !validGeo(req.body))
      return res.status(400).json({ error: 'Scan the container and choose a yard location.' });
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[container]] = await conn.execute(
        'SELECT id, status, current_yard_location FROM Containers WHERE internal_tracking_barcode = ? FOR UPDATE', [trackingBarcode]);
      if (!container) { await conn.rollback(); return res.status(404).json({ error: 'Container not found.' }); }
      if (container.status !== 'in-yard') { await conn.rollback(); return res.status(409).json({ error: 'Container has already left the yard.' }); }
      if (container.current_yard_location !== null) { await conn.rollback(); return res.status(409).json({ error: 'Container already has a location. Use Move.' }); }
      const [[location]] = await conn.execute('SELECT id FROM Locations WHERE id = ? AND is_active = TRUE', [locationId]);
      if (!location) { await conn.rollback(); return res.status(404).json({ error: 'Location not found.' }); }
      await conn.execute('UPDATE Containers SET current_yard_location = ? WHERE id = ?', [locationId, container.id]);
      await writeTransaction(conn, { containerId: container.id, actionType: 'Put Away', toLocationId: locationId, body: req.body });
      await conn.commit();
      res.json({ message: 'Container stored.', locationId });
    } catch (err) { if (conn) await conn.rollback(); next(err); }
    finally { conn?.release(); }
  });

  router.post('/move', allowRoles('worker', 'supervisor', 'admin'), async (req, res, next) => {
    const trackingBarcode = cleanBarcode(req.body.trackingBarcode);
    const destinationLocationId = Number(req.body.destinationLocationId);
    if (!trackingBarcode || !Number.isInteger(destinationLocationId) || destinationLocationId < 1 || !validGeo(req.body))
      return res.status(400).json({ error: 'Scan the container and choose a destination.' });
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[container]] = await conn.execute(
        'SELECT id, status, current_yard_location FROM Containers WHERE internal_tracking_barcode = ? FOR UPDATE', [trackingBarcode]);
      if (!container) { await conn.rollback(); return res.status(404).json({ error: 'Container not found.' }); }
      if (container.status !== 'in-yard') { await conn.rollback(); return res.status(409).json({ error: 'Container has already left the yard.' }); }
      if (container.current_yard_location === null) { await conn.rollback(); return res.status(409).json({ error: 'Put this container away before moving it.' }); }
      const [[location]] = await conn.execute('SELECT id FROM Locations WHERE id = ? AND is_active = TRUE', [destinationLocationId]);
      if (!location) { await conn.rollback(); return res.status(404).json({ error: 'Destination not found.' }); }
      if (Number(container.current_yard_location) === destinationLocationId) {
        await conn.rollback(); return res.status(409).json({ error: 'Choose a different location.' });
      }
      const fromLocationId = container.current_yard_location;
      await conn.execute('UPDATE Containers SET current_yard_location = ? WHERE id = ?', [destinationLocationId, container.id]);
      await writeTransaction(conn, { containerId: container.id, actionType: 'Move', fromLocationId, toLocationId: destinationLocationId, body: req.body });
      await conn.commit();
      res.json({ message: 'Container moved.', fromLocationId, locationId: destinationLocationId });
    } catch (err) { if (conn) await conn.rollback(); next(err); }
    finally { conn?.release(); }
  });

  router.post('/gate-out', allowRoles('gate_operator', 'supervisor', 'admin'), async (req, res, next) => {
    const trackingBarcode = cleanBarcode(req.body.trackingBarcode);
    if (!trackingBarcode || !validGeo(req.body))
      return res.status(400).json({ error: 'Scan the internal tracking barcode.' });
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [[container]] = await conn.execute(
        'SELECT id, status, current_yard_location FROM Containers WHERE internal_tracking_barcode = ? FOR UPDATE', [trackingBarcode]);
      if (!container) { await conn.rollback(); return res.status(404).json({ error: 'Tracking barcode not found.' }); }
      if (container.status !== 'in-yard') { await conn.rollback(); return res.status(409).json({ error: 'Container is already marked as shipped.' }); }
      await conn.execute("UPDATE Containers SET status = 'shipped', current_yard_location = NULL WHERE id = ?", [container.id]);
      await writeTransaction(conn, { containerId: container.id, actionType: 'Gate Out', fromLocationId: container.current_yard_location, body: req.body });
      await conn.commit();
      res.json({ message: 'Exit recorded.', trackingBarcode, status: 'shipped' });
    } catch (err) { if (conn) await conn.rollback(); next(err); }
    finally { conn?.release(); }
  });

  return router;
};
