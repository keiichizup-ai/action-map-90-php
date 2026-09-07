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
const assetVersion = read("asset_version.php");
const desktopPage = read("index.php");
const mobilePage = read("mobile-coach.php");
const mobileScript = read("assets/mobile-coach.js");
const registerPwaSource = mobileScript.slice(
  mobileScript.indexOf("function registerPwa()"),
  mobileScript.indexOf("async function installPwa()")
);
const migration = read("database/migration_006_goal_intelligence_core.sql");

expect(auth.includes("session_regenerate_id(true)"), "Production Auth session regeneration is preserved.");
expect(auth.includes("PDOException") && auth.includes("23000"), "Production duplicate-registration handling is preserved.");
expect(chart.includes("public_upload_path_to_disk_path"), "Production Chart file deletion is preserved.");
expect(chart.includes("DELETE FROM recommendations WHERE user_id = ?"), "Chart deletion remains user-scoped.");
expect(tasks.includes("update_owned_task_with_activity($userId, $taskId"), "Task changes use owned, logged updates.");
expect(coach.includes("allowed_today_task_ids($userId") && coach.includes("allowed_checkin_task_ids($userId"), "Coach task IDs remain user-scoped.");
expect(context.includes("WHERE user_id = ?") && context.includes("activity.user_id = ?"), "Context queries explicitly scope user data.");
expect(serviceWorker.includes("event.request.method !== 'GET'") && serviceWorker.includes("isApiRequest(requestUrl)"), "Service Worker does not cache POST/API responses.");
expect(serviceWorker.includes("event.request.mode === 'navigate'") && serviceWorker.includes("networkFirstNavigation"), "HTML navigation uses network-first handling.");
expect(serviceWorker.includes("encodeURIComponent(SCOPE_PATH)") && serviceWorker.includes("cacheName.startsWith(CACHE_PREFIX)"), "Service Worker cache names and current-cache cleanup are scope-specific.");
expect(serviceWorker.includes("removeCurrentScopeFromLegacyCache") && serviceWorker.includes("isWithinCurrentScope"), "Legacy v3/v4 cleanup removes only entries in the current scope.");
expect(serviceWorker.includes("ignoreSearch: true") && serviceWorker.includes("cacheLatestPathVersion"), "Versioned assets use consistent exact cache keys with an offline query fallback.");
expect(assetVersion.includes("hash_file('sha256'") && desktopPage.includes("versioned_asset_url('assets/app.js')") && mobilePage.includes("versioned_asset_url('assets/mobile-coach.js')"), "Asset versions are content-derived through one shared helper.");
expect(desktopPage.includes("send_no_store_html_headers()") && mobilePage.includes("send_no_store_html_headers()"), "Desktop and Mobile HTML send no-store headers.");
expect(mobileScript.includes("scope: './'") && mobileScript.includes("updateViaCache: 'none'") && mobileScript.includes("registration.update()"), "Service Worker registration fixes the application scope and bypasses the HTTP cache for updates.");
expect(!registerPwaSource.includes("location.reload") && !registerPwaSource.includes("controllerchange"), "Service Worker updates do not force-reload a page with user input.");
expect(!health.includes("DB_HOST") && !health.includes("DB_NAME") && !health.includes("DB_USER"), "Public health does not expose DB metadata.");
expect(!health.includes("getMessage()]);") && health.includes("respond(['ok' => true])"), "Public health response is minimal.");
expect(migration.includes("ON DELETE SET NULL"), "Task deletion retains activity rows.");
expect(migration.includes("ai_response JSON NULL"), "Structured AI response columns are additive.");

const failures = checks.filter(({ condition }) => !condition);
for (const check of checks) {
  console.log(`${check.condition ? "PASS" : "FAIL"} ${check.message}`);
}
if (failures.length) process.exit(1);
