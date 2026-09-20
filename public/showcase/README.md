# VRINTEX Family Mobile UI Kit

Implementasi frontend berdasarkan desain tiga mode:

1. **Super Admin / GOD MODE**
2. **Orang Tua / Family Control**
3. **Mode Anak**

Project dibuat dengan **HTML + CSS + JavaScript murni**, tanpa framework dan tanpa dependency eksternal, sehingga mudah dipindahkan ke Laravel, CodeIgniter, PHP native, React, Vue, Next.js, atau project SaaS lain.

## Fitur

- Responsive mobile-first.
- Desktop showcase menampilkan 3 smartphone sekaligus.
- Mobile otomatis menampilkan 1 mode penuh layar.
- Switch role Admin / Orang Tua / Anak.
- Bottom navigation interaktif.
- Toast action demo.
- Tombol Parent → Kids dapat berpindah ke Mode Anak.
- PWA manifest + service worker dasar.
- Semua icon dan ilustrasi tersedia lokal di folder `assets/`.
- Tidak memakai font eksternal atau CDN.

## Jalankan di Windows

Cara termudah:

1. Extract ZIP.
2. Pastikan Python terpasang.
3. Double click `start-local.bat`.
4. Browser akan membuka `http://localhost:8080`.

Alternatif PowerShell:

```powershell
./start-local.ps1
```

Atau terminal:

```bash
python -m http.server 8080
```

Kemudian buka:

```text
http://localhost:8080
```

> Jangan membuka `index.html` langsung dengan `file://` jika ingin menguji PWA/service worker. Gunakan localhost/HTTP.

## Struktur

```text
vrintex-family-mobile-ui/
├─ index.html
├─ styles.css
├─ app.js
├─ manifest.webmanifest
├─ service-worker.js
├─ start-local.bat
├─ start-local.ps1
├─ assets/
│  ├─ icon-192.png
│  ├─ icon-512.png
│  ├─ icons/
│  └─ illustrations/
└─ docs/
   ├─ reference-design.png
   └─ INTEGRATION.md
```

## Titik Integrasi Data

Saat dipasang ke backend, ganti data statis di `index.html` dengan data dari API/backend Anda. Contoh data yang perlu disambungkan:

- Admin: jumlah keluarga, premium, basic, anak, aktivitas terbaru.
- Parent: total anak, koin, hafalan, pending task, status anak, streak, watch time.
- Kid: daftar menu, hadiah, materi, game, hafalan, video, album.

Contoh pseudo-data:

```js
const dashboard = {
  totalFamilies: 2,
  premium: 1,
  basic: 1,
  children: 3
};
```

Untuk production sebaiknya render dari backend atau fetch API lalu update komponen DOM.

## Ubah Warna Global

Edit variabel pada bagian awal `styles.css`:

```css
:root {
  --blue:#195bff;
  --cyan:#24c9f3;
  --purple:#6b55ff;
  --pink:#ff4f8d;
  --green:#2acb8d;
  --amber:#ffbd2d;
}
```

## Catatan Production

- Ganti handler demo (`js-toast`) dengan route/API asli.
- Untuk autentikasi role, jangan hanya mengandalkan tampilan frontend. Validasi role tetap di backend.
- Untuk Parent Control seperti lock screen, gunakan API device/session yang benar dan otorisasi server-side.
- Simpan token autentikasi secara aman; jangan hard-code di JS.
- Service worker sekarang adalah versi demo cache-first. Untuk SaaS aktif, sesuaikan strategi cache endpoint API agar data user tidak stale.

Detail integrasi tersedia di `docs/INTEGRATION.md`.
