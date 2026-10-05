(() => {
  if (!window.__VIDKIDZ_DEV__ || window.self !== window.top) return;
  let revision = null;
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;background:#102034;color:white;padding:8px 12px;border-radius:8px;font:12px sans-serif;max-width:420px';
  status.textContent = 'Local Sync aktif';
  document.body.append(status);
  async function poll() {
    try {
      const response = await fetch('/__dev/revision', { cache: 'no-store' });
      if (!response.ok) throw new Error('Server belum siap');
      const data = await response.json();
      status.textContent = data.error ? `Update ditahan: ${data.error}` : 'Local Sync aktif';
      if (revision && revision !== data.revision && !data.error) {
        // One top-level reload also refreshes all three preview frames.
        location.reload();
        return;
      }
      revision = data.revision;
    } catch (_) { status.textContent = 'Local Sync: menunggu server...'; }
    setTimeout(poll, 1000);
  }
  poll();
})();
