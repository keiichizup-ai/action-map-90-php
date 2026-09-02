ALTER TABLE mandala_charts
  ADD COLUMN goal_why TEXT NULL AFTER ai_result,
  ADD COLUMN goal_deadline DATE NULL AFTER goal_why;

CREATE TABLE task_activity_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  task_id INT UNSIGNED NULL,
  task_title_snapshot VARCHAR(255) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  old_start_date DATE NULL,
  old_due_date DATE NULL,
  new_start_date DATE NULL,
  new_due_date DATE NULL,
  old_status ENUM('todo', 'doing', 'done') NULL,
  new_status ENUM('todo', 'doing', 'done') NULL,
  is_postponement TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_task_activity_user_created (user_id, created_at),
  INDEX idx_task_activity_user_task (user_id, task_id, is_postponement),
  CONSTRAINT fk_task_activity_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_task_activity_task
    FOREIGN KEY (task_id) REFERENCES action_tasks(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE daily_checkins
  ADD COLUMN ai_response JSON NULL AFTER ai_message;

ALTER TABLE daily_journals
  ADD COLUMN ai_response JSON NULL AFTER ai_feedback;
