ALTER TABLE action_tasks
  ADD COLUMN start_date DATE NULL AFTER description;

UPDATE action_tasks
SET start_date = CASE
  WHEN due_date IS NOT NULL THEN DATE_SUB(due_date, INTERVAL 6 DAY)
  ELSE CURDATE()
END
WHERE start_date IS NULL;

ALTER TABLE action_tasks
  DROP INDEX idx_tasks_user_status_due,
  ADD INDEX idx_tasks_user_status_due (user_id, status, start_date, due_date);
