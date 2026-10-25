-- One-time extension: scope gate operators to assigned gates when configured.
USE container_yard;
CREATE TABLE IF NOT EXISTS UserGates (
  user_id BIGINT UNSIGNED NOT NULL,
  gate_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id,gate_id),
  CONSTRAINT fk_user_gates_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_gates_gate FOREIGN KEY (gate_id) REFERENCES Gates(id) ON DELETE CASCADE
) ENGINE=InnoDB;
