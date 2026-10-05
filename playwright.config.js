const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/visual', timeout: 90000, workers: 2,
  use: { baseURL: 'http://127.0.0.1:3199', viewport: { width: 375, height: 760 }, reducedMotion: 'reduce', serviceWorkers: 'block', screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/visual-server.js', url: 'http://127.0.0.1:3199/api/version', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
