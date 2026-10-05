const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const babel = require('@babel/parser');

function checkUI(root = path.resolve(__dirname, '..')) {
  let checked = 0;
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!/\.(html|css|js)$/.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (file.endsWith('.css')) postcss.parse(text, { from: file });
      else if (file.endsWith('.js')) babel.parse(text, { sourceType: 'unambiguous' });
      else {
        for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
          postcss.parse(match[1], { from: file });
        }
        for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          if (/\bsrc\s*=/.test(match[1]) || /application\/(ld\+)?json/.test(match[1])) continue;
          babel.parse(match[2], { sourceType: 'unambiguous', plugins: ['jsx'] });
        }
      }
      checked++;
    }
  }
  visit(path.join(root, 'public'));
  return checked;
}
if (require.main === module) {
  try { console.log(`UI syntax OK: ${checkUI()} HTML/CSS/JS files`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkUI };
