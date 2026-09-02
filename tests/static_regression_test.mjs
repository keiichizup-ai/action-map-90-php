import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const expect = (condition, message) => checks.push({ condition, message });

const auth = read("api/auth.php");
const chart = read("api/chart.php");
const health = read("api/health.php");
const tasks = read("api/tasks.php");
const coach = read("api/coach.php");
const context = read("api/coach_context.php");
const serviceWorker = read("service-worker.js");
const migration = read("database/migration_006_goal_intelligence_core.sql");

expect(auth.includes("session_regenerate_id(true)"), "Production Auth session regeneration is preserved.");
expect(auth.includes("PDOException") && auth.includes("23000"), "Production duplicate-registration handling is preserved.");
expect(chart.includes("public_upload_path_to_disk_path"), "Production Chart file deletion is preserved.");
expect(chart.includes("DELETE FROM recommendations WHERE user_id = ?"), "Chart deletion remains user-scoped.");
expect(tasks.includes("update_owned_task_with_activity($userId, $taskId"), "Task changes use owned, logged updates.");
expect(coach.includes("allowed_today_task_ids($userId") && coach.includes("allowed_checkin_task_ids($userId"), "Coach task IDs remain user-scoped.");
expect(context.includes("WHERE user_id = ?") && context.includes("activity.user_id = ?"), "Context queries explicitly scope user data.");
expect(serviceWorker.includes("event.request.method !== 'GET'") && serviceWorker.includes("includes('/api/')"), "Service Worker does not cache POST/API responses.");
expect(!health.includes("DB_HOST") && !health.includes("DB_NAME") && !health.includes("DB_USER"), "Public health does not expose DB metadata.");
expect(!health.includes("getMessage()]);") && health.includes("respond(['ok' => true])"), "Public health response is minimal.");
expect(migration.includes("ON DELETE SET NULL"), "Task deletion retains activity rows.");
expect(migration.includes("ai_response JSON NULL"), "Structured AI response columns are additive.");

const failures = checks.filter(({ condition }) => !condition);
for (const check of checks) {
  console.log(`${check.condition ? "PASS" : "FAIL"} ${check.message}`);
}
if (failures.length) process.exit(1);
