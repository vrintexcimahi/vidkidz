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

  const fs = require('fs');
  const statePath = 'data/vidkidz-state.json';
  let initialStateBackup = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : null;

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

    const fs = require('fs');
    const statePath = 'data/vidkidz-state.json';
    if (fs.existsSync(statePath)) {
      initialStateBackup = fs.readFileSync(statePath, 'utf8');
      try {
        const parsed = JSON.parse(initialStateBackup);
        if (!parsed.state?.users?.kids || parsed.state.users.kids.length < 3) {
          initialStateBackup = null;
        }
      } catch (_) { initialStateBackup = null; }
    }

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
    const adminToken = adminLogin.data.token;

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

    // Kid submits AI hafalan with score and stars
    const testAiHafId = `rec_ai_${Date.now()}`;
    const kidAiHafRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        state: {
          hafalanRecords: [
            { id: testAiHafId, kidId: testKidId, hafalanId: 'h2', duration: 30, approved: false, score: 92, stars: 3 }
          ]
        }
      })
    });
    assert(kidAiHafRes.ok, 'Kid submitted hafalan with AI score');
    const stateAfterAiHaf = await req('/api/state', { headers: { Authorization: `Bearer ${testToken}` } });
    const foundAiHaf = stateAfterAiHaf.data.hafalanRecords?.find(h => h.id === testAiHafId);
    assert(foundAiHaf && foundAiHaf.score === 92, 'AI pronunciation score persisted correctly');
    assert(foundAiHaf && foundAiHaf.stars === 3, 'AI stars rating persisted correctly');

    // Daily Quests persistence
    const questDate = new Date().toISOString().slice(0, 10);
    const kidQuestRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        state: {
          users: {
            kids: [{
              id: testKidId,
              coins: 165,
              streak: 4,
              dailyQuests: { date: questDate, video: true, hafalan: true, game: true, claimed: true }
            }]
          }
        }
      })
    });
    assert(kidQuestRes.ok, 'Kid daily quests update accepted');
    const stateAfterQuest = await req('/api/state', { headers: { Authorization: `Bearer ${testToken}` } });
    const questKid = stateAfterQuest.data.users?.kids?.find(k => k.id === testKidId);
    assert(questKid && questKid.dailyQuests?.claimed === true, 'Daily quest claim persisted');
    assert(questKid && questKid.streak === 4, 'Streak count updated and persisted');

    console.log('\n--- 12. lockPin NOT exposed in Kid Login / Session Responses ---');
    const kidLoginForPin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'k1', password: '1234', role: 'kids' })
    });
    assert(kidLoginForPin.ok, 'Kid login k1 succeeded');
    assert(!kidLoginForPin.data.user?.lockPin, 'lockPin NOT present in kid direct login response');

    const kidsSessionForPin = await req('/api/auth/kids-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${famToken}` },
      body: JSON.stringify({ kidId: 'k1' })
    });
    assert(kidsSessionForPin.ok, 'kids-session succeeded');
    assert(!kidsSessionForPin.data.user?.lockPin, 'lockPin NOT present in kids-session response');

    console.log('\n--- 13. Kids Cannot Self-Lock (isLocked Protection) ---');
    const selfLockRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        state: {
          users: {
            kids: [
              { id: testKidId, isLocked: true, coins: testKidToken ? 999 : 0 }
            ]
          }
        }
      })
    });
    assert(selfLockRes.ok, 'Kid self-lock PATCH accepted (no crash)');
    const stateAfterSelfLock = await req('/api/state', {
      headers: { Authorization: `Bearer ${testToken}` }
    });
    const kidAfterSelfLock = stateAfterSelfLock.data.users?.kids?.find(k => k.id === testKidId);
    assert(kidAfterSelfLock?.isLocked !== true, 'Kid cannot self-lock (isLocked still false)');

    console.log('\n--- 14. Family Path-PATCH Cannot Target Other Family Kids ---');
    const otherKidPathPatch = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ path: 'users.kids.k3.coins', value: 99999 })
    });
    assert(otherKidPathPatch.status === 403, 'Family cannot path-PATCH another family\'s kid (k3 belongs to f2)');
    const stateAfterCrossPatch = await req('/api/state', {
      headers: { Authorization: `Bearer ${famToken}` }
    });
    const k3AfterCross = stateAfterCrossPatch.data.users?.kids?.find(k => k.id === 'k3');
    assert((k3AfterCross?.coins || 0) !== 99999, 'k3 coins not corrupted by cross-family path-PATCH');

    // --- 15. Curfew & Schedule Security and Tamper Protection ---
    console.log('\n--- 15. Curfew & Schedule Security and Tamper Protection ---');
    // Family sets schedule for testKidId
    const setSchedule = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({
        state: {
          users: {
            kids: [
              { id: testKidId, name: 'Child Iso', familyId: testFamId, schedule: { enabled: true, lockStart: '21:00', lockEnd: '07:00' } }
            ]
          }
        }
      })
    });
    assert(setSchedule.ok, 'Family set curfew schedule succeeded');

    const stateAfterSchedule = await req('/api/state', { headers: { Authorization: `Bearer ${testToken}` } });
    const kidWithSchedule = stateAfterSchedule.data.users.kids.find(k => k.id === testKidId);
    assert(kidWithSchedule && kidWithSchedule.schedule?.enabled === true, 'Curfew schedule persisted for kid');

    // Kid attempts to disable schedule via profile PATCH
    const kidTamperSchedule = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        state: {
          users: {
            kids: [
              { id: testKidId, schedule: { enabled: false, lockStart: '00:00', lockEnd: '00:00' } }
            ]
          }
        }
      })
    });
    assert(kidTamperSchedule.ok, 'Kid profile PATCH accepted');

    const stateAfterScheduleTamper = await req('/api/state', { headers: { Authorization: `Bearer ${testToken}` } });
    const kidAfterScheduleTamper = stateAfterScheduleTamper.data.users.kids.find(k => k.id === testKidId);
    assert(kidAfterScheduleTamper.schedule?.enabled === true, 'Kid cannot tamper with curfew schedule (remains true)');

    // Kid attempts path-based PATCH on schedule
    const kidPathSchedule = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        path: `users.kids.${testKidId}.schedule`,
        value: { enabled: false }
      })
    });
    assert(kidPathSchedule.status === 403, 'Kid path-PATCH on schedule rejected (403)');

    // Family path-based PATCH on schedule succeeds
    const familyPathSchedule = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({
        path: `users.kids.${testKidId}.schedule`,
        value: { enabled: true, lockStart: '20:30', lockEnd: '06:30' }
      })
    });
    assert(familyPathSchedule.ok, 'Family path-PATCH on kid schedule succeeded');

    console.log('\n--- 16. Security & Parental PIN Stripping in GET /api/state ---');
    const kidState = await req('/api/state', {
      headers: { Authorization: `Bearer ${testKidToken}` }
    });
    assert(kidState.ok, 'GET /api/state with kid token');
    const kidStateAnyPin = kidState.data.users?.kids?.some(k => k.lockPin !== undefined);
    assert(!kidStateAnyPin, 'All kid lockPins stripped in GET /api/state for kid role');

    const famStatePinCheck = await req('/api/state', {
      headers: { Authorization: `Bearer ${famToken}` }
    });
    const ownKid = famStatePinCheck.data.users?.kids?.find(k => k.id === 'k1');
    const otherKid = famStatePinCheck.data.users?.kids?.find(k => k.id === 'k3');
    assert(ownKid && ownKid.lockPin === '1234', 'Own kid lockPin preserved for parent');
    assert(otherKid && otherKid.lockPin === undefined, 'Other family kid lockPin stripped for parent');

    console.log('\n--- 17. Privacy & Device Telemetry Isolation ---');
    // Register device under admin
    await req('/api/device/register', {
      method: 'POST',
      body: JSON.stringify({ deviceId: 'dev_admin_secret', userId: 'a1', userName: 'Admin', userType: 'admin', model: 'AdminPC' })
    });
    // Register device under testKid
    await req('/api/device/register', {
      method: 'POST',
      body: JSON.stringify({ deviceId: 'dev_kid_test', userId: testKidId, userName: 'Anak Iso', userType: 'kids', model: 'KidTablet' })
    });
    const kidStateDev = await req('/api/state', {
      headers: { Authorization: `Bearer ${testKidToken}` }
    });
    const kidCanSeeAdminDev = kidStateDev.data.devices?.some(d => d.id === 'dev_admin_secret');
    const kidDevHasNoIp = kidStateDev.data.devices?.every(d => d.ip === undefined);
    assert(!kidCanSeeAdminDev, 'Kid cannot see admin device telemetry');
    assert(kidDevHasNoIp, 'IP address stripped from device telemetry in GET /api/state');

    console.log('\n--- 18. Screen Unlock API (POST /api/kids/unlock) ---');
    // Re-lock test kid
    await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ path: `users.kids.${testKidId}.isLocked`, value: true })
    });
    const stateBeforeUnlock = await req('/api/state', { headers: { Authorization: `Bearer ${testToken}` } });
    assert(stateBeforeUnlock.data.users?.kids?.find(k => k.id === testKidId)?.isLocked === true, 'Test kid locked by parent');

    // Missing pin rejected
    const noPinUnlock = await req('/api/kids/unlock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({})
    });
    assert(noPinUnlock.status === 400, 'Unlock rejects missing PIN');

    // Wrong pin rejected
    const wrongPinUnlock = await req('/api/kids/unlock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({ pin: '0000' })
    });
    assert(wrongPinUnlock.status === 401, 'Unlock rejects incorrect PIN');

    // Correct pin succeeds
    const correctPinUnlock = await req('/api/kids/unlock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({ pin: '4321' })
    });
    assert(correctPinUnlock.ok && correctPinUnlock.data.success === true, 'Unlock succeeds with correct PIN');

    const stateAfterUnlock = await req('/api/state', { headers: { Authorization: `Bearer ${testToken}` } });
    assert(stateAfterUnlock.data.users?.kids?.find(k => k.id === testKidId)?.isLocked === false, 'Kid isLocked status reset to false');

    console.log('\n--- 19. Security & Prototype Pollution Protection ---');
    const protoPollutionAttempt = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ path: '__proto__.polluted', value: true })
    });
    assert(protoPollutionAttempt.status === 400, 'Path-based PATCH rejects __proto__ pollution attempt');
    assert(({}).polluted === undefined, 'Object.prototype remains unpolluted');

    console.log('\n--- 20. Express API 404 Routing ---');
    const unknownApi = await req('/api/unknown-endpoint-test');
    assert(unknownApi.status === 404, 'Undefined /api/* route returns 404');
    assert(unknownApi.data && unknownApi.data.error === 'Endpoint API tidak ditemukan', 'Undefined API route returns JSON error');

    console.log('\n--- 21. Admin Backup & Restore and Telegram Integration ---');
    // Non-admin cannot call restore-state
    const nonAdminRestore = await req('/api/admin/restore-state', {
      method: 'POST',
      headers: { Authorization: `Bearer ${famToken}` },
      body: JSON.stringify({ state: { users: {} } })
    });
    assert(nonAdminRestore.status === 403, 'Non-admin forbidden from restore-state');

    // Admin restore-state rejects invalid payload
    const invalidRestore = await req('/api/admin/restore-state', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ state: { invalid: true } })
    });
    assert(invalidRestore.status === 400, 'Admin restore-state rejects payload without users');

    // Admin restore-state accepts valid payload
    const validRestore = await req('/api/admin/restore-state', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        state: {
          users: {
            admins: [{ id: 'a1', name: 'Super Admin', email: 'admin@vidkidz.local', password: 'admin123' }],
            families: [{ id: 'f1', name: 'Keluarga Budi Santoso', email: 'budi@vidkidz.local', password: 'family123', linkedKids: ['k1'] }],
            kids: [{ id: 'k1', name: 'Andi', age: 7, familyId: 'f1', avatar: '👦', coins: 100 }]
          },
          albums: [],
          photoAlbums: [],
          rewards: [],
          redemptions: [],
          hafalanRecords: [],
          activityLog: [],
          systemSettings: { siteName: 'VIDKIDZ' }
        }
      })
    });
    assert(validRestore.ok, 'Admin restore-state succeeds with valid state');
    assert(validRestore.data.stats?.kids === 1, 'Restored state has 1 kid');

    // Telegram endpoints require token & chatId
    const emptyTgTest = await req('/api/admin/telegram-test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({})
    });
    assert(emptyTgTest.status === 400, 'Telegram test rejects empty token/chatId');

    const emptyTgBackup = await req('/api/admin/telegram-backup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({})
    });
    assert(emptyTgBackup.status === 400, 'Telegram backup rejects empty token/chatId');

    console.log('\n--- 22. Rate Limiting Protection ---');
    let got429 = false;
    for (let i = 0; i < 35; i++) {
      const res = await req('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'x-forwarded-for': '198.51.100.1' },
        body: JSON.stringify({ method: 'email', target: 'ratelimit@test.local' })
      });
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    assert(got429, 'Excessive requests trigger HTTP 429 Rate Limit');

    console.log('\n--- 23. Real-Time Family Telegram Notifications ---');
    // Kid cannot configure family telegram
    const kidTgCfg = await req('/api/family/telegram-config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({ token: 'dummy', chatId: 'dummy' })
    });
    assert(kidTgCfg.status === 403, 'Kid forbidden from family telegram-config');

    // Family can configure telegram
    const famTgCfg = await req('/api/family/telegram-config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${famToken}` },
      body: JSON.stringify({
        token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        chatId: '-1001234567890',
        enabled: true,
        notifyRedemptions: true,
        notifyHafalan: true
      })
    });
    assert(famTgCfg.ok && famTgCfg.data.success === true, 'Family telegram-config saved successfully');

    // Family test rejects empty params
    const famTgTestEmpty = await req('/api/family/telegram-test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${famToken}` },
      body: JSON.stringify({ token: '', chatId: '' })
    });
    assert(famTgTestEmpty.status === 400, 'Family telegram-test rejects empty token/chatId');

    // --- 24. Privacy: Telegram Bot Token Protection in GET /api/state ---
    console.log(`\n--- 24. Privacy: Telegram Bot Token Protection in GET /api/state ---`);
    const kidStateCheck = await req('/api/state', { headers: { Authorization: `Bearer ${testKidToken}` } });
    assert(kidStateCheck.ok, 'GET /api/state with kid token succeeded');
    const kidFamilies = kidStateCheck.data.users?.families || [];
    const kidSawToken = kidFamilies.some(f => f.telegramConfig);
    const kidSawPhone = kidFamilies.some(f => f.phone);
    assert(!kidSawToken, 'Telegram bot config stripped for kid role in GET /api/state');
    assert(!kidSawPhone, 'Parent phone stripped for kid role in GET /api/state');

    // Family checking other families
    const famStateCheck = await req('/api/state', { headers: { Authorization: `Bearer ${famToken}` } });
    assert(famStateCheck.ok, 'GET /api/state with family token succeeded');
    const ownFamCheck = (famStateCheck.data.users?.families || []).find(f => f.email === 'budi@vidkidz.local');
    const otherFamsCheck = (famStateCheck.data.users?.families || []).filter(f => f.email !== 'budi@vidkidz.local');
    assert(ownFamCheck && ownFamCheck.telegramConfig && ownFamCheck.telegramConfig.token === '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', 'Own family telegramConfig preserved');
    const otherFamHasToken = otherFamsCheck.some(f => f.telegramConfig);
    const otherFamHasPhone = otherFamsCheck.some(f => f.phone);
    assert(!otherFamHasToken, 'Other family telegramConfig stripped for family role');
    assert(!otherFamHasPhone, 'Other family phone stripped for family role');

    // --- 25. Protection Against PIN Brute Force & Rate Limiting ---
    console.log(`\n--- 25. Protection Against PIN Brute Force & Rate Limiting ---`);
    let unlockRateLimited = false;
    for (let i = 0; i < 20; i++) {
      const res = await req('/api/kids/unlock', {
        method: 'POST',
        headers: { Authorization: `Bearer ${testKidToken}` },
        body: JSON.stringify({ pin: '0000' })
      });
      if (res.status === 429) {
        unlockRateLimited = true;
        break;
      }
    }
    assert(unlockRateLimited, 'Excessive PIN attempts on /api/kids/unlock trigger HTTP 429 Rate Limit');

    // --- 26. Bedtime Storytelling Records & Persistence ---
    console.log(`\n--- 26. Bedtime Storytelling Records & Persistence ---`);
    const newStoryRecord = {
      id: 'srec_test_1',
      kidId: testKidId,
      storyId: 'story1',
      title: 'Kisah Semut yang Rajin & Belalang Penyanyi',
      completedAt: Date.now(),
      rewardCoins: 10,
      moralLearned: 'Bekerja keras dan mempersiapkan bekal hari ini.'
    };
    const storyPatchRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        state: {
          storyRecords: [newStoryRecord],
          users: {
            kids: [{ id: testKidId, coins: 95 }]
          }
        }
      })
    });
    assert(storyPatchRes.ok, 'Kid submitted story record via PATCH /api/state');

    const kidStoryState = await req('/api/state', { headers: { Authorization: `Bearer ${testKidToken}` } });
    const savedStory = (kidStoryState.data.storyRecords || []).find(s => s.id === 'srec_test_1');
    assert(savedStory && savedStory.storyId === 'story1', 'Story record successfully persisted on server');
    assert(savedStory && savedStory.rewardCoins === 10, 'Story rewardCoins persisted correctly');

    // Admin restore state preserves storyRecords
    const adminRestorePayload = {
      state: {
        users: { admins: [{ id: 'a1', email: 'admin@vidkidz.local', password: 'admin' }], families: [], kids: [] },
        storyRecords: [newStoryRecord]
      }
    };
    const restoreRes = await req('/api/admin/restore-state', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(adminRestorePayload)
    });
    assert(restoreRes.ok && restoreRes.data.stats.storyRecords === 1, 'Admin restore-state preserves storyRecords collection');

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
      if (initialStateBackup) {
        fs.writeFileSync(p, initialStateBackup, 'utf8');
      } else if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        d.state.users.families = d.state.users.families.filter(f => !f.email.startsWith('keluarga_iso_'));
        d.state.users.kids = d.state.users.kids.filter(k => !k.id.startsWith('kid_iso_'));
        d.state.photoAlbums = d.state.photoAlbums.filter(pa => pa.id !== 'pa_test_iso');
        d.state.redemptions = d.state.redemptions.filter(r => !r.id.startsWith('red_test_'));
        d.state.hafalanRecords = d.state.hafalanRecords.filter(h => !h.id.startsWith('rec_haf_'));
        d.state.storyRecords = (d.state.storyRecords || []).filter(s => !s.id.startsWith('srec_test_'));
        fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
      }
    } catch (_) {}
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
});
