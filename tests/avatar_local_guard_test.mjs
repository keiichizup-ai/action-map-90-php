import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');
const php = process.env.AM90_TEST_PHP || '/Applications/XAMPP/xamppfiles/bin/php';
test('normal PHP SAPI never enables Dummy even with loopback or query flag', () => {
  for (const host of ['127.0.0.1:8094', 'keiichizup.sakura.ne.jp']) {
    const code = `$_SERVER['HTTP_HOST']=${JSON.stringify(host)}; $_SERVER['REMOTE_ADDR']='127.0.0.1'; $_GET['avatar']='1'; require ${JSON.stringify(path.join(root, 'mobile-coach.php'))};`;
    const html = execFileSync(php, ['-r', code], { encoding: 'utf8' });
    assert.ok(html.includes('homeCoachMessage'));
    assert.equal(html.includes('mobileMiraPresentation'), false);
    assert.equal(html.includes('assets/avatar/'), false);
  }
});
test('Presentation runtime has no SDK, release, model or external dependency', () => {
  for (const name of ['avatar-bridge.js', 'mira-presentation-controller.js', 'mobile-avatar-bridge.js', 'mira-presentation.css']) {
    const source = fs.readFileSync(path.join(root, 'assets/avatar', name), 'utf8');
    assert.equal(/live2dcubismcore|releases\/poc-|models\/haru|CubismFramework|https?:\/\//.test(source), false);
  }
});

test('pure guard requires staging host, script and physical directory; Production always OFF', () => {
  const stage = '/home/keiichizup/www/action-map-90-staging';
  const prod = '/home/keiichizup/www/action-map-90';
  const base = { HTTP_HOST: 'keiichizup.sakura.ne.jp', SCRIPT_NAME: '/action-map-90-staging/mobile-coach.php', REMOTE_ADDR: '203.0.113.1' };
  const cases = [
    [base, 'cgi-fcgi', stage, true],
    [base, 'apache2handler', stage, true],
    [base, 'cgi-fcgi', prod, false],
    [{ ...base, SCRIPT_NAME: '/action-map-90/mobile-coach.php' }, 'cgi-fcgi', stage, false],
    [{ ...base, SCRIPT_NAME: '/mobile-coach.php', QUERY_STRING: 'avatar=1' }, 'cgi-fcgi', stage, false],
    [{ ...base, HTTP_HOST: 'evil.invalid' }, 'cgi-fcgi', stage, false],
    [base, 'cgi-fcgi', stage + '-copy', false],
    [base, 'cgi-fcgi', stage + '/../action-map-90-staging', false],
    [{ HTTP_HOST: 'localhost:8094', REMOTE_ADDR: '127.0.0.1', SCRIPT_NAME: '/mobile-coach.php' }, 'cli-server', '/tmp/dummy', true],
    [{ HTTP_HOST: '[::1]:8094', REMOTE_ADDR: '::1' }, 'cli-server', '/tmp/dummy', true],
    [{ HTTP_HOST: 'localhost', REMOTE_ADDR: '127.0.0.1', SCRIPT_NAME: '/action-map-90/mobile-coach.php' }, 'cli-server', '/tmp/dummy', false],
    [{ HTTP_HOST: 'localhost', REMOTE_ADDR: '127.0.0.1' }, 'cli-server', prod, false],
    [{ HTTP_HOST: 'localhost', REMOTE_ADDR: '203.0.113.1' }, 'cli-server', '/tmp/dummy', false],
  ];
  for (const [server, sapi, directory, expected] of cases) {
    const code = `ob_start(); require ${JSON.stringify(path.join(root, 'mobile-coach.php'))}; ob_end_clean(); $s=json_decode(${JSON.stringify(JSON.stringify(server))},true); echo dummy_avatar_enabled($s,${JSON.stringify(sapi)},${JSON.stringify(directory)})?'on':'off';`;
    assert.equal(execFileSync(php, ['-r', code], { encoding: 'utf8' }), expected ? 'on' : 'off');
  }
});
