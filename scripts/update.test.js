const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidkidz-update-test-'));
process.env.VIDKIDZ_DATA_DIR = path.join(temp, 'data');
let server;
let base;
before(async () => {
  const app = require('../server');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('CSS gate rejects the original missing-brace regression', () => {
  const fixture = path.join(temp, 'fixture');
  fs.mkdirSync(path.join(fixture, 'public'), { recursive: true });
  const file = path.join(fixture, 'public', 'index.html');
  fs.writeFileSync(file, '<style>.install-prompt { display:none; .hero {height:130px;}</style>');
  assert.throws(() => require('./check-ui').checkUI(fixture), /Unclosed block/);
  fs.writeFileSync(file, '<style>.install-prompt { display:none; } .hero {height:130px;}</style>');
  assert.equal(require('./check-ui').checkUI(fixture), 1);
});
test('HTML, server and service-worker share one release identity', async () => {
  const version = await (await fetch(base + '/api/version')).json();
  assert.equal(version.version, require('../package.json').version);
  assert.match(version.releaseId, /^[a-f0-9]{24}$/);
  const html = await (await fetch(base)).text();
  assert.ok(html.includes(`"releaseId":"${version.releaseId}"`));
  const sw = await (await fetch(base + '/sw.js')).text();
  assert.ok(sw.includes(`const CACHE_VERSION = '${version.releaseId}'`));
  assert.ok(sw.includes(`const APP_VERSION = '${version.version}'`));
  assert.ok(!html.includes('<script src="/dev-sync.js">'));
});
test('production cannot access dev endpoint; missing assets return 404', async () => {
  assert.equal((await fetch(base + '/__dev/revision')).status, 404);
  assert.equal((await fetch(base + '/assets/missing.png')).status, 404);
  const asset = await fetch(base + '/logo.png');
  assert.equal(asset.status, 200);
  assert.ok(!asset.headers.get('cache-control').includes('immutable'));
});
test('each tab compares its loaded build, even if the semver stays unchanged', async () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const code = html.slice(html.indexOf('function registerBackgroundUpdater('), html.indexOf('function isDesktopDeviceViewport('));
  let updates = 0;
  let callback;
  const win = { __VIDKIDZ_RELEASE__: { releaseId: 'old-build' } };
  win.self = win; win.top = win;
  const context = {
    window: win, navigator: {}, document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    VERSION_POLL_MS: 60000, setInterval(fn) { callback = fn; return 1; }, clearInterval() {},
    fetch: async () => ({ ok: true, json: async () => ({ version: '5.2.24', releaseId: 'new-build' }) }),
    scheduleSoftReload() { updates++; }
  };
  vm.runInNewContext(code + '\nthis.stop = registerBackgroundUpdater(() => {});', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates, 1);
  context.stop();
  await callback();
  assert.equal(updates, 1);
});

test('Local Sync holds invalid saves and resumes after a valid save', async () => {
  const express = require('express');
  const fixture = path.join(temp, 'live');
  fs.mkdirSync(path.join(fixture, 'public'), { recursive: true });
  const file = path.join(fixture, 'public', 'index.html');
  fs.writeFileSync(file, '<style>.hero { height:120px; }</style>');
  const app = express();
  const stopSync = require('./dev-middleware')(app, fixture);
  const live = app.listen(0, '127.0.0.1');
  await new Promise(resolve => live.once('listening', resolve));
  const url = `http://127.0.0.1:${live.address().port}/__dev/revision`;
  const read = async () => (await fetch(url)).json();
  async function until(predicate) {
    for (let i = 0; i < 30; i++) {
      const state = await read();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Local Sync did not respond to file changes');
  }
  try {
    const first = await read();
    fs.writeFileSync(file, '<style>.hero { height:120px;</style>');
    const invalid = await until(s => !!s.error);
    assert.equal(invalid.revision, first.revision);
    fs.writeFileSync(file, '<style>.hero { height:140px; }</style>');
    const valid = await until(s => !s.error && s.revision !== first.revision);
    assert.ok(valid.revision);
  } finally { stopSync(); await new Promise(resolve => live.close(resolve)); }
});

test('release hash changes for an asset edit without a version bump', () => {
  const fixture = path.join(temp, 'release');
  fs.mkdirSync(path.join(fixture, 'public'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'scripts'));
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(fixture, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(fixture, 'server.js'), '// server\r\n');
  const asset = path.join(fixture, 'public', 'icon.svg');
  fs.writeFileSync(asset, '<svg/>');
  const info = require('./release-info');
  const original = info(fixture);
  fs.writeFileSync(path.join(fixture, 'server.js'), '// server\n');
  assert.equal(info(fixture).releaseId, original.releaseId, 'Windows/Linux line endings match');
  fs.writeFileSync(asset, '<svg width="20"/>');
  assert.notEqual(info(fixture).releaseId, original.releaseId);
  assert.equal(info(fixture).version, original.version);
});
