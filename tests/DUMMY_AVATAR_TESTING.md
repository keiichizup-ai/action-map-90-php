# Dummy Avatar — independent local verification

Requirements: Node.js 22+, PHP 8+, Git and tar. No npm install, SDK, model, WebGL, database or API key is needed.
Set `AM90_TEST_PHP` to your PHP executable if it differs from the existing test default.
Run commands from the repository root.

## Dummy-only tests

```sh
node --test tests/avatar_bridge_test.mjs tests/mobile_avatar_integration_test.mjs tests/avatar_local_guard_test.mjs tests/dummy_clean_checkout_test.mjs
```

The clean-checkout test exports HEAD to an OS temporary directory, overlays only the six Dummy runtime files and three Dummy test files, and verifies there is no Phase 1 release, PoC page or tooling. It never changes the working repository.

## Chrome fixture and HTTP checks

```sh
php -S 127.0.0.1:8094 -t . tests/dummy_avatar_router.php
```

Open `http://127.0.0.1:8094/tests/mobile-avatar-browser.html` in Chrome. Press **Run browser tests** at least three times without reloading the harness. Each run must finish PASS, with zero captured console errors. The fixture uses synthetic data only; its authentication response is not a real login/logout test.

In a second terminal:

```sh
node --test tests/avatar_http_test.mjs
```

The probe script and router are test-only; never deploy them. The router does not serve SDK/model/config/Production paths.

## Separate Phase 1 regression

```sh
node --test tools/avatar/tests/controller.test.mjs tools/avatar/tests/build.test.mjs tests/phase1/release_integrity_test.mjs
```

This separate suite intentionally requires existing Phase 1 local assets/tooling. Do not include it in a Dummy-only checkout or deploy.

## Staging follow-up (not performed locally)

Verify actual PHP `__DIR__` is `/home/keiichizup/www/action-map-90-staging`, host is `keiichizup.sakura.ne.jp`, and `SCRIPT_NAME` is `/action-map-90-staging/mobile-coach.php`. The guard fails closed if any staging value differs. Verify real login/logout, Morning/Evening persistence, task completion/desktop reload, history, user isolation and the existing SW update flow after an approved staging-only deploy. Never deploy or modify Production during these tests.
