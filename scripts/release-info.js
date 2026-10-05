const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

// Content identity changes even when a developer forgets to bump the version.
module.exports = function releaseInfo(root) {
  const hash = createHash('sha256');
  function add(relative) {
    const file = path.join(root, relative);
    if (fs.statSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) add(`${relative}/${name}`);
    } else {
      const content = fs.readFileSync(file);
      hash.update(relative).update('\0').update(/\.(js|json|html|css|md|ps1|bat|webmanifest|svg)$/.test(file)
        ? content.toString('utf8').replace(/\r\n/g, '\n') : content).update('\0');
    }
  }
  for (const file of ['package.json', 'package-lock.json', 'server.js', 'scripts', 'public']) add(file);
  const releaseId = hash.digest('hex').slice(0, 24);
  return {
    version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
    releaseId,
    assetVersion: releaseId,
    buildId: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || releaseId
  };
};
