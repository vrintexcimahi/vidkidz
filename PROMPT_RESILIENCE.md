# TASK: Implementasi Hardening AI 9Router & Optimasi Beban RAM Sharp pada VIDKIDZ (Windows PC)

Target Environment: Windows PC (SERVER PC @ 192.168.1.27)
Project Path: `C:\Users\SERVER PC\Pictures\VIDKIDZ`
Runtime: Node.js (Express 5.2.1, sharp 0.35.4, libvips 8.18.6, Port 3100)
Main File: `server.js` | Test Suite: `npm test` (`node scripts/test-isolated.js` - 183 existing test cases)

---

## TUJUAN UTAMA
1. **Mengamankan Integrasi AI 9Router**: Pasang Dual-URL Auto-Failover (localhost -> LAN `http://192.168.1.14:20128/v1`), upstream timeout 15 detik, Circuit Breaker (3x fail -> OPEN 30 detik), dan in-memory result cache untuk endpoint `/api/ai/analyze` & `/api/ai/test`.
2. **Optimasi Beban RAM Sharp pada Windows PC**: Mengendalikan thread pool dan memory cache libvips (`sharp.concurrency(1)` & `sharp.cache({ memory: 50, files: 20, items: 100 })`) serta memasang Concurrency Semaphore (maksimal 2 operasi kompresi simultan) guna mencegah RAM WorkingSet spike dan kebocoran heap pada OS Windows.
3. **Pre-Processing Gambar Vision (Token & Bandwidth Saver)**: Kompresi dan downscale gambar kamera/drawing sebelum dikirim ke 9Router Vision (maks. 1024x1024, JPEG 80%), memangkas ukuran payload base64 dari 5MB-10MB menjadi ~120KB (reduksi >95%).
4. **Optimasi Endpoint Upload Media (`/api/media/upload`)**: Mengonversi upload gambar gambar anak/foto menjadi WebP terkompresi sebelum disimpan ke disk untuk menghemat kapasitas hard drive dan mempercepat loading PWA.
5. **Zero Regression**: 100% tes `npm test` (183 pengujian isolasi) tetap berjalan dengan status PASS.

---

## TEMUAN AUDIT & ANALISIS MASALAH
1. **Koneksi 9Router Gagal/Hang pada Windows**:
   - `server.js:2059` menetapkan default `nineRouterBaseUrl` ke `http://127.0.0.1:20128/v1`.
   - Di Windows PC, 9Router tidak berjalan di localhost melainkan di server Linux LAN (`http://192.168.1.14:20128/v1`). Jika user tidak mengubah setting, request akan hang hingga sistem timeout.
   - Panggilan `fetch(`${nineRouterBaseUrl}/chat/completions`)` tidak memiliki `AbortSignal.timeout` dan tidak memiliki Circuit Breaker.
2. **Payload Base64 Jumbo ke 9Router**:
   - `/api/ai/analyze` menerima gambar base64 mentah (bisa mencapai 10MB dari kamera HP/tablet) dan langsung meneruskannya ke 9Router. Ini menyebabkan lonjakan memori heap Node.js, pemborosan bandwidth LAN, dan latensi tinggi.
3. **Sharp di Windows Rawan RAM Bloat**:
   - Library `sharp` sudah terpasang (v0.35.4). Secara default pada Windows multi-core, libvips membuat thread sebanyak CPU core dan melakukan unbounded memory caching, yang dapat menguras ratusan MB RAM saat melayani request media/gambar.
4. **Endpoint Media Upload Simpan File Mentah**:
   - `/api/media/upload` (baris ~890) menerima base64 lalu langsung menulis `fs.writeFileSync(filePath, buffer)` tanpa kompresi, menyebabkan file media cepat membengkak.

---

## DETAIL LANGKAH IMPLEMENTASI

### 1. Buat Modul Utilitas Ketahanan: `lib/resilience.js`
Buat file baru `C:\Users\SERVER PC\Pictures\VIDKIDZ\lib\resilience.js` (atau letakkan helper di dalam `server.js` jika ingin tetap single-file) yang mengimplementasikan:

```javascript
// Semaphore untuk membatasi operasi berat CPU/RAM secara simultan
class Semaphore {
  constructor(maxConcurrency = 2) {
    this.max = maxConcurrency;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    await new Promise(resolve => this.queue.push(resolve));
    this.current++;
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }

  async run(task) {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

// Circuit Breaker untuk melindungi dari upstream 9Router yang hang/down
class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeout = options.resetTimeout || 30000; // 30 detik
    this.state = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF_OPEN'
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  isOpen() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.warn(`[CIRCUIT-BREAKER] ${this.name} status sekarang: OPEN (Threshold ${this.failureThreshold} tercapai)`);
    }
  }
}

// Cache TTL untuk hasil AI Vision
class TtlCache {
  constructor(ttlMs = 5 * 60 * 1000, maxItems = 100) {
    this.ttlMs = ttlMs;
    this.maxItems = maxItems;
    this.cache = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value) {
    if (this.cache.size >= this.maxItems) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

module.exports = { Semaphore, CircuitBreaker, TtlCache };
```

---

### 2. Konfigurasi dan Tuning Sharp di `server.js`
Tambahkan inisialisasi Sharp yang aman untuk Windows di bagian atas `server.js`:

```javascript
let sharp = null;
try {
  sharp = require('sharp');
  // Tuning RAM & Threading khusus Windows PC:
  sharp.concurrency(1); // Batasi ke 1-2 worker thread agar CPU/RAM tidak spiking
  sharp.cache({ memory: 50, files: 20, items: 100 }); // Batasi cache libvips maks 50MB RAM
  sharp.simd(true);
  console.log('✅ Sharp terinisialisasi dengan konfigurasi memori aman untuk Windows');
} catch (e) {
  console.warn('⚠️ Sharp tidak tersedia, fallback ke mode bypass kompresi:', e.message);
}

const sharpSemaphore = new Semaphore(2); // Maksimal 2 proses kompresi Sharp simultan
const aiVisionBreaker = new CircuitBreaker('9Router-Vision', { failureThreshold: 3, resetTimeout: 30000 });
const aiVisionCache = new TtlCache(5 * 60 * 1000, 100);
```

---

### 3. Pasang Downscale Gambar Sebelum Kirim ke 9Router
Buat helper fungsi untuk mengompres gambar sebelum dikirim ke AI Vision:

```javascript
async function prepareVisionImage(imageBase64) {
  if (!sharp) return imageBase64;
  
  return await sharpSemaphore.run(async () => {
    try {
      const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      const inputBuffer = Buffer.from(cleanBase64, 'base64');
      
      // Jika gambar kecil (< 200KB), tidak perlu diproses ulang
      if (inputBuffer.length < 200 * 1024) {
        return imageBase64;
      }

      // Resize maks sisi 1024px, JPEG quality 80%
      const compressedBuffer = await sharp(inputBuffer)
        .rotate() // Auto-orient dari EXIF
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toBuffer();

      return `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;
    } catch (err) {
      console.warn('Gagal memproses gambar dengan Sharp, menggunakan gambar asli:', err.message);
      return imageBase64;
    }
  });
}
```

---

### 4. Hardening Endpoint `/api/ai/analyze` di `server.js`
Refactor handler `/api/ai/analyze`:
1. **Cache Check**: Hitung MD5 atau simple hash dari `imageBase64.slice(0, 1000) + imageBase64.length + promptText`. Jika ada di `aiVisionCache`, langsung return (<5ms).
2. **Circuit Breaker Check**: Jika `aiVisionBreaker.isOpen()`, langsung coba fallback Anthropic (jika ada key) atau lempar response error 503 cepat tanpa menunggu timeout 15 detik.
3. **URL Auto-Discovery / Failover**:
   - Coba URL utama: `settings.nineRouterBaseUrl || process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1'`
   - Jika koneksi gagal (ECONNREFUSED / timeout), coba otomatis fallback ke LAN: `'http://192.168.1.14:20128/v1'`
4. **Timeout Guard**: Gunakan `signal: AbortSignal.timeout(15000)` pada `fetch()`.
5. **Pre-compress Image**: Jalankan `const optimizedImageUrl = await prepareVisionImage(imageUrl);` sebelum dikirim dalam payload `messages`.
6. Simpan hasil sukses ke `aiVisionCache` dan panggil `aiVisionBreaker.recordSuccess()`.
7. Jika gagal, panggil `aiVisionBreaker.recordFailure()`.

---

### 5. Optimasi Endpoint Upload Media `/api/media/upload` di `server.js`
Pada rute `POST /api/media/upload`:
- Gunakan `sharpSemaphore` saat menerima file gambar (`image/png`, `image/jpeg`).
- Konversi gambar menjadi WebP berkualitas 85% dengan batas resolusi maksimum 1600x1200.
- Simpan file dengan ekstensi `.webp` atau `.jpg` yang sudah terkompresi.
- Jika Sharp gagal atau file bukan gambar (misal file audio rekaman orang tua `.webm`/`.mp3`), simpan buffer asli secara normal tanpa error.

---

### 6. Endpoint Health & Admin Diagnostics
Di `/api/ai/test`:
- Tambahkan status deteksi apakah 9Router aktif di `127.0.0.1:20128` atau `192.168.1.14:20128`.
- Tampilkan metrik RAM Sharp (`sharp.cache()`) dalam response diagnosis untuk memudahkan monitoring performa server Windows.

---

## ACCEPTANCE CRITERIA
1. **RAM Server Windows Tetap Terkendali**: Pengujian upload atau analisis gambar berulang tidak menyebabkan memory leak atau lonjakan working set RAM node.exe di atas 250MB.
2. **Payload AI Vision Ramping**: Gambar resolusi tinggi (3-10MB) berhasil terkompresi menjadi base64 < 200KB sebelum ditembak ke 9Router.
3. **Failover LAN Otomatis**: Jika setting menunjuk ke `127.0.0.1:20128` dan port lokal tidak aktif, sistem otomatis mencoba `http://192.168.1.14:20128/v1`.
4. **Fast Timeout & Breaker**: Saat 9Router down, request dibatalkan maksimal dalam 15 detik. Setelah 3x gagal, request ke-4 langsung dipotong oleh Circuit Breaker (<5ms).
5. **100% Test Suite Hijau**: Menjalankan `npm test` di Windows PC menghasilkan:
   `FINAL RESULTS: 183 passed, 0 failed`
