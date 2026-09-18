const http = require('http');
const app = require('./server');

const server = app.listen(0, async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`[TEST] Test server running on port ${port}`);

  async function req(path, opts = {}) {
    const res = await fetch(`${base}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  PASS: ${message}`);
      passed++;
    } else {
      console.error(`  FAIL: ${message}`);
      failed++;
    }
  }

  try {
    console.log('\n--- 1. Health & Config & Version ---');
    const health = await req('/api/health');
    assert(health.ok && health.data.status === 'ok', 'GET /api/health');

    const config = await req('/api/auth/config');
    assert(config.ok && typeof config.data.googleClientId === 'string', 'GET /api/auth/config');

    const version = await req('/api/version');
    assert(version.ok && !!version.data.version, 'GET /api/version');

    console.log('\n--- 2. Auth: Family Login ---');
    const famLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'budi@vidkidz.local', password: 'family123' })
    });
    assert(famLogin.ok && !!famLogin.data.token, 'Family login budi@vidkidz.local');
    assert(!famLogin.data.user?.password, 'Family login response has no password');
    const famToken = famLogin.data.token;

    console.log('\n--- 3. Auth: Kid Direct Login (README spec) ---');
    const kidLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'k1', password: '1234', role: 'kids' })
    });
    assert(kidLogin.ok && !!kidLogin.data.token, 'Kid direct login k1 / 1234 with role: kids');

    const kidLoginImplicit = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'k2', password: '5678' })
    });
    assert(kidLoginImplicit.ok && kidLoginImplicit.data.role === 'kids', 'Kid direct login k2 / 5678 without explicit role');

    console.log('\n--- 4. Auth: Admin Login ---');
    const adminLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@vidkidz.local', password: 'admin123', role: 'admin' })
    });
    assert(adminLogin.ok, 'Admin login admin@vidkidz.local');
    assert(!adminLogin.data.user?.password, 'Admin login response has no password');

    console.log('\n--- 5. State Retrieval & Security Sanitization ---');
    const famState = await req('/api/state', {
      headers: { Authorization: `Bearer ${famToken}` }
    });
    assert(famState.ok, 'GET /api/state with family token');
    const leakedAdminPass = famState.data.users?.admins?.some(a => !!a.password);
    const leakedFamPass = famState.data.users?.families?.some(f => !!f.password);
    const leakedApiKey = !!famState.data.systemSettings?.apiKey;
    assert(!leakedAdminPass, 'Admin password stripped in GET /api/state for family');
    assert(!leakedFamPass, 'Family passwords stripped in GET /api/state for family');
    assert(!leakedApiKey, 'Anthropic API key stripped in GET /api/state for family');

    console.log('\n--- 6. State Data Integrity (No Corrupted ?? Emojis) ---');
    const k1 = famState.data.users?.kids?.find(k => k.id === 'k1');
    const alb1 = famState.data.albums?.find(a => a.id === 'alb1');
    const r1 = famState.data.rewards?.find(r => r.id === 'r1');
    assert(k1 && k1.avatar !== '??', `Kid avatar intact: ${k1?.avatar}`);
    assert(alb1 && alb1.emoji !== '??', `Album emoji intact: ${alb1?.emoji}`);
    assert(r1 && r1.emoji !== '??', `Reward emoji intact: ${r1?.emoji}`);

    console.log('\n--- 7. State Multi-Family Isolation in PATCH ---');
    // Register and login a non-demo family
    const testEmail = `keluarga_iso_${Date.now()}@vidkidz.local`;
    const regRes = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        method: 'email',
        email: testEmail,
        password: 'securePass123!',
        otp: '123456',
        acceptedTerms: true
      })
    });
    assert(regRes.ok && !!regRes.data.token, 'Register new family');
    assert(!regRes.data.user?.password, 'Register response strips password');
    const testToken = regRes.data.token;
    const testFamId = regRes.data.user.id;

    // Test family patches only its own photo album
    const patchRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({
        state: {
          photoAlbums: [
            { id: 'pa_test_iso', familyId: testFamId, name: 'Iso Album', photos: [] }
          ]
        }
      })
    });
    assert(patchRes.ok, 'PATCH /api/state by new family');

    // Verify existing families' photo albums (pa1 for f1, pa2 for f2) were NOT wiped!
    const verifyState = await req('/api/state', {
      headers: { Authorization: `Bearer ${testToken}` }
    });
    const hasPa1 = verifyState.data.photoAlbums?.some(pa => pa.id === 'pa1');
    const hasPa2 = verifyState.data.photoAlbums?.some(pa => pa.id === 'pa2');
    const hasIso = verifyState.data.photoAlbums?.some(pa => pa.id === 'pa_test_iso');
    assert(hasPa1 && hasPa2, 'Existing family albums (pa1, pa2) preserved after another family PATCH');
    assert(hasIso, 'New family album persisted');

    console.log('\n--- 8. Path-based PATCH /api/state ---');
    const pathPatchRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({
        path: `users.families.${testFamId}.phone`,
        value: '0812-9999-8888'
      })
    });
    assert(pathPatchRes.ok, 'Path-based PATCH /api/state');

    const stateAfterPath = await req('/api/state', {
      headers: { Authorization: `Bearer ${testToken}` }
    });
    const myFam = stateAfterPath.data.users?.families?.find(f => f.id === testFamId);
    assert(myFam?.phone === '0812-9999-8888', 'Path-based value persisted correctly');

    console.log('\n--- 9. Non-Demo Child Setup & Redemption PATCH ---');
    const testKidId = `kid_iso_${Date.now()}`;
    const addKidRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({
        state: {
          users: {
            kids: [
              {
                id: testKidId,
                name: 'Anak Iso',
                age: 7,
                familyId: testFamId,
                avatar: '👦',
                isLocked: false,
                allowedAlbums: ['alb1', 'alb2'],
                lockPin: '4321',
                coins: 100
              }
            ]
          }
        }
      })
    });
    assert(addKidRes.ok, 'Non-demo family added child');

    const kidLoginRes = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: testKidId, password: '4321', role: 'kids' })
    });
    assert(kidLoginRes.ok && !!kidLoginRes.data.token, 'Non-demo kid login');
    const testKidToken = kidLoginRes.data.token;

    const testRedId = `red_test_${Date.now()}`;
    const kidPatchRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        state: {
          redemptions: [
            { id: testRedId, kidId: testKidId, rewardId: 'r1', status: 'pending', kidName: 'Anak Iso', cost: 50 }
          ]
        }
      })
    });
    assert(kidPatchRes.ok, 'Kid submitted redemption via PATCH /api/state');

    const stateAfterKidRed = await req('/api/state', {
      headers: { Authorization: `Bearer ${testToken}` }
    });
    const foundRed = stateAfterKidRed.data.redemptions?.some(r => r.id === testRedId && r.kidId === testKidId);
    assert(foundRed, 'Kid redemption successfully persisted and visible to Family');

    console.log('\n--- 10. Parental Controls Tamper Protection for Kids ---');
    const tamperRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        state: {
          users: {
            kids: [
              { id: testKidId, lockPin: '9999', allowedAlbums: ['hacked'], coins: 150 }
            ]
          }
        }
      })
    });
    assert(tamperRes.ok, 'Kid profile PATCH accepted');
    const stateAfterTamper = await req('/api/state', {
      headers: { Authorization: `Bearer ${testToken}` }
    });
    const kidTamperCheck = stateAfterTamper.data.users?.kids?.find(k => k.id === testKidId);
    assert(kidTamperCheck?.lockPin === '4321', 'Parental lockPin cannot be overwritten by kid');
    assert(JSON.stringify(kidTamperCheck?.allowedAlbums) === JSON.stringify(['alb1', 'alb2']), 'Parental allowedAlbums cannot be overwritten by kid');
    assert(kidTamperCheck?.coins === 150, 'Kid coins update permitted');

    console.log('\n--- 11. Family Hafalan Records Persistence ---');
    const testHafalanId = `rec_haf_${Date.now()}`;
    const famHafalanRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({
        state: {
          hafalanRecords: [
            { id: testHafalanId, kidId: testKidId, hafalanId: 'h1', approved: true }
          ]
        }
      })
    });
    assert(famHafalanRes.ok, 'Family PATCH hafalanRecords succeeded');
    const stateAfterFamHaf = await req('/api/state', {
      headers: { Authorization: `Bearer ${testToken}` }
    });
    const foundHaf = stateAfterFamHaf.data.hafalanRecords?.some(h => h.id === testHafalanId);
    assert(foundHaf, 'Family hafalanRecords persisted correctly');

    console.log(`\n========================================`);
    console.log(`FINAL RESULTS: ${passed} passed, ${failed} failed`);
    console.log(`========================================`);
  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    try {
      const fs = require('fs');
      const p = 'data/vidkidz-state.json';
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        d.state.users.families = d.state.users.families.filter(f => !f.email.startsWith('keluarga_iso_'));
        d.state.users.kids = d.state.users.kids.filter(k => !k.id.startsWith('kid_iso_'));
        d.state.photoAlbums = d.state.photoAlbums.filter(pa => pa.id !== 'pa_test_iso');
        d.state.redemptions = d.state.redemptions.filter(r => !r.id.startsWith('red_test_'));
        d.state.hafalanRecords = d.state.hafalanRecords.filter(h => !h.id.startsWith('rec_haf_'));
        fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
      }
    } catch (_) {}
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
});
