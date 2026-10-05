const fs = require('fs');
const path = require('path');
const { checkUI } = require('./check-ui');

module.exports = function installDev(app, root) {
  let revision = `${Date.now()}`;
  let error = null;
  const validate = () => {
    try { checkUI(root); error = null; revision = `${Date.now()}`; console.log('[Local Sync] UI valid, browser update ready'); }
    catch (err) { error = err.message; console.error('[Local Sync] Update blocked:', error); }
  };
  validate();
  // Polling avoids native recursive watcher crashes on Windows/short temp paths.
  function snapshot(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
      .map(entry => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) return snapshot(file);
        const stat = fs.statSync(file);
        return `${file}:${stat.size}:${stat.mtimeMs}`;
      }).join('|');
  }
  let previous = snapshot(path.join(root, 'public'));
  let pending = false;
  const timer = setInterval(() => {
    try {
      const next = snapshot(path.join(root, 'public'));
      if (next !== previous) { previous = next; pending = true; }
      else if (pending) { pending = false; validate(); }
    } catch (err) { error = err.message; }
  }, 400);
  timer.unref();
  app.get('/__dev/revision', (req, res) => res.set('Cache-Control', 'no-store').json({ revision, error }));
  return () => clearInterval(timer);
};
