const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const multer = require('multer');
const { authenticate, allowRoles, canAccessYard } = require('../middleware/auth');
const idempotency = require('../middleware/idempotency');

const VIEW_ROLES = ['admin', 'supervisor', 'viewer', 'gate_operator', 'yard_operator', 'shipment_operator'];
const LOCATION_LABEL = "CONCAT_WS(' / ', y.yard_name, l.zone_name, CONCAT('Block ',l.block_name), CONCAT('Row ',l.row_name), CONCAT('Bay ',l.bay_name), CONCAT('Tier ',l.tier_name), CONCAT('Position ',l.position_name))";

function number(value) { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; }
function pageValues(req, max = 100) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  return { page, limit, offset: (page - 1) * limit };
}
function accessFilter(user, alias = 'c', suppliedYardId = null) {
  const id = suppliedYardId ? number(suppliedYardId) : null;
  if (suppliedYardId && !id) return { sql: ' AND 1=0', params: [] };
  if (id) return canAccessYard(user, id) ? { sql: ` AND ${alias}.yard_id=?`, params: [id] } : { sql: ' AND 1=0', params: [] };
  if (user.role === 'admin' && user.yardIds.length === 0) return { sql: '', params: [] };
  if (!user.yardIds?.length) return { sql: ' AND 1=0', params: [] };
  return { sql: ` AND ${alias}.yard_id IN (${user.yardIds.map(() => '?').join(',')})`, params: user.yardIds };
}
async function defaultYard(pool, user, input) {
  if (input) {
    const id = number(input);
    if (!id || !canAccessYard(user, id)) throw Object.assign(new Error('You do not have access to that yard.'), { status: 403 });
    return id;
  }
  if (user.yardIds?.length) return user.yardIds[0];
  if (user.role !== 'admin') throw Object.assign(new Error('An administrator must assign your account to a yard.'), { status: 403 });
  const [[yard]] = await pool.execute('SELECT id FROM Yards WHERE is_active=TRUE ORDER BY id LIMIT 1');
  if (!yard) throw Object.assign(new Error('Create an active yard first.'), { status: 409 });
  return Number(yard.id);
}
function geo(body, required = false) {
  if(required&&(body.geoLat===undefined||body.geoLat===null||body.geoLong===undefined||body.geoLong===null))throw Object.assign(new Error('GPS location is required for gate entry or exit.'),{status:400});
  const valid = (v, min, max) => v === undefined || v === null ||
    (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max);
  if (!valid(body.geoLat, -90, 90) || !valid(body.geoLong, -180, 180) ||
      (body.geoAccuracy !== undefined && body.geoAccuracy !== null && Number(body.geoAccuracy) < 0)) {
    throw Object.assign(new Error('GPS data is invalid.'), { status: 400 });
  }
}
function clean(value, max = 255) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

async function logEvent(conn, { containerId, userId, action, body = {}, fromLocationId = null,
  toLocationId = null, gateId = null, shipmentId = null, reason = null, details = null }) {
  await conn.execute(
    `INSERT INTO Transactions (container_id,action_type,from_location_id,to_location_id,geo_lat,geo_long,geo_accuracy,reason,event_details,gate_id,shipment_id,user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [containerId, action, fromLocationId, toLocationId, body.geoLat ?? null, body.geoLong ?? null,
      body.geoAccuracy ?? null, reason, details ? JSON.stringify(details) : null, gateId, shipmentId, userId],
  );
  await conn.execute(
    'INSERT INTO AuditLogs (user_id,action,record_type,record_id,reason,change_metadata,outcome) VALUES (?,?,?,?,?,?,?)',
    [userId, action, 'container', containerId, reason, details ? JSON.stringify(details) : null, 'success'],
  );
}
async function gateFor(conn, gateId, yardId, direction,user) {
  if (gateId) {
    const [[gate]] = await conn.execute('SELECT id,yard_id,direction,is_active FROM Gates WHERE id=? FOR UPDATE', [gateId]);
    if (!gate || !gate.is_active || Number(gate.yard_id) !== Number(yardId) || (gate.direction !== direction && gate.direction !== 'both') || (user?.role!=='admin'&&user?.gateIds?.length&&!user.gateIds.includes(Number(gate.id)))) {
      throw Object.assign(new Error('Choose an active gate for this operation.'), { status: 400 });
    }
    return Number(gate.id);
  }
  const assigned=user?.role!=='admin'&&user?.gateIds?.length;
  const [[gate]] = await conn.execute(
    `SELECT id FROM Gates WHERE yard_id=? AND is_active=TRUE AND direction IN (?, 'both')${assigned?' AND id IN ('+user.gateIds.map(()=>'?').join(',')+')':''} ORDER BY id LIMIT 1`, [yardId, direction,...(assigned?user.gateIds:[])]);
  if (!gate) throw Object.assign(new Error('No active gate is configured for this yard.'), { status: 409 });
  return Number(gate.id);
}
async function checkLocation(conn, locationId, yardId, containerType, excludeContainerId = null) {
  const [[location]] = await conn.execute(
    'SELECT id,yard_id,status,capacity,compatible_types FROM Locations WHERE id=? AND is_active=TRUE FOR UPDATE', [locationId]);
  if (!location || Number(location.yard_id) !== Number(yardId)) throw Object.assign(new Error('Choose an active slot in this yard.'), { status: 404 });
  if (location.status !== 'available') throw Object.assign(new Error(`This slot is ${location.status}. Choose another location.`), { status: 409 });
  const [[{ occupied }]] = await conn.execute(
    "SELECT COUNT(*) AS occupied FROM Containers WHERE current_yard_location=? AND status IN ('in-yard','reserved_for_shipment','ready_for_gate_out') AND (? IS NULL OR id<>?)",
    [locationId, excludeContainerId, excludeContainerId]);
  if (Number(occupied) >= Number(location.capacity)) throw Object.assign(new Error('This slot has reached its capacity.'), { status: 409 });
  let compatible = location.compatible_types;
  if (typeof compatible === 'string') { try { compatible = JSON.parse(compatible); } catch { compatible = []; } }
  if (Array.isArray(compatible) && compatible.length && containerType &&
      !compatible.map((x) => String(x).toUpperCase()).includes('ALL') &&
      !compatible.map((x) => String(x).toUpperCase()).includes(String(containerType).toUpperCase())) {
    throw Object.assign(new Error('This slot is not compatible with the container type.'), { status: 409 });
  }
  return location;
}
async function checkPutAwayAssignee(conn, assignedTo, yardId) {
  const id=number(assignedTo);
  if(!id)throw Object.assign(new Error('Assign this container to a Yard Operator for put-away.'),{status:400});
  const [[user]]=await conn.execute(
    `SELECT u.id FROM Users u JOIN UserYards uy ON uy.user_id=u.id
     WHERE u.id=? AND u.role='yard_operator' AND u.is_active=TRUE AND uy.yard_id=? FOR UPDATE`,[id,yardId]);
  if(!user)throw Object.assign(new Error('Choose an active Yard Operator assigned to this yard.'),{status:400});
  return id;
}
async function fetchContainerDetail(pool, id) {
  const [[container]] = await pool.execute(
    `SELECT c.id,c.yard_id AS yardId,c.original_barcode AS originalBarcode,c.container_number AS containerNumber,
      c.internal_tracking_barcode AS trackingBarcode,c.size_code AS sizeCode,c.type_code AS typeCode,c.iso_code AS isoCode,
      c.shipping_line AS shippingLine,c.seal_number AS sealNumber,c.condition_code AS conditionCode,c.remarks,c.status,
      c.current_yard_location AS locationId,c.putaway_assigned_to AS putawayAssignedTo,
      putawayUser.display_name AS putawayAssignedToName,
      ${LOCATION_LABEL} AS locationName,c.created_at AS createdAt,c.updated_at AS updatedAt
     FROM Containers c LEFT JOIN Locations l ON l.id=c.current_yard_location LEFT JOIN Yards y ON y.id=l.yard_id
     LEFT JOIN Users putawayUser ON putawayUser.id=c.putaway_assigned_to WHERE c.id=?`, [id]);
  if (!container) return null;
  const [events] = await pool.execute(
    `SELECT t.id,t.action_type AS actionType,t.geo_lat AS geoLat,t.geo_long AS geoLong,t.geo_accuracy AS geoAccuracy,
      t.reason,t.event_details AS details,t.timestamp,t.shipment_id AS shipmentId,s.shipment_ref AS shipmentRef,
      fromLoc.zone_name AS fromZone,fromLoc.block_name AS fromBlock,fromLoc.row_name AS fromRow,
      toLoc.zone_name AS toZone,toLoc.block_name AS toBlock,toLoc.row_name AS toRow,
      u.display_name AS userName,u.role AS userRole
     FROM Transactions t LEFT JOIN Shipments s ON s.id=t.shipment_id
     LEFT JOIN Locations fromLoc ON fromLoc.id=t.from_location_id LEFT JOIN Locations toLoc ON toLoc.id=t.to_location_id
     LEFT JOIN Users u ON u.id=t.user_id WHERE t.container_id=? ORDER BY t.timestamp DESC,t.id DESC`, [id]);
  const [[shipment]] = await pool.execute(
    `SELECT s.id,s.shipment_ref AS shipmentRef,s.status FROM ShipmentContainers sc JOIN Shipments s ON s.id=sc.shipment_id
     WHERE sc.container_id=? AND sc.assignment_status IN ('assigned','ready') ORDER BY sc.id DESC LIMIT 1`, [id]);
  const enrichedEvents=events.map(e=>({...e,fromLocation:[e.fromZone,e.fromBlock,e.fromRow].filter(Boolean).join(' / '),toLocation:[e.toZone,e.toBlock,e.toRow].filter(Boolean).join(' / ')}));
  return { ...container, shipment: shipment || null, events:enrichedEvents, transactions:enrichedEvents };
}

module.exports = function createBrdRouter(pool) {
  const router = express.Router();
  router.use(authenticate);
  const idem = idempotency(pool);
  const photoDir = path.resolve(process.env.CONTAINER_PHOTO_DIR ||
    (process.env.NODE_ENV === 'production' ? '/var/lib/yard-tracking/container-photos' : path.join(__dirname, '..', 'uploads', 'containers')));
  const photoUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, done) => done(null, photoDir),
      filename: (req, file, done) => {
        const extension = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[file.mimetype];
        if (!extension) return done(new Error('Upload a JPG, PNG, or WebP container photo.'));
        done(null, 'container-' + req.params.id + '-' + crypto.randomUUID() + extension);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, done) => done(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
  });
  function uploadContainerPhoto(req, res, next) {
    photoUpload.single('photo')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 8 MB or smaller.' : err.message });
      if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, or WebP photo.' });
      next();
    });
  }

  router.get('/yards', async (req, res, next) => {
    try {
      const scope = accessFilter(req.user, 'y');
      const [rows] = await pool.execute(`SELECT y.id,y.yard_name AS yardName,y.yard_code AS yardCode,y.address,y.timezone,y.is_active AS isActive FROM Yards y WHERE y.is_active=TRUE${scope.sql} ORDER BY y.yard_name`, scope.params);
      res.json(rows);
    } catch (err) { next(err); }
  });
  router.get('/gates', async (req, res, next) => {
    try {
      const scope = accessFilter(req.user, 'g');
      const gateScope=req.user.role!=='admin'&&req.user.gateIds?.length?` AND g.id IN (${req.user.gateIds.map(()=>'?').join(',')})`:'';
      const [rows] = await pool.execute(`SELECT g.id,g.yard_id AS yardId,g.gate_code AS gateCode,g.gate_name AS gateName,g.direction FROM Gates g WHERE g.is_active=TRUE${scope.sql}${gateScope} ORDER BY g.gate_name`, [...scope.params,...(gateScope?req.user.gateIds:[])]);
      res.json(rows);
    } catch (err) { next(err); }
  });
  router.get('/yard-operators', allowRoles('gate_operator','supervisor','admin'), async (req,res,next)=>{
    try {
      const yardId=await defaultYard(pool,req.user,req.query.yardId);
      const [rows]=await pool.execute(
        `SELECT u.id,u.display_name AS displayName FROM Users u
         JOIN UserYards uy ON uy.user_id=u.id
         WHERE u.role='yard_operator' AND u.is_active=TRUE AND uy.yard_id=?
         ORDER BY u.display_name`,[yardId]);
      res.json(rows);
    } catch(err) { if(err.status)return res.status(err.status).json({error:err.message}); next(err); }
  });
  router.get('/locations', async (req, res, next) => {
    try {
      const scope = accessFilter(req.user, 'l', req.query.yardId);
      const [rows] = await pool.execute(
        `SELECT l.id,l.yard_id AS yardId,l.zone_name AS zoneName,l.block_name AS blockName,l.row_name AS rowName,
          l.bay_name AS bayName,l.tier_name AS tierName,l.position_name AS positionName,l.barcode_id AS barcodeId,
          l.capacity,l.compatible_types AS compatibleTypes,l.status AS slotStatus,
          CONCAT_WS(' / ',y.yard_name,l.zone_name,CONCAT('Block ',l.block_name),CONCAT('Row ',l.row_name),CONCAT('Bay ',l.bay_name),CONCAT('Tier ',l.tier_name),CONCAT('Position ',l.position_name)) AS label,
          COUNT(c.id) AS occupied,CASE WHEN l.status='blocked' THEN 'blocked' WHEN l.status='reserved' THEN 'reserved' WHEN COUNT(c.id)>=l.capacity THEN 'full' WHEN COUNT(c.id)>0 THEN 'occupied' ELSE 'available' END AS availability
         FROM Locations l JOIN Yards y ON y.id=l.yard_id
         LEFT JOIN Containers c ON c.current_yard_location=l.id AND c.status IN ('in-yard','reserved_for_shipment','ready_for_gate_out')
         WHERE l.is_active=TRUE${scope.sql} GROUP BY l.id ORDER BY y.yard_name,l.zone_name,l.block_name,l.row_name,l.bay_name,l.tier_name,l.position_name`, scope.params);
      res.json(rows);
    } catch (err) { next(err); }
  });

  router.get('/inventory', async (req, res, next) => {
    try {
      const { page, limit, offset } = pageValues(req, 50);
      const search = clean(req.query.search, 100);
      const status = ['awaiting_putaway','in-yard','reserved_for_shipment','ready_for_gate_out','dispatched'].includes(req.query.status) ? req.query.status : null;
      const scope = accessFilter(req.user, 'c', req.query.yardId);
      const clause = `${scope.sql}${search ? ' AND (c.container_number LIKE ? OR c.original_barcode LIKE ? OR c.internal_tracking_barcode LIKE ?)' : ''}${status ? ' AND c.status=?' : " AND c.status<>'dispatched'"}`;
      const values = [...scope.params]; if (search) values.push(`%${search}%`,`%${search}%`,`%${search}%`); if (status) values.push(status);
      const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM Containers c WHERE 1=1${clause}`, values);
      const [rows] = await pool.execute(
        `SELECT c.id,c.container_number AS containerNumber,c.original_barcode AS originalBarcode,c.internal_tracking_barcode AS trackingBarcode,
          c.size_code AS sizeCode,c.type_code AS typeCode,c.iso_code AS isoCode,c.shipping_line AS shippingLine,c.condition_code AS conditionCode,c.status,
          c.yard_id AS yardId,c.current_yard_location AS locationId,${LOCATION_LABEL} AS locationName,c.created_at AS createdAt
         FROM Containers c LEFT JOIN Locations l ON l.id=c.current_yard_location LEFT JOIN Yards y ON y.id=c.yard_id
         WHERE 1=1${clause} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`, [...values,limit,offset]);
      res.json({ rows, page, limit, total: Number(total) });
    } catch (err) { next(err); }
  });
  router.get('/put-away/tasks', allowRoles('yard_operator','supervisor','admin'), async(req,res,next)=>{
    try {
      const scope=accessFilter(req.user,'c',req.query.yardId);
      const assignedClause=req.user.role==='yard_operator'?' AND (c.putaway_assigned_to=? OR c.putaway_assigned_to IS NULL)':'';
      const params=[...scope.params,...(req.user.role==='yard_operator'?[req.user.id]:[])];
      const [rows]=await pool.execute(
        `SELECT c.id,c.container_number AS containerNumber,c.original_barcode AS originalBarcode,
          c.internal_tracking_barcode AS trackingBarcode,c.yard_id AS yardId,c.putaway_assigned_to AS assignedTo,
          u.display_name AS assignedToName,c.created_at AS createdAt
         FROM Containers c LEFT JOIN Users u ON u.id=c.putaway_assigned_to
         WHERE c.status='awaiting_putaway'${scope.sql}${assignedClause}
         ORDER BY (c.putaway_assigned_to IS NULL),c.created_at LIMIT 100`,params);
      res.json(rows);
    } catch(err) { next(err); }
  });

  router.get('/history', async (req, res, next) => {
    try {
      const { page, limit, offset } = pageValues(req, 50);
      const search = clean(req.query.search,100); const type = clean(req.query.actionType,60);
      const scope = accessFilter(req.user,'c',req.query.yardId);
      const searchSql=search?' AND (c.container_number LIKE ? OR c.original_barcode LIKE ? OR c.internal_tracking_barcode LIKE ?)':'';
      const typeSql=type?' AND t.action_type=?':'';
      const values=[...scope.params];if(search)values.push(`%${search}%`,`%${search}%`,`%${search}%`);if(type)values.push(type);
      const joins=` FROM Transactions t JOIN Containers c ON c.id=t.container_id LEFT JOIN Shipments s ON s.id=t.shipment_id LEFT JOIN Locations fromLoc ON fromLoc.id=t.from_location_id LEFT JOIN Locations toLoc ON toLoc.id=t.to_location_id LEFT JOIN Users u ON u.id=t.user_id`;
      const where=` WHERE 1=1${scope.sql}${searchSql}${typeSql}`;
      const [[{total}]]=await pool.execute('SELECT COUNT(*) AS total'+joins+where,values);
      const [rows]=await pool.execute(
        `SELECT t.id,t.container_id AS containerId,c.container_number AS containerNumber,c.original_barcode AS originalBarcode,
          c.internal_tracking_barcode AS trackingBarcode,t.action_type AS actionType,t.geo_lat AS geoLat,t.geo_long AS geoLong,
          t.geo_accuracy AS geoAccuracy,t.reason,t.event_details AS details,t.timestamp,t.shipment_id AS shipmentId,s.shipment_ref AS shipmentRef,
          fromLoc.zone_name AS fromZone,fromLoc.block_name AS fromBlock,fromLoc.row_name AS fromRow,
          toLoc.zone_name AS toZone,toLoc.block_name AS toBlock,toLoc.row_name AS toRow,
          CONCAT_WS(' / ',fromLoc.zone_name,fromLoc.block_name,fromLoc.row_name) AS fromLocation,
          CONCAT_WS(' / ',toLoc.zone_name,toLoc.block_name,toLoc.row_name) AS toLocation,u.display_name AS userName,u.role AS userRole
         ${joins}${where}
         ORDER BY t.timestamp DESC,t.id DESC LIMIT ? OFFSET ?`,[...values,limit,offset]);
      res.json({rows,page,limit,total:Number(total)});
    } catch(err){next(err);}
  });

  router.get('/containers/:id', async (req,res,next)=>{
    try{
      const id=number(req.params.id);if(!id)return res.status(400).json({error:'Invalid container.'});
      const record=await fetchContainerDetail(pool,id);if(!record)return res.status(404).json({error:'Container not found.'});
      if(!canAccessYard(req.user,record.yardId))return res.status(403).json({error:'You cannot view this yard record.'});
      res.json(record);
    }catch(err){next(err);}
  });
  router.post('/containers/:id/photos',allowRoles('gate_operator','yard_operator','supervisor','admin'),uploadContainerPhoto,async(req,res,next)=>{
    const id=number(req.params.id);
    if(!id){await fs.unlink(req.file.path).catch(()=>{});return res.status(400).json({error:'Invalid container.'});}
    try {
      const [[container]]=await pool.execute('SELECT id,yard_id FROM Containers WHERE id=?',[id]);
      if(!container){await fs.unlink(req.file.path).catch(()=>{});return res.status(404).json({error:'Container not found.'});}
      if(!canAccessYard(req.user,Number(container.yard_id))){await fs.unlink(req.file.path).catch(()=>{});return res.status(403).json({error:'You cannot attach a photo to this yard.'});}
      const [created]=await pool.execute(
        'INSERT INTO ContainerPhotos (container_id,file_name,mime_type,size_bytes,uploaded_by) VALUES (?,?,?,?,?)',
        [id,req.file.filename,req.file.mimetype,req.file.size,req.user.id]);
      await pool.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',
        [req.user.id,'Container photo uploaded','container',id,JSON.stringify({photoId:created.insertId,fileName:req.file.filename})]);
      res.status(201).json({id:created.insertId,containerId:id,mimeType:req.file.mimetype,sizeBytes:req.file.size,createdAt:new Date().toISOString()});
    } catch(err) { await fs.unlink(req.file.path).catch(()=>{}); next(err); }
  });
  router.get('/containers/:id/photos',async(req,res,next)=>{
    try {
      const id=number(req.params.id);if(!id)return res.status(400).json({error:'Invalid container.'});
      const [[container]]=await pool.execute('SELECT id,yard_id FROM Containers WHERE id=?',[id]);
      if(!container)return res.status(404).json({error:'Container not found.'});
      if(!canAccessYard(req.user,Number(container.yard_id)))return res.status(403).json({error:'You cannot view this yard.'});
      const [rows]=await pool.execute(
        'SELECT p.id,p.mime_type AS mimeType,p.size_bytes AS sizeBytes,p.created_at AS createdAt,u.display_name AS uploadedBy FROM ContainerPhotos p LEFT JOIN Users u ON u.id=p.uploaded_by WHERE p.container_id=? ORDER BY p.created_at DESC',
        [id]);
      res.json(rows);
    } catch(err) { next(err); }
  });
  router.get('/container-photos/:photoId',async(req,res,next)=>{
    try {
      const id=number(req.params.photoId);if(!id)return res.status(400).json({error:'Invalid photo.'});
      const [[photo]]=await pool.execute(
        'SELECT p.file_name AS fileName,p.mime_type AS mimeType,c.yard_id AS yardId FROM ContainerPhotos p JOIN Containers c ON c.id=p.container_id WHERE p.id=?',[id]);
      if(!photo)return res.status(404).json({error:'Photo not found.'});
      if(!canAccessYard(req.user,Number(photo.yardId)))return res.status(403).json({error:'You cannot view this yard.'});
      res.type(photo.mimeType).sendFile(path.join(req.app.locals.containerPhotoDir,photo.fileName));
    } catch(err) { next(err); }
  });
  router.get('/admin/containers/:id',allowRoles('admin','supervisor','viewer'),async(req,res,next)=>{
    try{const id=number(req.params.id);if(!id)return res.status(400).json({error:'Invalid container.'});const record=await fetchContainerDetail(pool,id);if(!record)return res.status(404).json({error:'Container not found.'});if(!canAccessYard(req.user,record.yardId))return res.status(403).json({error:'You cannot view this yard record.'});res.json(record);}catch(err){next(err);}
  });
  router.get('/track', async(req,res,next)=>{
    try{
      const query=clean(req.query.q,120);if(!query)return res.status(400).json({error:'Enter or scan a container or shipment reference.'});
      const scope=accessFilter(req.user,'c');
      const [rows]=await pool.execute(
        `SELECT DISTINCT c.id,c.yard_id AS yardId FROM Containers c LEFT JOIN ShipmentContainers sc ON sc.container_id=c.id
         LEFT JOIN Shipments s ON s.id=sc.shipment_id WHERE (c.container_number=? OR c.original_barcode=? OR c.internal_tracking_barcode=? OR s.shipment_ref=?)${scope.sql} ORDER BY c.id DESC LIMIT 50`,
        [query,query,query,query,...scope.params]);
      const results=[];for(const row of rows){const r=await fetchContainerDetail(pool,Number(row.id));if(r)results.push(r);}
      res.json({results});
    }catch(err){next(err);}
  });

  router.get('/shipments', async(req,res,next)=>{
    try{
      const {page,limit,offset}=pageValues(req,50);const search=clean(req.query.search,100);const status=clean(req.query.status,20);
      const scope=accessFilter(req.user,'s',req.query.yardId);
      const searchSql=search?' AND (s.shipment_ref LIKE ? OR s.customer_name LIKE ? OR s.vehicle_registration LIKE ?)':'';
      const statusSql=['draft','ready','dispatched','cancelled'].includes(status)?' AND s.status=?':'';
      const vals=[...scope.params];if(search)vals.push(`%${search}%`,`%${search}%`,`%${search}%`);if(statusSql)vals.push(status);
      const [[{total}]]=await pool.execute(`SELECT COUNT(*) AS total FROM Shipments s WHERE 1=1${scope.sql}${searchSql}${statusSql}`,vals);
      const [rows]=await pool.execute(
        `SELECT s.id,s.shipment_ref AS shipmentRef,s.yard_id AS yardId,s.customer_name AS customerName,s.consignee,s.shipping_line AS shippingLine,
          s.vehicle_registration AS vehicleRegistration,s.driver_name AS driverName,s.driver_contact AS driverContact,
          s.planned_dispatch_at AS plannedDispatchAt,s.status,s.remarks,s.created_at AS createdAt,
          COUNT(CASE WHEN sc.assignment_status IN ('assigned','ready') THEN 1 END) AS activeContainers
         FROM Shipments s LEFT JOIN ShipmentContainers sc ON sc.shipment_id=s.id
         WHERE 1=1${scope.sql}${searchSql}${statusSql} GROUP BY s.id ORDER BY s.planned_dispatch_at,s.created_at DESC LIMIT ? OFFSET ?`,[...vals,limit,offset]);
      res.json({rows,page,limit,total:Number(total)});
    }catch(err){next(err);}
  });
  router.get('/shipments/:id', async(req,res,next)=>{
    try{
      const id=number(req.params.id);if(!id)return res.status(400).json({error:'Invalid shipment.'});
      const [[shipment]]=await pool.execute('SELECT * FROM Shipments WHERE id=?',[id]);if(!shipment)return res.status(404).json({error:'Shipment not found.'});
      if(!canAccessYard(req.user,Number(shipment.yard_id)))return res.status(403).json({error:'You cannot view this yard shipment.'});
      const [containers]=await pool.execute(
        `SELECT c.id,c.container_number AS containerNumber,c.original_barcode AS originalBarcode,c.internal_tracking_barcode AS trackingBarcode,
          c.status,sc.assignment_status AS assignmentStatus,sc.assigned_at AS assignedAt
         FROM ShipmentContainers sc JOIN Containers c ON c.id=sc.container_id WHERE sc.shipment_id=? ORDER BY sc.assigned_at DESC`,[id]);
      res.json({id:Number(shipment.id),shipmentRef:shipment.shipment_ref,yardId:Number(shipment.yard_id),customerName:shipment.customer_name,consignee:shipment.consignee,
        shippingLine:shipment.shipping_line,vehicleRegistration:shipment.vehicle_registration,driverName:shipment.driver_name,driverContact:shipment.driver_contact,
        plannedDispatchAt:shipment.planned_dispatch_at,status:shipment.status,remarks:shipment.remarks,containers});
    }catch(err){next(err);}
  });

  router.post('/gate-in', allowRoles('gate_operator','supervisor','admin'), idem, async(req,res,next)=>{
    let conn;
    try{
      const originalBarcode=clean(req.body.originalBarcode||req.body.containerNumber,160);
      const containerNumber=clean(req.body.containerNumber||originalBarcode,80);
      if(!originalBarcode||!containerNumber)return res.status(400).json({error:'Scan or enter a container number.'});
      geo(req.body,true);const yardId=await defaultYard(pool,req.user,req.body.yardId);
      const assignedTo=number(req.body.assignedTo);
      conn=await pool.getConnection();await conn.beginTransaction();
      const gateId=await gateFor(conn,req.body.gateId,yardId,'in',req.user);
      const putawayAssignee=await checkPutAwayAssignee(conn,assignedTo,yardId);
      const trackingBarcode=`YRD-${crypto.randomUUID().toUpperCase()}`;
      const [created]=await conn.execute(
        `INSERT INTO Containers (original_barcode,container_number,internal_tracking_barcode,size_code,type_code,iso_code,shipping_line,seal_number,condition_code,remarks,status,yard_id,putaway_assigned_to,current_yard_location)
         VALUES (?,?,?,?,?,?,?,?,?,?,'awaiting_putaway',?,?,NULL)`,
        [originalBarcode,containerNumber,trackingBarcode,clean(req.body.sizeCode,30)||null,clean(req.body.typeCode,40)||null,
          clean(req.body.isoCode,20)||null,clean(req.body.shippingLine,100)||null,clean(req.body.sealNumber,100)||null,
          ['good','damaged','inspection_required','unknown'].includes(req.body.conditionCode)?req.body.conditionCode:'unknown',clean(req.body.remarks,1000)||null,yardId,putawayAssignee]);
      await conn.execute('INSERT INTO GateTransactions (container_id,gate_id,direction,operator_id,geo_lat,geo_long,geo_accuracy,remarks) VALUES (?,? ,\'in\',?,?,?,?,?)',
        [created.insertId,gateId,req.user.id,req.body.geoLat??null,req.body.geoLong??null,req.body.geoAccuracy??null,clean(req.body.sourceReference||req.body.remarks,255)||null]);
      await logEvent(conn,{containerId:created.insertId,userId:req.user.id,action:'Gate In',gateId,body:req.body,details:{containerNumber,sizeCode:req.body.sizeCode,typeCode:req.body.typeCode,conditionCode:req.body.conditionCode,sourceReference:req.body.sourceReference,putawayAssignedTo:putawayAssignee}});
      await conn.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',
        [req.user.id,'Put-away assigned','container',created.insertId,JSON.stringify({assignedTo:putawayAssignee})]);
      await conn.commit();
      res.status(201).json({message:'Gate Entry saved and Put-away assigned.',containerId:created.insertId,containerNumber,originalBarcode,trackingBarcode,status:'awaiting_putaway',assignedTo:putawayAssignee});
    }catch(err){if(conn)await conn.rollback();if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'This container number or barcode is already registered.'});if(err.status)return res.status(err.status).json({error:err.message});next(err);}
    finally{conn?.release();}
  });
  router.post('/put-away',allowRoles('yard_operator','supervisor','admin'),idem,async(req,res,next)=>{
    let conn;
    try{
      const barcode=clean(req.body.trackingBarcode||req.body.containerNumber,160);const locationId=number(req.body.locationId);
      if(!barcode||!locationId)return res.status(400).json({error:'Scan a container and select its destination slot.'});geo(req.body);
      conn=await pool.getConnection();await conn.beginTransaction();
      const [[container]]=await conn.execute('SELECT id,yard_id,status,current_yard_location,type_code,putaway_assigned_to FROM Containers WHERE internal_tracking_barcode=? OR container_number=? FOR UPDATE',[barcode,barcode]);
      if(!container){await conn.rollback();return res.status(404).json({error:'Container not found.'});}
      if(!canAccessYard(req.user,Number(container.yard_id))){await conn.rollback();return res.status(403).json({error:'You cannot operate in this yard.'});}
      if(container.putaway_assigned_to&&Number(container.putaway_assigned_to)!==Number(req.user.id)&&!['admin','supervisor'].includes(req.user.role)){await conn.rollback();return res.status(403).json({error:'This Put-away task is assigned to another Yard Operator.'});}
      if(container.status!=='awaiting_putaway'||container.current_yard_location!==null){await conn.rollback();return res.status(409).json({error:'This container is not waiting for put-away.'});}
      await checkLocation(conn,locationId,container.yard_id,container.type_code);
      await conn.execute("UPDATE Containers SET current_yard_location=?,status='in-yard',putaway_assigned_to=NULL WHERE id=?",[locationId,container.id]);
      await logEvent(conn,{containerId:container.id,userId:req.user.id,action:'Put Away',toLocationId:locationId,body:req.body});
      await conn.commit();res.json({message:'Put-away confirmed.',containerId:container.id,locationId,status:'in-yard'});
    }catch(err){if(conn)await conn.rollback();if(err.status)return res.status(err.status).json({error:err.message});next(err);}finally{conn?.release();}
  });

  router.post('/move',allowRoles('yard_operator','supervisor','admin'),idem,async(req,res,next)=>{
    let conn;
    try{
      const barcode=clean(req.body.trackingBarcode||req.body.containerNumber,160);const locationId=number(req.body.destinationLocationId||req.body.locationId);
      const reason=clean(req.body.reason,255)||'Routine yard relocation';
      if(!barcode||!locationId)return res.status(400).json({error:'Scan the container and select a destination slot.'});geo(req.body);
      conn=await pool.getConnection();await conn.beginTransaction();
      const [[container]]=await conn.execute('SELECT id,yard_id,status,current_yard_location,type_code FROM Containers WHERE internal_tracking_barcode=? OR container_number=? FOR UPDATE',[barcode,barcode]);
      if(!container){await conn.rollback();return res.status(404).json({error:'Container not found.'});}
      if(!canAccessYard(req.user,Number(container.yard_id))){await conn.rollback();return res.status(403).json({error:'You cannot operate in this yard.'});}
      if(!['in-yard','reserved_for_shipment'].includes(container.status)||!container.current_yard_location){await conn.rollback();return res.status(409).json({error:'Only a stored container can be moved.'});}
      if(Number(container.current_yard_location)===locationId){await conn.rollback();return res.status(409).json({error:'Choose a different slot.'});}
      await checkLocation(conn,locationId,container.yard_id,container.type_code,container.id);
      const source=Number(container.current_yard_location);
      await conn.execute('UPDATE Containers SET current_yard_location=? WHERE id=?',[locationId,container.id]);
      await conn.execute('INSERT INTO Movements (container_id,from_location_id,to_location_id,reason,user_id,geo_lat,geo_long,geo_accuracy) VALUES (?,?,?,?,?,?,?,?)',
        [container.id,source,locationId,reason,req.user.id,req.body.geoLat??null,req.body.geoLong??null,req.body.geoAccuracy??null]);
      await logEvent(conn,{containerId:container.id,userId:req.user.id,action:'Move',fromLocationId:source,toLocationId:locationId,reason,body:req.body});
      await conn.commit();res.json({message:'Movement saved.',containerId:container.id,fromLocationId:source,locationId,status:container.status});
    }catch(err){if(conn)await conn.rollback();if(err.status)return res.status(err.status).json({error:err.message});next(err);}finally{conn?.release();}
  });

  router.post('/shipments',allowRoles('shipment_operator','supervisor','admin'),idem,async(req,res,next)=>{
    try{
      const shipmentRef=clean(req.body.shipmentRef,80);if(!shipmentRef)return res.status(400).json({error:'Enter a shipment reference.'});
      const yardId=await defaultYard(pool,req.user,req.body.yardId);
      const [result]=await pool.execute(
        `INSERT INTO Shipments (shipment_ref,yard_id,customer_name,consignee,shipping_line,vehicle_registration,driver_name,driver_contact,planned_dispatch_at,status,remarks,created_by)
         VALUES (?,?,?,?,?,?,?,?,?,'draft',?,?)`,
        [shipmentRef,yardId,clean(req.body.customerName,160)||null,clean(req.body.consignee,160)||null,clean(req.body.shippingLine,100)||null,
          clean(req.body.vehicleRegistration,40)||null,clean(req.body.driverName,120)||null,clean(req.body.driverContact,60)||null,
          req.body.plannedDispatchAt||null,clean(req.body.remarks,2000)||null,req.user.id]);
      await pool.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',
        [req.user.id,'Shipment created','shipment',result.insertId,JSON.stringify({shipmentRef,yardId})]);
      res.status(201).json({id:result.insertId,shipmentRef,yardId,status:'draft'});
    }catch(err){if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That shipment reference already exists.'});if(err.status)return res.status(err.status).json({error:err.message});next(err);}
  });
  router.post('/shipments/:id/containers',allowRoles('shipment_operator','supervisor','admin'),idem,async(req,res,next)=>{
    let conn;
    try{
      const shipmentId=number(req.params.id);const containerIds=[...new Set((Array.isArray(req.body.containerIds)?req.body.containerIds:[]).map(number).filter(Boolean))];
      if(!shipmentId||!containerIds.length)return res.status(400).json({error:'Select at least one container.'});
      conn=await pool.getConnection();await conn.beginTransaction();
      const [[shipment]]=await conn.execute('SELECT id,yard_id,status FROM Shipments WHERE id=? FOR UPDATE',[shipmentId]);
      if(!shipment||shipment.status==='cancelled'||shipment.status==='dispatched'){await conn.rollback();return res.status(409).json({error:'Shipment is not accepting containers.'});}
      if(!canAccessYard(req.user,Number(shipment.yard_id))){await conn.rollback();return res.status(403).json({error:'You cannot manage this yard shipment.'});}
      for(const containerId of containerIds){
        const [[container]]=await conn.execute('SELECT id,yard_id,status,current_yard_location FROM Containers WHERE id=? FOR UPDATE',[containerId]);
        if(!container||Number(container.yard_id)!==Number(shipment.yard_id)||container.status!=='in-yard'||!container.current_yard_location){await conn.rollback();return res.status(409).json({error:`Container ${containerId} is not eligible for this shipment.`});}
        const [[active]]=await conn.execute("SELECT id FROM ShipmentContainers WHERE container_id=? AND assignment_status IN ('assigned','ready') LIMIT 1 FOR UPDATE",[containerId]);
        if(active){await conn.rollback();return res.status(409).json({error:`Container ${containerId} already has an active shipment.`});}
        await conn.execute("INSERT INTO ShipmentContainers (shipment_id,container_id,assignment_status,assigned_by) VALUES (?,?,'ready',?)",[shipmentId,containerId,req.user.id]);
        await conn.execute("UPDATE Containers SET status='reserved_for_shipment' WHERE id=?",[containerId]);
        await logEvent(conn,{containerId,userId:req.user.id,action:'Shipment Assigned',shipmentId,details:{shipmentId}});
      }
      await conn.execute("UPDATE Shipments SET status='ready' WHERE id=?",[shipmentId]);await conn.commit();
      res.status(201).json({message:`${containerIds.length} container(s) assigned.`,shipmentId,containerIds});
    }catch(err){if(conn)await conn.rollback();if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Duplicate shipment assignment.'});if(err.status)return res.status(err.status).json({error:err.message});next(err);}finally{conn?.release();}
  });

  router.post('/gate-out',allowRoles('gate_operator','supervisor','admin'),idem,async(req,res,next)=>{
    let conn;
    try{
      const barcode=clean(req.body.trackingBarcode||req.body.containerNumber,160);const shipmentId=number(req.body.shipmentId);
      if(!barcode||!shipmentId)return res.status(400).json({error:'Scan the container and select its shipment.'});geo(req.body,true);
      conn=await pool.getConnection();await conn.beginTransaction();
      const [[container]]=await conn.execute('SELECT id,yard_id,status,current_yard_location FROM Containers WHERE internal_tracking_barcode=? OR container_number=? FOR UPDATE',[barcode,barcode]);
      if(!container){await conn.rollback();return res.status(404).json({error:'Container not found.'});}
      if(!canAccessYard(req.user,Number(container.yard_id))){await conn.rollback();return res.status(403).json({error:'You cannot dispatch from this yard.'});}
      if(!['reserved_for_shipment','ready_for_gate_out'].includes(container.status)){await conn.rollback();return res.status(409).json({error:'Container is not assigned to a ready shipment.'});}
      const [[assignment]]=await conn.execute("SELECT sc.id,s.yard_id,s.status,s.shipment_ref FROM ShipmentContainers sc JOIN Shipments s ON s.id=sc.shipment_id WHERE sc.container_id=? AND sc.shipment_id=? AND sc.assignment_status IN ('assigned','ready') FOR UPDATE",[container.id,shipmentId]);
      if(!assignment||Number(assignment.yard_id)!==Number(container.yard_id)||!['ready'].includes(assignment.status)){await conn.rollback();return res.status(409).json({error:'Shipment does not match this container or is not ready.'});}
      const gateId=await gateFor(conn,req.body.gateId,container.yard_id,'out',req.user);
      const source=container.current_yard_location;
      await conn.execute("UPDATE Containers SET status='dispatched',current_yard_location=NULL WHERE id=?",[container.id]);
      await conn.execute("UPDATE ShipmentContainers SET assignment_status='dispatched',dispatched_at=NOW() WHERE id=?",[assignment.id]);
      await conn.execute('INSERT INTO GateTransactions (container_id,shipment_id,gate_id,direction,operator_id,vehicle_registration,geo_lat,geo_long,geo_accuracy,verification_result,remarks) VALUES (?,?,?,\'out\',?,?,?,?,?,\'passed\',?)',
        [container.id,shipmentId,gateId,req.user.id,clean(req.body.vehicleRegistration,40)||null,req.body.geoLat??null,req.body.geoLong??null,req.body.geoAccuracy??null,clean(req.body.remarks,255)||null]);
      await logEvent(conn,{containerId:container.id,userId:req.user.id,action:'Gate Out',fromLocationId:source,gateId,shipmentId,body:req.body,details:{shipmentRef:assignment.shipment_ref,verification:'passed'}});
      const [[{remaining}]]=await conn.execute("SELECT COUNT(*) AS remaining FROM ShipmentContainers WHERE shipment_id=? AND assignment_status IN ('assigned','ready')",[shipmentId]);
      if(Number(remaining)===0)await conn.execute("UPDATE Shipments SET status='dispatched' WHERE id=?",[shipmentId]);
      await conn.commit();res.json({message:'Dispatch confirmed.',trackingBarcode:barcode,status:'dispatched',shipmentRef:assignment.shipment_ref});
    }catch(err){if(conn)await conn.rollback();if(err.status)return res.status(err.status).json({error:err.message});next(err);}finally{conn?.release();}
  });

  router.post('/admin/locations',allowRoles('admin'),idem,async(req,res,next)=>{
    try{
      const yardId=await defaultYard(pool,req.user,req.body.yardId);
      const zoneName=clean(req.body.zoneName,80),blockName=clean(req.body.blockName,80),rowName=clean(req.body.rowName,80),bayName=clean(req.body.bayName||'01',80),tierName=clean(req.body.tierName||'01',80),positionName=clean(req.body.positionName,80);
      const capacity=Math.max(1,Math.min(100,Number(req.body.capacity)||1));const status=['available','reserved','blocked'].includes(req.body.status)?req.body.status:'available';
      if(!zoneName||!blockName||!rowName||!positionName)return res.status(400).json({error:'Enter zone, block, row, and position.'});
      let compatible=req.body.compatibleTypes;if(typeof compatible==='string')compatible=compatible.split(',').map(x=>x.trim()).filter(Boolean);
      if(compatible!==undefined&&!Array.isArray(compatible))return res.status(400).json({error:'Compatible types must be a list.'});
      const barcodeId=`LOC-${[yardId,zoneName,blockName,rowName,bayName,tierName,positionName].join('-')}`.toUpperCase().replace(/[^A-Z0-9-]/g,'-').replace(/-+/g,'-').slice(0,120);
      const [result]=await pool.execute('INSERT INTO Locations (yard_id,zone_name,block_name,row_name,bay_name,tier_name,position_name,barcode_id,capacity,compatible_types,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [yardId,zoneName,blockName,rowName,bayName,tierName,positionName,barcodeId,capacity,compatible?.length?JSON.stringify(compatible):null,status]);
      await pool.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',[req.user.id,'Location created','location',result.insertId,JSON.stringify({yardId,zoneName,blockName,rowName,bayName,tierName,positionName,capacity,compatibleTypes:compatible,status})]);
      res.status(201).json({id:result.insertId,yardId,zoneName,blockName,rowName,bayName,tierName,positionName,barcodeId,capacity,compatibleTypes:compatible||[],status,isActive:true});
    }catch(err){if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That yard slot or location barcode already exists.'});if(err.status)return res.status(err.status).json({error:err.message});next(err);}
  });

  router.get('/admin/locations',allowRoles('admin','supervisor'),async(req,res,next)=>{
    try{
      const scope=accessFilter(req.user,'l',req.query.yardId);
      const [rows]=await pool.execute(`SELECT l.id,l.yard_id AS yardId,y.yard_name AS yardName,l.zone_name AS zoneName,l.block_name AS blockName,l.row_name AS rowName,l.bay_name AS bayName,l.tier_name AS tierName,l.position_name AS positionName,l.barcode_id AS barcodeId,l.capacity,l.compatible_types AS compatibleTypes,l.status,l.is_active AS isActive,CONCAT_WS(' / ',y.yard_name,l.zone_name,CONCAT('Block ',l.block_name),CONCAT('Row ',l.row_name),CONCAT('Bay ',l.bay_name),CONCAT('Tier ',l.tier_name),CONCAT('Position ',l.position_name)) AS label FROM Locations l JOIN Yards y ON y.id=l.yard_id WHERE 1=1${scope.sql} ORDER BY y.yard_name,l.zone_name,l.block_name,l.row_name,l.bay_name,l.tier_name,l.position_name`,scope.params);
      res.json(rows);
    }catch(err){next(err);}
  });
  router.patch('/admin/locations/:id',allowRoles('admin'),idem,async(req,res,next)=>{
    try{
      const id=number(req.params.id);if(!id)return res.status(400).json({error:'Invalid slot.'});
      const fields={zoneName:'zone_name',blockName:'block_name',rowName:'row_name',bayName:'bay_name',tierName:'tier_name',positionName:'position_name'};
      const sets=[];const values=[];for(const [key,column] of Object.entries(fields)){if(req.body[key]!==undefined){sets.push(`${column}=?`);values.push(clean(req.body[key],80));}}
      if(req.body.capacity!==undefined){const cap=Number(req.body.capacity);if(!Number.isInteger(cap)||cap<1||cap>100)return res.status(400).json({error:'Capacity must be between 1 and 100.'});sets.push('capacity=?');values.push(cap);}
      if(req.body.status!==undefined){if(!['available','reserved','blocked'].includes(req.body.status))return res.status(400).json({error:'Invalid slot status.'});sets.push('status=?');values.push(req.body.status);}
      if(req.body.compatibleTypes!==undefined){const list=Array.isArray(req.body.compatibleTypes)?req.body.compatibleTypes:[];sets.push('compatible_types=?');values.push(list.length?JSON.stringify(list):null);}
      if(req.body.isActive!==undefined){sets.push('is_active=?');values.push(Boolean(req.body.isActive));}
      if(!sets.length)return res.status(400).json({error:'No changes provided.'});
      values.push(id);const [result]=await pool.execute(`UPDATE Locations SET ${sets.join(',')} WHERE id=?`,values);
      if(!result.affectedRows)return res.status(404).json({error:'Location not found.'});
      await pool.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',[req.user.id,'Location updated','location',id,JSON.stringify(req.body)]);
      res.json({message:'Location updated.'});
    }catch(err){if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That slot already exists.'});next(err);}
  });

  router.post('/admin/yards',allowRoles('admin'),idem,async(req,res,next)=>{
    try{
      const name=clean(req.body.yardName,120),code=clean(req.body.yardCode,40).toUpperCase();if(!name||!code)return res.status(400).json({error:'Enter a yard name and code.'});
      const [r]=await pool.execute('INSERT INTO Yards (yard_name,yard_code,address,timezone) VALUES (?,?,?,?)',[name,code,clean(req.body.address,255)||null,clean(req.body.timezone,80)||'Asia/Kolkata']);
      await pool.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',[req.user.id,'Yard created','yard',r.insertId,JSON.stringify(req.body)]);
      res.status(201).json({id:r.insertId,yardName:name,yardCode:code});
    }catch(err){if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That yard code already exists.'});next(err);}
  });
  router.get('/admin/yards',allowRoles('admin'),async(_req,res,next)=>{
    try{const [rows]=await pool.execute('SELECT id,yard_name AS yardName,yard_code AS yardCode,address,timezone,is_active AS isActive FROM Yards ORDER BY yard_name');res.json(rows);}catch(err){next(err);}
  });
  router.patch('/admin/yards/:id',allowRoles('admin'),idem,async(req,res,next)=>{
    try{const id=number(req.params.id);const [r]=await pool.execute('UPDATE Yards SET yard_name=COALESCE(?,yard_name),address=COALESCE(?,address),timezone=COALESCE(?,timezone),is_active=COALESCE(?,is_active) WHERE id=?',
      [req.body.yardName?clean(req.body.yardName,120):null,req.body.address?clean(req.body.address,255):null,req.body.timezone?clean(req.body.timezone,80):null,req.body.isActive===undefined?null:Boolean(req.body.isActive),id]);
      if(!r.affectedRows)return res.status(404).json({error:'Yard not found.'});res.json({message:'Yard updated.'});}catch(err){next(err);}
  });
  router.post('/admin/gates',allowRoles('admin'),idem,async(req,res,next)=>{
    try{const yardId=await defaultYard(pool,req.user,req.body.yardId);const code=clean(req.body.gateCode,40).toUpperCase(),name=clean(req.body.gateName,120);const direction=['in','out','both'].includes(req.body.direction)?req.body.direction:'both';if(!code||!name)return res.status(400).json({error:'Enter gate name and code.'});
      const [r]=await pool.execute('INSERT INTO Gates (yard_id,gate_code,gate_name,direction) VALUES (?,?,?,?)',[yardId,code,name,direction]);await pool.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',[req.user.id,'Gate created','gate',r.insertId,JSON.stringify({yardId,code,name,direction})]);res.status(201).json({id:r.insertId,yardId,gateCode:code,gateName:name,direction});}
    catch(err){if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That gate code already exists in this yard.'});if(err.status)return res.status(err.status).json({error:err.message});next(err);}
  });

  // Admin register is a manual gate-in workflow; it shares the same invariants as mobile gate-in.
  router.post('/admin/containers',allowRoles('admin'),idem,async(req,res,next)=>{
    let conn;
    try {
      const originalBarcode=clean(req.body.originalBarcode||req.body.containerNumber,160);
      const containerNumber=clean(req.body.containerNumber||originalBarcode,80);
      if(!originalBarcode||!containerNumber)return res.status(400).json({error:'Enter a container number or original barcode.'});
      geo(req.body);const yardId=await defaultYard(pool,req.user,req.body.yardId);
      const assignedTo=number(req.body.assignedTo);
      conn=await pool.getConnection();await conn.beginTransaction();
      const gateId=await gateFor(conn,req.body.gateId,yardId,'in',req.user);
      const putawayAssignee=await checkPutAwayAssignee(conn,assignedTo,yardId);
      const trackingBarcode=`YRD-${crypto.randomUUID().toUpperCase()}`;
      const [created]=await conn.execute(`INSERT INTO Containers
        (original_barcode,container_number,internal_tracking_barcode,size_code,type_code,iso_code,shipping_line,seal_number,condition_code,remarks,status,yard_id,putaway_assigned_to,current_yard_location)
        VALUES (?,?,?,?,?,?,?,?,?,?,'awaiting_putaway',?,?,NULL)`,
        [originalBarcode,containerNumber,trackingBarcode,clean(req.body.sizeCode,30)||null,clean(req.body.typeCode,40)||null,
          clean(req.body.isoCode,20)||null,clean(req.body.shippingLine,100)||null,clean(req.body.sealNumber,100)||null,
          ['good','damaged','inspection_required','unknown'].includes(req.body.conditionCode)?req.body.conditionCode:'unknown',clean(req.body.remarks,1000)||null,yardId,putawayAssignee]);
      await conn.execute(`INSERT INTO GateTransactions (container_id,gate_id,direction,operator_id,geo_lat,geo_long,geo_accuracy,remarks)
        VALUES (?,?,'in',?,?,?,?,?)`,[created.insertId,gateId,req.user.id,req.body.geoLat??null,req.body.geoLong??null,req.body.geoAccuracy??null,clean(req.body.remarks,255)||'Admin manual gate entry']);
      await logEvent(conn,{containerId:created.insertId,userId:req.user.id,action:'Gate In',gateId,body:req.body,details:{origin:'admin-panel',containerNumber,putawayAssignedTo:putawayAssignee}});
      await conn.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',[req.user.id,'Gate Entry created and Put-away assigned','container',created.insertId,JSON.stringify({yardId,assignedTo:putawayAssignee,containerNumber})]);
      await conn.commit();res.status(201).json({message:'Gate Entry saved and Put-away assigned.',containerId:created.insertId,containerNumber,originalBarcode,trackingBarcode,status:'awaiting_putaway',assignedTo:putawayAssignee});
    }catch(err){if(conn)await conn.rollback();if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'This container number or barcode is already registered.'});if(err.status)return res.status(err.status).json({error:err.message});next(err);}
    finally{conn?.release();}
  });

  router.patch('/admin/containers/:id',allowRoles('admin'),idem,async(req,res,next)=>{
    try{
      const id=number(req.params.id);if(!id)return res.status(400).json({error:'Invalid container.'});
      const fields={containerNumber:['container_number',80],sizeCode:['size_code',30],typeCode:['type_code',40],isoCode:['iso_code',20],shippingLine:['shipping_line',100],sealNumber:['seal_number',100],remarks:['remarks',2000]};
      const sets=[];const vals=[];for(const[key,[col,max]]of Object.entries(fields)){if(req.body[key]!==undefined){sets.push(`${col}=?`);vals.push(clean(req.body[key],max)||null);}}
      if(req.body.conditionCode!==undefined){if(!['good','damaged','inspection_required','unknown'].includes(req.body.conditionCode))return res.status(400).json({error:'Invalid container condition.'});sets.push('condition_code=?');vals.push(req.body.conditionCode);}
      if(!sets.length)return res.status(400).json({error:'No editable container details were provided.'});vals.push(id);
      const [r]=await pool.execute(`UPDATE Containers SET ${sets.join(',')} WHERE id=?`,vals);if(!r.affectedRows)return res.status(404).json({error:'Container not found.'});
      await pool.execute('INSERT INTO AuditLogs (user_id,action,record_type,record_id,change_metadata) VALUES (?,?,?,?,?)',[req.user.id,'Container details updated','container',id,JSON.stringify(req.body)]);res.json({message:'Container details updated.'});
    }catch(err){if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That container number is already in use.'});next(err);}
  });

  router.get('/admin/containers',allowRoles('admin','supervisor','viewer'),async(req,res,next)=>{
    try{
      const {page,limit,offset}=pageValues(req,100);const search=clean(req.query.search,100);const status=clean(req.query.status,40);const scope=accessFilter(req.user,'c',req.query.yardId);
      const searchSql=search?' AND (c.container_number LIKE ? OR c.original_barcode LIKE ? OR c.internal_tracking_barcode LIKE ?)':'';
      const statusSql=['awaiting_putaway','in-yard','reserved_for_shipment','ready_for_gate_out','dispatched'].includes(status)?' AND c.status=?':'';
      const values=[...scope.params];if(search)values.push(`%${search}%`,`%${search}%`,`%${search}%`);if(statusSql)values.push(status);
      const [[{total}]]=await pool.execute(`SELECT COUNT(*) AS total FROM Containers c WHERE 1=1${scope.sql}${searchSql}${statusSql}`,values);
      const [rows]=await pool.execute(`SELECT c.id,c.container_number AS containerNumber,c.original_barcode AS originalBarcode,c.internal_tracking_barcode AS trackingBarcode,c.size_code AS sizeCode,c.type_code AS typeCode,c.iso_code AS isoCode,c.shipping_line AS shippingLine,c.condition_code AS conditionCode,c.status,c.yard_id AS yardId,c.current_yard_location AS locationId,${LOCATION_LABEL} AS locationName,c.created_at AS createdAt FROM Containers c LEFT JOIN Locations l ON l.id=c.current_yard_location LEFT JOIN Yards y ON y.id=c.yard_id WHERE 1=1${scope.sql}${searchSql}${statusSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,[...values,limit,offset]);
      res.json({rows,page,limit,total:Number(total)});
    }catch(err){next(err);}
  });

  router.get('/admin/history',allowRoles('admin','supervisor','viewer'),async(req,res,next)=>{
    try{const {page,limit,offset}=pageValues(req,100);const scope=accessFilter(req.user,'c',req.query.yardId);const search=clean(req.query.search,100);const type=clean(req.query.actionType,60);const q=search?' AND (c.container_number LIKE ? OR c.original_barcode LIKE ? OR c.internal_tracking_barcode LIKE ?)':'';const a=type?' AND t.action_type=?':'';const params=[...scope.params];if(search)params.push(`%${search}%`,`%${search}%`,`%${search}%`);if(type)params.push(type);const joins=` FROM Transactions t JOIN Containers c ON c.id=t.container_id LEFT JOIN Shipments s ON s.id=t.shipment_id LEFT JOIN Users u ON u.id=t.user_id LEFT JOIN Locations fromLoc ON fromLoc.id=t.from_location_id LEFT JOIN Locations toLoc ON toLoc.id=t.to_location_id`;const where=` WHERE 1=1${scope.sql}${q}${a}`;const [[{total}]]=await pool.execute('SELECT COUNT(*) AS total'+joins+where,params);const [rows]=await pool.execute(`SELECT t.id,t.container_id AS containerId,c.container_number AS containerNumber,c.original_barcode AS originalBarcode,c.internal_tracking_barcode AS trackingBarcode,t.action_type AS actionType,t.geo_lat AS geoLat,t.geo_long AS geoLong,t.geo_accuracy AS geoAccuracy,t.reason,t.timestamp,t.shipment_id AS shipmentId,s.shipment_ref AS shipmentRef,u.display_name AS userName,u.role AS userRole,fromLoc.zone_name AS fromZone,fromLoc.block_name AS fromBlock,fromLoc.row_name AS fromRow,toLoc.zone_name AS toZone,toLoc.block_name AS toBlock,toLoc.row_name AS toRow${joins}${where} ORDER BY t.timestamp DESC,t.id DESC LIMIT ? OFFSET ?`,[...params,limit,offset]);res.json({rows,page,limit,total:Number(total)});}catch(err){next(err);}
  });

  router.get('/admin/overview',allowRoles('admin','supervisor','viewer'),async(req,res,next)=>{
    try{const from=clean(req.query.from,10),to=clean(req.query.to,10);const scope=accessFilter(req.user,'c',req.query.yardId);const [params,dates]=[scope.params,[]];let txDate='';if(from){txDate+=' AND DATE(t.timestamp)>=?';dates.push(from);}if(to){txDate+=' AND DATE(t.timestamp)<=?';dates.push(to);}const [[counts]]=await pool.execute(`SELECT COUNT(*) total,SUM(status='awaiting_putaway') pendingPutaway,SUM(status IN ('in-yard','reserved_for_shipment','ready_for_gate_out')) inYard,SUM(status='reserved_for_shipment') reserved,SUM(status='dispatched') dispatched FROM Containers c WHERE 1=1${scope.sql}`,params);const [[eventCount]]=await pool.execute(`SELECT COUNT(*) AS eventCount FROM Transactions t JOIN Containers c ON c.id=t.container_id WHERE 1=1${scope.sql}${txDate}`,[...scope.params,...dates]);const [[today]]=await pool.execute(`SELECT COUNT(*) AS countToday FROM Transactions t JOIN Containers c ON c.id=t.container_id WHERE DATE(t.timestamp)=CURDATE()${scope.sql}`,scope.params);const [[locationCount]]=await pool.execute(`SELECT COUNT(*) totalSlots,SUM(status='blocked') blocked FROM Locations l WHERE is_active=TRUE${accessFilter(req.user,'l',req.query.yardId).sql}`,accessFilter(req.user,'l',req.query.yardId).params);const [[shipmentCount]]=await pool.execute(`SELECT COUNT(*) AS readyShipments FROM Shipments s WHERE s.status='ready'${accessFilter(req.user,'s',req.query.yardId).sql}`,accessFilter(req.user,'s',req.query.yardId).params);res.json({total:Number(counts.total),pendingPutaway:Number(counts.pendingPutaway||0),inYard:Number(counts.inYard||0),reserved:Number(counts.reserved||0),dispatched:Number(counts.dispatched||0),shipped:Number(counts.dispatched||0),todayEvents:Number(today.countToday),eventCount:Number(eventCount.eventCount),totalSlots:Number(locationCount.totalSlots||0),blockedSlots:Number(locationCount.blocked||0),readyShipments:Number(shipmentCount.readyShipments||0),from:from||null,to:to||null});}catch(err){next(err);}
  });

  router.get('/admin/audit',allowRoles('admin'),async(req,res,next)=>{
    try{const {page,limit,offset}=pageValues(req);const search=clean(req.query.search,100);const where=search?' WHERE (a.action LIKE ? OR a.record_type LIKE ? OR u.display_name LIKE ?)':'';const params=search?[`%${search}%`,`%${search}%`,`%${search}%`]:[];const [[{total}]]=await pool.execute(`SELECT COUNT(*) total FROM AuditLogs a LEFT JOIN Users u ON u.id=a.user_id${where}`,params);const [rows]=await pool.execute(`SELECT a.id,a.action,a.record_type AS recordType,a.record_id AS recordId,a.outcome,a.change_metadata AS metadata,a.created_at AS createdAt,u.display_name AS userName,u.email FROM AuditLogs a LEFT JOIN Users u ON u.id=a.user_id${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`,[...params,limit,offset]);res.json({rows,page,limit,total:Number(total)});}catch(err){next(err);}
  });

  router.get('/reports/locations',allowRoles('admin','supervisor','viewer'),async(req,res,next)=>{
    try{const scope=accessFilter(req.user,'l',req.query.yardId);const [rows]=await pool.execute(`SELECT l.id,l.zone_name AS zoneName,l.block_name AS blockName,l.row_name AS rowName,l.bay_name AS bayName,l.tier_name AS tierName,l.position_name AS positionName,l.capacity,l.status,COUNT(c.id) AS occupied,CASE WHEN l.status='blocked' THEN 'blocked' WHEN l.status='reserved' THEN 'reserved' WHEN COUNT(c.id)>=l.capacity THEN 'full' WHEN COUNT(c.id)>0 THEN 'occupied' ELSE 'available' END AS availability FROM Locations l LEFT JOIN Containers c ON c.current_yard_location=l.id AND c.status IN ('in-yard','reserved_for_shipment','ready_for_gate_out') WHERE l.is_active=TRUE${scope.sql} GROUP BY l.id ORDER BY l.zone_name,l.block_name,l.row_name,l.bay_name,l.tier_name,l.position_name`,scope.params);res.json(rows);}catch(err){next(err);}
  });
  router.get('/reports/gate-register',allowRoles('admin','supervisor','viewer'),async(req,res,next)=>{
    try{const {page,limit,offset}=pageValues(req);const direction=['in','out'].includes(req.query.direction)?req.query.direction:null;const from=clean(req.query.from,20),to=clean(req.query.to,20);const scope=accessFilter(req.user,'c',req.query.yardId);let where=scope.sql;const p=[...scope.params];if(direction){where+=' AND g.direction=?';p.push(direction);}if(from){where+=' AND g.occurred_at>=?';p.push(from);}if(to){where+=' AND g.occurred_at<=?';p.push(to);}const [[{total}]]=await pool.execute(`SELECT COUNT(*) total FROM GateTransactions g JOIN Containers c ON c.id=g.container_id WHERE 1=1${where}`,p);const [rows]=await pool.execute(`SELECT g.id,g.direction,g.occurred_at AS occurredAt,g.geo_lat AS geoLat,g.geo_long AS geoLong,g.geo_accuracy AS geoAccuracy,g.vehicle_registration AS vehicleRegistration,g.verification_result AS verificationResult,c.container_number AS containerNumber,c.internal_tracking_barcode AS trackingBarcode,gate.gate_name AS gateName,s.shipment_ref AS shipmentRef,u.display_name AS operator FROM GateTransactions g JOIN Containers c ON c.id=g.container_id JOIN Gates gate ON gate.id=g.gate_id LEFT JOIN Shipments s ON s.id=g.shipment_id LEFT JOIN Users u ON u.id=g.operator_id WHERE 1=1${where} ORDER BY g.occurred_at DESC LIMIT ? OFFSET ?`,[...p,limit,offset]);res.json({rows,page,limit,total:Number(total)});}catch(err){next(err);}
  });
  router.get('/reports/movements',allowRoles('admin','supervisor','viewer'),async(req,res,next)=>{
    try{const {page,limit,offset}=pageValues(req);const scope=accessFilter(req.user,'c',req.query.yardId);const [[{total}]]=await pool.execute(`SELECT COUNT(*) total FROM Movements m JOIN Containers c ON c.id=m.container_id WHERE 1=1${scope.sql}`,scope.params);const [rows]=await pool.execute(`SELECT m.id,m.moved_at AS movedAt,m.reason,m.geo_lat AS geoLat,m.geo_long AS geoLong,c.container_number AS containerNumber,c.internal_tracking_barcode AS trackingBarcode,fromLoc.zone_name AS fromZone,fromLoc.block_name AS fromBlock,fromLoc.row_name AS fromRow,toLoc.zone_name AS toZone,toLoc.block_name AS toBlock,toLoc.row_name AS toRow,u.display_name AS userName FROM Movements m JOIN Containers c ON c.id=m.container_id JOIN Locations fromLoc ON fromLoc.id=m.from_location_id JOIN Locations toLoc ON toLoc.id=m.to_location_id LEFT JOIN Users u ON u.id=m.user_id WHERE 1=1${scope.sql} ORDER BY m.moved_at DESC LIMIT ? OFFSET ?`,[...scope.params,limit,offset]);res.json({rows,page,limit,total:Number(total)});}catch(err){next(err);}
  });
  router.get('/reports/export.csv',allowRoles('admin','supervisor'),async(req,res,next)=>{
    try{const type=clean(req.query.type,30);let headers=[],rows=[];if(type==='inventory'){headers=['Container','Barcode','Status','Yard','Location','Size','Type'];const scope=accessFilter(req.user,'c',req.query.yardId);[rows]=await pool.execute(`SELECT c.container_number,c.internal_tracking_barcode,c.status,y.yard_name,${LOCATION_LABEL} AS locationName,c.size_code,c.type_code FROM Containers c JOIN Yards y ON y.id=c.yard_id LEFT JOIN Locations l ON l.id=c.current_yard_location WHERE 1=1${scope.sql} ORDER BY c.container_number`,scope.params);}else if(type==='gate'){headers=['Direction','Container','Shipment','Gate','Operator','Occurred','GPS Lat','GPS Long','Accuracy','Verification'];const scope=accessFilter(req.user,'c',req.query.yardId);[rows]=await pool.execute(`SELECT g.direction,c.container_number,s.shipment_ref,gate.gate_name,u.display_name,g.occurred_at,g.geo_lat,g.geo_long,g.geo_accuracy,g.verification_result FROM GateTransactions g JOIN Containers c ON c.id=g.container_id JOIN Gates gate ON gate.id=g.gate_id LEFT JOIN Shipments s ON s.id=g.shipment_id LEFT JOIN Users u ON u.id=g.operator_id WHERE 1=1${scope.sql} ORDER BY g.occurred_at DESC`,scope.params);}else if(type==='shipments'){headers=['Shipment','Status','Customer','Vehicle','Driver','Planned Dispatch'];const scope=accessFilter(req.user,'s',req.query.yardId);[rows]=await pool.execute(`SELECT shipment_ref,status,customer_name,vehicle_registration,driver_name,planned_dispatch_at FROM Shipments s WHERE 1=1${scope.sql} ORDER BY planned_dispatch_at DESC`,scope.params);}else return res.status(400).json({error:'Export type must be inventory, gate, or shipments.'});const body=[headers,...rows.map(r=>Object.values(r))].map(row=>row.map(csvCell).join(',')).join('\r\n');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="yard-${type}-${Date.now()}.csv"`);res.send(body);}catch(err){next(err);}
  });

  return router;
};
