-- Run once against a database created from the earlier schema.
ALTER TABLE Locations
  ADD COLUMN block_name VARCHAR(80) NOT NULL DEFAULT 'A' AFTER zone_name,
  ADD COLUMN row_name VARCHAR(80) NOT NULL DEFAULT '01' AFTER block_name,
  ADD COLUMN position_name VARCHAR(80) NOT NULL DEFAULT '01' AFTER row_name;

UPDATE Locations SET
  block_name = CASE WHEN zone_name = 'Gate' THEN 'GATE' ELSE UPPER(LEFT(zone_name, 1)) END,
  position_name = LPAD(id, 2, '0');

ALTER TABLE Locations
  DROP INDEX idx_locations_active_zone,
  ADD UNIQUE KEY uq_location_slot (zone_name, block_name, row_name, position_name),
  ADD INDEX idx_locations_active_zone (is_active, zone_name, block_name, row_name);
