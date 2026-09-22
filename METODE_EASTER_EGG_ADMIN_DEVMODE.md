# 📱 Metode Easter Egg Admin / Developer Mode ala Android

Panduan implementasi modul autentikasi tersembunyi dengan ketukan bertahap (*multi-tap secret trigger*) seperti aktivasi **Developer Options** pada nomor versi Android (*Build Number*).

Dokumen ini siap digunakan sebagai referensi atau di-*copy-paste* langsung ke project web lain (React, Next.js, Vue, maupun Vanilla JavaScript).

---

## 🎯 Konsep & Alur Kerja

1. **Default State (Aman & Tersembunyi)**:
   - UI Admin (tab switcher, tombol login admin, kredensial demo) **tidak ditampilkan sama sekali** secara default.
   - User biasa hanya melihat login standar (Customer / User / Family).

2. **Ketukan Bertahap (Multi-Tap Threshold)**:
   - **Target Ketukan**: `15 kali`.
   - **Ketukan 1 – 5**: **Silent** (senyap, tidak ada feedback apa pun agar tidak memancing rasa penasaran user biasa).
   - **Ketukan 6 – 14**: **Countdown Feedback** (mulai memunculkan toast/notifikasi ala Android: *"Tinggal X langkah lagi untuk membuka akses Administrator"*).
   - **Ketukan ke-15**: **Akses Terbuka** (notifikasi perayaan: *"🎉 Mode Administrator Terbuka!"*, UI Admin langsung muncul dan aktif).

3. **Area Trigger yang Luas & Fleksibel**:
   - Ketukan dapat dipasang pada:
     - Logo aplikasi
     - Tagline / Subtitle
     - Footer copyright
     - Background / area kosong di luar form

4. **Persistence & Bypass Parameter**:
   - Menggunakan `sessionStorage` agar setelah di-unlock, refresh tab tidak mengunci kembali selama sesi browser masih aktif.
   - Opsional: Mendukung bypass otomatis via query parameter (misal `?role=admin` atau `#admin`) untuk kebutuhan automated testing atau simulator.

---

## 💻 Implementasi 1: React / Next.js (Modern Hooks)

### 1. Custom Hook: `useAdminEasterEgg.js`

```javascript
import { useState, useCallback } from 'react';

/**
 * Hook untuk mengelola easter egg ketukan berulang ala Android Developer Mode
 * @param {Object} options
 * @param {number} options.totalClicks - Total klik untuk unlock (default: 15)
 * @param {number} options.notifyStartClick - Klik ke berapa notifikasi mulai muncul (default: 6)
 * @param {Function} options.onNotify - Callback notifikasi (message, type)
 * @param {Function} options.onUnlocked - Callback saat unlock tercapai
 */
export function useAdminEasterEgg({
  totalClicks = 15,
  notifyStartClick = 6,
  onNotify = (msg) => alert(msg),
  onUnlocked = () => {}
} = {}) {
  const [isUnlocked, setIsUnlocked] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      const params = new URLSearchParams(window.location.search);
      const hash = window.location.hash || '';
      return (
        params.get('role') === 'admin' ||
        params.get('preview_role') === 'admin' ||
        hash.includes('admin') ||
        sessionStorage.getItem('app_admin_unlocked') === 'true'
      );
    } catch (e) {
      return false;
    }
  });

  const [clickCount, setClickCount] = useState(0);

  const handleTriggerClick = useCallback((e) => {
    if (isUnlocked) return;

    setClickCount((prev) => {
      const next = prev + 1;

      if (next >= totalClicks) {
        setIsUnlocked(true);
        try {
          sessionStorage.setItem('app_admin_unlocked', 'true');
        } catch (e) {}

        onNotify('🎉 Selamat! Anda sekarang dalam Mode Developer & Akses Admin terbuka!', 'success');
        onUnlocked();
        return totalClicks;
      } else if (next >= notifyStartClick) {
        const remaining = totalClicks - next;
        onNotify(`Tinggal ${remaining} langkah lagi untuk membuka akses Admin`, 'info');
      }

      return next;
    });
  }, [isUnlocked, totalClicks, notifyStartClick, onNotify, onUnlocked]);

  const lockAdmin = useCallback(() => {
    setIsUnlocked(false);
    setClickCount(0);
    try {
      sessionStorage.removeItem('app_admin_unlocked');
    } catch (e) {}
  }, []);

  return {
    isUnlocked,
    clickCount,
    handleTriggerClick,
    lockAdmin
  };
}
```

---

### 2. Penggunaan di Komponen Login (`LoginScreen.jsx`)

```jsx
import React, { useState } from 'react';
import { useAdminEasterEgg } from './useAdminEasterEgg';

export function LoginScreen() {
  const [role, setRole] = useState('user'); // 'user' | 'admin'
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  // Pasang hook Easter Egg
  const { isUnlocked, handleTriggerClick } = useAdminEasterEgg({
    totalClicks: 15,
    notifyStartClick: 6,
    onNotify: (msg, type) => {
      // Ganti dengan library toast Anda (cth: react-hot-toast, sonner, notif internal)
      console.log(`[${type}] ${msg}`);
      showToast(msg);
    },
    onUnlocked: () => {
      setRole('admin');
      setAccount('admin@example.com');
      setPassword('admin123');
    }
  });

  return (
    <div className="login-wrapper" onClick={handleTriggerClick}>
      <div className="login-card" onClick={(e) => e.stopPropagation()}>
        
        {/* LOGO: Berfungsi sebagai trigger klik rahasia */}
        <div className="logo-section" onClick={handleTriggerClick} style={{ cursor: 'pointer' }}>
          <img src="/logo.png" alt="Logo" className="logo" />
          <p className="tagline">Sistem Aplikasi Terpercaya</p>
        </div>

        {/* TAB ROLE: HANYA MUNCUL JIKA SUDAH DI-UNLOCK */}
        {isUnlocked && (
          <div className="role-switcher-tabs fade-in">
            <button
              type="button"
              className={role === 'user' ? 'active' : ''}
              onClick={() => setRole('user')}
            >
              👤 Pengguna
            </button>
            <button
              type="button"
              className={role === 'admin' ? 'active' : ''}
              onClick={() => setRole('admin')}
            >
              🛡️ Admin
            </button>
          </div>
        )}

        {/* FORM LOGIN */}
        <form onSubmit={(e) => { e.preventDefault(); /* handle login */ }}>
          <input
            type="text"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder={role === 'admin' ? 'Email Administrator' : 'Nomor HP / Email'}
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Kata Sandi"
            required
          />
          <button type="submit">
            Masuk sebagai {role === 'admin' ? 'Admin' : 'Pengguna'}
          </button>
        </form>

        {/* HINT KREDENSIAL: Jangan bocorkan kredensial admin jika belum terbuka */}
        <div className="demo-hint">
          <span>
            ⚡ Demo: {isUnlocked && role === 'admin' ? 'admin@example.com / admin123' : 'user@example.com / user123'}
          </span>
        </div>

        {/* LINK FOOTER ADMIN: HANYA MUNCUL SETELAH UNLOCKED */}
        {isUnlocked && (
          <div className="admin-link">
            <button
              type="button"
              onClick={() => setRole(role === 'admin' ? 'user' : 'admin')}
            >
              {role === 'admin' ? '← Mode Pengguna Standar' : 'Portal Admin →'}
            </button>
          </div>
        )}
      </div>

      {/* FOOTER CAPTION: Juga bisa jadi trigger klik */}
      <p className="footer-caption" onClick={handleTriggerClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
        Aplikasi &copy; 2026 · Hak Cipta Dilindungi
      </p>
    </div>
  );
}
```

---

## 🌐 Implementasi 2: Vanilla JavaScript / HTML (No Framework)

Jika project Anda menggunakan HTML biasa, PHP, Laravel Blade, atau template engine:

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Login Terproteksi</title>
  <style>
    /* Toast floating ala Android */
    .android-toast {
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(20, 24, 33, 0.92);
      color: #fff;
      padding: 10px 18px;
      border-radius: 24px;
      font-family: sans-serif;
      font-size: 13px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 9999;
    }
    .android-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>

  <!-- Background klik -->
  <div id="login-container" style="min-height: 100vh; display: grid; place-items: center;">
    
    <div id="login-card" style="width: 340px; padding: 24px; border: 1px solid #ccc; border-radius: 16px;">
      
      <!-- Logo sebagai trigger -->
      <div id="secret-trigger" style="text-align: center; cursor: pointer; user-select: none;">
        <img src="logo.png" alt="Logo" width="60">
        <h3>Selamat Datang</h3>
      </div>

      <!-- Tab Admin (Default: hidden) -->
      <div id="admin-tabs" class="hidden" style="display: flex; gap: 8px; margin: 16px 0;">
        <button id="btn-role-user" style="flex:1;">User</button>
        <button id="btn-role-admin" style="flex:1;">Admin</button>
      </div>

      <form id="login-form">
        <input type="text" id="input-account" placeholder="Email / Telepon" style="width: 100%; margin-bottom: 10px;" required>
        <input type="password" id="input-password" placeholder="Kata Sandi" style="width: 100%; margin-bottom: 10px;" required>
        <button type="submit" id="btn-submit" style="width: 100%;">Masuk</button>
      </form>
      
    </div>

  </div>

  <!-- Android Style Toast Container -->
  <div id="android-toast" class="android-toast"></div>

  <script>
    (function() {
      const TOTAL_CLICKS = 15;
      const NOTIFY_START = 6;
      let clicks = 0;
      let unlocked = sessionStorage.getItem('admin_unlocked') === 'true';

      const toastEl = document.getElementById('android-toast');
      const adminTabsEl = document.getElementById('admin-tabs');
      let toastTimer = null;

      function showToast(text) {
        toastEl.textContent = text;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toastEl.classList.remove('show');
        }, 2200);
      }

      function enableAdminMode() {
        unlocked = true;
        sessionStorage.setItem('admin_unlocked', 'true');
        adminTabsEl.classList.remove('hidden');
        showToast('🎉 Mode Developer & Akses Admin Terbuka!');
      }

      if (unlocked) {
        adminTabsEl.classList.remove('hidden');
      }

      function handleSecretTap(e) {
        if (unlocked) return;

        clicks++;
        if (clicks >= TOTAL_CLICKS) {
          enableAdminMode();
        } else if (clicks >= NOTIFY_START) {
          const remaining = TOTAL_CLICKS - clicks;
          showToast(`Tinggal ${remaining} langkah lagi untuk membuka akses Admin`);
        }
      }

      // Daftarkan target klik
      document.getElementById('secret-trigger').addEventListener('click', handleSecretTap);
      document.getElementById('login-container').addEventListener('click', function(e) {
        // Jangan picu jika klik di dalam input form
        if (!e.target.closest('#login-card')) {
          handleSecretTap(e);
        }
      });
    })();
  </script>
</body>
</html>
```

---

## 🛡️ Catatan Keamanan (*Best Practices*)

1. **Security by Obscurity + Real Authorization**:
   - Metode multi-tap ini menyembunyikan *UI portal admin* dari pandangan pengguna biasa agar tidak mudah dicoba-coba (*prevent casual probing / brute force*).
   - **PENTING**: Endpoint API backend (seperti `/api/admin/*`) **tetap wajib** dilindungi dengan otentikasi JWT Bearer, validasi role token, IP whitelist/telemetry, dan rate limiter. Jangan mengandalkan frontend saja.
2. **Kredensial Demo**:
   - Saat terkunci, pastikan *placeholder*, *hint text*, atau *auto-fill* tidak menampilkan kredensial akun admin.
3. **Session Reset**:
   - Gunakan `sessionStorage` daripada `localStorage` agar saat tab atau browser ditutup, state rahasia kembali terkunci secara otomatis.
