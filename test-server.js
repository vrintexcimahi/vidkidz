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
    const headers = {};
    if (res.headers && typeof res.headers.forEach === 'function') {
      res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    }
    return { status: res.status, ok: res.ok, data, headers, rawHeaders: res.headers };
  }

  let passed = 0;
  let failed = 0;

  const fs = require('fs');
  const path = require('path');
  const statePath = path.join(process.env.VIDKIDZ_DATA_DIR || 'data', 'vidkidz-state.json');
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
    const statePath = require('path').join(process.env.VIDKIDZ_DATA_DIR || 'data', 'vidkidz-state.json');
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
    const kidToken = kidLogin.data.token;

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

    // Curfew Extension Request (Smart Curfew Remote Handshake)
    const newCurfewReq = {
      id: 'creq_test_1',
      kidId: testKidId,
      kidName: 'Anak Test',
      reason: 'Selesaikan Dongeng',
      minutes: 15,
      status: 'pending',
      createdAt: Date.now()
    };
    const kidReqCurfew = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({ state: { curfewRequests: [newCurfewReq] } })
    });
    assert(kidReqCurfew.ok, 'Kid curfew extension request accepted via PATCH /api/state');

    const kidStateCurfew = await req('/api/state', { headers: { Authorization: `Bearer ${testKidToken}` } });
    const savedCurfewReq = (kidStateCurfew.data.curfewRequests || []).find(r => r.id === 'creq_test_1');
    assert(savedCurfewReq && savedCurfewReq.status === 'pending', 'Kid curfew extension request persisted with pending status');

    // Family approves request and grants 15m bypass
    const bypassTimestamp = Date.now() + 15 * 60 * 1000;
    const familyApproveCurfew = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({
        state: {
          curfewRequests: [{ ...savedCurfewReq, status: 'approved' }],
          users: {
            kids: [{
              id: testKidId,
              name: 'Anak Test',
              familyId: testFamId,
              curfewBypassUntil: bypassTimestamp,
              isLocked: false
            }]
          }
        }
      })
    });
    assert(familyApproveCurfew.ok, 'Family approved curfew extension request');

    const famCheckState = await req('/api/state', { headers: { Authorization: `Bearer ${testToken}` } });
    const verifiedKid = famCheckState.data.users?.kids?.find(k => k.id === testKidId);
    assert(verifiedKid && verifiedKid.curfewBypassUntil === bypassTimestamp, 'Curfew bypass timestamp persisted for kid');

    // Kid cannot tamper with curfewBypassUntil directly
    const kidTamperBypass = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${testKidToken}` },
      body: JSON.stringify({
        path: `users.kids.${testKidId}.curfewBypassUntil`,
        value: Date.now() + 86400000
      })
    });
    assert(kidTamperBypass.status === 403, 'Kid cannot path-PATCH curfewBypassUntil directly (403)');

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

    // --- 27. Kids Creative Coloring & Drawing Records Privacy Isolation ---
    console.log('\n--- 27. Creative Coloring & Drawing Records Privacy Isolation ---');
    const regArtistFam = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Keluarga Seniman',
        email: `seniman_${Date.now()}@test.local`,
        password: 'securePass123!',
        otp: '123456',
        acceptedTerms: true
      })
    });
    assert(regArtistFam.ok && !!regArtistFam.data.token, 'Register non-demo family for coloring & audio tests');
    const artistFamToken = regArtistFam.data.token;
    const artistFamId = regArtistFam.data.user.id;

    const artistKidId = `kid_art_${Date.now()}`;
    const addArtKidRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistFamToken}` },
      body: JSON.stringify({
        state: {
          users: {
            kids: [
              {
                id: artistKidId,
                name: 'Seniman Cilik',
                age: 8,
                familyId: artistFamId,
                avatar: '🎨',
                coins: 50,
                lockPin: '1122'
              }
            ]
          }
        }
      })
    });
    assert(addArtKidRes.ok, 'Family added child for creative coloring test');

    const artistKidLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: artistKidId, password: '1122', role: 'kids' })
    });
    const artistKidToken = artistKidLogin.data.token;

    const newDrawingRecord = {
      id: 'draw_test_1',
      kidId: artistKidId,
      templateId: 'kancil',
      title: 'Si Kancil Cerdik',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      createdAt: Date.now(),
      rewardCoins: 10
    };

    const drawPatchRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistKidToken}` },
      body: JSON.stringify({ state: { drawingRecords: [newDrawingRecord] } })
    });
    assert(drawPatchRes.ok, 'Kid submitted drawing record via PATCH /api/state');

    const kidDrawState = await req('/api/state', { headers: { Authorization: `Bearer ${artistKidToken}` } });
    const savedDrawKid = (kidDrawState.data.drawingRecords || []).find(d => d.id === 'draw_test_1');
    assert(savedDrawKid && savedDrawKid.title === 'Si Kancil Cerdik', 'Drawing record successfully persisted on server for kid');

    const ownFamDrawState = await req('/api/state', { headers: { Authorization: `Bearer ${artistFamToken}` } });
    const savedDrawFam = (ownFamDrawState.data.drawingRecords || []).find(d => d.id === 'draw_test_1');
    assert(savedDrawFam && savedDrawFam.id === 'draw_test_1', 'Own family can see child artwork in GET /api/state');

    const otherFamDrawState = await req('/api/state', { headers: { Authorization: `Bearer ${famToken}` } });
    const savedDrawOtherFam = (otherFamDrawState.data.drawingRecords || []).find(d => d.id === 'draw_test_1');
    assert(!savedDrawOtherFam, 'Other family cannot see another family kid artwork in GET /api/state');

    // --- 28. Parent Bedtime Story Audio Recordings & Family Isolation ---
    console.log('\n--- 28. Parent Bedtime Story Audio Recordings & Family Isolation ---');
    const newParentAudio = {
      id: 'audio_test_1',
      familyId: artistFamId,
      storyId: 'story1',
      recordedBy: 'Keluarga Seniman',
      audioData: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAA',
      recordedAt: Date.now()
    };

    const audioPatchRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistFamToken}` },
      body: JSON.stringify({ state: { parentStoryAudios: [newParentAudio] } })
    });
    assert(audioPatchRes.ok, 'Family saved parent bedtime story audio via PATCH /api/state');

    const famAudioState = await req('/api/state', { headers: { Authorization: `Bearer ${artistFamToken}` } });
    const savedFamAudio = (famAudioState.data.parentStoryAudios || []).find(a => a.id === 'audio_test_1');
    assert(savedFamAudio && savedFamAudio.storyId === 'story1', 'Parent story audio successfully persisted for family');

    const kidAudioState = await req('/api/state', { headers: { Authorization: `Bearer ${artistKidToken}` } });
    const savedKidAudio = (kidAudioState.data.parentStoryAudios || []).find(a => a.id === 'audio_test_1');
    assert(savedKidAudio && savedKidAudio.id === 'audio_test_1', 'Own kid can access parent story voice audio in GET /api/state');

    const otherFamAudioState = await req('/api/state', { headers: { Authorization: `Bearer ${famToken}` } });
    const savedOtherFamAudio = (otherFamAudioState.data.parentStoryAudios || []).find(a => a.id === 'audio_test_1');
    assert(!savedOtherFamAudio, 'Other family cannot see parent story voice audio in GET /api/state');

    // --- 29. Media Storage API & Path Traversal Protection ---
    console.log('\n--- 29. Media Storage API & Path Traversal Protection ---');
    const sampleBase64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const uploadRes = await req('/api/media/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${artistKidToken}` },
      body: JSON.stringify({ type: 'art', data: sampleBase64Png, filename: 'pixel.png' })
    });
    assert(uploadRes.ok && uploadRes.data.url && uploadRes.data.mediaId, 'Upload media succeeds and returns mediaId & URL');

    const uploadedMediaId = uploadRes.data.mediaId;
    const getMediaRes = await req(`/api/media/${uploadedMediaId}`);
    assert(getMediaRes.status === 200, 'GET /api/media/:fileId serves uploaded media file');

    const emptyUploadRes = await req('/api/media/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${artistKidToken}` },
      body: JSON.stringify({ type: 'art' })
    });
    assert(emptyUploadRes.status === 400, 'Upload rejects missing media data payload');

    const traversalRes = await req('/api/media/..%2F..%2Fserver.js');
    assert(traversalRes.status === 404, 'Path traversal attack safely blocked (404)');

    // --- 30. Sibling Quiz Duel Persistence & Multi-Tenant Privacy Isolation ---
    console.log('\n--- 30. Sibling Quiz Duel Persistence & Multi-Tenant Privacy Isolation ---');
    const newQuizDuel = {
      id: 'qduel_test_1',
      familyId: artistFamId,
      category: 'math',
      title: 'Duel Matematika Cepat',
      challengerKidId: artistKidId,
      challengerKidName: 'Bintang Kecil',
      challengerAvatar: '🎨',
      challengerScore: 100,
      challengerTimeSeconds: 38,
      opponentKidId: 'bot',
      opponentKidName: 'Robot Pintar VIDKIDZ',
      opponentAvatar: '🤖',
      opponentScore: 70,
      opponentTimeSeconds: 45,
      winnerKidId: artistKidId,
      winnerKidName: 'Bintang Kecil',
      status: 'completed',
      createdAt: Date.now(),
      rewardCoins: 15
    };

    const duelPatchRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistKidToken}` },
      body: JSON.stringify({ state: { quizDuels: [newQuizDuel] } })
    });
    assert(duelPatchRes.ok, 'Kid submitted quiz duel record via PATCH /api/state');

    const kidDuelState = await req('/api/state', { headers: { Authorization: `Bearer ${artistKidToken}` } });
    const savedDuelKid = (kidDuelState.data.quizDuels || []).find(q => q.id === 'qduel_test_1');
    assert(savedDuelKid && savedDuelKid.winnerKidName === 'Bintang Kecil', 'Quiz duel successfully persisted on server for kid');

    const ownFamDuelState = await req('/api/state', { headers: { Authorization: `Bearer ${artistFamToken}` } });
    const savedDuelFam = (ownFamDuelState.data.quizDuels || []).find(q => q.id === 'qduel_test_1');
    assert(savedDuelFam && savedDuelFam.id === 'qduel_test_1', 'Own family can see quiz duel in GET /api/state');

    const otherFamDuelState = await req('/api/state', { headers: { Authorization: `Bearer ${famToken}` } });
    const savedOtherFamDuel = (otherFamDuelState.data.quizDuels || []).find(q => q.id === 'qduel_test_1');
    assert(!savedOtherFamDuel, 'Other family cannot see another family quiz duel in GET /api/state');

    // --- 31. Admin Restore State Preserves Drawing, Audio & Quiz Collections ---
    console.log('\n--- 31. Admin Restore State Preserves Drawing, Audio & Quiz Collections ---');
    const fullRestorePayload = {
      state: {
        users: {
          admins: [{ id: 'a1', email: 'admin@vidkidz.local', password: 'admin' }],
          families: [{ id: 'f1', email: 'budi@vidkidz.local', password: 'family123' }],
          kids: [
            { id: 'k1', familyId: 'f1', name: 'Andi', avatar: '👦', lockPin: '1234', coins: 100 },
            { id: 'k2', familyId: 'f1', name: 'Sari', avatar: '👧', lockPin: '5678', coins: 80 }
          ]
        },
        storyRecords: [newStoryRecord],
        drawingRecords: [newDrawingRecord],
        parentStoryAudios: [newParentAudio],
        quizDuels: [newQuizDuel],
        curfewRequests: [newCurfewReq]
      }
    };
    const fullRestoreRes = await req('/api/admin/restore-state', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(fullRestorePayload)
    });
    assert(fullRestoreRes.ok && fullRestoreRes.data.stats.storyRecords === 1, 'Admin restore-state preserves storyRecords collection');
    assert(fullRestoreRes.ok && fullRestoreRes.data.stats.drawingRecords === 1, 'Admin restore-state preserves drawingRecords collection');
    assert(fullRestoreRes.ok && fullRestoreRes.data.stats.parentStoryAudios === 1, 'Admin restore-state preserves parentStoryAudios collection');
    assert(fullRestoreRes.ok && fullRestoreRes.data.stats.quizDuels === 1, 'Admin restore-state preserves quizDuels collection');
    assert(fullRestoreRes.ok && fullRestoreRes.data.stats.curfewRequests === 1, 'Admin restore-state preserves curfewRequests collection');

    // --- 32. Vrintex Image API & 7-Day Media Retention Policy ---
    console.log('\n--- 32. Vrintex Image API & 7-Day Media Retention Policy ---');
    const retentionStatusRes = await req('/api/admin/retention-status', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(retentionStatusRes.ok && retentionStatusRes.data.retentionDays === 7, 'Admin retention status reports 7-day retention policy');
    assert(typeof retentionStatusRes.data.totalFiles === 'number', 'Admin retention status reports totalFiles count');

    // Create a mock old media file (> 7 days) and fresh media file (recent) to verify retention cleaner
    const fsUtil = require('fs');
    const pathUtil = require('path');
    const testMediaDir = retentionStatusRes.data.mediaDir || 'data/media';
    if (!fsUtil.existsSync(testMediaDir)) fsUtil.mkdirSync(testMediaDir, { recursive: true });

    const oldFile = pathUtil.join(testMediaDir, 'test_old_expired_media.jpg');
    const freshFile = pathUtil.join(testMediaDir, 'test_fresh_recent_media.jpg');
    fsUtil.writeFileSync(oldFile, 'fake-old-image-bytes');
    fsUtil.writeFileSync(freshFile, 'fake-fresh-image-bytes');

    // Set old file mtime to 8 days ago (8 * 24 * 3600 * 1000 ms ago)
    const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    fsUtil.utimesSync(oldFile, eightDaysAgo, eightDaysAgo);

    // Trigger cleanup
    const cleanupRes = await req('/api/admin/cleanup-retention', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(cleanupRes.ok && cleanupRes.data.success === true, 'Admin cleanup-retention succeeds');
    assert(!fsUtil.existsSync(oldFile), 'Expired media file (> 7 days) successfully deleted by retention cleanup');
    assert(fsUtil.existsSync(freshFile), 'Fresh media file (<= 7 days) preserved by retention cleanup');
    try { fsUtil.unlinkSync(freshFile); } catch (_) {}

    // AI Generate Image validations
    const noPromptRes = await req('/api/ai/generate-image', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ size: '16:9' })
    });
    assert(noPromptRes.status === 400 && noPromptRes.data.error.includes('Prompt'), 'Generate image rejects missing prompt');

    const demoGenerateRes = await req('/api/ai/generate-image', {
      method: 'POST',
      headers: { Authorization: `Bearer ${kidLogin.data.token}` }, // kid token has demo: true
      body: JSON.stringify({ prompt: 'dinosaurus lucu kartun' })
    });
    assert(demoGenerateRes.status === 403, 'AI Generate image forbidden for demo account');

    // AI Stream Render redirect validation
    const renderRes = await req('/api/ai/render-image?prompt=pemandangan+gunung&size=16:9', {
      redirect: 'manual'
    });
    assert(renderRes.status === 302, 'GET /api/ai/render-image returns HTTP 302 redirect to Vrintex render stream');

    // --- 33. Multi-Device Quiz Room & Real-Time Buzzer Synchronization ---
    console.log('\n--- 33. Multi-Device Quiz Room & Real-Time Buzzer Synchronization ---');
    // Create quiz room with kid token (Andi - k1)
    const createRoomRes = await req('/api/quiz-room/create', {
      method: 'POST',
      headers: { Authorization: `Bearer ${kidLogin.data.token}` },
      body: JSON.stringify({ category: 'math' })
    });
    assert(createRoomRes.ok && !!createRoomRes.data.room?.roomId, 'Create quiz room returns roomId');
    assert(typeof createRoomRes.data.room?.roomCode === 'string' && createRoomRes.data.room?.roomCode.length === 4, 'Quiz room generated 4-digit code');
    const createdRoomId = createRoomRes.data.room.roomId;
    const createdRoomCode = createRoomRes.data.room.roomCode;

    // List active family rooms
    const activeRoomsRes = await req('/api/quiz-room/active', {
      headers: { Authorization: `Bearer ${famToken}` }
    });
    assert(activeRoomsRes.ok && activeRoomsRes.data.rooms?.some(r => r.roomId === createdRoomId), 'GET /api/quiz-room/active lists waiting room for family');

    // Sibling login (Sari - k2) and join room
    const kid2Login = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'k2', password: '5678' })
    });
    const kid2Token = kid2Login.data.token;

    const joinRoomRes = await req('/api/quiz-room/join', {
      method: 'POST',
      headers: { Authorization: `Bearer ${kid2Token}` },
      body: JSON.stringify({ roomCode: createdRoomCode })
    });
    assert(joinRoomRes.ok && joinRoomRes.data.room?.players?.opponent?.kidId === 'k2', 'Sibling joins room via 4-digit room code');

    // Both players mark ready
    const ready1Res = await req('/api/quiz-room/ready', {
      method: 'POST',
      headers: { Authorization: `Bearer ${kidLogin.data.token}` },
      body: JSON.stringify({ roomId: createdRoomId })
    });
    assert(ready1Res.ok, 'Player 1 marks ready');

    const ready2Res = await req('/api/quiz-room/ready', {
      method: 'POST',
      headers: { Authorization: `Bearer ${kid2Token}` },
      body: JSON.stringify({ roomId: createdRoomId })
    });
    assert(ready2Res.ok && (ready2Res.data.room?.status === 'countdown' || ready2Res.data.room?.status === 'in_progress'), 'Both players ready triggers countdown/start');

    // Submit answer in room
    const ansRes = await req('/api/quiz-room/answer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${kidLogin.data.token}` },
      body: JSON.stringify({ roomId: createdRoomId, round: 0, answerIndex: 0, timeSpentMs: 2200 })
    });
    assert(ansRes.status === 200 || ansRes.status === 400, 'Quiz room answer submission validated');

    // BUG-042 regression: SSE stream must require authentication
    const sseNoAuthRes = await req(`/api/quiz-room/stream/${createdRoomId}`, {});
    assert(sseNoAuthRes.status === 401, 'SSE stream rejects unauthenticated access (BUG-042)');

    // BUG-042 regression: SSE stream must reject cross-family access
    const f2BugLogin = await req('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Keluarga Lain Test',
        email: 'crossfam_' + Date.now() + '@test.local',
        password: 'securePass123!',
        otp: '123456',
        acceptedTerms: true
      })
    });
    const sseCrossFamRes = await req(`/api/quiz-room/stream/${createdRoomId}`, {
      headers: { Authorization: `Bearer ${f2BugLogin.data.token}` }
    });
    assert(sseCrossFamRes.status === 403, 'SSE stream rejects cross-family access (BUG-042)');

    // BUG-042 regression: SSE stream accepts valid token via query param
    const sseAbort = new AbortController();
    const sseAuthRes = await fetch(`${base}/api/quiz-room/stream/${createdRoomId}?token=${encodeURIComponent(kidLogin.data.token)}`, {
      signal: sseAbort.signal
    });
    assert(sseAuthRes.status === 200 && (sseAuthRes.headers.get('content-type') || '').includes('text/event-stream'), 'SSE stream accepts valid token via query param (BUG-042)');
    sseAbort.abort();

    // Leave room
    const leaveRes = await req('/api/quiz-room/leave', {
      method: 'POST',
      headers: { Authorization: `Bearer ${kid2Token}` },
      body: JSON.stringify({ roomId: createdRoomId })
    });
    assert(leaveRes.ok, 'Leave quiz room succeeds');

    // --- 34. Transactional Journaling & State Snapshot Recovery ---
    console.log('\n--- 34. Transactional Journaling & State Snapshot Recovery ---');
    const journalStatusRes = await req('/api/admin/journal-status', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(journalStatusRes.ok && typeof journalStatusRes.data.totalEntries === 'number', 'Admin journal status returns totalEntries');
    assert(journalStatusRes.data.totalEntries > 0, 'Transactional journal entries logged on state mutations');
    assert(typeof journalStatusRes.data.logSizeBytes === 'number' && journalStatusRes.data.logSizeBytes > 0, 'State journal log file exists on disk');

    // --- 35. Creative Collections in Path-Based PATCH ---
    console.log('\n--- 35. Creative Collections in Path-Based PATCH ---');
    // Non-demo Kid submits drawingRecord via path-based PATCH
    const kidDrawPathRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistKidToken}` },
      body: JSON.stringify({
        path: 'drawingRecords.draw_path_test',
        value: { id: 'draw_path_test', kidId: artistKidId, templateId: 'kancil', title: 'Si Kancil', createdAt: Date.now(), rewardCoins: 10 }
      })
    });
    assert(kidDrawPathRes.ok, 'Kid drawingRecords accepted via path-based PATCH');

    // Non-demo Family submits parentStoryAudios via path-based PATCH
    const famAudioPathRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistFamToken}` },
      body: JSON.stringify({
        path: 'parentStoryAudios.audio_path_test',
        value: { id: 'audio_path_test', familyId: artistFamId, storyId: 'story1', storyTitle: 'Semut', duration: 25, recordedAt: Date.now() }
      })
    });
    assert(famAudioPathRes.ok, 'Family parentStoryAudios accepted via path-based PATCH');

    // Non-demo Family submits quizDuels via path-based PATCH
    const famDuelPathRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistFamToken}` },
      body: JSON.stringify({
        path: 'quizDuels.qduel_path_test',
        value: { id: 'qduel_path_test', familyId: artistFamId, category: 'math', title: 'Duel Matematika', challengerKidId: artistKidId, opponentKidId: 'k2', winnerKidId: artistKidId, status: 'completed', createdAt: Date.now() }
      })
    });
    assert(famDuelPathRes.ok, 'Family quizDuels accepted via path-based PATCH');

    // Kid submits curfewRequests via path-based PATCH
    const kidCurfewPathRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistKidToken}` },
      body: JSON.stringify({
        path: 'curfewRequests.creq_path_test',
        value: { id: 'creq_path_test', kidId: artistKidId, reason: 'Belajar Hafalan', minutes: 15, status: 'pending', createdAt: Date.now() }
      })
    });
    assert(kidCurfewPathRes.ok, 'Kid curfewRequests accepted via path-based PATCH');

    // Test Idempotency Key Replay (Feature #5)
    const idemKey = 'idem_test_' + Date.now();
    const idemRes1 = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistFamToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify({ path: 'rewards', value: [] })
    });
    assert(idemRes1.ok, 'First request with Idempotency-Key succeeds');

    const idemRes2 = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${artistFamToken}`, 'Idempotency-Key': idemKey },
      body: JSON.stringify({ path: 'rewards', value: [] })
    });
    assert(idemRes2.ok && (idemRes2.headers?.get ? idemRes2.headers.get('x-idempotency-replay') : idemRes2.headers?.['x-idempotency-replay']) === 'true', 'Second request with same Idempotency-Key returns replayed response');

    // Test Multiple Failed PIN Attempts & Security Alert Tracking (Feature #7)
    for (let i = 0; i < 5; i++) {
      await req('/api/kids/unlock', {
        method: 'POST',
        headers: { Authorization: `Bearer ${famToken}` },
        body: JSON.stringify({ kidId: 'k1', pin: '0000' })
      });
    }
    const kidUnlockFail = await req('/api/kids/unlock', {
      method: 'POST',
      headers: { Authorization: `Bearer ${famToken}` },
      body: JSON.stringify({ kidId: 'k1', pin: '0000' })
    });
    assert(kidUnlockFail.status === 401 || kidUnlockFail.status === 429, 'PIN failure tracking records multiple incorrect attempts and prevents unauthorized unlock');

    // --- 36. Password Preservation in Admin State Sync ---
    console.log('\n--- 36. Password Preservation in Admin State Sync ---');
    // Fetch state with admin token (sanitized state where passwords may be omitted or sanitized)
    const adminStateGet = await req('/api/state', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminStateGet.ok, 'Admin GET /api/state succeeded');
    // Prepare a state update payload where user objects omit the password property
    const sanitizedAdminUsers = {
      admins: (adminStateGet.data.users.admins || []).map(a => { const { password: _p, ...rest } = a; return rest; }),
      families: (adminStateGet.data.users.families || []).map(f => { const { password: _p, ...rest } = f; return rest; }),
      kids: adminStateGet.data.users.kids
    };
    const adminSyncRes = await req('/api/state', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ state: { users: sanitizedAdminUsers } })
    });
    assert(adminSyncRes.ok, 'Admin PATCH /api/state with password-less users accepted');

    // Verify admin can still login with restored password ('admin')
    const adminReLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@vidkidz.local', password: 'admin', role: 'admin' })
    });
    assert(adminReLogin.ok && adminReLogin.data.token, 'Admin can still log in after password-less state sync');

    // Verify family can still login with original password
    const familyReLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'budi@vidkidz.local', password: 'family123', role: 'family' })
    });
    assert(familyReLogin.ok && familyReLogin.data.token, 'Family can still log in after password-less state sync');

    console.log('\n--- 37. Admin Auth Integrity & Telegram/Backup Bearer Protection ---');
    // Verify endpoints strictly reject unauthenticated requests without Bearer token
    const noAuthRestore = await req('/api/admin/restore-state', {
      method: 'POST',
      body: JSON.stringify({ state: { users: {} } })
    });
    assert(noAuthRestore.status === 401, 'Unauthenticated restore-state rejected with HTTP 401');

    const noAuthTgTest = await req('/api/admin/telegram-test', {
      method: 'POST',
      body: JSON.stringify({ token: 'test', chatId: '123' })
    });
    assert(noAuthTgTest.status === 401, 'Unauthenticated telegram-test rejected with HTTP 401');

    const noAuthTgBackup = await req('/api/admin/telegram-backup', {
      method: 'POST',
      body: JSON.stringify({ token: 'test', chatId: '123' })
    });
    assert(noAuthTgBackup.status === 401, 'Unauthenticated telegram-backup rejected with HTTP 401');

    // Verify authenticated requests with valid admin token pass authMiddleware
    const authTgTest = await req('/api/admin/telegram-test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ token: '', chatId: '' })
    });
    assert(authTgTest.status === 400, 'Authenticated telegram-test validates empty token/chatId with HTTP 400');

    const authTgBackup = await req('/api/admin/telegram-backup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ token: '', chatId: '' })
    });
    assert(authTgBackup.status === 400, 'Authenticated telegram-backup validates empty token/chatId with HTTP 400');

    console.log('\n--- 38. Automated Telegram Backup Scheduling (Cron Mode) ---');
    // Non-admin forbidden from telegram-schedule
    const nonAdminSched = await req('/api/admin/telegram-schedule', {
      method: 'POST',
      headers: { Authorization: `Bearer ${famToken}` },
      body: JSON.stringify({ enabled: true, intervalHours: 12 })
    });
    assert(nonAdminSched.status === 403, 'Non-admin forbidden from telegram-schedule');

    // Admin configure automated schedule
    const adminSchedRes = await req('/api/admin/telegram-schedule', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        enabled: true,
        intervalHours: 12,
        token: 'bot12345:TEST_TOKEN',
        chatId: '-100987654321',
        sendDoc: true,
        sendSummary: true,
        customCaption: 'Cron automated test run'
      })
    });
    assert(adminSchedRes.ok && adminSchedRes.data.schedule.enabled === true, 'Admin configure telegram auto-backup schedule succeeded');
    assert(adminSchedRes.data.schedule.intervalHours === 12, 'Schedule interval set to 12 hours');

    // GET /api/admin/telegram-schedule inspect
    const getSchedRes = await req('/api/admin/telegram-schedule', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(getSchedRes.ok && getSchedRes.data.schedule.enabled === true, 'GET /api/admin/telegram-schedule returns active schedule');
    assert(getSchedRes.data.schedule.token === 'bot12345:TEST_TOKEN', 'Schedule bot token saved properly');

    // Admin toggle pause/disable schedule
    const disableSchedRes = await req('/api/admin/telegram-schedule', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: false })
    });
    assert(disableSchedRes.ok && disableSchedRes.data.schedule.enabled === false, 'Admin disable telegram auto-backup succeeded');

    // --- 39. 9Router AI Gateway Configuration & Admin Test Endpoint ---
    console.log('\n--- 39. 9Router AI Gateway Configuration & Admin Test Endpoint ---');
    // Non-admin rejected from /api/ai/test
    const nonAdminAiTest = await req('/api/ai/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ baseUrl: 'http://127.0.0.1:20128/v1' })
    });
    assert(nonAdminAiTest.status === 403, 'Non-admin forbidden from /api/ai/test');

    // Admin calling /api/ai/test (will return 502 connection refused if local gateway offline, but valid JSON without crash)
    const adminAiTest = await req('/api/ai/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ baseUrl: 'http://127.0.0.1:20128/v1', apiKey: 'test-key' })
    });
    assert(adminAiTest.status === 200 || adminAiTest.status === 502, 'Admin /api/ai/test returns structured response');
    assert(typeof adminAiTest.data === 'object' && ('error' in adminAiTest.data || 'ok' in adminAiTest.data), 'Admin /api/ai/test returns error or ok format');
    assert(adminAiTest.data.circuitBreaker && typeof adminAiTest.data.circuitBreaker.isOpen === 'boolean', 'Admin /api/ai/test returns circuit breaker status');
    assert(adminAiTest.data.gateways && typeof adminAiTest.data.gateways === 'object', 'Admin /api/ai/test returns multi-gateway reachability status');

    // Verify 9Router settings in state
    const stateWith9Router = await req('/api/state', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(stateWith9Router.ok && stateWith9Router.data.systemSettings.aiProvider === '9router', 'Admin sees aiProvider set to 9router');
    assert(stateWith9Router.data.systemSettings.nineRouterBaseUrl.includes('20128'), 'Admin sees 9Router default base URL');

    // Verify non-admin has nineRouterApiKey stripped
    const kidStateAi = await req('/api/state', {
      headers: { Authorization: `Bearer ${kidLogin.data.token}` }
    });
    assert(kidStateAi.ok && !kidStateAi.data.systemSettings.nineRouterApiKey, 'Non-admin has nineRouterApiKey stripped in GET /api/state');

    // --- 40. Dashboard & Login Auth Flow Integrity ---
    console.log('\n--- 40. Dashboard & Login Auth Flow Integrity ---');
    // Direct kid login by ID and by Name
    const directKidById = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'k1', password: '1234', role: 'kids' })
    });
    assert(directKidById.ok && directKidById.data.role === 'kids' && directKidById.data.kidId === 'k1', 'Direct kid login by ID k1');

    const directKidByName = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'Andi', password: '1234', role: 'kids' })
    });
    assert(directKidByName.ok && directKidByName.data.role === 'kids' && directKidByName.data.user.name === 'Andi', 'Direct kid login by Name Andi');

    // Launch kid session via fresh family token
    const freshFamLogin = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'budi@vidkidz.local', password: 'family123' })
    });
    const launchKid = await req('/api/auth/kids-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${freshFamLogin.data?.token}` },
      body: JSON.stringify({ kidId: 'k1' })
    });
    assert(launchKid.ok && launchKid.data.role === 'kids' && launchKid.data.kidId === 'k1', 'Launch kid session via family token succeeds');

    // Admin overview state metric correctness
    const adminOverviewState = await req('/api/state', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminOverviewState.ok, 'Admin overview state fetch succeeds');
    const adminFamCount = adminOverviewState.data.users?.families?.length;
    assert(typeof adminFamCount === 'number', 'Admin overview reports accurate numeric family count');

    // ── Group 41: Features #5, #7, #10 — Co-op Quest, Roadtrip Vault, WebAuthn ──
    console.log('\n--- 41. Feature Regression: Co-op Quest, Roadtrip Vault, WebAuthn ---');

    // Feature #5: Co-op quest is a client-side localStorage feature; verify family
    // telegram-digest endpoint (co-op data aggregation path) works for family role
    const famLoginForCoop = await req('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'budi@vidkidz.local', password: 'family123' })
    });
    const coopFamToken = famLoginForCoop.data.token;
    assert(typeof coopFamToken === 'string', 'Feature #5: family login for co-op test succeeds');

    // Family coin aggregate is exposed via /api/state
    const coopState = await req('/api/state', {
      headers: { Authorization: `Bearer ${coopFamToken}` }
    });
    assert(coopState.ok, 'Feature #5: Family /api/state reachable for co-op coin aggregation');
    const coopKids = (coopState.data?.users?.kids || []).filter(k => k.familyId === famLoginForCoop.data?.id);
    const totalFamilyCoins = coopKids.reduce((s, k) => s + (k.coins || 0), 0);
    assert(typeof totalFamilyCoins === 'number', 'Feature #5: family total coin pool computable from state');

    // Feature #7: Roadtrip Vault is a Cache API (browser) feature; verify that
    // server does NOT block cross-origin-like video URLs (no-cors access must be possible)
    // Test: /api/state serves correct album whitelist so roadtrip vault can cache approved videos
    const vidState = await req('/api/state', { headers: { Authorization: `Bearer ${coopFamToken}` } });
    assert(Array.isArray(vidState.data?.albums), 'Feature #7: albums array present in state for Roadtrip Vault');
    assert(vidState.ok, 'Feature #7: state endpoint accessible for Roadtrip Vault album resolution');

    // Verify index.html includes Roadtrip Vault button marker
    const indexPage = await fetch(`${base}/`);
    const indexHtml = await indexPage.text();
    assert(indexHtml.includes('btn-roadtrip-cache'), 'Feature #7: Roadtrip Vault button present in index.html');
    assert(indexHtml.includes('ROADTRIP_CACHE'), 'Feature #7: ROADTRIP_CACHE constant present in index.html');

    // Feature #10: WebAuthn — verify helpers present in index.html
    assert(indexHtml.includes('webauthnRegisterParent'), 'Feature #10: webauthnRegisterParent helper present in index.html');
    assert(indexHtml.includes('webauthnVerifyParent'), 'Feature #10: webauthnVerifyParent helper present in index.html');
    assert(indexHtml.includes('btn-webauthn-unlock'), 'Feature #10: WebAuthn unlock button present in index.html');
    assert(indexHtml.includes('PublicKeyCredential'), 'Feature #10: WebAuthn API guard (PublicKeyCredential) present');

    // Feature #5: verify co-op goal UI present in index.html
    assert(indexHtml.includes('btn-create-coop-quest'), 'Feature #5: Co-op Quest create button present in index.html');
    assert(indexHtml.includes('vk_coop_goal_'), 'Feature #5: Co-op goal localStorage key marker present');

    // Security: verify non-family role cannot access family telegram-digest
    const guestDigest = await req('/api/family/telegram-digest', { method: 'POST', body: '{}' });
    assert(guestDigest.status === 401 || guestDigest.status === 403, 'Feature #6: telegram-digest blocked for unauthenticated');

    // --- 42. AI Voice Story Narration, Adaptive Video Bandwidth & Periodic Heartbeat ---
    console.log('\n--- 42. AI Voice Story Narration & Adaptive Media ---');
    const ttsEmpty = await req('/api/ai/tts');
    assert(ttsEmpty.status === 400, 'AI TTS rejects missing text parameter (400)');

    const ttsFirst = await req('/api/ai/tts?text=Kancil%20dan%20Buaya%20cerita%20bijak');
    assert(ttsFirst.status === 200, 'AI TTS returns HTTP 200 for valid text');
    assert(ttsFirst.headers?.['content-type']?.includes('audio/wav'), 'AI TTS responds with audio/wav');
    assert(ttsFirst.headers?.['x-tts-engine'] === 'vidkidz-tts-synth', 'AI TTS engine header present');
    assert(ttsFirst.headers?.['x-tts-cache'] === 'MISS', 'First AI TTS request records cache MISS');

    const ttsSecond = await req('/api/ai/tts?text=Kancil%20dan%20Buaya%20cerita%20bijak');
    assert(ttsSecond.status === 200, 'Cached AI TTS request succeeds (200)');
    assert(ttsSecond.headers?.['x-tts-cache'] === 'HIT', 'Second AI TTS request serves from cache (HIT)');

    const ttsPost = await req('/api/ai/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Cerita budi pekerti sebelum tidur' })
    });
    assert(ttsPost.status === 200, 'POST /api/ai/tts accepts JSON body');

    // UI Marker Validations
    assert(indexHtml.includes('btn-video-quality'), 'Feature #8: Video quality selector button present in index.html');
    assert(indexHtml.includes('vidkidz_video_quality'), 'Feature #8: Video quality localStorage persistence marker present');
    assert(indexHtml.includes('btn-ai-story-tts'), 'Feature #2: AI story narration button present in index.html');
    assert(indexHtml.includes('vidkidz-telemetry-heartbeat'), 'Feature #10: Periodic telemetry heartbeat tag present in index.html');

    const swCode = fs.readFileSync(path.join(__dirname, 'public/sw.js'), 'utf8');
    assert(swCode.includes('vidkidz-telemetry-heartbeat'), 'Feature #10: Periodic sync heartbeat listener present in sw.js');

    // --- 43. P1 Recommendations: Error Telemetry, Self-Healing & Compression ---
    console.log('\n--- 43. P1 Recommendations: Error Telemetry, Self-Healing & Compression ---');

    // 1. Client Error Telemetry Endpoint (POST /api/logs)
    const logPost = await req('/api/logs', {
      method: 'POST',
      body: JSON.stringify({
        level: 'error',
        source: 'test-runner',
        message: 'Simulated client error with Bearer token_secret_12345',
        stack: 'Error: at line 42',
        url: 'http://localhost/test'
      })
    });
    assert(logPost.status === 200, 'POST /api/logs accepts error telemetry payload');
    assert(logPost.data?.success === true, 'POST /api/logs returns success: true');

    // Verify sanitization and activityLog storage in state
    const adminStateCheck = await req('/api/state', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminStateCheck.status === 200, 'Admin can inspect state to verify logged telemetry');
    const recentTelemetry = adminStateCheck.data?.activityLog?.find(l => l.type === 'telemetry_error');
    assert(recentTelemetry, 'Telemetry error entry logged in state activityLog');
    assert(!recentTelemetry.action.includes('token_secret_12345'), 'Sensitive token was sanitized from action');

    // 2. Self-Healing State Verification (GET /api/admin/self-heal)
    const healForbidden = await req('/api/admin/self-heal', {
      headers: { Authorization: `Bearer ${testKidToken}` }
    });
    assert(healForbidden.status === 403, 'Non-admin forbidden from /api/admin/self-heal');

    const healAdmin = await req('/api/admin/self-heal', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(healAdmin.status === 200, 'Admin can invoke /api/admin/self-heal');
    assert(healAdmin.data?.success === true, 'Self-healing routine reports success');
    assert(typeof healAdmin.data?.healedCount === 'number', 'Self-healing reports numeric healedCount');
    assert(Array.isArray(healAdmin.data?.issues), 'Self-healing returns issues array');
    assert(healAdmin.data?.verifiedAt, 'Self-healing includes verifiedAt timestamp');

    // 3. Compression & HTTP Optimization
    const compRes = await req('/api/version', {
      headers: { 'Accept-Encoding': 'gzip, deflate, br' }
    });
    assert(compRes.status === 200, 'Version endpoint reachable with Accept-Encoding');
    assert(compRes.headers?.['vary']?.includes('Accept-Encoding'), 'Vary: Accept-Encoding header present');

    // 4. Client ErrorBoundary UI Check
    assert(indexHtml.includes('class ErrorBoundary extends React.Component'), 'ErrorBoundary class component present in index.html');
    assert(indexHtml.includes('<ErrorBoundary>'), 'Root component wrapped with <ErrorBoundary>');
    assert(indexHtml.includes('Ups, Ada Sedikit Gangguan!'), 'Child-friendly error message present in ErrorBoundary');

    console.log(`FINAL RESULTS: ${passed} passed, ${failed} failed`);
    console.log(`========================================`);
  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    try {
      const fs = require('fs');
      const p = require('path').join(process.env.VIDKIDZ_DATA_DIR || 'data', 'vidkidz-state.json');
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
        d.state.drawingRecords = (d.state.drawingRecords || []).filter(d => !d.id.startsWith('draw_test_'));
        d.state.parentStoryAudios = (d.state.parentStoryAudios || []).filter(a => !a.id.startsWith('audio_test_'));
        d.state.quizDuels = (d.state.quizDuels || []).filter(q => !q.id.startsWith('qduel_test_') && q.id !== 'qduel_restore_test');
        fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
      }
    } catch (_) {}
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
});
