# 📺 VIDKIDZ — Full Stack

**Platform edukasi video terproteksi untuk anak — dashboard orang tua dan kids app.**

---

## 🚀 Quick Start

### Opsi 1: Docker (Paling Mudah)

```bash
# 1. Clone / extract project
cd VIDKIDZ

# 2. Buat file .env
cp .env.example .env
# Edit .env — ganti JWT_SECRET, isi GOOGLE_CLIENT_ID, dan isi ANTHROPIC_API_KEY bila memakai AI

# 3. Jalankan
docker-compose up -d

# 4. Buka browser
open http://localhost:3000
```

### Opsi 2: Node.js Langsung

```bash
# 1. Install dependencies
npm install

# 2. Buat file .env
cp .env.example .env
# Edit .env sesuai kebutuhan

# 3. Jalankan
npm start       # production
npm run dev     # development (auto-reload)

# 4. Buka browser
open http://localhost:3000
```

---

## 👥 Demo Login

| Role | Email / ID | Password / PIN |
|------|-----------|----------------|
| 👨‍👩‍👧 Family 1 | budi@vidkidz.local | family123 |
| 👨‍👩‍👧 Family 2 | siti@vidkidz.local | family456 |
| 🎒 Anak Andi | k1 | 1234 |
| 🎒 Anak Sari | k2 | 5678 |
| 🎒 Anak Doni | k3 | 9012 |

---

## 🏗️ Arsitektur

```
VIDKIDZ/
├── server.js           # Express server (API + static)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── public/
│   └── index.html      # React SPA (v5)
└── data/
└── vidkidz-state.json  # App state (auto-created)
```

### Stack

| Layer | Teknologi |
|-------|-----------|
| Frontend | React 18 (CDN), CSS Custom Properties |
| Backend | Node.js + Express |
| Storage | JSON state file |
| Auth | JWT (jsonwebtoken) |
| AI | Anthropic Claude API (proxied) |
| Deploy | Vercel / Docker / Railway / Render / VPS |

> Catatan Vercel: state JSON berjalan sebagai demo serverless dan bisa reset saat cold start. Untuk data production yang permanen, sambungkan ke database eksternal seperti Neon/Postgres, Vercel Postgres, atau Redis.

---

## 🔌 API Endpoints

| Method | Path | Auth | Deskripsi |
|--------|------|------|-----------|
| GET | `/api/auth/config` | ❌ | Konfigurasi login publik |
| POST | `/api/auth/login` | ❌ | Login Family/Kids |
| POST | `/api/auth/google` | ❌ | Daftar/login Family dengan Google |
| POST | `/api/auth/logout` | ✅ JWT | Logout |
| GET | `/api/state` | ✅ JWT | Ambil full state |
| PUT | `/api/state` | ✅ Admin internal | Replace full state (`ALLOW_ADMIN_LOGIN=true`) |
| PATCH | `/api/state` | ✅ JWT | Update partial state |
| POST | `/api/ai/analyze` | ✅ JWT | AI Face Analysis (proxy) |
| GET | `/api/health` | ❌ | Health check |

---

## ☁️ Deploy ke Cloud

### Railway (Gratis)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login & deploy
railway login
railway init
railway up

# Set environment variables di Railway dashboard
# JWT_SECRET=...
# ANTHROPIC_API_KEY=...
```

### Render.com
1. Push ke GitHub
2. New Web Service → pilih repo
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Add environment variables di dashboard

### VPS (Ubuntu/Debian)
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone & setup
git clone <repo> /var/www/vidkidz
cd /var/www/vidkidz
npm install --production
cp .env.example .env
nano .env  # isi JWT_SECRET dan ANTHROPIC_API_KEY

# Jalankan dengan PM2
npm install -g pm2
pm2 start server.js --name vidkidz
pm2 startup
pm2 save
```

### Nginx Reverse Proxy (opsional)
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 🔒 Keamanan untuk Production

1. **Ganti JWT_SECRET** dengan string random panjang (64+ karakter):
   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

2. **Gunakan HTTPS** — setup SSL certificate (Let's Encrypt via Certbot)

3. **Password hashing** — saat ini password tersimpan plaintext di JSON state.
   Untuk production upgrade: tambahkan bcrypt di route login.

4. **Rate limiting** — tambahkan `express-rate-limit` untuk mencegah brute force:
   ```bash
   npm install express-rate-limit
   ```

5. **Backup state** — setup cron job untuk backup `data/vidkidz-state.json`

---

## 🤖 AI Face Analysis

1. Dapatkan API Key di https://console.anthropic.com
2. **Opsi A**: Set `ANTHROPIC_API_KEY=sk-ant-...` di file `.env` (key tidak terekspos ke client)
3. Untuk production, simpan key di environment server, bukan di client.

Fitur AI akan menganalisis foto anak via Claude Vision dan memberikan laporan kondisi dalam Bahasa Indonesia.

---

## 📝 Catatan Perubahan dari v4 → v5 Full Stack

| Aspek | v4 (Static) | v5 Full Stack |
|-------|-------------|---------------|
| Storage | localStorage | Server-side JSON state |
| Auth | Client-side check | JWT + Server |
| Data sharing | Per-browser | Shared (semua device) |
| AI Key | Terekspos di client | Aman di server env |
| Deploy | Buka file HTML | `npm start` / Docker |
| Multi-user | ❌ (tiap browser terpisah) | ✅ (server terpusat) |

---

*VIDKIDZ — Full Stack Edition*
