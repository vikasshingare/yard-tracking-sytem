-- Separate Gate Entry from assigned Yard Put-away work and retain entry photos.
ALTER TABLE Containers
  ADD COLUMN putaway_assigned_to BIGINT UNSIGNED NULL AFTER yard_id,
  ADD INDEX idx_containers_putaway_assignee (putaway_assigned_to, status),
  ADD CONSTRAINT fk_containers_putaway_assignee
    FOREIGN KEY (putaway_assigned_to) REFERENCES Users(id) ON DELETE SET NULL;

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
