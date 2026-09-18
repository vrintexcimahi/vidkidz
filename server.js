require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vidkidz-secret-change-in-prod';
const JWT_EXPIRES = '30d';
const APP_VERSION = process.env.APP_VERSION || '5.2.18';
const ASSET_VERSION = 'v33';
const ADMIN_LOGIN_ENABLED = process.env.ALLOW_ADMIN_LOGIN === 'true';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DEMO_DURATION_MS = 30 * 60 * 1000;
const DEMO_FAMILY_EMAILS = new Set(['budi@vidkidz.local', 'siti@vidkidz.local']);
const DEMO_KID_IDS = new Set(['k1', 'k2', 'k3']);
const DATA_DIR = process.env.VERCEL ? path.join(os.tmpdir(), 'vidkidz-data') : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const STATE_FILE = path.join(DATA_DIR, 'vidkidz-state.json');
let stateCache = null;
let stateUpdatedAt = 0;

// ─── Seed initial state ──────────────────────────────────────────────────────
const INITIAL_STATE = {
  users: {
    admins: [
      { id:'a1', name:'Super Admin', email:'admin@vidkidz.local', password:'admin123', createdAt: Date.now()-86400000*30, lastLogin: Date.now()-3600000 }
    ],
    families: [
      { id:'f1', name:'Keluarga Budi Santoso', email:'budi@vidkidz.local', password:'family123', linkedKids:['k1','k2'], plan:'Premium', createdAt: Date.now()-86400000*20, lastLogin: Date.now()-7200000, phone:'0812-3456-7890' },
      { id:'f2', name:'Keluarga Siti Rahma', email:'siti@vidkidz.local', password:'family456', linkedKids:['k3'], plan:'Basic', createdAt: Date.now()-86400000*10, lastLogin: Date.now()-86400000, phone:'0821-9876-5432' },
    ],
    kids: [
      { id:'k1', name:'Andi', age:7, familyId:'f1', avatar:'👦', isLocked:false, allowedAlbums:['alb1','alb2'], isOnline:true, lastSeen:Date.now()-600000, lockPin:'1234', watchTime:142, totalVideos:28, coins:85, streak:3, badges:['bintang_pertama','rajin_belajar'], hafalanDone:['h1','h2','h6'], gameStats:{math:{played:12,correct:9},hewan:{played:8,correct:7},tanaman:{played:5,correct:4},warna:{played:6,correct:5}} },
      { id:'k2', name:'Sari', age:5, familyId:'f1', avatar:'👧', isLocked:false, allowedAlbums:['alb1'], isOnline:false, lastSeen:Date.now()-3600000*3, lockPin:'5678', watchTime:89, totalVideos:15, coins:40, streak:1, badges:['bintang_pertama'], hafalanDone:['h6','h7'], gameStats:{math:{played:5,correct:3},hewan:{played:3,correct:2},tanaman:{played:2,correct:2},warna:{played:4,correct:3}} },
      { id:'k3', name:'Doni', age:9, familyId:'f2', avatar:'👦', isLocked:true, allowedAlbums:['alb1','alb2','alb3'], isOnline:true, lastSeen:Date.now()-1800000, lockPin:'9012', watchTime:210, totalVideos:42, coins:160, streak:7, badges:['bintang_pertama','rajin_belajar','hafalan_hero','game_master'], hafalanDone:['h1','h2','h3','h4','h5','h6','h7','h8'], gameStats:{math:{played:30,correct:26},hewan:{played:20,correct:18},tanaman:{played:15,correct:13},warna:{played:12,correct:11}} },
    ]
  },
  albums: [
    { id:'alb1', name:'Alfabet & Huruf', emoji:'🔤', videos:['v1','v5'], createdBy:'f1', color:'#818cf8' },
    { id:'alb2', name:'Matematika Dasar', emoji:'🔢', videos:['v2','v6','v8'], createdBy:'f1', color:'#10b981' },
    { id:'alb3', name:'Alam & Hewan', emoji:'🐾', videos:['v4','v7'], createdBy:'f2', color:'#f59e0b' },
    { id:'alb4', name:'Musik & Kreativitas', emoji:'🎵', videos:['v3','v5'], createdBy:'f1', color:'#f43f5e' },
  ],
  photoAlbums: [
    {
      id:'pa1',
      familyId:'f1',
      name:'Momen Keluarga',
      description:'Kenangan hangat bersama keluarga',
      cover:'#0aa7e5',
      createdAt:Date.now()-86400000*5,
      photos:[
        { id:'ph1', title:'Piknik Minggu Pagi', caption:'Belajar sambil bermain di taman', color:'#0aa7e5', emoji:'🌤️', createdAt:Date.now()-86400000*4 },
        { id:'ph2', title:'Hadiah Hafalan', caption:'Andi dapat bintang pertama', color:'#f2527b', emoji:'⭐', createdAt:Date.now()-86400000*3 },
        { id:'ph3', title:'Belajar Bersama', caption:'Sesi membaca sebelum tidur', color:'#16c6a3', emoji:'📚', createdAt:Date.now()-86400000*2 },
      ]
    },
    {
      id:'pa2',
      familyId:'f2',
      name:'Kenangan Doni',
      description:'Album momen belajar dan bermain',
      cover:'#ffb92f',
      createdAt:Date.now()-86400000*7,
      photos:[
        { id:'ph4', title:'Hari Game Edukatif', caption:'Doni menyelesaikan tantangan matematika', color:'#ffb92f', emoji:'🎮', createdAt:Date.now()-86400000*6 },
      ]
    }
  ],
  rewards: [
    { id:'r1', familyId:'f1', name:'Uang Jajan Rp 5.000', emoji:'💵', cost:100, type:'money', active:true },
    { id:'r2', familyId:'f1', name:'Es Krim Favorit', emoji:'🍦', cost:80, type:'treat', active:true },
    { id:'r3', familyId:'f1', name:'Mainan Pilihan', emoji:'🧸', cost:300, type:'toy', active:true },
    { id:'r4', familyId:'f1', name:'Nonton Film Bioskop', emoji:'🎬', cost:500, type:'experience', active:true },
    { id:'r5', familyId:'f2', name:'Uang Jajan Rp 2.000', emoji:'💵', cost:50, type:'money', active:true },
    { id:'r6', familyId:'f2', name:'Stiker Keren', emoji:'⭐', cost:30, type:'treat', active:true },
  ],
  redemptions: [
    { id:'red1', kidId:'k3', rewardId:'r5', status:'pending', requestedAt:Date.now()-3600000, kidName:'Doni', rewardName:'Uang Jajan Rp 2.000', cost:50 },
  ],
  hafalanRecords: [
    { id:'rec1', kidId:'k1', hafalanId:'h1', recordedAt:Date.now()-86400000*2, duration:45, approved:true },
    { id:'rec2', kidId:'k1', hafalanId:'h2', recordedAt:Date.now()-86400000, duration:30, approved:true },
  ],
  activityLog: [
    { id:'log1', ts:Date.now()-300000, user:'Andi', action:'Bermain Matematika Seru — skor 9/12', type:'game' },
    { id:'log2', ts:Date.now()-600000, user:'Budi Santoso', action:'Mengunci layar Andi', type:'lock' },
    { id:'log3', ts:Date.now()-3600000, user:'Sari', action:'Hafalan Al-Fatihah selesai', type:'hafalan' },
    { id:'log4', ts:Date.now()-7200000, user:'Doni', action:'Menukar 50 koin → Uang Jajan Rp 2.000', type:'coin' },
    { id:'log5', ts:Date.now()-86400000, user:'Andi', action:'Menonton video "Mengenal Huruf A"', type:'watch' },
    { id:'log6', ts:Date.now()-86400000*2, user:'Admin', action:'Menambah user keluarga baru', type:'admin' },
  ],
  systemSettings: {
    siteName: 'VIDKIDZ',
    maxKidsPerFamily: 5,
    maxAlbumsPerFamily: 10,
    aiAnalysisEnabled: true,
    gpsEnabled: true,
    cameraMonitorEnabled: true,
    maintenanceMode: false,
    registrationOpen: true,
    apiKey: '',
    dailyLoginBonus: 10,
    videoWatchReward: 2,
    gameCorrectReward: 5,
    hafalanReward: 20,
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getState() {
  if (stateCache) return stateCache;

  if (!fs.existsSync(STATE_FILE)) {
    saveState(INITIAL_STATE);
    console.log('✅ State VIDKIDZ dibuat dengan data awal');
    return stateCache;
  }

  try {
    const persisted = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    stateUpdatedAt = persisted.updatedAt || Date.now();
    stateCache = persisted.state || persisted;
  } catch (err) {
    console.error('State file read error, restoring initial state:', err);
    saveState(INITIAL_STATE);
    return stateCache;
  }

  // Ensure collections exist
  if (!stateCache.users) stateCache.users = { admins: [], families: [], kids: [] };
  if (!Array.isArray(stateCache.users.admins)) stateCache.users.admins = INITIAL_STATE.users.admins;
  if (!Array.isArray(stateCache.users.families)) stateCache.users.families = INITIAL_STATE.users.families;
  if (!Array.isArray(stateCache.users.kids)) stateCache.users.kids = INITIAL_STATE.users.kids;
  if (!Array.isArray(stateCache.albums)) stateCache.albums = INITIAL_STATE.albums;
  if (!Array.isArray(stateCache.photoAlbums)) stateCache.photoAlbums = INITIAL_STATE.photoAlbums;
  if (!Array.isArray(stateCache.rewards)) stateCache.rewards = INITIAL_STATE.rewards;
  if (!Array.isArray(stateCache.redemptions)) stateCache.redemptions = INITIAL_STATE.redemptions;
  if (!Array.isArray(stateCache.hafalanRecords)) stateCache.hafalanRecords = INITIAL_STATE.hafalanRecords;
  if (!Array.isArray(stateCache.activityLog)) stateCache.activityLog = INITIAL_STATE.activityLog;
  if (!stateCache.systemSettings) stateCache.systemSettings = INITIAL_STATE.systemSettings;

  // Auto-repair any legacy corrupted ?? emojis
  const kidAvatars = { k1: '👦', k2: '👧', k3: '👦' };
  stateCache.users.kids.forEach(k => {
    if (k.avatar === '??' && kidAvatars[k.id]) k.avatar = kidAvatars[k.id];
  });
  const albumEmojis = { alb1: '🔤', alb2: '🔢', alb3: '🐾', alb4: '🎵' };
  stateCache.albums.forEach(a => {
    if (a.emoji === '??' && albumEmojis[a.id]) a.emoji = albumEmojis[a.id];
  });
  const rewardEmojis = { r1: '💵', r2: '🍦', r3: '🧸', r4: '🎬', r5: '💵', r6: '⭐' };
  stateCache.rewards.forEach(r => {
    if ((r.emoji === '??' || r.emoji === '?') && rewardEmojis[r.id]) r.emoji = rewardEmojis[r.id];
  });

  return stateCache;
}

function saveState(state) {
  stateCache = state;
  stateUpdatedAt = Date.now();
  const jsonStr = JSON.stringify({ updatedAt: stateUpdatedAt, state }, null, 2);
  const tmpFile = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpFile, jsonStr, 'utf8');
    try {
      fs.renameSync(tmpFile, STATE_FILE);
    } catch (e) {
      fs.writeFileSync(STATE_FILE, jsonStr, 'utf8');
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
  } catch (err) {
    fs.writeFileSync(STATE_FILE, jsonStr, 'utf8');
  }
}

function sanitizeStateForUser(state, user) {
  const clean = JSON.parse(JSON.stringify(state));
  if (user?.role !== 'admin') {
    if (clean.users?.admins) {
      clean.users.admins = clean.users.admins.map(a => {
        const { password, ...rest } = a;
        return rest;
      });
    }
    if (clean.users?.families) {
      clean.users.families = clean.users.families.map(f => {
        const { password, ...rest } = f;
        return rest;
      });
    }
    if (clean.systemSettings) {
      clean.systemSettings.apiKey = '';
    }
  }
  return clean;
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDemoMeta(role, idOrEmail) {
  const key = String(idOrEmail || '').trim().toLowerCase();
  const isDemo = role === 'family' ? DEMO_FAMILY_EMAILS.has(key) :
    role === 'kids' ? DEMO_KID_IDS.has(key) :
    false;
  return isDemo ? { demo: true, demoExpiresAt: Date.now() + DEMO_DURATION_MS } : { demo: false };
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token tidak ditemukan' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    if (req.user.demo && req.user.demoExpiresAt && Date.now() > req.user.demoExpiresAt) {
      return res.status(401).json({ error: 'Sesi demo sudah habis' });
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token tidak valid atau sudah kadaluarsa' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Hanya admin yang bisa mengakses ini' });
  }
  next();
}

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath).toLowerCase();
    if (fileName === 'index.html' || fileName === 'sw.js') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return;
    }
    if (fileName === 'manifest.webmanifest') {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      return;
    }
    if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.woff', '.woff2'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
}));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────

// GET /api/auth/config
app.get('/api/auth/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID
  });
});

app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({
    version: APP_VERSION,
    assetVersion: ASSET_VERSION,
    buildId: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || 'local',
    timestamp: Date.now()
  });
});

app.post('/api/auth/send-otp', (req, res) => {
  const method = String(req.body.method || 'email').trim().toLowerCase();
  const target = String(req.body.target || '').trim();
  if (!['email', 'phone'].includes(method)) {
    return res.status(400).json({ error: 'Metode OTP tidak valid' });
  }
  if (!target) {
    return res.status(400).json({ error: method === 'phone' ? 'Nomor telepon diperlukan' : 'Email diperlukan' });
  }
  if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    return res.status(400).json({ error: 'Format email tidak valid' });
  }
  if (method === 'phone' && target.replace(/\D/g, '').length < 8) {
    return res.status(400).json({ error: 'Nomor telepon tidak valid' });
  }
  res.json({ ok: true, otp: '123456', message: 'Kode OTP lokal: 123456' });
});

app.post('/api/auth/register', (req, res) => {
  const state = getState();
  if (state.systemSettings?.registrationOpen === false) {
    return res.status(403).json({ error: 'Registrasi sedang ditutup' });
  }

  const method = String(req.body.method || 'email').trim().toLowerCase();
  const rawEmail = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '').trim();
  const otp = String(req.body.otp || '').trim();
  const referralCode = String(req.body.referralCode || '').trim();
  const acceptedTerms = !!req.body.acceptedTerms;

  if (!['email', 'phone'].includes(method)) {
    return res.status(400).json({ error: 'Metode daftar tidak valid' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }
  if (otp !== '123456') {
    return res.status(400).json({ error: 'Kode OTP tidak valid. Untuk lokal gunakan 123456' });
  }
  if (!acceptedTerms) {
    return res.status(400).json({ error: 'Setujui perjanjian pengguna dan kebijakan privasi' });
  }

  const digits = phone.replace(/\D/g, '');
  const email = method === 'email' ? rawEmail : `${digits}@phone.vidkidz.local`;
  if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Format email tidak valid' });
  }
  if (method === 'phone' && digits.length < 8) {
    return res.status(400).json({ error: 'Nomor telepon tidak valid' });
  }

  const exists = state.users.families.some(u =>
    u.email.toLowerCase() === email ||
    (phone && String(u.phone || '').replace(/\D/g, '') === digits)
  );
  if (exists) {
    return res.status(409).json({ error: 'Akun sudah terdaftar' });
  }

  const nameSeed = method === 'email' ? email.split('@')[0] : `Telepon ${digits.slice(-4)}`;
  const family = {
    id: makeId('f'),
    name: `Keluarga ${nameSeed}`,
    email,
    password: bcrypt.hashSync(password, 10),
    linkedKids: [],
    plan: 'Basic',
    createdAt: Date.now(),
    lastLogin: Date.now(),
    phone: method === 'phone' ? phone : '',
    authProvider: method,
    referralCode
  };

  state.users.families.push(family);
  state.activityLog.unshift({
    id: makeId('log'),
    ts: Date.now(),
    user: family.name,
    action: `Mendaftar akun Family via ${method === 'phone' ? 'telepon' : 'email'}`,
    type: 'admin'
  });
  saveState(state);

  const token = signToken({ id: family.id, role: 'family', name: family.name });
  const { password: _, ...safeFamily } = family;
  res.status(201).json({ token, user: { ...safeFamily, role: 'family' }, role: 'family', isNew: true });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const emailInput = String(req.body.email || '').trim();
  const passwordInput = String(req.body.password || '').trim();
  const role = req.body.role;
  if (!emailInput || !passwordInput) {
    return res.status(400).json({ error: 'Email/ID dan password/PIN diperlukan' });
  }

  const verifyPass = (userPass, inputPass) => {
    if (!userPass || !inputPass) return false;
    if (userPass.startsWith('$2a$') || userPass.startsWith('$2b$')) {
      try { return bcrypt.compareSync(inputPass, userPass); } catch (e) { return false; }
    }
    return userPass === inputPass;
  };

  const state = getState();
  const { admins, families, kids } = state.users;
  const requestedRole = role || '';
  const allowedRoles = ADMIN_LOGIN_ENABLED ? ['admin', 'family', 'kids', ''] : ['family', 'kids', ''];
  if (!allowedRoles.includes(requestedRole)) {
    return res.status(400).json({ error: 'Tipe akun tidak valid' });
  }

  // 1. Check admin
  if (ADMIN_LOGIN_ENABLED && (requestedRole === 'admin' || !requestedRole)) {
    const admin = admins.find(u => u.email.toLowerCase() === emailInput.toLowerCase() && verifyPass(u.password, passwordInput));
    if (admin) {
      admin.lastLogin = Date.now();
      saveState(state);
      const token = signToken({ id: admin.id, role: 'admin', name: admin.name });
      const { password, ...safeAdmin } = admin;
      return res.json({ token, user: { ...safeAdmin, role: 'admin' }, role: 'admin' });
    }
  }

  // 2. Check family
  if (requestedRole === 'family' || !requestedRole) {
    const normalizedPhone = emailInput.replace(/\D/g, '');
    const family = families.find(u =>
      (u.email.toLowerCase() === emailInput.toLowerCase() ||
        (normalizedPhone && String(u.phone || '').replace(/\D/g, '') === normalizedPhone)) &&
      verifyPass(u.password, passwordInput)
    );
    if (family) {
      family.lastLogin = Date.now();
      saveState(state);
      const demoMeta = getDemoMeta('family', family.email);
      const token = signToken({ id: family.id, role: 'family', name: family.name, ...demoMeta });
      const { password, ...safeFamily } = family;
      return res.json({ token, user: { ...safeFamily, role: 'family', demoAccess: demoMeta.demo, demoExpiresAt: demoMeta.demoExpiresAt }, role: 'family', ...demoMeta });
    }
  }

  // 3. Check kids (by kid ID like 'k1' or name, and PIN like '1234')
  if (requestedRole === 'kids' || requestedRole === 'family' || !requestedRole) {
    const kid = (kids || []).find(k =>
      (k.id.toLowerCase() === emailInput.toLowerCase() || k.name.toLowerCase() === emailInput.toLowerCase()) &&
      String(k.lockPin) === passwordInput
    );
    if (kid) {
      kid.isOnline = true;
      kid.lastSeen = Date.now();
      saveState(state);
      const demoMeta = getDemoMeta('kids', kid.id);
      const token = signToken({ id: kid.id, role: 'kids', name: kid.name, familyId: kid.familyId, ...demoMeta });
      return res.json({ token, user: { ...kid, role: 'kids', demoAccess: demoMeta.demo, demoExpiresAt: demoMeta.demoExpiresAt }, role: 'kids', kidId: kid.id, ...demoMeta });
    }
  }

  return res.status(401).json({ error: 'Email/ID atau password/PIN salah' });
});

app.post('/api/auth/kids-session', authMiddleware, (req, res) => {
  if (req.user.role !== 'family') {
    return res.status(403).json({ error: 'Akses Kids hanya bisa dibuka dari dashboard Family' });
  }
  const kidId = String(req.body.kidId || '').trim();
  if (!kidId) return res.status(400).json({ error: 'kidId diperlukan' });

  const state = getState();
  const family = state.users.families.find(f => f.id === req.user.id);
  const kid = state.users.kids.find(k => k.id === kidId && family?.linkedKids?.includes(k.id));
  if (!family || !kid) {
    return res.status(404).json({ error: 'Akun anak tidak ditemukan untuk keluarga ini' });
  }

  kid.isOnline = true;
  kid.lastSeen = Date.now();
  saveState(state);
  const demoMeta = getDemoMeta('kids', kid.id);
  const token = signToken({ id: kid.id, role: 'kids', name: kid.name, familyId: kid.familyId, ...demoMeta });
  return res.json({ token, user: { ...kid, role: 'kids', demoAccess: demoMeta.demo, demoExpiresAt: demoMeta.demoExpiresAt }, role: 'kids', kidId: kid.id, ...demoMeta });
});

// POST /api/auth/google — daftar/login akun Family lewat Google
app.post('/api/auth/google', async (req, res) => {
  const { accessToken } = req.body;
  if (!GOOGLE_CLIENT_ID) {
    return res.status(400).json({ error: 'GOOGLE_CLIENT_ID belum dikonfigurasi di server' });
  }
  if (!accessToken) {
    return res.status(400).json({ error: 'Token Google tidak ditemukan' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const profile = await googleRes.json();
    if (!googleRes.ok || !profile.email) {
      return res.status(401).json({ error: 'Token Google tidak valid' });
    }

    const state = getState();
    let family = state.users.families.find(f => f.email.toLowerCase() === profile.email.toLowerCase());
    if (!family) {
      const displayName = profile.name || profile.email.split('@')[0];
      family = {
        id: makeId('f'),
        name: displayName.startsWith('Keluarga ') ? displayName : `Keluarga ${displayName}`,
        email: profile.email,
        password: '',
        authProvider: 'google',
        googleSub: profile.sub || '',
        photoUrl: profile.picture || '',
        linkedKids: [],
        plan: 'Basic',
        createdAt: Date.now(),
        lastLogin: Date.now(),
        phone: ''
      };
      state.users.families.push(family);
      state.activityLog.unshift({
        id: makeId('log'),
        ts: Date.now(),
        user: family.name,
        action: 'Mendaftar akun Family lewat Google',
        type: 'admin'
      });
    } else {
      family.lastLogin = Date.now();
      family.authProvider = family.authProvider || 'google';
      family.googleSub = family.googleSub || profile.sub || '';
      family.photoUrl = profile.picture || family.photoUrl || '';
    }

    saveState(state);
    const token = signToken({ id: family.id, role: 'family', name: family.name });
    return res.json({ token, user: { ...family, role: 'family' }, role: 'family', isNew: !family.linkedKids.length });
  } catch (err) {
    console.error('Google auth error:', err);
    return res.status(500).json({ error: 'Gagal menghubungi Google Auth: ' + err.message });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  if (req.user.role === 'kids') {
    const state = getState();
    const kid = state.users.kids.find(k => k.id === req.user.id);
    if (kid) { kid.isOnline = false; kid.lastSeen = Date.now(); saveState(state); }
  }
  res.json({ success: true });
});

// ── STATE ROUTES ──────────────────────────────────────────────────────────────

// GET /api/state — full state (sanitized for non-admin)
app.get('/api/state', authMiddleware, (req, res) => {
  const state = getState();
  res.json(sanitizeStateForUser(state, req.user));
});

// PUT /api/state — replace full state (admin only)
app.put('/api/state', authMiddleware, adminOnly, (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: 'Akun demo hanya bisa melihat data' });
  const newState = req.body;
  if (!newState || !newState.users) {
    return res.status(400).json({ error: 'State tidak valid' });
  }
  saveState(newState);
  res.json({ success: true });
});

// PATCH /api/state — partial state update (family/kids can call for their own data)
app.patch('/api/state', authMiddleware, (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: 'Akun demo hanya bisa melihat data' });
  const { path: statePath, value } = req.body;
  const state = getState();
  const incoming = req.body.state;

  // Frontend autosave sends a scoped full-state snapshot. Merge only the
  // records the current role owns, then return before path-based handling.
  if (incoming) {
    if (req.user.role === 'admin') {
      Object.assign(state, incoming);
    } else if (req.user.role === 'family') {
      // 1. Photo albums: family only owns albums matching their familyId
      if (Array.isArray(incoming.photoAlbums)) {
        const otherPhotoAlbums = (state.photoAlbums || []).filter(pa => pa.familyId !== req.user.id);
        const myPhotoAlbums = incoming.photoAlbums.filter(pa => pa.familyId === req.user.id);
        state.photoAlbums = [...otherPhotoAlbums, ...myPhotoAlbums];
      }

      // 2. Rewards: family only owns rewards matching their familyId
      if (Array.isArray(incoming.rewards)) {
        const otherRewards = (state.rewards || []).filter(r => r.familyId !== req.user.id);
        const myRewards = incoming.rewards.filter(r => r.familyId === req.user.id);
        state.rewards = [...otherRewards, ...myRewards];
      }

      // 3. Redemptions: family only owns redemptions of kids belonging to this family
      const myKidIds = new Set((state.users.kids || []).filter(k => k.familyId === req.user.id).map(k => k.id));
      if (Array.isArray(incoming.redemptions)) {
        const otherRedemptions = (state.redemptions || []).filter(r => !myKidIds.has(r.kidId));
        const myRedemptions = incoming.redemptions.filter(r => myKidIds.has(r.kidId));
        state.redemptions = [...otherRedemptions, ...myRedemptions];
      }

      // 4. Albums: preserve albums created by other families or system
      if (Array.isArray(incoming.albums)) {
        const otherAlbums = (state.albums || []).filter(a => a.createdBy && a.createdBy !== req.user.id);
        const myAlbums = incoming.albums.filter(a => !a.createdBy || a.createdBy === req.user.id);
        state.albums = [...otherAlbums, ...myAlbums];
      }

      // 5. Kids: Family owns child management for their own kids
      if (Array.isArray(incoming.users?.kids)) {
        const incomingOwnKids = incoming.users.kids.filter(k => k.familyId === req.user.id);
        const incomingOwnIds = new Set(incomingOwnKids.map(k => k.id));
        state.users.kids = (state.users.kids || []).filter(k => k.familyId !== req.user.id || incomingOwnIds.has(k.id));
        incomingOwnKids.forEach(inKid => {
          const idx = state.users.kids.findIndex(k => k.id === inKid.id && k.familyId === req.user.id);
          if (idx >= 0) state.users.kids[idx] = inKid;
          else state.users.kids.push(inKid);
        });
        const fam = state.users.families.find(f => f.id === req.user.id);
        if (fam) fam.linkedKids = [...incomingOwnIds];
      }

      // 6. Family record: preserve password and synced linkedKids
      const famIdx = (state.users.families || []).findIndex(f => f.id === req.user.id);
      if (famIdx >= 0 && Array.isArray(incoming.users?.families)) {
        const inFam = incoming.users.families.find(f => f.id === req.user.id);
        if (inFam) {
          state.users.families[famIdx] = {
            ...inFam,
            linkedKids: state.users.families[famIdx].linkedKids || inFam.linkedKids || [],
            password: inFam.password || state.users.families[famIdx].password
          };
        }
      }

      // 7. Activity Log: merge without overwriting other families' logs
      if (Array.isArray(incoming.activityLog)) {
        const existingIds = new Set((state.activityLog || []).map(l => l.id));
        const newLogs = incoming.activityLog.filter(l => !existingIds.has(l.id));
        state.activityLog = [...newLogs, ...(state.activityLog || [])].slice(0, 300);
      }

      // 8. Hafalan records: family manages records of their own kids
      if (Array.isArray(incoming.hafalanRecords)) {
        const otherRecords = (state.hafalanRecords || []).filter(r => !myKidIds.has(r.kidId));
        const myRecords = incoming.hafalanRecords.filter(r => myKidIds.has(r.kidId));
        state.hafalanRecords = [...otherRecords, ...myRecords];
      }
    } else if (req.user.role === 'kids') {
      // Kids can only update their own record, hafalan, redemptions, and logs
      const kidIdx = (state.users.kids || []).findIndex(k => k.id === req.user.id);
      if (kidIdx >= 0 && Array.isArray(incoming.users?.kids)) {
        const inKid = incoming.users.kids.find(k => k.id === req.user.id);
        if (inKid) {
          const existing = state.users.kids[kidIdx];
          state.users.kids[kidIdx] = {
            ...inKid,
            id: req.user.id,
            familyId: existing.familyId,
            lockPin: existing.lockPin,
            allowedAlbums: existing.allowedAlbums,
            isLocked: existing.isLocked && inKid.isLocked === false
              ? (inKid.unlockPin === existing.lockPin || inKid.lockPin === existing.lockPin ? false : true)
              : (inKid.isLocked ?? existing.isLocked)
          };
        }
      }
      if (Array.isArray(incoming.hafalanRecords)) {
        const otherRecords = (state.hafalanRecords || []).filter(r => r.kidId !== req.user.id);
        const myRecords = incoming.hafalanRecords.filter(r => r.kidId === req.user.id);
        state.hafalanRecords = [...otherRecords, ...myRecords];
      }
      if (Array.isArray(incoming.redemptions)) {
        const otherRedemptions = (state.redemptions || []).filter(r => r.kidId !== req.user.id);
        const myRedemptions = incoming.redemptions.filter(r => r.kidId === req.user.id);
        state.redemptions = [...otherRedemptions, ...myRedemptions];
      }
      if (Array.isArray(incoming.activityLog)) {
        const existingIds = new Set((state.activityLog || []).map(l => l.id));
        const newLogs = incoming.activityLog.filter(l => !existingIds.has(l.id));
        state.activityLog = [...newLogs, ...(state.activityLog || [])].slice(0, 300);
      }
    }
    saveState(state);
    return res.json({ success: true });
  }

  if (!statePath) return res.status(400).json({ error: 'path diperlukan' });

  // Family and kids can only update their specific allowed paths
  const allowed = req.user.role === 'admin' ? true :
    req.user.role === 'family' ? statePath.startsWith(`users.families.${req.user.id}`) ||
      statePath.startsWith('albums') || statePath.startsWith('photoAlbums') || statePath.startsWith('rewards') ||
      statePath.startsWith('redemptions') || statePath.startsWith('activityLog') ||
      statePath.startsWith('hafalanRecords') ||
      statePath.startsWith(`users.kids`) :
    req.user.role === 'kids' ? statePath.startsWith(`users.kids.${req.user.id}`) ||
      statePath.startsWith('activityLog') || statePath.startsWith('hafalanRecords') ||
      statePath.startsWith('redemptions') :
    false;

  if (!allowed) return res.status(403).json({ error: 'Akses update state ditolak' });

  // Apply path-based update
  const parts = statePath.split('.');
  let target = state;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (Array.isArray(target)) {
      if (/^\d+$/.test(p)) {
        target = target[parseInt(p, 10)];
      } else {
        const found = target.find(item => item && item.id === p);
        if (found) target = found;
        else { target[p] = {}; target = target[p]; }
      }
    } else {
      if (target[p] === undefined || target[p] === null) target[p] = {};
      target = target[p];
    }
  }
  const lastKey = parts[parts.length - 1];
  if (Array.isArray(target) && !/^\d+$/.test(lastKey)) {
    const item = target.find(x => x && x.id === lastKey);
    if (item) Object.assign(item, value);
    else target.push(value);
  } else {
    target[lastKey] = value;
  }
  saveState(state);
  return res.json({ success: true });
});

// ── AI PROXY ROUTE ────────────────────────────────────────────────────────────

// POST /api/ai/analyze — proxy Anthropic Vision API
app.post('/api/ai/analyze', authMiddleware, async (req, res) => {
  if (req.user.demo) return res.status(403).json({ error: 'AI Analisis tidak tersedia untuk akun demo' });
  const { imageBase64, prompt, apiKey: clientKey } = req.body;
  const state = getState();
  const key = process.env.ANTHROPIC_API_KEY || state.systemSettings.apiKey || clientKey;

  if (!key) {
    return res.status(400).json({ error: 'API Key Anthropic belum dikonfigurasi. Set di System Settings atau env ANTHROPIC_API_KEY.' });
  }
  if (!imageBase64) {
    return res.status(400).json({ error: 'imageBase64 diperlukan' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt || 'Kamu adalah asisten analisis kondisi anak untuk orang tua. Analisis gambar dan beri laporan dalam Bahasa Indonesia. Respons HANYA dalam JSON: {"kondisi":"...","postur":"...","lingkungan":"...","rekomendasi":"...","skor_perhatian":7}' }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'AI API error' });
    }
    res.json(data);
  } catch (err) {
    console.error('AI Proxy error:', err);
    res.status(500).json({ error: 'Gagal menghubungi Anthropic API: ' + err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  getState();
  res.json({
    status: 'ok',
    version: APP_VERSION,
    assetVersion: ASSET_VERSION,
    lastStateUpdate: stateUpdatedAt,
    timestamp: Date.now()
  });
});

// ── SPA FALLBACK ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`
📺 VIDKIDZ — Full Stack
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Server  : http://localhost:${PORT}
🗄️  State   : ${STATE_FILE}
🔐 JWT     : ${JWT_SECRET.substring(0, 20)}...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Demo Login:
  Family : budi@vidkidz.local / family123
  `);
  });
}

module.exports = app;
