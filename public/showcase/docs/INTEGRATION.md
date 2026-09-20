# Instruksi Penerapan ke Project Existing

## 1. Cara tercepat: pasang sebagai halaman standalone

Copy file berikut ke public web root:

- `index.html`
- `styles.css`
- `app.js`
- `manifest.webmanifest`
- `service-worker.js`
- folder `assets/`

Jika domain Anda misalnya `https://app.example.com/family/`, letakkan semuanya di folder `family/` agar path relatif tetap bekerja.

## 2. Integrasi ke Laravel / PHP

Pindahkan asset:

```text
public/family-ui/styles.css
public/family-ui/app.js
public/family-ui/assets/...
```

Pindahkan isi utama `index.html` ke Blade/PHP template. Ubah referensi asset, contoh Laravel:

```blade
<link rel="stylesheet" href="{{ asset('family-ui/styles.css') }}">
<img src="{{ asset('family-ui/assets/icons/home.svg') }}" alt="">
<script src="{{ asset('family-ui/app.js') }}"></script>
```

Render data backend langsung di template atau kirim sebagai JSON:

```blade
<script>
window.DASHBOARD_DATA = @json($dashboardData);
</script>
```

Lalu baca di `app.js`.

## 3. Integrasi ke React / Next / Vue

Pisahkan tiga section menjadi komponen:

```text
components/
├─ AdminDashboard
├─ ParentDashboard
├─ KidDashboard
├─ BottomNav
├─ StatCard
├─ HeroCard
└─ KidMenuCard
```

CSS dapat dipakai langsung sebagai global stylesheet, atau dikonversi menjadi CSS Module / Tailwind secara bertahap.

## 4. API Binding yang Disarankan

Gunakan satu endpoint ringkas per role:

```text
GET /api/dashboard/admin
GET /api/dashboard/parent
GET /api/dashboard/kid
```

Contoh Parent:

```json
{
  "summary": {
    "children": 2,
    "coins": 125,
    "memorization": 5,
    "pending": 0
  },
  "child": {
    "id": 12,
    "name": "Andi",
    "age": 7,
    "class": "1 SD",
    "active": true,
    "score": 85,
    "streak": 3,
    "memorization": 3,
    "watchMinutes": 142
  }
}
```

## 5. Mapping aksi UI ke backend

Ganti demo toast dengan fungsi seperti:

```js
async function lockChildDevice(childId) {
  const response = await fetch(`/api/children/${childId}/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': window.csrfToken
    }
  });
  if (!response.ok) throw new Error('Gagal mengunci perangkat');
}
```

Pastikan role dan ownership diverifikasi kembali di server.

## 6. Responsive behavior

- Lebar > 900px: tiga mode tampil berdampingan seperti design showcase.
- Lebar <= 900px: hanya satu screen aktif, full-height seperti aplikasi Android.
- Role switch di bagian atas dipakai sebagai alat preview/development. Pada aplikasi production, role sebaiknya ditentukan dari session login.

Untuk production mobile, Anda dapat menghapus role switch jika role berasal dari backend.

## 7. PWA

Project sudah memiliki:

- `manifest.webmanifest`
- `service-worker.js`
- icon 192px dan 512px

Pastikan website berjalan melalui HTTPS agar install PWA dan service worker bekerja di production.

Jika deploy di sub-folder, update `start_url` pada manifest bila diperlukan.

## 8. Backend security checklist

- Jangan percaya role dari localStorage/frontend.
- Validasi `user_id`, `family_id`, `child_id` di backend.
- Parent hanya boleh melihat/mengontrol anak dalam family miliknya.
- Admin endpoint wajib memiliki middleware admin/super-admin.
- Rate limit action sensitif seperti lock device.
- Audit log untuk action admin dan parent-control.
- Gunakan CSRF protection untuk session auth atau bearer token yang sesuai untuk API auth.

## 9. Mengganti asset

Semua asset visual ada di:

```text
assets/icons/
assets/illustrations/
```

Anda dapat mengganti SVG dengan PNG/WebP baru tanpa mengubah layout, selama nama file dipertahankan atau path pada HTML diperbarui.

## 10. File referensi

`reference-design.png` disertakan sebagai referensi visual hasil desain. Gunakan file tersebut untuk membandingkan komposisi saat melakukan pengembangan lebih lanjut.
