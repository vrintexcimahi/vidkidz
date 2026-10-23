const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

console.log('========================================');
console.log('🛡️ VIDKIDZ Disaster Recovery & Session Revocation Drill');
console.log('========================================\n');

// Isolated test directory
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidkidz-dr-test-'));
process.env.VIDKIDZ_DATA_DIR = testDataDir;
process.env.JWT_SECRET = 'vidkidz-test-dr-secret';

// Load server and internal utilities
const serverFile = path.join(__dirname, '..', 'server.js');
const app = require('express')();

async function runDisasterRecoveryDrill() {
  // Spawn standalone test server using server.js in isolated environment
  const { fork } = require('child_process');
  const port = 3288;
  const child = fork(serverFile, [], {
    env: { ...process.env, PORT: String(port), VIDKIDZ_DATA_DIR: testDataDir },
    stdio: 'pipe'
  });

  const cleanup = () => {
    try { child.kill('SIGTERM'); } catch (_) {}
    try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch (_) {}
  };

  // Wait for server ready
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout starting DR server')), 10000);
    child.stdout.on('data', (d) => {
      if (d.toString().includes('http://localhost') || d.toString().includes('PORT')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  const req = (endpoint, options = {}) => new Promise((resolve, reject) => {
    const url = new URL(`http://127.0.0.1:${port}${endpoint}`);
    const reqOpts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    };
    const clientReq = http.request(url, reqOpts, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (_) { data = raw; }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data, headers: res.headers });
      });
    });
    clientReq.on('error', reject);
    if (options.body) clientReq.write(options.body);
    clientReq.end();
  });

  try {
    // --- 1. Health & Initial State Verification ---
    console.log('--- 1. Health & State Baseline ---');
    const health = await req('/api/health');
    assert(health.ok, 'Health endpoint responds with HTTP 200');
    assert(health.data.status === 'ok', 'Server health reports ok');
    console.log('  PASS: Health endpoint active and responsive');

    // --- 2. Admin Login & Self-Healing State Verification ---
    console.log('\n--- 2. Self-Healing State Consistency Routine ---');
    const adminLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@vidkidz.local', password: 'kayaraya3+' })
    });
    assert(adminLogin.ok, 'Admin login succeeded');
    const adminToken = adminLogin.data.token;

    const healRes = await req('/api/admin/self-heal', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(healRes.ok, 'Self-heal endpoint returns HTTP 200');
    assert(healRes.data.verifiedAt, 'Self-heal reports verifiedAt ISO timestamp');
    console.log('  PASS: Self-healing integrity routine verified without errors');

    // --- 3. Session Revocation (Saran #13) Drill ---
    console.log('\n--- 3. Session Revocation Drill (Saran #13) ---');
    // Verify demo account is forbidden from revoking sessions
    const budiLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'budi@vidkidz.local', password: 'family123' })
    });
    assert(budiLogin.ok, 'Demo Family login succeeded');
    const demoRevoke = await req('/api/auth/revoke-sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${budiLogin.data.token}` }
    });
    assert(demoRevoke.status === 403, 'Demo family properly forbidden from revoking sessions');
    console.log('  PASS: Demo family prevented from session revocation (HTTP 403)');

    // Register active non-demo family for full revocation lifecycle drill
    const regRes = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        method: 'email',
        email: 'dr_fam@vidkidz.test',
        password: 'Password123!',
        otp: '123456',
        acceptedTerms: true
      })
    });
    assert(regRes.ok, 'Non-demo family registration succeeded');
    const oldFamToken = regRes.data.token;

    // Verify initial token works
    const stateBefore = await req('/api/state', {
      headers: { Authorization: `Bearer ${oldFamToken}` }
    });
    assert(stateBefore.ok, 'Initial family token can fetch state');

    // Revoke all other sessions
    const revokeRes = await req('/api/auth/revoke-sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${oldFamToken}` }
    });
    assert(revokeRes.ok, 'Revoke sessions endpoint returned HTTP 200');
    assert(revokeRes.data.success === true, 'Revocation marked success');
    assert(revokeRes.data.token, 'New refreshed token received after revocation');
    const newFamToken = revokeRes.data.token;

    // Verify old token is now REJECTED with HTTP 401
    const testOldToken = await req('/api/state', {
      headers: { Authorization: `Bearer ${oldFamToken}` }
    });
    assert(testOldToken.status === 401, 'Old family token rejected with HTTP 401 after revocation');
    console.log('  PASS: Old sessions rejected (HTTP 401) immediately after revoke-sessions');

    // Verify new token works
    const testNewToken = await req('/api/state', {
      headers: { Authorization: `Bearer ${newFamToken}` }
    });
    assert(testNewToken.ok, 'New refreshed family token continues to work seamlessly');
    console.log('  PASS: New refreshed token active and authorized');

    // --- 4. Exponential PIN Lockout (Saran #35) Drill ---
    console.log('\n--- 4. Exponential Backoff PIN Lockout Drill (Saran #35) ---');
    for (let i = 0; i < 5; i++) {
      await req('/api/kids/unlock', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ kidId: 'k1', pin: '9999' })
      });
    }

    const lockedOutRes = await req('/api/kids/unlock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ kidId: 'k1', pin: '9999' })
    });
    assert(lockedOutRes.status === 429, 'Excessive failed PIN attempts triggers HTTP 429 Too Many Requests');
    assert(lockedOutRes.headers['retry-after'], 'HTTP 429 response includes Retry-After header');
    console.log(`  PASS: Exponential lockout activated with Retry-After: ${lockedOutRes.headers['retry-after']}s`);

    // --- 5. State Journaling & Primary State Integrity ---
    console.log('\n--- 5. State Journaling & Recovery Verification ---');
    const journalRes = await req('/api/admin/journal-status', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(journalRes.ok, 'Admin journal status accessible');
    assert(typeof journalRes.data.totalEntries === 'number', 'Transactional state journal log status verified');
    assert(typeof journalRes.data.logSizeBytes === 'number', 'Transactional state journal size verified');
    console.log(`  PASS: Transactional state journal verified (${journalRes.data.totalEntries} entries recorded, ${journalRes.data.logSizeBytes} bytes)`);

    console.log('\n========================================');
    console.log('ALL DISASTER RECOVERY DRILLS PASSED: 100% OK');
    console.log('========================================');
    cleanup();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Disaster Recovery Drill FAILED:', err.message);
    cleanup();
    process.exit(1);
  }
}

runDisasterRecoveryDrill();
