require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'container_yard', connectionLimit: 3,
});

async function locationId(zone, block, row, position) {
  const [[yard]] = await pool.execute("SELECT id FROM Yards WHERE yard_code='MAIN'");
  if (!yard) throw new Error('Create a yard before loading sample data.');
  const barcodeId = `LOC-${[yard.id,zone,block,row,'01','01',position].join('-')}`.toUpperCase().replace(/[^A-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 120);
  await pool.execute(
    'INSERT INTO Locations (yard_id, zone_name, block_name, row_name, bay_name, tier_name, position_name, barcode_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE is_active = TRUE',
    [yard.id, zone, block, row, '01', '01', position, barcodeId]);
  const [[rowData]] = await pool.execute(
    'SELECT id FROM Locations WHERE yard_id = ? AND zone_name = ? AND block_name = ? AND row_name = ? AND bay_name = ? AND tier_name = ? AND position_name = ?',
    [yard.id, zone, block, row, '01', '01', position]);
  return rowData.id;
}

async function seedContainer(adminId, record) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.execute('SELECT id FROM Containers WHERE original_barcode = ?', [record.originalBarcode]);
    if (existing) { await conn.rollback(); return false; }
    const [result] = await conn.execute(
      "INSERT INTO Containers (original_barcode, internal_tracking_barcode, container_number, yard_id, status, current_yard_location) VALUES (?, ?, ?, (SELECT id FROM Yards WHERE yard_code='MAIN'), ?, ?)",
      [record.originalBarcode, record.trackingBarcode, record.originalBarcode, record.status, record.currentLocationId]);
    const event = async (action, fromId = null, toId = null) => conn.execute(
      'INSERT INTO Transactions (container_id, action_type, from_location_id, to_location_id, user_id) VALUES (?, ?, ?, ?, ?)',
      [result.insertId, action, fromId, toId, adminId]);
    await event('Gate In');
    if (record.events.includes('Put Away')) await event('Put Away', null, record.firstLocationId);
    if (record.events.includes('Move')) await event('Move', record.firstLocationId, record.currentLocationId);
    if (record.events.includes('Gate Out')) await event('Gate Out', record.firstLocationId);
    await conn.commit();
    return true;
  } catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

async function seedDemoUsers(yardId) {
  const demos=[['gate@yard.local','Demo Gate Operator','gate_operator'],['yard@yard.local','Demo Yard Operator','yard_operator'],
    ['shipments@yard.local','Demo Shipment Operator','shipment_operator'],['supervisor@yard.local','Demo Supervisor','supervisor'],['viewer@yard.local','Demo Viewer','viewer']];
  for(const [email,name,role] of demos){
    let [[user]]=await pool.execute('SELECT id FROM Users WHERE email=?',[email]);
    if(!user){const password=crypto.randomBytes(18).toString('base64url');const hash=await bcrypt.hash(password,12);const [result]=await pool.execute('INSERT INTO Users (display_name,email,password_hash,role) VALUES (?,?,?,?)',[name,email,hash,role]);user={id:result.insertId};console.log(`Demo login created: ${email} / ${password}`);}
    await pool.execute('INSERT IGNORE INTO UserYards (user_id,yard_id) VALUES (?,?)',[user.id,yardId]);
  }
}

async function main() {
  try {
    if(process.env.NODE_ENV==='production')throw new Error('Sample data must never be seeded in production.');
    const [[admin]] = await pool.execute("SELECT id FROM Users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (!admin) throw new Error('Create an administrator first with npm run create-admin.');
    const [[mainYard]]=await pool.execute("SELECT id FROM Yards WHERE yard_code='MAIN'");
    if(!mainYard)throw new Error('Create the Main Yard before loading sample data.');
    await seedDemoUsers(mainYard.id);
    const zoneA = await locationId('North Yard', 'A', '01', '02');
    const zoneB = await locationId('North Yard', 'B', '02', '03');
    const records = [
      { originalBarcode: 'DEMO-CNT-1001', trackingBarcode: 'YRD-DEMO-1001', status: 'in-yard', currentLocationId: zoneA, firstLocationId: zoneA, events: ['Put Away'] },
      { originalBarcode: 'DEMO-CNT-1002', trackingBarcode: 'YRD-DEMO-1002', status: 'in-yard', currentLocationId: zoneB, firstLocationId: zoneA, events: ['Put Away', 'Move'] },
      { originalBarcode: 'DEMO-CNT-1003', trackingBarcode: 'YRD-DEMO-1003', status: 'dispatched', currentLocationId: null, firstLocationId: zoneB, events: ['Put Away', 'Gate Out'] },
      { originalBarcode: 'DEMO-CNT-1004', trackingBarcode: 'YRD-DEMO-1004', status: 'in-yard', currentLocationId: null, firstLocationId: null, events: [] },
    ];
    let added = 0;
    for (const record of records) if (await seedContainer(admin.id, record)) added += 1;
    const [[shipment]] = await pool.execute('SELECT id FROM Shipments WHERE shipment_ref = ?', ['DEMO-SHP-2026-001']);
    let shipmentId = shipment?.id;
    if (!shipmentId) {
      const [created] = await pool.execute(
        "INSERT INTO Shipments (shipment_ref, yard_id, customer_name, vehicle_registration, driver_name, planned_dispatch_at, status, created_by) VALUES ('DEMO-SHP-2026-001', (SELECT id FROM Yards WHERE yard_code='MAIN'), 'Demo Customer', 'DEMO-1234', 'Sample Driver', DATE_ADD(NOW(), INTERVAL 1 DAY), 'ready', ?)", [admin.id]);
      shipmentId = created.insertId;
    }
    const [[reservedContainer]] = await pool.execute('SELECT id FROM Containers WHERE original_barcode = ?', ['DEMO-CNT-1002']);
    const [[assignment]] = await pool.execute("SELECT id FROM ShipmentContainers WHERE shipment_id=? AND container_id=? AND assignment_status IN ('assigned','ready')", [shipmentId, reservedContainer.id]);
    if (!assignment) {
      await pool.execute("INSERT INTO ShipmentContainers (shipment_id, container_id, assignment_status, assigned_by) VALUES (?, ?, 'ready', ?)", [shipmentId, reservedContainer.id, admin.id]);
      await pool.execute("UPDATE Containers SET status='reserved_for_shipment' WHERE id=? AND status='in-yard'", [reservedContainer.id]);
      await pool.execute("INSERT INTO Transactions (container_id, action_type, shipment_id, user_id, event_details) VALUES (?, 'Shipment Assigned', ?, ?, JSON_OBJECT('shipmentRef','DEMO-SHP-2026-001'))", [reservedContainer.id, shipmentId, admin.id]);
    }
    console.log(`Sample data ready. Added ${added} container records; existing samples were kept.`);
  } catch (err) { console.error(err.message); process.exitCode = 1; }
  finally { await pool.end(); }
}

main();
