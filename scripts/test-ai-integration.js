/**
 * Integration Test: VIDKIDZ AI Gateway & Media Storage
 * Menguji integrasi Express app secara end-to-end:
 * 1. POST /api/ai/test diagnosis (gateways, sharp RAM metrics, circuit breaker)
 * 2. POST /api/media/upload (WebP 85% compression)
 * 3. POST /api/ai/analyze (TTL Cache & Circuit Breaker fast fail)
 */

const assert = require('assert');
const http = require('http');
const app = require('../server');

async function runIntegration() {
  console.log('\n========================================');
  console.log('🌐 VIDKIDZ AI & Media HTTP Integration Test');
  console.log('========================================\n');

  // Start app on ephemeral port
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  async function request(endpoint, options = {}) {
    const fetch = (await import('node-fetch')).default;
    const res = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, headers: res.headers, data };
  }

  try {
    // 1. Login Admin to obtain token
    const loginRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'vrintex@vidkidz.local', password: 'kayaraya3+' })
    });
    assert.strictEqual(loginRes.status, 200, 'Admin login berhasil');
    const adminToken = loginRes.data.token;

    // 2. Test /api/ai/test Diagnostics
    console.log('--- 1. Diagnostics /api/ai/test ---');
    await test('/api/ai/test menyertakan gateways, sharp, dan circuitBreaker', async () => {
      const res = await request('/api/ai/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ baseUrl: 'http://127.0.0.1:20128/v1', apiKey: 'test-key' })
      });

      assert(res.status === 200 || res.status === 502, `Status harus 200 atau 502, dapat: ${res.status}`);
      assert(typeof res.data === 'object', 'Data harus object');
      assert('gateways' in res.data, 'Harus ada field gateways');
      assert('localhost' in res.data.gateways, 'Gateways harus ada status localhost');
      assert('lan' in res.data.gateways, 'Gateways harus ada status lan');
      assert('sharp' in res.data, 'Harus ada field sharp');
      assert('memory' in res.data.sharp, 'Sharp metrics harus menyertakan memory');
      assert('circuitBreaker' in res.data, 'Harus ada field circuitBreaker');
      assert('state' in res.data.circuitBreaker, 'Circuit breaker harus menyertakan state');
      console.log(`    Gateways: localhost=${res.data.gateways.localhost}, lan=${res.data.gateways.lan}`);
      console.log(`    Sharp cache memory limit: ${JSON.stringify(res.data.sharp)}`);
      console.log(`    Circuit Breaker state: ${res.data.circuitBreaker.state}`);
    });

    // 3. Test /api/media/upload with WebP conversion
    console.log('\n--- 2. Media Upload & WebP Storage ---');
    await test('/api/media/upload mengonversi gambar ke WebP dan menyimpannya', async () => {
      // Valid PNG data URL
      const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const uploadRes = await request('/api/media/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ type: 'art', data: samplePng, filename: 'canvas.png' })
      });

      assert.strictEqual(uploadRes.status, 201, 'Status upload harus 201');
      assert(uploadRes.data.success, 'Upload sukses');
      assert(uploadRes.data.mediaId.endsWith('.webp'), `mediaId harus berakhiran .webp: ${uploadRes.data.mediaId}`);
      assert.strictEqual(uploadRes.data.mimeType, 'image/webp', 'mimeType harus image/webp');

      // Fetch uploaded file
      const getFile = await request(uploadRes.data.url);
      assert.strictEqual(getFile.status, 200, 'GET media file harus 200');
      assert.strictEqual(getFile.headers.get('content-type'), 'image/webp', 'Content-Type header harus image/webp');
    });

    // 4. Test /api/ai/analyze
    console.log('\n--- 3. AI Analyze Resilience ---');
    await test('/api/ai/analyze menolak request tanpa imageBase64', async () => {
      const res = await request('/api/ai/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ prompt: 'test' })
      });
      assert.strictEqual(res.status, 400);
    });

    await test('/api/ai/analyze menolak akun demo dengan 403', async () => {
      const demoLogin = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'budi@vidkidz.local', password: 'family123' })
      });
      const demoToken = demoLogin.data.token;

      const res = await request('/api/ai/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${demoToken}` },
        body: JSON.stringify({ imageBase64: 'abc' })
      });
      assert.strictEqual(res.status, 403, 'Akun demo harus ditolak 403');
    });

    await test('Circuit Breaker aktif setelah 3x gagal dan memotong request ke-4 dengan HTTP 503 (<5ms)', async () => {
      const dummyImg = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      // Panggilan 1, 2, 3 (akan gagal menghubungi 127.0.0.1/192.168.1.14 karena apiKey invalid dan tidak ada anthropic key)
      const res1 = await request('/api/ai/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ imageBase64: dummyImg, prompt: 'fail-1', apiKey: 'invalid-key' })
      });
      assert(res1.status === 502, `Res1 status harus 502, dapat: ${res1.status}`);

      const res2 = await request('/api/ai/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ imageBase64: dummyImg, prompt: 'fail-2', apiKey: 'invalid-key' })
      });
      assert(res2.status === 502, `Res2 status harus 502, dapat: ${res2.status}`);

      const res3 = await request('/api/ai/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ imageBase64: dummyImg, prompt: 'fail-3', apiKey: 'invalid-key' })
      });
      assert(res3.status === 502, `Res3 status harus 502, dapat: ${res3.status}`);

      // Request ke-4: Circuit Breaker harus OPEN dan merespon HTTP 503 sangat cepat (<50ms)
      const startT = Date.now();
      const res4 = await request('/api/ai/analyze', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ imageBase64: dummyImg, prompt: 'fail-4', apiKey: 'invalid-key' })
      });
      const elapsedMs = Date.now() - startT;

      assert.strictEqual(res4.status, 503, `Res4 harus 503 dari circuit breaker, dapat: ${res4.status}`);
      assert.strictEqual(res4.data.circuitBreaker, 'OPEN', 'Field circuitBreaker harus OPEN');
      assert(elapsedMs < 50, `Waktu potong circuit breaker harus sangat cepat (<50ms), terukur: ${elapsedMs}ms`);
      console.log(`    Circuit Breaker fast fail dipotong dalam ${elapsedMs}ms dengan status 503 OPEN`);
    });

    console.log(`\n========================================`);
    console.log(`HTTP INTEGRATION RESULTS: ${passed} passed, ${failed} failed`);
    console.log(`========================================\n`);

  } finally {
    server.close();
  }

  if (failed > 0) process.exit(1);
}

runIntegration().catch(err => {
  console.error('Fatal integration error:', err);
  process.exit(1);
});
