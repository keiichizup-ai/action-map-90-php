import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

function request(path, host = '127.0.0.1:8094') {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: 8094, path, headers: { Host: host } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', data => body += data);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    req.on('error', reject);
  });
}
test('loopback shell enables Presentation Mira and content-versioned modules, no SDK dependency', async () => {
  const response = await request('/mobile-coach.php'); assert.equal(response.status, 200);
  assert.ok(response.headers['cache-control'].includes('no-store')); assert.ok(response.body.includes('mobileMiraPresentation'));
  assert.equal(response.body.includes('mobileConcern'), false); assert.equal(response.body.includes('mobileCheckinMessage'), false);
  assert.equal(response.body.includes('mobileJournalMessage'), false); assert.equal(response.body.includes('AIコーチに相談する（任意）'), false);
  const urls = response.body.match(/\.\/assets\/avatar\/[^"\s]+\?v=[a-f0-9]{12}/g);
  assert.equal(urls.length, 4);
  for (const url of urls) { const asset = await request(url.slice(1)); assert.equal(asset.status, 200); }
  assert.equal(response.body.includes('live2dcubismcore'), false); assert.equal(response.body.includes('models/haru'), false);
});
test('non-loopback Host and query flags cannot enable Dummy, existing Text shell remains usable', async () => {
  for (const host of ['keiichizup.sakura.ne.jp', 'localhost.evil.invalid', '127.0.0.1.evil.invalid']) {
    const response = await request('/mobile-coach.php?avatar=1', host); assert.equal(response.status, 200);
    assert.equal(response.body.includes('mobileMiraPresentation'), false); assert.ok(response.body.includes('homeCoachMessage'));
    assert.equal(response.body.includes('assets/avatar/'), false);
  }
});
test('fixture server refuses SDK/Core/Haru/config and Production routes', async () => {
  for (const path of ['/assets/avatar/releases/poc-002/core/live2dcubismcore.min.js', '/config/config.php', '/action-map-90/mobile-coach.php']) {
    assert.equal((await request(path)).status, 404);
  }
});
