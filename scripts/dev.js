// nodemon restarts the backend. The dev-only revision endpoint refreshes browsers
// after either a validated frontend save or a successful backend restart.
process.env.VIDKIDZ_DEV = '1';
process.env.PORT = process.env.PORT || '3100';
const nodemon = require('nodemon');
nodemon({ script: 'server.js', watch: ['server.js', 'scripts'], ext: 'js,json', delay: 500 });
nodemon.on('quit', () => process.exit());
