const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function worker(fetcher = async () => new Response('asset')) {
  const events = {}, entries = new Map();
  let skipped = false;
  const cache = {
    match: async key => entries.get(typeof key === 'string' ? key : key.url)?.clone(),
    put: async (key, value) => entries.set(typeof key === 'string' ? key : key.url, value),
    keys: async () => [], delete: async () => true
  };
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {
    self: { location: { origin: 'https://test.local' }, addEventListener: (name, fn) => events[name] = fn,
      skipWaiting: () => { skipped = true; } },
    caches: { open: async () => cache }, fetch: fetcher, URL, Response,
    Request: class extends Request { constructor(url, init) { super(new URL(url, 'https://test.local'), init); } }
  });
  return { events, entries, skipped: () => skipped };
}

test('worker precaches executable shell and waits for old clients to close', async () => {
  const w = worker(); let pending;
  w.events.install({ waitUntil: p => pending = p });
  await pending;
  assert.equal(w.skipped(), false);
  assert.ok(w.entries.has('/kids-ui.css'));
  assert.ok([...w.entries.keys()].some(k => k.includes('react.production')));
});

test('failed shell download rejects installation', async () => {
  const w = worker(async () => new Response('missing', { status: 404 })); let pending;
  w.events.install({ waitUntil: p => pending = p });
  await assert.rejects(pending, /App shell unavailable/);
});

test('private API, uploads, external media and authenticated assets bypass shared cache', () => {
  const w = worker();
  for (const [url, headers] of [
    ['https://test.local/api/state'], ['https://test.local/uploads/family.jpg'],
    ['https://other.test/video.mp4'], ['https://test.local/assets/a.png', { Authorization: 'Bearer test' }]
  ]) {
    let handled = false;
    w.events.fetch({ request: new Request(url, { headers }), respondWith: () => handled = true });
    assert.equal(handled, false, url);
  }
});

test('offline asset miss produces an explicit network error', async () => {
  const w = worker(async () => { throw new Error('offline'); }); let response;
  w.events.fetch({ request: new Request('https://test.local/assets/missing.png'), respondWith: p => response = p });
  assert.equal((await response).type, 'error');
});

const html = fs.readFileSync('public/index.html', 'utf8');
const vaultCode = html.slice(html.indexOf("const ROADTRIP_CACHE="), html.indexOf('function resolveAdaptiveDifficulty('));
function vault(fetcher) {
  const entries = new Map();
  const cache = { keys: async () => [...entries.keys()], match: async u => entries.get(u), put: async (u, r) => entries.set(u, r) };
  const ctx = { window: { caches: {} }, caches: { open: async () => cache }, fetch: fetcher, Response };
  vm.runInNewContext(vaultCode, ctx);
  return { save: ctx.roadtripCacheVideo, entries };
}
test('video cache rejects failed, partial and non-video downloads without fake success', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); },
    async () => new Response('partial', { status: 206, headers: { 'Content-Type': 'video/mp4' } }),
    async () => new Response('<html>error</html>'),
    async () => new Response('', { headers: { 'Content-Type': 'video/mp4' } })]) {
    const v = vault(fetcher);
    assert.equal((await v.save('/movie.mp4')).ok, false);
    assert.equal(v.entries.size, 0);
  }
});
test('video cache persists completed video bytes', async () => {
  const v = vault(async () => new Response('video-bytes', { headers: { 'Content-Type': 'video/mp4' } }));
  assert.equal((await v.save('/movie.mp4')).ok, true);
  assert.equal(await v.entries.get('/movie.mp4').text(), 'video-bytes');
});
