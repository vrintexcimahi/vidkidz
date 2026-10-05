# Update VIDKIDZ

## Edit dan langsung lihat hasilnya, tanpa deployment

Jalankan `npm install` sekali, lalu `npm run dev`.
Buka http://127.0.0.1:3100/#devmode dan gunakan akun lokal.
Simpan perubahan HTML/CSS/JS/aset: Local Sync memeriksa sintaks, kemudian
memuat ulang halaman beserta tiga iframe. Perubahan backend me-restart server;
browser menyambung kembali secara otomatis. Error sintaks menahan refresh dan
ditampilkan di indikator Local Sync. Ini full reload, bukan React HMR:
simpan form/gambar yang sedang dikerjakan sebelum mengedit kode.

Server development hanya mendengarkan 127.0.0.1. Data lokal terpisah dari Vercel.
Service worker root dinonaktifkan di mode ini untuk menghindari tampilan cache lama.
Domain publik tidak membaca hard disk komputer secara langsung.

## Publish satu perintah

Jalankan `npm run release` ketika perubahan sudah siap.
Perintah ini memeriksa CSS/JS/JSX, menjalankan regresi dengan data sementara,
menjalankan tes browser, deploy ke proyek Vercel yang terhubung, lalu membandingkan sidik rilis lokal
dengan https://vidkidz.vercel.app/api/version.
Jika belum login, jalankan `npx vercel@59.25.4 login` sekali terlebih dahulu.
Jika pemeriksaan gagal, deployment tidak dijalankan.
Perintah rilis menetapkan scope `vrintexcimahi-6412s-projects` secara eksplisit,
sesuai pemilik proyek VIDKIDZ, agar tidak bergantung pada scope aktif CLI.

Siapkan Chromium satu kali dengan `npx playwright install chromium`.
`npm run test:visual` menguji layout dan navigasi memakai data sementara di port 3199.
Screenshot hasil pengujian disimpan di `test-results/`.

`npm run release:status` dapat dipakai kapan saja untuk memeriksa sinkronisasi.
Jangan menjalankan publish pada setiap tombol Save: gunakan Local Sync untuk
iterasi, kemudian publish satu rilis lengkap.

## Identitas dan cache

Nomor versi server diambil dari package.json. Identitas rilis dihitung dari isi
kode, dependensi terkunci, dan aset; perubahan tetap terdeteksi walau nomor versi
belum dinaikkan. Build Vercel menjalankan pemeriksaan sintaks lagi dan membuat
release.json sebelum bundling. HTML, API versi, dan service worker memakai
identitas yang sama. Aset dengan nama tetap harus divalidasi ulang ke server.

Browser produksi memeriksa rilis setiap 60 detik saat halaman terlihat, dan saat
tab dibuka kembali. Jika berbeda, tombol **Perbarui sekarang** muncul. Halaman
tidak dipaksa reload di tengah pekerjaan. Jika offline, pemeriksaan ditunda;
konten yang sudah tersimpan dapat digunakan sesuai cache yang tersedia.

## Deployment otomatis melalui Git (opsional)

Vercel mendukung deployment otomatis dari push Git. Hubungkan repository dan
pilih production branch di Settings > Git, lalu setiap push memicu build.
Pemeriksaan sintaks `vercel-build` tetap berlaku. Untuk regresi penuh gunakan
`npm run release`, atau tambahkan CI dan perlindungan branch sesuai kebutuhan.
Konfigurasi Git integration belum diubah oleh pekerjaan ini.

## Batas verifikasi

Pemeriksaan sintaks mencegah error seperti kurung CSS hilang, tetapi tidak
menjamin hasil visual. Tetap tinjau Admin, Family, Kids pada mobile dan desktop.
Jangan memakai klaim audit lama “100% READY” sebagai bukti rendering browser.


## Perbaikan PWA ? 25 September 2026

Worker baru menunggu seluruh tab/PWA lama ditutup sebelum aktivasi. Tombol
pembaruan tetap memuat ulang halaman atas tindakan pengguna; tidak memaksa
reload tab lain. Simpan draft, tutup seluruh jendela VIDKIDZ, lalu buka kembali
untuk menyelesaikan penggantian worker. Pola lifecycle mengacu pada
https://web.dev/learn/pwa/update.

Shell offline mencakup CSS utama dan tiga runtime CDN berversi tetap. Instalasi
worker ditolak jika salah satu unduhan shell gagal, sehingga worker lama tetap
tersedia. Cache runtime umum hanya menerima aset publik yang diizinkan;
API, upload privat, request berotorisasi, dan media eksternal tidak masuk cache ini.
Aplikasi tetap membutuhkan koneksi saat kunjungan pertama/instalasi shell.

Roadtrip Vault memakai cache v2, unduhan CORS dengan respons 200 berjenis video,
dan pemutaran Blob lokal. Respons gagal, parsial, kosong, atau opaque tidak
menghasilkan status berhasil. Cache v1 tidak dibaca karena dapat mengandung data
dummy dari implementasi sebelumnya. Video lama harus diunduh ulang; cache v1
belum dihapus otomatis. Kuota browser dan dukungan CORS sumber video tetap membatasi
kemampuan unduhan. Perbaikan ini tidak menjamin semua sumber video bisa offline.

Pengujian PWA terarah: `node --test scripts/pwa.test.js` dan
`npx playwright test tests/visual/pwa.spec.js`. Unit PWA juga masuk `npm run check`.
Tes browser PWA mengaktifkan service worker secara eksplisit; tes visual lainnya
masih memblokir service worker agar hasil layout tidak dipengaruhi cache.
