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
const coachResponse = read("api/coach_response.php");
const coachFollowup = read("api/coach_followup.php");
const coachSpeech = read("api/coach_speech.php");
const coachTranscribe = read("api/coach_transcribe.php");
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
expect(context.includes("postponement_lookback_days") && context.includes("activity.created_at >= ?") && context.includes("task.status <> 'done'"), "Coach postponement signals use a 30-day window and exclude completed targets.");
expect(context.includes("selectCoachQuestionType") && context.includes("COACH_QUESTION_TYPES"), "Question type selection is server-side and allowlisted.");
expect(coach.includes("buildCoachContext($userId") && coach.includes("generateCoachResponse($userId"), "Morning and Evening saves use Goal Intelligence context.");
expect(coach.includes("ai_message, ai_response") && coach.includes("ai_feedback, ai_response"), "Morning and Evening persist both legacy and structured coach responses.");
expect(coach.indexOf("require_csrf($data)") < coach.indexOf("if ($action === 'save_checkin')"), "Coach writes remain protected by CSRF validation.");
expect(coachResponse.includes("catch (Throwable)") && coachResponse.includes("return $fallback"), "AI failures fall back before Morning or Evening persistence.");
expect(coach.indexOf("'planned_count' => $plannedCount") < coach.indexOf("update_owned_task_with_activity($userId, $completedTaskId"), "Evening completion data is overlaid before the existing task update order.");
expect(coachResponse.includes("json_schema") && coachResponse.includes("strict' => true"), "Coach wording uses strict Structured Output.");
expect(coachResponse.includes("'store' => false"), "Responses API storage is disabled for coach prompt privacy.");
expect(coachResponse.includes("validateCoachTargetTaskId") && coachResponse.includes("=== 'done'"), "Coach target tasks are revalidated and completed tasks are rejected.");
expect(coachResponse.includes("buildCoachFallbackResponse") && coachResponse.includes("isSingleCoachQuestion"), "Invalid or failed AI responses use a validated one-question fallback.");
expect(!coachResponse.includes("user_id' =>") && !coachResponse.includes("email' =>") && !coachResponse.includes("ai_result"), "Coach prompts do not include user identity or the full plan.");
expect(coachFollowup.includes("current_user_id()") && coachFollowup.includes("require_csrf($data)"), "Follow-up uses authenticated session context and CSRF protection.");
expect(coachFollowup.includes("buildCoachContext($userId") && !coachFollowup.includes("$data['user_id']") && !coachFollowup.includes("$data['task"), "Follow-up context is server-owned and user-scoped.");
expect(coachFollowup.includes("'store' => false") && coachFollowup.includes("json_schema") && coachFollowup.includes("strict' => true"), "Follow-up uses private strict structured output.");
expect(coachFollowup.includes("/action-map-90-staging/api/coach_followup.php") && coachFollowup.includes("str_starts_with($script, '/action-map-90/')"), "Follow-up endpoint retains an explicit staging/local-only guard.");
expect(coachSpeech.includes("current_user_id()") && coachSpeech.includes("require_csrf($data)")
  && coachSpeech.includes("/action-map-90-staging/api/coach_speech.php") && coachSpeech.includes("str_starts_with($script, '/action-map-90/')"),
"ElevenLabs speech is authenticated, CSRF-protected and staging/local-only.");
expect(coachSpeech.includes("ELEVENLABS_API_KEY") && coachSpeech.includes("xi-api-key:")
  && !mobileScript.includes("ELEVENLABS_API_KEY") && !mobileScript.includes("LKD32PsGTGpoVmYgvAOv"),
"ElevenLabs key and selected voice ID remain server-side.");
expect(coachSpeech.includes("COACH_SPEECH_MAX_TEXT") && coachSpeech.includes("containsCoachSpeechMarkup")
  && !coachSpeech.includes("file_put_contents") && !coachSpeech.includes("tempnam"),
"Speech accepts bounded plain text and does not persist generated audio.");
expect(coachTranscribe.includes("current_user_id()") && coachTranscribe.includes("require_csrf($_POST)")
  && coachTranscribe.includes("deleteCoachAudioUpload($temporaryPath)") && coachTranscribe.includes("COACH_TRANSCRIBE_MAX_DURATION_MS"),
"Microphone transcription is authenticated, bounded, and deletes temporary uploads.");
expect(serviceWorker.includes("event.request.method !== 'GET'") && serviceWorker.includes("isApiRequest(requestUrl)"), "Service Worker does not cache POST/API responses.");
expect(serviceWorker.includes("event.request.mode === 'navigate'") && serviceWorker.includes("networkFirstNavigation"), "HTML navigation uses network-first handling.");
expect(serviceWorker.includes("encodeURIComponent(SCOPE_PATH)") && serviceWorker.includes("cacheName.startsWith(CACHE_PREFIX)"), "Service Worker cache names and current-cache cleanup are scope-specific.");
expect(serviceWorker.includes("removeCurrentScopeFromLegacyCache") && serviceWorker.includes("isWithinCurrentScope"), "Legacy v3/v4 cleanup removes only entries in the current scope.");
expect(serviceWorker.includes("ignoreSearch: true") && serviceWorker.includes("cacheLatestPathVersion"), "Versioned assets use consistent exact cache keys with an offline query fallback.");
expect(assetVersion.includes("hash_file('sha256'") && desktopPage.includes("versioned_asset_url('assets/app.js')") && mobilePage.includes("versioned_asset_url('assets/mobile-coach.js')"), "Asset versions are content-derived through one shared helper.");
expect(desktopPage.includes("send_no_store_html_headers()") && mobilePage.includes("send_no_store_html_headers()"), "Desktop and Mobile HTML send no-store headers.");
expect(!mobilePage.includes('id="mobileConcern"') && !mobilePage.includes('id="mobileCheckinMessage"')
  && !mobilePage.includes('id="mobileJournalMessage"') && !mobilePage.includes('AIコーチに相談する（任意）'),
"Mobile Check-in has no duplicate Coach input or response boxes.");
expect(mobileScript.includes("concern: ''") && mobileScript.includes("showFormStatus('mobileCheckinStatus', error.message)")
  && mobileScript.includes("showFormStatus('mobileJournalStatus', error.message)"),
"Morning keeps API compatibility while save errors remain accessible outside the Coach bubble.");
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
