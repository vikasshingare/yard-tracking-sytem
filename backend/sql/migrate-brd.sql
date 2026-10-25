-- One-time upgrade from the app's pre-BRD schema. Back up the database first.
CREATE TABLE IF NOT EXISTS Yards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  yard_name VARCHAR(120) NOT NULL,
  yard_code VARCHAR(40) NOT NULL UNIQUE,
  address VARCHAR(255) NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT INTO Yards (yard_name, yard_code) VALUES ('Main Yard', 'MAIN') ON DUPLICATE KEY UPDATE yard_name=VALUES(yard_name);

CREATE TABLE IF NOT EXISTS UserYards (
  user_id BIGINT UNSIGNED NOT NULL,
  yard_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, yard_id),
  CONSTRAINT fk_user_yards_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_yards_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE Users MODIFY role ENUM('worker','gate_operator','supervisor','admin','yard_operator','shipment_operator','viewer') NOT NULL DEFAULT 'yard_operator';
UPDATE Users SET role='yard_operator' WHERE role='worker';
ALTER TABLE Users MODIFY role ENUM('yard_operator','gate_operator','shipment_operator','supervisor','viewer','admin') NOT NULL DEFAULT 'yard_operator';

CREATE TABLE IF NOT EXISTS Gates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  yard_id BIGINT UNSIGNED NOT NULL,
  gate_code VARCHAR(40) NOT NULL,
  gate_name VARCHAR(120) NOT NULL,
  direction ENUM('in','out','both') NOT NULL DEFAULT 'both',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_gate_yard_code (yard_id, gate_code),
  CONSTRAINT fk_gates_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
INSERT INTO Gates (yard_id,gate_code,gate_name,direction)
SELECT id,'MAIN','Main Gate','both' FROM Yards WHERE yard_code='MAIN'
ON DUPLICATE KEY UPDATE gate_name=VALUES(gate_name);

ALTER TABLE Locations
  ADD COLUMN bay_name VARCHAR(80) NOT NULL DEFAULT '01' AFTER row_name,
  ADD COLUMN tier_name VARCHAR(80) NOT NULL DEFAULT '01' AFTER bay_name,
  ADD COLUMN yard_id BIGINT UNSIGNED NULL AFTER position_name,
  ADD COLUMN capacity INT UNSIGNED NOT NULL DEFAULT 1 AFTER yard_id,
  ADD COLUMN compatible_types JSON NULL AFTER capacity,
  ADD COLUMN status ENUM('available','reserved','blocked') NOT NULL DEFAULT 'available' AFTER compatible_types;
UPDATE Locations SET yard_id=(SELECT id FROM Yards WHERE yard_code='MAIN' LIMIT 1), position_name=LPAD(id,2,'0');
ALTER TABLE Locations
  DROP INDEX uq_location_slot,
  ADD UNIQUE KEY uq_location_slot (yard_id,zone_name,block_name,row_name,bay_name,tier_name,position_name),
  ADD CONSTRAINT fk_locations_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE RESTRICT;

ALTER TABLE Containers
  ADD COLUMN container_number VARCHAR(80) NULL AFTER internal_tracking_barcode,
  ADD COLUMN size_code VARCHAR(30) NULL AFTER container_number,
  ADD COLUMN type_code VARCHAR(40) NULL AFTER size_code,
  ADD COLUMN iso_code VARCHAR(20) NULL AFTER type_code,
  ADD COLUMN shipping_line VARCHAR(100) NULL AFTER iso_code,
  ADD COLUMN seal_number VARCHAR(100) NULL AFTER shipping_line,
  ADD COLUMN condition_code ENUM('good','damaged','inspection_required','unknown') NOT NULL DEFAULT 'unknown' AFTER seal_number,
  ADD COLUMN remarks TEXT NULL AFTER condition_code,
  ADD COLUMN yard_id BIGINT UNSIGNED NULL AFTER status;
ALTER TABLE Containers MODIFY status ENUM('in-yard','shipped','awaiting_putaway','reserved_for_shipment','ready_for_gate_out','dispatched') NOT NULL DEFAULT 'awaiting_putaway';
UPDATE Containers SET container_number=original_barcode, yard_id=(SELECT id FROM Yards WHERE yard_code='MAIN' LIMIT 1), status='dispatched' WHERE status='shipped';
UPDATE Containers SET container_number=original_barcode, yard_id=(SELECT id FROM Yards WHERE yard_code='MAIN' LIMIT 1) WHERE container_number IS NULL;
ALTER TABLE Containers MODIFY status ENUM('awaiting_putaway','in-yard','reserved_for_shipment','ready_for_gate_out','dispatched') NOT NULL DEFAULT 'awaiting_putaway',
  ADD UNIQUE KEY uq_containers_number (container_number),
  ADD CONSTRAINT fk_containers_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE RESTRICT;

ALTER TABLE Transactions
  MODIFY action_type VARCHAR(60) NOT NULL,
  ADD COLUMN geo_accuracy DECIMAL(9,2) NULL AFTER geo_long,
  ADD COLUMN reason VARCHAR(255) NULL AFTER geo_accuracy,
  ADD COLUMN event_details JSON NULL AFTER reason,
  ADD COLUMN gate_id BIGINT UNSIGNED NULL AFTER event_details,
  ADD COLUMN shipment_id BIGINT UNSIGNED NULL AFTER gate_id,
  ADD COLUMN client_action_id VARCHAR(80) NULL AFTER shipment_id;

CREATE TABLE IF NOT EXISTS Movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT UNSIGNED NOT NULL,
  from_location_id BIGINT UNSIGNED NOT NULL,
  to_location_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  geo_lat DECIMAL(10,7) NULL,
  geo_long DECIMAL(10,7) NULL,
  geo_accuracy DECIMAL(9,2) NULL,
  moved_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_movements_container FOREIGN KEY (container_id) REFERENCES Containers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_from FOREIGN KEY (from_location_id) REFERENCES Locations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_to FOREIGN KEY (to_location_id) REFERENCES Locations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_movements_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_movements_container_date (container_id,moved_at)
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
  status ENUM('draft','ready','dispatched','cancelled') NOT NULL DEFAULT 'draft',
  remarks TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shipments_yard FOREIGN KEY (yard_id) REFERENCES Yards(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shipments_user FOREIGN KEY (created_by) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_shipments_status_dispatch (status,planned_dispatch_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ShipmentContainers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shipment_id BIGINT UNSIGNED NOT NULL,
  container_id BIGINT UNSIGNED NOT NULL,
  assignment_status ENUM('assigned','ready','dispatched','cancelled') NOT NULL DEFAULT 'assigned',
  assigned_by BIGINT UNSIGNED NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at DATETIME NULL,
  CONSTRAINT fk_shipment_containers_shipment FOREIGN KEY (shipment_id) REFERENCES Shipments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shipment_containers_container FOREIGN KEY (container_id) REFERENCES Containers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_shipment_containers_user FOREIGN KEY (assigned_by) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_shipment_container_active (container_id,assignment_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS GateTransactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  container_id BIGINT UNSIGNED NOT NULL,
  shipment_id BIGINT UNSIGNED NULL,
  gate_id BIGINT UNSIGNED NOT NULL,
  direction ENUM('in','out') NOT NULL,
  operator_id BIGINT UNSIGNED NULL,
  vehicle_registration VARCHAR(40) NULL,
  geo_lat DECIMAL(10,7) NULL,
  geo_long DECIMAL(10,7) NULL,
  geo_accuracy DECIMAL(9,2) NULL,
  verification_result ENUM('passed','failed','override') NOT NULL DEFAULT 'passed',
  remarks VARCHAR(255) NULL,
  occurred_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_gate_tx_container FOREIGN KEY (container_id) REFERENCES Containers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gate_tx_shipment FOREIGN KEY (shipment_id) REFERENCES Shipments(id) ON DELETE SET NULL,
  CONSTRAINT fk_gate_tx_gate FOREIGN KEY (gate_id) REFERENCES Gates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_gate_tx_operator FOREIGN KEY (operator_id) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_gate_tx_direction_time (direction,occurred_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS AuditLogs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  record_type VARCHAR(60) NOT NULL,
  record_id BIGINT UNSIGNED NULL,
  reason VARCHAR(255) NULL,
  change_metadata JSON NULL,
  outcome ENUM('success','failure') NOT NULL DEFAULT 'success',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE SET NULL,
  INDEX idx_audit_record (record_type,record_id,created_at),
  INDEX idx_audit_user_date (user_id,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS IdempotencyKeys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  request_path VARCHAR(160) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT UNSIGNED NULL,
  response_body LONGTEXT NULL,
  state ENUM('processing','complete') NOT NULL DEFAULT 'processing',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_idempotency_user_key (user_id,idempotency_key),
  CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
