const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidkidz-test-'));
const result = spawnSync(process.execPath, ['test-server.js'], {
  stdio: 'inherit', env: { ...process.env, VIDKIDZ_DATA_DIR: dir }
});
console.log(`Test data isolated at ${dir}`);
process.exit(result.status ?? 1);
