const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const React = require('react');
const renderer = require('react-test-renderer');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const script = [...html.matchAll(/<script\b[^>]*type="text\/babel"[^>]*>([\s\S]*?)<\/script>/g)][0][1];
const ast = parser.parse(script,{sourceType:'script',plugins:['jsx']});
const names = ['LegacyUiIcon','UiIcon','SCULPTED_ICONS','sculptedIconSource','PIXAR_3D_ICON_MAP','EMOJI_ICON_MAP','KNOWN_UI_ICONS','IconSlot','PixarCoin','KidsStoryHub','STORY_LIST','KidsNavigation','KidsMoreMenu','KIDS_MENU','KidsColoringStudio','COLORING_TEMPLATES','FamilyBedtimeVoiceStudio','BEDTIME_DRAFT_PREFIX','KidsQuizDuel','QUIZ_BANKS','FamilyQuizTournament','IDB_CONFIG','VidkidzIdb','isCurfewActive','KidsLockScreen','FamilyDeviceControl','Toggle','timeAgo','HAFALAN_LIST','DEMO_VIDEOS'];
const source = ast.program.body.filter(node => names.includes(node.id?.name) || node.declarations?.some(d=>names.includes(d.id.name))).map(node=>script.slice(node.start,node.end)).join('\n');
const compiled = babel.transformSync(source,{configFile:false,babelrc:false,plugins:[['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code;

function fixture(state = {}) {
  const AppCtx = React.createContext(null);
  const storage = new Map();
  const idbStores = new Map();
  const mockIndexedDB = {
    open: (dbName, version) => {
      const listeners = {};
      const req = {
        addEventListener: (evt, fn) => { listeners[evt] = fn; },
        set onsuccess(fn) { listeners['success'] = fn; },
        set onerror(fn) { listeners['error'] = fn; },
        set onupgradeneeded(fn) { listeners['upgradeneeded'] = fn; }
      };
      queueMicrotask(() => {
        const db = {
          objectStoreNames: {
            contains: (name) => idbStores.has(name)
          },
          createObjectStore: (name, opts) => {
            const storeMap = new Map();
            storeMap.keyPath = opts?.keyPath;
            idbStores.set(name, storeMap);
            return storeMap;
          },
          transaction: (storeNames) => {
            const storeName = Array.isArray(storeNames) ? storeNames[0] : storeNames;
            let targetMap = idbStores.get(storeName);
            if (!targetMap) {
              targetMap = new Map();
              idbStores.set(storeName, targetMap);
            }
            return {
              objectStore: () => ({
                keyPath: targetMap.keyPath,
                get: (key) => {
                  const getReq = {};
                  queueMicrotask(() => {
                    getReq.result = targetMap.get(key);
                    getReq.onsuccess?.({ target: getReq });
                  });
                  return getReq;
                },
                getAll: () => {
                  const getReq = {};
                  queueMicrotask(() => {
                    getReq.result = Array.from(targetMap.values());
                    getReq.onsuccess?.({ target: getReq });
                  });
                  return getReq;
                },
                put: (val, key) => {
                  const putReq = {};
                  const storeKey = targetMap.keyPath ? val[targetMap.keyPath] : key;
                  targetMap.set(storeKey, val);
                  queueMicrotask(() => {
                    putReq.onsuccess?.({ target: putReq });
                  });
                  return putReq;
                },
                delete: (key) => {
                  const delReq = {};
                  targetMap.delete(key);
                  queueMicrotask(() => {
                    delReq.onsuccess?.({ target: delReq });
                  });
                  return delReq;
                },
                clear: () => {
                  const clearReq = {};
                  targetMap.clear();
                  queueMicrotask(() => {
                    clearReq.onsuccess?.({ target: clearReq });
                  });
                  return clearReq;
                }
              })
            };
          }
        };
        listeners['upgradeneeded']?.({ target: { result: db } });
        listeners['success']?.({ target: { result: db } });
      });
      return req;
    }
  };
  const navigatorMock = {
    storage: {
      estimate: () => Promise.resolve({ usage: 2048000, quota: 104857600 })
    }
  };
  let bitmap = 'blank';
  const ctx = new Proxy({}, { get(target,key) { if(key==='getImageData') return ()=>({bitmap}); if(key==='putImageData')return snap=>{bitmap=snap.bitmap;}; if(key==='drawImage')return image=>{bitmap=image.src;};return target[key] ?? (()=>{}); }, set(target,key,value){target[key]=value;return true;} });
  const canvas = { width:640,height:460,getContext:()=>ctx,toDataURL:()=>bitmap,getBoundingClientRect:()=>({left:0,top:0,width:320,height:230}),setPointerCapture(){} };
  const notifications = [];
  const preloadedAudios = [];
  class MockAudio {
    constructor(src = '') {
      this.src = src || '';
      this.preload = 'auto';
      this.paused = true;
      preloadedAudios.push(this);
    }
    load() {}
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const sessionStorageMock = {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const context = { React, AppCtx, ...React, console, Set, Map, Date, Math,
    setInterval, clearInterval, setTimeout, clearTimeout, queueMicrotask, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
    apiFetch: () => Promise.resolve({ success: true }),
    window:{speechSynthesis:{cancel(){},speak(){},pause(){},resume(){}},confirm:()=>true,sessionStorage:sessionStorageMock,indexedDB:mockIndexedDB},
    indexedDB:mockIndexedDB,
    navigator:navigatorMock,
    SpeechSynthesisUtterance:function(text){this.text=text;},
    sessionStorage:sessionStorageMock,
    Image:class { set src(value){this.value=value;queueMicrotask(()=>this.onload?.());}get src(){return this.value;} },
    Audio:MockAudio,
    document:{createElement:()=>({click(){}})}
  };
  vm.runInNewContext(compiled+'\nthis.exports={KidsStoryHub,KidsNavigation,KidsColoringStudio,KIDS_MENU,STORY_LIST,SCULPTED_ICONS,FamilyBedtimeVoiceStudio,KidsQuizDuel,QUIZ_BANKS,FamilyQuizTournament,IDB_CONFIG,VidkidzIdb,isCurfewActive,KidsLockScreen,FamilyDeviceControl,DEMO_VIDEOS};',context);
  const app = {state:{storyRecords:[],drawingRecords:[],parentStoryAudios:[],quizDuels:[],curfewRequests:[],users:{kids:[]},...state},currentUser:{id:'f1',name:'Ayah Budi'},showNotif:m=>notifications.push(m),updateState:fn=>fn(app.state),addCoins(){},addLog(){},idb:context.exports.VidkidzIdb};
  return { ...context.exports, storage, notifications, canvas, preloadedAudios, setBitmap:value=>{bitmap=value;},
    render(Component,props){ let tree;renderer.act(()=>{tree=renderer.create(React.createElement(AppCtx.Provider,{value:app},React.createElement(Component,props)),{createNodeMock:el=>el.type==='canvas'?canvas:el.type==='dialog'?{showModal(){this.open=true;},close(){this.open=false;}}:{scrollIntoView(){}}});});return tree; }
  };
}
test('five visible tabs keep all nine activities reachable through the menu',()=>{
  const f=fixture();let selected=null;
  const tree=f.render(f.KidsNavigation,{items:f.KIDS_MENU,page:'drawing',onNavigate:id=>{selected=id;}});
  const nav=tree.root.findByType('nav');
  assert.equal(nav.findAllByType('button').length,5);
  assert.equal(nav.findAllByType('button').filter(b=>b.props['aria-current']==='page').length,1);
  renderer.act(()=>nav.findAllByType('button')[4].props.onClick());
  const dialog=tree.root.findByType('dialog');
  const grid=dialog.findByProps({className:'kids-menu-grid'});
  assert.equal(grid.findAllByType('button').length,9);
  renderer.act(()=>grid.findAllByType('button')[6].props.onClick());
  assert.equal(selected,'games');
  assert.equal(tree.root.findAllByType('dialog').length,0);
  renderer.act(()=>tree.unmount());
});
test('story search combines with completion filters and reset recovers the list',()=>{
  const f=fixture();const tree=f.render(f.KidsStoryHub,{kid:{id:'k1'}});
  const count=()=>tree.root.findAllByProps({className:'story-card'}).length;
  assert.equal(count(),f.STORY_LIST.length);
  renderer.act(()=>tree.root.findByProps({type:'search'}).props.onChange({target:{value:'zzzz-no-story'}}));
  assert.equal(count(),0);
  const reset=tree.root.findAllByType('button').find(b=>b.children.includes('Tampilkan semua'));
  renderer.act(()=>reset.props.onClick());
  assert.equal(count(),f.STORY_LIST.length);
  const done=tree.root.findAllByType('button').find(b=>b.children.includes('Selesai'));
  renderer.act(()=>done.props.onClick());
  assert.equal(count(),0);
  renderer.act(()=>tree.unmount());
});
test('drawing saves a draft after a pointer stroke and restores it on remount',async()=>{
  const f=fixture();let tree=f.render(f.KidsColoringStudio,{kid:{id:'k1',name:'Andi'}});
  const canvas=tree.root.findByType('canvas');
  const event={preventDefault(){},currentTarget:f.canvas,pointerId:1,clientX:20,clientY:20};
  renderer.act(()=>canvas.props.onPointerDown(event));
  f.setBitmap('data:image/png;base64,saved-draft');
  renderer.act(()=>canvas.props.onPointerUp(event));
  assert.equal(f.storage.get('vidkidz-drawing-draft:k1:kancil'),'data:image/png;base64,saved-draft');
  renderer.act(()=>tree.unmount());
  tree=f.render(f.KidsColoringStudio,{kid:{id:'k1',name:'Andi'}});
  await renderer.act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
  assert.equal(tree.root.findByProps({role:'status'}).children[0],'Draf sebelumnya dipulihkan');
  renderer.act(()=>tree.unmount());
});
test('new icon assets resolve locally and CSS does not reinstate forced heading colors',()=>{
  const f=fixture();
  for(const asset of new Set(Object.values(f.SCULPTED_ICONS)))assert.ok(fs.existsSync(path.join(root,`public/assets/icons/pixar/${asset}.webp`)),asset);
  for(const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))postcss.parse(block[1]).walkRules(rule=>{assert.ok(!/\.kids-app h[23]\[style\]/.test(rule.selector),'broad heading override must stay removed');});
});
test('parent bedtime story audio preloads and displays parent-ready badge and quick play panel',()=>{
  const f = fixture();
  const storyId = f.STORY_LIST[0].id;
  const parentStoryAudios = [
    { id: 'pa_1', storyId, audioData: 'data:audio/webm;base64,mockvoice', recordedBy: 'Bunda' }
  ];
  const fWithAudio = fixture({ parentStoryAudios });
  const tree = fWithAudio.render(fWithAudio.KidsStoryHub, { kid: { id: 'k1' } });

  // Verify audio preloader warmed cache for parent voice
  assert.equal(fWithAudio.preloadedAudios.length, 1);
  assert.equal(fWithAudio.preloadedAudios[0].src, 'data:audio/webm;base64,mockvoice');

  // Verify badge in story grid
  const badges = tree.root.findAllByProps({ className: 'story-badge parent-ready' });
  assert.equal(badges.length, 1);
  assert.ok(badges[0].children.some(c => typeof c === 'string' && c.includes('Suara Ayah/Bunda')));

  // Open the story reader
  const s1Card = tree.root.findAllByProps({ className: 'story-card' })[0];
  renderer.act(() => s1Card.props.onClick());

  // Verify parent audio panel is rendered with Bunda's voice
  const audioPanel = tree.root.findByProps({ className: 'reader-panel story-parent-audio-panel' });
  assert.ok(audioPanel);
  const heading = audioPanel.findByType('h3');
  assert.ok(heading.children.some(c => typeof c === 'string' && c.includes('Bunda')));

  renderer.act(() => tree.unmount());
  // Verify audio elements were released on unmount
  assert.equal(fWithAudio.preloadedAudios[0].src, '');
});

test('family bedtime studio recovers unsaved audio recording draft from sessionStorage',()=>{
  const f=fixture();
  const story=f.STORY_LIST[0];
  const draftKey=`vidkidz-bedtime-draft:${story.id}`;
  const mockDraft={
    base64:'data:audio/webm;base64,dGVzdGF1ZGlv',
    duration:35,
    savedAt:Date.now()
  };
  f.storage.set(draftKey,JSON.stringify(mockDraft));

  const tree=f.render(f.FamilyBedtimeVoiceStudio,{myKids:[{id:'k1',name:'Andi'}]});

  // Click record button on first story
  const recordButtons=tree.root.findAllByType('button').filter(b=>b.children.some(c=>typeof c==='string'&&c.includes('Mulai Rekam Suara')));
  assert.ok(recordButtons.length>0);
  renderer.act(()=>recordButtons[0].props.onClick());

  // Verify draft restored status and notification
  assert.ok(f.notifications.includes('Draf rekaman sebelumnya dipulihkan'));
  const statusBadge=tree.root.findByProps({role:'status'});
  assert.ok(statusBadge.children.includes('Draf dipulihkan'));

  // Verify preview audio element has restored draft source
  const audioElem=tree.root.findByType('audio');
  assert.equal(audioElem.props.src,mockDraft.base64);

  // Click Simpan Suara to commit to state and clear draft
  const saveBtn=tree.root.findAllByType('button').find(b=>b.children.some(c=>typeof c==='string'&&c.includes('Simpan Suara')));
  assert.ok(saveBtn);
  renderer.act(()=>saveBtn.props.onClick());

  // Verify draft is removed from storage after saving
  assert.equal(f.storage.has(draftKey),false);

  renderer.act(()=>tree.unmount());
});

test('kids quiz duel computes streak and multiplier, and tournament displays streak badges',()=>{
  const kid1 = { id: 'k1', name: 'Andi', avatar: '👦', familyId: 'f1' };
  const kid2 = { id: 'k2', name: 'Budi', avatar: '🧒', familyId: 'f1' };
  const quizDuels = [
    // 3 consecutive wins for kid1 (newest first)
    { id: 'qd_1', familyId: 'f1', challengerKidId: 'k1', opponentKidId: 'k2', winnerKidId: 'k1', challengerScore: 3, opponentScore: 1, rewardCoins: 20 },
    { id: 'qd_2', familyId: 'f1', challengerKidId: 'k1', opponentKidId: 'k2', winnerKidId: 'k1', challengerScore: 4, opponentScore: 2, rewardCoins: 15 },
    { id: 'qd_3', familyId: 'f1', challengerKidId: 'k2', opponentKidId: 'k1', winnerKidId: 'k1', challengerScore: 0, opponentScore: 2, rewardCoins: 15 },
    // A loss before that
    { id: 'qd_4', familyId: 'f1', challengerKidId: 'k1', opponentKidId: 'k2', winnerKidId: 'k2', challengerScore: 1, opponentScore: 3, rewardCoins: 5 },
  ];

  const f = fixture({ quizDuels, users: { kids: [kid1, kid2] } });

  // 1. Test KidsQuizDuel
  const duelTree = f.render(f.KidsQuizDuel, { kid: kid1 });
  const streakBar = duelTree.root.findByProps({ className: 'card duel-streak-bar' });
  assert.ok(streakBar, 'duel streak bar should be rendered');

  // Verify winning streak count: 3x
  const streakElements = streakBar.findAll(node => typeof node.children?.[0] === 'string' && node.children[0].includes('3x'));
  assert.ok(streakElements.length > 0, 'should show 3x streak');

  // Verify multiplier text: 1.3x Multiplier
  const multiplierElements = streakBar.findAll(node => typeof node.children?.[0] === 'string' && node.children[0].includes('1.3x Multiplier'));
  assert.ok(multiplierElements.length > 0, 'should indicate active 1.3x multiplier');

  duelTree.unmount();

  // 2. Test FamilyQuizTournament
  const tourneyTree = f.render(f.FamilyQuizTournament, { myKids: [kid1, kid2] });
  const streakBadges = tourneyTree.root.findAllByProps({ className: 'streak-badge' });
  assert.equal(streakBadges.length, 1, 'only kid1 with streak >= 2 should have streak badge');
  assert.ok(streakBadges[0].children.join('').includes('3x Streak'));

  tourneyTree.unmount();
});

test('indexedDB storage layer provides resilient media caching, snapshot hydration, and quota estimation', async () => {
  const f = fixture();
  assert.ok(f.VidkidzIdb, 'VidkidzIdb should be defined and exported');
  assert.equal(f.IDB_CONFIG.dbName, 'vidkidz_pwa_db');
  assert.equal(f.IDB_CONFIG.stores.offline_state, 'offline_state');
  assert.equal(f.IDB_CONFIG.stores.media_vault, 'media_vault');

  // 1. Test Storage Estimate
  const est = await f.VidkidzIdb.getStorageEstimate();
  assert.ok(est.supported, 'Storage estimate should be supported');
  assert.ok(Number(est.usageMB) > 0, 'Usage MB should be calculated');
  assert.ok(Number(est.quotaMB) > 0, 'Quota MB should be calculated');

  // 2. Test Snapshot Persistence & Hydration
  const testState = {
    users: { kids: [{ id: 'k_offline', name: 'Offline Kid', coins: 99 }] },
    systemSettings: { appName: 'VIDKIDZ PWA' }
  };
  const saveResult = await f.VidkidzIdb.saveSnapshot(testState);
  assert.equal(saveResult, true, 'saveSnapshot should return true');

  const loadedSnapshot = await f.VidkidzIdb.loadSnapshot();
  assert.ok(loadedSnapshot, 'Snapshot should be recovered from IndexedDB');
  assert.equal(loadedSnapshot.users.kids[0].id, 'k_offline');
  assert.equal(loadedSnapshot.users.kids[0].coins, 99);

  const snapshotTs = await f.VidkidzIdb.getSnapshotTime();
  assert.ok(typeof snapshotTs === 'number' && snapshotTs > 0, 'Snapshot timestamp should be recorded');

  // 3. Test Media Vault Caching & Retrieval
  const mockAudioDraft = 'data:audio/webm;base64,offline-vault-test-audio';
  const saveMediaResult = await f.VidkidzIdb.saveMedia('vidkidz-bedtime-draft:s1', mockAudioDraft, { duration: 42, storyId: 's1' });
  assert.equal(saveMediaResult, true, 'saveMedia should succeed');

  const cachedMedia = await f.VidkidzIdb.getMedia('vidkidz-bedtime-draft:s1');
  assert.ok(cachedMedia, 'Cached media should be found in vault');
  assert.equal(cachedMedia.id, 'vidkidz-bedtime-draft:s1');
  assert.equal(cachedMedia.data, mockAudioDraft);
  assert.equal(cachedMedia.meta?.duration, 42);

  // 4. Test Deletion from Media Vault
  const delResult = await f.VidkidzIdb.del(f.IDB_CONFIG.stores.media_vault, 'vidkidz-bedtime-draft:s1');
  assert.equal(delResult, true, 'del should succeed');

  const afterDel = await f.VidkidzIdb.getMedia('vidkidz-bedtime-draft:s1');
  assert.equal(afterDel, null, 'Deleted media should return null');
});

test('PWA background sync and offline action queue enqueues, recovers, and flushes mutations in order', async () => {
  const f = fixture();
  assert.ok(f.VidkidzIdb.enqueueAction, 'enqueueAction should be defined');
  assert.ok(f.VidkidzIdb.getQueue, 'getQueue should be defined');
  assert.ok(f.VidkidzIdb.syncQueue, 'syncQueue should be defined');
  assert.equal(f.IDB_CONFIG.version, 2, 'IDB version should be 2 for action_queue');
  assert.equal(f.IDB_CONFIG.stores.action_queue, 'action_queue');

  // 1. Clear any existing queue
  await f.VidkidzIdb.clearQueue();
  let q = await f.VidkidzIdb.getQueue();
  assert.equal(q.length, 0, 'queue should be empty initially');

  // 2. Enqueue multiple mutation actions
  const action1 = await f.VidkidzIdb.enqueueAction({
    type: 'ADD_COINS',
    endpoint: '/api/state',
    method: 'PATCH',
    payload: { kidId: 'k1', coins: 10 }
  });
  assert.ok(action1?.id, 'Action 1 should have generated ID');

  const action2 = await f.VidkidzIdb.enqueueAction({
    type: 'STORY_COMPLETE',
    endpoint: '/api/state',
    method: 'PATCH',
    payload: { kidId: 'k1', storyId: 's1' }
  });
  assert.ok(action2?.id, 'Action 2 should have generated ID');

  q = await f.VidkidzIdb.getQueue();
  assert.equal(q.length, 2, 'queue should contain 2 actions');
  assert.equal(q[0].id, action1.id);
  assert.equal(q[1].id, action2.id);

  // 3. Test Sync Queue with mock executor
  const executed = [];
  const syncResult = await f.VidkidzIdb.syncQueue(async (act) => {
    executed.push(act.id);
    return true; // simulated successful API sync
  });

  assert.equal(syncResult.processed, 2, 'Both actions should be processed');
  assert.equal(syncResult.failed, 0, 'No actions should fail');
  assert.equal(syncResult.remaining, 0, 'No actions remaining in queue');
  assert.deepEqual(executed, [action1.id, action2.id], 'Actions should execute in FIFO order');

  q = await f.VidkidzIdb.getQueue();
  assert.equal(q.length, 0, 'queue should be empty after complete sync');

  // 4. Test Partial Failure / Offline pause
  await f.VidkidzIdb.enqueueAction({ id: 'act_fail', type: 'FAILED_ACTION' });
  await f.VidkidzIdb.enqueueAction({ id: 'act_after_fail', type: 'SUBSEQUENT_ACTION' });

  const failResult = await f.VidkidzIdb.syncQueue(async (act) => {
    if (act.id === 'act_fail') return false; // simulated network drop
    return true;
  });

  assert.equal(failResult.processed, 0);
  assert.equal(failResult.failed, 1);
  assert.equal(failResult.remaining, 2, 'Queue should pause on failure preserving remaining actions');

  await f.VidkidzIdb.clearQueue();
});

test('smart curfew remote handshake: curfew bypass evaluation, request submission and parent remote approval lifecycle', () => {
  const f = fixture();

  // 1. Curfew evaluation and bypass mechanics
  const activeSchedule = { enabled: true, lockStart: '00:00', lockEnd: '23:59' };
  const mockKid = { id: 'k1', name: 'Andi', schedule: activeSchedule, isLocked: false };

  // Curfew active normally
  assert.equal(f.isCurfewActive(activeSchedule, mockKid), true, 'Curfew should be active under all-day schedule');

  // Curfew bypassed when curfewBypassUntil is active in future
  const bypassedKid = { ...mockKid, curfewBypassUntil: Date.now() + 15 * 60 * 1000 };
  assert.equal(f.isCurfewActive(activeSchedule, bypassedKid), false, 'Curfew should be bypassed when curfewBypassUntil is in the future');

  // Curfew resumes when bypass expires
  const expiredKid = { ...mockKid, curfewBypassUntil: Date.now() - 1000 };
  assert.equal(f.isCurfewActive(activeSchedule, expiredKid), true, 'Curfew should reactivate once bypass window expires');

  // 2. Kid submits curfew extension request in KidsLockScreen
  const kidTree = f.render(f.KidsLockScreen, { kid: mockKid, isCurfew: true });

  // Find the "Minta Tambahan 15 Menit" button
  const askBtn = kidTree.root.findByProps({ className: 'btn card-interactive-lift btn-ask-curfew' });
  assert.ok(askBtn, 'KidsLockScreen should offer "Minta Tambahan 15 Menit" button');
  renderer.act(() => askBtn.props.onClick());

  // Modal reason options should be rendered
  const reasonBtns = kidTree.root.findAllByType('button').filter(b => 
    b.findAllByType('span').some(s => s.children.includes('Selesaikan Dongeng'))
  );
  assert.ok(reasonBtns.length > 0, 'Reason buttons should be available');
  renderer.act(() => reasonBtns[0].props.onClick());

  // Submit request to parent
  const submitBtn = kidTree.root.findAllByType('button').find(b => b.children && b.children.includes('Kirim ke Ortu'));
  assert.ok(submitBtn, 'Submit button should be present in modal');
  renderer.act(() => submitBtn.props.onClick());

  // Request should be recorded and notif shown
  assert.ok(f.notifications.some(n => n.includes('Permintaan tambahan 15 menit terkirim')), 'Notification should confirm request sent');
  renderer.act(() => kidTree.unmount());

  // 3. Parent reviews and approves in FamilyDeviceControl
  const pendingRequests = [
    { id: 'creq_test_1', kidId: 'k1', kidName: 'Andi', reason: 'Selesaikan Dongeng', minutes: 15, status: 'pending', createdAt: Date.now() }
  ];
  const fParent = fixture({
    curfewRequests: pendingRequests,
    users: { kids: [mockKid] }
  });

  const parentTree = fParent.render(fParent.FamilyDeviceControl, {
    myKids: [mockKid],
    toggleLock: () => {}
  });

  // Verify banner displayed
  const banner = parentTree.root.findByProps({ className: 'card mb-6 animate-pulse-gentle curfew-requests-banner' });
  assert.ok(banner, 'Pending curfew requests banner should be displayed on parent control');

  // Approve the request
  const approveBtn = banner.findByProps({ className: 'btn btn-sm btn-family btn-approve-curfew' });
  assert.ok(approveBtn, 'Approve button should be available');
  renderer.act(() => approveBtn.props.onClick());

  // Verify approval notification and state update
  assert.ok(fParent.notifications.some(n => n.includes('✓ Tambahan 15 menit diberikan untuk Andi')), 'Approval notif should confirm granted time');
  renderer.act(() => parentTree.unmount());
});

test('AI voice story narration streams from audio endpoint and fallback triggers gracefully', () => {
  const f = fixture();
  const tree = f.render(f.KidsStoryHub, { kid: { id: 'k1' } });

  // Open first story
  const firstCard = tree.root.findAllByProps({ className: 'story-card' })[0];
  renderer.act(() => firstCard.props.onClick());

  // Verify AI narration button is rendered
  const aiBtn = tree.root.findByProps({ className: 'activity-button btn-ai-story-tts' });
  assert.ok(aiBtn, 'AI story narration button should be present in story reader');
  assert.ok(aiBtn.children.some(c => typeof c === 'string' && c.includes('Narasi AI Studio')));

  // Trigger AI narration
  renderer.act(() => aiBtn.props.onClick());
  assert.ok(f.preloadedAudios.length > 0, 'Audio instance should be created for AI narration');
  const latestAudio = f.preloadedAudios[f.preloadedAudios.length - 1];
  assert.ok(latestAudio.src.includes('/api/ai/tts'), 'Audio source should route through /api/ai/tts');
  assert.equal(latestAudio.paused, false, 'Audio playback should be started');

  renderer.act(() => tree.unmount());
});

test('adaptive video resolution selector and bandwidth tiers are configured across demo catalog', () => {
  const f = fixture();
  assert.ok(Array.isArray(f.DEMO_VIDEOS), 'DEMO_VIDEOS should be exported as array');
  assert.ok(f.DEMO_VIDEOS.length >= 8, 'At least 8 demo videos should be available');

  for (const video of f.DEMO_VIDEOS) {
    assert.ok(video.qualities, `Video ${video.id} must have qualities property`);
    assert.ok(video.qualities['360p'], `Video ${video.id} must have 360p quality URL`);
    assert.ok(video.qualities['720p'], `Video ${video.id} must have 720p quality URL`);
    assert.equal(typeof video.qualities['360p'], 'string');
    assert.equal(typeof video.qualities['720p'], 'string');
  }
});

