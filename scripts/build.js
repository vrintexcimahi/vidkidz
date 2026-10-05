const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
console.log(`UI syntax OK: ${require('./check-ui').checkUI(root)} files`);
const release = require('./release-info')(root);
fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`Release ${release.version} / ${release.releaseId}`);
