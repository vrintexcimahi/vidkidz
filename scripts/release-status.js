const local = require('./release-info')(require('path').resolve(__dirname, '..'));
(async () => {
  const response = await fetch('https://vidkidz.vercel.app/api/version', { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const remote = await response.json();
  console.log('Local:', local.version, local.releaseId);
  console.log('Online:', remote.version, remote.releaseId || remote.buildId);
  const match = local.releaseId === remote.releaseId;
  console.log(match ? 'SYNCED: production matches local source.' : 'NOT SYNCED: production differs from local source.');
  process.exitCode = match ? 0 : 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
