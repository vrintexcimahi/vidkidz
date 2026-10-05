// Separate data directory: browser verification must never mutate user data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.VIDKIDZ_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vidkidz-visual-'));
require('../server').listen(3199, '127.0.0.1', () => console.log('Visual test server ready on 3199'));
