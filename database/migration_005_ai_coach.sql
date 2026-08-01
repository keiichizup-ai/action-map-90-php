-- ACTION MAP 90 AIコーチ（第1・第2段階）
CREATE TABLE daily_checkins (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  checkin_date DATE NOT NULL,
  mood TINYINT UNSIGNED NOT NULL DEFAULT 3,
  focus_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  concern TEXT NULL,
  selected_task_ids JSON NULL,
  ai_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_checkin_date (user_id, checkin_date),
  INDEX idx_checkins_user_date (user_id, checkin_date),
  CONSTRAINT fk_checkins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE daily_journals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  journal_date DATE NOT NULL,
  mood TINYINT UNSIGNED NOT NULL DEFAULT 3,
  completed_text TEXT NULL,
  problem_text TEXT NULL,
  reason_code VARCHAR(32) NULL,
  free_text TEXT NULL,
  tomorrow_action VARCHAR(32) NULL,
  completed_task_ids JSON NULL,
  ai_feedback TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_journal_date (user_id, journal_date),
  INDEX idx_journals_user_date (user_id, journal_date),
  CONSTRAINT fk_journals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
