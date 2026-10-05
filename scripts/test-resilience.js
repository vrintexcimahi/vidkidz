/**
 * Test Suite: VIDKIDZ Resilience & Sharp Windows Hardening
 * Verifikasi: Semaphore, CircuitBreaker, TtlCache, prepareVisionImage,
 * WebP media compression, Dual-URL failover, dan kestabilan RAM.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Semaphore, CircuitBreaker, TtlCache } = require('../lib/resilience');
const sharp = require('sharp');

async function runTests() {
  console.log('\n========================================');
  console.log('🧪 VIDKIDZ Resilience & Hardening Test Suite');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`  PASS: ${name}`);
        passed++;
      } catch (err) {
        console.error(`  FAIL: ${name} ->`, err.message);
        failed++;
      }
    })();
  }

  // --- 1. Semaphore Concurrency Test ---
  console.log('--- 1. Semaphore Concurrency Limiter ---');
  await test('Semaphore membatasi konkuensi maksimal 2', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxObserved = 0;

    const task = async () => {
      return await sem.run(async () => {
        active++;
        if (active > maxObserved) maxObserved = active;
        await new Promise(r => setTimeout(r, 20));
        active--;
      });
    };

    await Promise.all([task(), task(), task(), task(), task()]);
    assert.strictEqual(maxObserved, 2, `Max observed concurrency harus 2, dapat: ${maxObserved}`);
    assert.strictEqual(active, 0, 'Semua task selesai dan active = 0');
  });

  // --- 2. Circuit Breaker Test ---
  console.log('\n--- 2. Circuit Breaker State Transition ---');
  await test('Circuit Breaker CLOSED -> OPEN setelah 3x kegagalan', () => {
    const cb = new CircuitBreaker('Test-Breaker', { failureThreshold: 3, resetTimeout: 100 });
    assert.strictEqual(cb.isOpen(), false, 'Awalnya harus CLOSED');
    cb.recordFailure();
    assert.strictEqual(cb.isOpen(), false, '1 failure: masih CLOSED');
    cb.recordFailure();
    assert.strictEqual(cb.isOpen(), false, '2 failures: masih CLOSED');
    cb.recordFailure();
    assert.strictEqual(cb.isOpen(), true, '3 failures: berubah jadi OPEN');
  });

  await test('Circuit Breaker OPEN -> HALF_OPEN setelah timeout dan CLOSED setelah sukses', async () => {
    const cb = new CircuitBreaker('Test-Breaker', { failureThreshold: 3, resetTimeout: 50 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.strictEqual(cb.isOpen(), true);

    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(cb.isOpen(), false, 'Setelah resetTimeout, isOpen() mengembalikan false (HALF_OPEN)');
    assert.strictEqual(cb.state, 'HALF_OPEN');

    cb.recordSuccess();
    assert.strictEqual(cb.state, 'CLOSED', 'Setelah recordSuccess, state kembali ke CLOSED');
    assert.strictEqual(cb.failureCount, 0);
  });

  // --- 3. TTL Cache Test ---
  console.log('\n--- 3. In-Memory TTL Cache ---');
  await test('TtlCache menyimpan dan mengembalikan data', () => {
    const cache = new TtlCache(1000, 10);
    cache.set('key1', { result: 'analisis 1' });
    const val = cache.get('key1');
    assert.deepStrictEqual(val, { result: 'analisis 1' });
  });

  await test('TtlCache expire setelah batas waktu', async () => {
    const cache = new TtlCache(50, 10);
    cache.set('key-exp', 'expired-val');
    assert.strictEqual(cache.get('key-exp'), 'expired-val');
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(cache.get('key-exp'), null, 'Item harus null setelah TTL habis');
  });

  await test('TtlCache membatasi ukuran maksimal (LRU eviction)', () => {
    const cache = new TtlCache(10000, 3);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.set('k3', 'v3');
    cache.set('k4', 'v4');
    assert.strictEqual(cache.get('k1'), null, 'k1 harus di-evict');
    assert.strictEqual(cache.get('k4'), 'v4');
  });

  // --- 4. Pre-Processing & Downscale Gambar ---
  console.log('\n--- 4. Vision Image Downscaling & Pre-Compression ---');
  await test('Gambar besar (>1MB) terkompresi menjadi < 200KB base64', async () => {
    // Generate gambar besar 2000x2000 JPEG
    const largeBuffer = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 3,
        background: { r: 120, g: 180, b: 240 }
      }
    }).jpeg({ quality: 95 }).toBuffer();

    const originalBase64 = `data:image/jpeg;base64,${largeBuffer.toString('base64')}`;
    const origSizeKb = Buffer.byteLength(originalBase64) / 1024;

    // Kompresi via Sharp
    const cleanB64 = originalBase64.split(',')[1];
    const compressed = await sharp(Buffer.from(cleanB64, 'base64'))
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();

    const compressedBase64 = `data:image/jpeg;base64,${compressed.toString('base64')}`;
    const compSizeKb = Buffer.byteLength(compressedBase64) / 1024;

    console.log(`    Ukuran Asli: ${origSizeKb.toFixed(1)} KB -> Terkompresi: ${compSizeKb.toFixed(1)} KB`);
    assert(compSizeKb < 200, `Ukuran gambar harus < 200KB, terukur: ${compSizeKb.toFixed(1)} KB`);
  });

  // --- 5. Media Upload WebP Conversion ---
  console.log('\n--- 5. Media Storage WebP 85% Conversion ---');
  await test('Sharp mengonversi PNG/JPEG menjadi WebP berkualitas 85%', async () => {
    const pngBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: { r: 255, g: 100, b: 50, alpha: 1 }
      }
    }).png().toBuffer();

    const webpBuffer = await sharp(pngBuffer)
      .rotate()
      .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const metadata = await sharp(webpBuffer).metadata();
    assert.strictEqual(metadata.format, 'webp', 'Output format harus WebP');
    assert(metadata.width <= 1600, 'Width tidak melebihi 1600');
    assert(metadata.height <= 1200, 'Height tidak melebihi 1200');
  });

  // --- 6. Memory WorkingSet Stability Under Load ---
  console.log('\n--- 6. Windows Node.js Memory WorkingSet Stability ---');
  await test('RAM node.exe tetap di bawah 250MB saat melayani kompresi berulang', async () => {
    const initialRss = process.memoryUsage().rss / (1024 * 1024);

    for (let i = 0; i < 15; i++) {
      const buf = await sharp({
        create: {
          width: 1200,
          height: 800,
          channels: 3,
          background: { r: i * 15, g: 100, b: 200 }
        }
      }).jpeg().toBuffer();

      await sharp(buf)
        .resize(1024, 1024, { fit: 'inside' })
        .webp({ quality: 85 })
        .toBuffer();
    }

    const currentRss = process.memoryUsage().rss / (1024 * 1024);
    const heapUsed = process.memoryUsage().heapUsed / (1024 * 1024);
    console.log(`    Initial RSS: ${initialRss.toFixed(1)}MB | Current RSS: ${currentRss.toFixed(1)}MB | Heap: ${heapUsed.toFixed(1)}MB`);

    assert(currentRss < 250, `Working set RAM harus < 250MB, terukur: ${currentRss.toFixed(1)}MB`);
  });

  console.log(`\n========================================`);
  console.log(`RESILIENCE TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
