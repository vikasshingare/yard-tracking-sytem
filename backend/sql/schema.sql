CREATE DATABASE IF NOT EXISTS container_yard
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE container_yard;

CREATE TABLE IF NOT EXISTS Users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('yard_operator', 'gate_operator', 'shipment_operator', 'supervisor', 'viewer', 'admin') NOT NULL DEFAULT 'yard_operator',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Yards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  yard_name VARCHAR(120) NOT NULL,
  yard_code VARCHAR(40) NOT NULL UNIQUE,
  address VARCHAR(255) NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS UserYards (
  user_id BIGINT UNSIGNED NOT NULL,
  yard_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, yard_id),
  CONSTRAINT fk_user_yards_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_yards_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Gates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  yard_id BIGINT UNSIGNED NOT NULL,
  gate_code VARCHAR(40) NOT NULL,
  gate_name VARCHAR(120) NOT NULL,
  direction ENUM('in', 'out', 'both') NOT NULL DEFAULT 'both',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_gate_yard_code (yard_id, gate_code),
  CONSTRAINT fk_gates_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS UserGates (
  user_id BIGINT UNSIGNED NOT NULL,
  gate_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, gate_id),
  CONSTRAINT fk_user_gates_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_gates_gate FOREIGN KEY (gate_id) REFERENCES Gates(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Locations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  zone_name VARCHAR(120) NOT NULL,
  block_name VARCHAR(80) NOT NULL,
  row_name VARCHAR(80) NOT NULL,
  bay_name VARCHAR(80) NOT NULL DEFAULT '01',
  tier_name VARCHAR(80) NOT NULL DEFAULT '01',
  position_name VARCHAR(80) NOT NULL,
  yard_id BIGINT UNSIGNED NULL,
  capacity INT UNSIGNED NOT NULL DEFAULT 1,
  compatible_types JSON NULL,
  status ENUM('available', 'reserved', 'blocked') NOT NULL DEFAULT 'available',
  barcode_id VARCHAR(120) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_location_slot (yard_id, zone_name, block_name, row_name, bay_name, tier_name, position_name),
  INDEX idx_locations_active_zone (is_active, yard_id, zone_name, block_name, row_name),
  CONSTRAINT fk_locations_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Containers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  original_barcode VARCHAR(160) NOT NULL UNIQUE,
  internal_tracking_barcode VARCHAR(80) NOT NULL UNIQUE,
  container_number VARCHAR(80) NULL UNIQUE,
  size_code VARCHAR(30) NULL,
  type_code VARCHAR(40) NULL,
  iso_code VARCHAR(20) NULL,
  shipping_line VARCHAR(100) NULL,
  seal_number VARCHAR(100) NULL,
  condition_code ENUM('good', 'damaged', 'inspection_required', 'unknown') NOT NULL DEFAULT 'unknown',
  remarks TEXT NULL,
  status ENUM('awaiting_putaway', 'in-yard', 'reserved_for_shipment', 'ready_for_gate_out', 'dispatched') NOT NULL DEFAULT 'awaiting_putaway',
  yard_id BIGINT UNSIGNED NULL,
  putaway_assigned_to BIGINT UNSIGNED NULL,
  current_yard_location BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_containers_location FOREIGN KEY (current_yard_location)
    REFERENCES Locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_containers_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE RESTRICT,
  CONSTRAINT fk_containers_putaway_assignee FOREIGN KEY (putaway_assigned_to) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_containers_putaway_assignee (putaway_assigned_to, status),
  INDEX idx_containers_status_location (status, current_yard_location)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ContainerPhotos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(180) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_container_photos_container FOREIGN KEY (container_id)
    REFERENCES Containers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_container_photos_user FOREIGN KEY (uploaded_by)
    REFERENCES Users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  INDEX idx_container_photos_container (container_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT UNSIGNED NOT NULL,
  action_type VARCHAR(60) NOT NULL,
  from_location_id BIGINT UNSIGNED NULL,
  to_location_id BIGINT UNSIGNED NULL,
  geo_lat DECIMAL(10, 7) NULL,
  geo_long DECIMAL(10, 7) NULL,
  geo_accuracy DECIMAL(9, 2) NULL,
  reason VARCHAR(255) NULL,
  event_details JSON NULL,
  gate_id BIGINT UNSIGNED NULL,
  shipment_id BIGINT UNSIGNED NULL,
  client_action_id VARCHAR(80) NULL,
  `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id BIGINT UNSIGNED NULL,
  CONSTRAINT fk_transactions_container FOREIGN KEY (container_id)
    REFERENCES Containers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_from_location FOREIGN KEY (from_location_id)
    REFERENCES Locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_to_location FOREIGN KEY (to_location_id)
    REFERENCES Locations(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_user FOREIGN KEY (user_id)
    REFERENCES Users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_transactions_gate FOREIGN KEY (gate_id) REFERENCES Gates(id) ON DELETE SET NULL,
  INDEX idx_transactions_container_time (container_id, `timestamp`),
  INDEX idx_transactions_type_time (action_type, `timestamp`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT UNSIGNED NOT NULL,
  from_location_id BIGINT UNSIGNED NOT NULL,
  to_location_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  geo_lat DECIMAL(10, 7) NULL,
  geo_long DECIMAL(10, 7) NULL,
  geo_accuracy DECIMAL(9, 2) NULL,
  moved_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_movements_container FOREIGN KEY (container_id) REFERENCES Containers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_from FOREIGN KEY (from_location_id) REFERENCES Locations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_to FOREIGN KEY (to_location_id) REFERENCES Locations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_movements_container_date (container_id, moved_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Shipments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shipment_ref VARCHAR(80) NOT NULL UNIQUE,
  yard_id BIGINT UNSIGNED NULL,
  customer_name VARCHAR(160) NULL,
  consignee VARCHAR(160) NULL,
  shipping_line VARCHAR(100) NULL,
  vehicle_registration VARCHAR(40) NULL,
  driver_name VARCHAR(120) NULL,
  driver_contact VARCHAR(60) NULL,
  planned_dispatch_at DATETIME NULL,
  status ENUM('draft', 'ready', 'dispatched', 'cancelled') NOT NULL DEFAULT 'draft',
  remarks TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shipments_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shipments_user FOREIGN KEY (created_by) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_shipments_status_dispatch (status, planned_dispatch_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ShipmentContainers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shipment_id BIGINT UNSIGNED NOT NULL,
  container_id BIGINT UNSIGNED NOT NULL,
  assignment_status ENUM('assigned', 'ready', 'dispatched', 'cancelled') NOT NULL DEFAULT 'assigned',
  assigned_by BIGINT UNSIGNED NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at DATETIME NULL,
  CONSTRAINT fk_shipment_containers_shipment FOREIGN KEY (shipment_id) REFERENCES Shipments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shipment_containers_container FOREIGN KEY (container_id) REFERENCES Containers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shipment_containers_user FOREIGN KEY (assigned_by) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_shipment_container_active (container_id, assignment_status),
  INDEX idx_shipment_ref_status (shipment_id, assignment_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS GateTransactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT UNSIGNED NOT NULL,
  shipment_id BIGINT UNSIGNED NULL,
  gate_id BIGINT UNSIGNED NOT NULL,
  direction ENUM('in', 'out') NOT NULL,
  operator_id BIGINT UNSIGNED NULL,
  vehicle_registration VARCHAR(40) NULL,
  geo_lat DECIMAL(10, 7) NULL,
  geo_long DECIMAL(10, 7) NULL,
  geo_accuracy DECIMAL(9, 2) NULL,
  verification_result ENUM('passed', 'failed', 'override') NOT NULL DEFAULT 'passed',
  remarks VARCHAR(255) NULL,
  occurred_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_gate_tx_container FOREIGN KEY (container_id) REFERENCES Containers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gate_tx_shipment FOREIGN KEY (shipment_id) REFERENCES Shipments(id) ON DELETE SET NULL,
  CONSTRAINT fk_gate_tx_gate FOREIGN KEY (gate_id) REFERENCES Gates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gate_tx_operator FOREIGN KEY (operator_id) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_gate_tx_direction_time (direction, occurred_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS AuditLogs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  record_type VARCHAR(60) NOT NULL,
  record_id BIGINT UNSIGNED NULL,
  reason VARCHAR(255) NULL,
  change_metadata JSON NULL,
  outcome ENUM('success', 'failure') NOT NULL DEFAULT 'success',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_audit_record (record_type, record_id, created_at),
  INDEX idx_audit_user_date (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS IdempotencyKeys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  request_path VARCHAR(160) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT UNSIGNED NULL,
  response_body LONGTEXT NULL,
  state ENUM('processing', 'complete') NOT NULL DEFAULT 'processing',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_idempotency_user_key (user_id, idempotency_key),
  CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Replace these example locations with the yard's real zone and barcode labels.
INSERT INTO Yards (yard_name, yard_code) VALUES ('Main Yard', 'MAIN')
ON DUPLICATE KEY UPDATE yard_name = VALUES(yard_name);
INSERT INTO Gates (yard_id, gate_code, gate_name, direction)
SELECT id, 'MAIN', 'Main Gate', 'both' FROM Yards WHERE yard_code = 'MAIN'
ON DUPLICATE KEY UPDATE gate_name = VALUES(gate_name);
INSERT INTO Locations (yard_id, zone_name, block_name, row_name, bay_name, tier_name, position_name, barcode_id) VALUES
  ((SELECT id FROM Yards WHERE yard_code='MAIN'), 'Zone A', 'A', '01', '01', '01', '01', 'LOC-ZONE-A-A-01-01'),
  ((SELECT id FROM Yards WHERE yard_code='MAIN'), 'Zone B', 'B', '01', '01', '01', '01', 'LOC-ZONE-B-B-01-01'),
  ((SELECT id FROM Yards WHERE yard_code='MAIN'), 'Gate', 'GATE', '01', '01', '01', '01', 'LOC-GATE-GATE-01-01')
ON DUPLICATE KEY UPDATE zone_name = VALUES(zone_name);
