import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('Presentation-only clean checkout passes without Phase 1 assets or tooling', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const clean = mkdtempSync(path.join(tmpdir(), 'am90-dummy-clean-'));
  const archive = execFileSync('git', ['archive', 'HEAD'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', clean], { input: archive });
  const runtime = ['mobile-coach.php', 'assets/mobile-coach.js', 'assets/mobile-coach.css', 'api/coach_followup.php',
    'api/coach_speech.php', 'api/coach_transcribe.php', ...['avatar-bridge.js', 'mira-presentation-controller.js',
    'mobile-avatar-bridge.js', 'mira-presentation.css'].map(name => 'assets/avatar/' + name),
    ...['neutral', 'thinking', 'encourage', 'empathy', 'smile', 'celebrate'].map(name => `assets/avatar/mira/mira-${name}.webp`)];
  const tests = ['avatar_bridge_test.mjs', 'mobile_avatar_integration_test.mjs', 'avatar_local_guard_test.mjs'];
  for (const file of [...runtime, ...tests.map(name => 'tests/' + name)]) {
    cpSync(path.join(root, file), path.join(clean, file), { recursive: true });
  }
  for (const file of ['assets/avatar/releases', 'tools/avatar', 'avatar-poc.php']) assert.equal(existsSync(path.join(clean, file)), false);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // The exported checkout is an independent runner, not a nested test worker.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests.map(name => 'tests/' + name)], { cwd: clean, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /# fail 0/);
});
