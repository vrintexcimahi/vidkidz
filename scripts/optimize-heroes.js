// Lossy delivery copies; retain the original PNG artwork for future edits.
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
(async () => {
  for (const role of ['family', 'admin', 'kid']) {
    const source = path.join(root, `public/assets/images/${role}-hero-3d.png`);
    const target = path.join(root, `public/assets/images/${role}-hero-3d.webp`);
    await sharp(source).resize(768,768,{fit:'inside',withoutEnlargement:true}).webp({quality:86,alphaQuality:100}).toFile(target);
    console.log(`${role}: ${fs.statSync(source).size} -> ${fs.statSync(target).size} bytes`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
