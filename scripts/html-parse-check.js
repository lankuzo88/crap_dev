// Parse-check inline <script> blocks inside an HTML file.
// Usage: node scripts/html-parse-check.js dashboard.html dashboard_mobile_terracotta.html ...
// Exits 0 if all blocks parse, non-zero otherwise.

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node html-parse-check.js <file.html> [more.html ...]');
  process.exit(2);
}

let totalBlocks = 0;
let failed = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`MISSING: ${file}`);
    failed++;
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  const rx = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let m;
  let blocks = 0;
  while ((m = rx.exec(html))) {
    blocks++;
    totalBlocks++;
    const body = m[1];
    if (!body.trim()) continue;
    try {
      new Function(body);
    } catch (e) {
      failed++;
      console.error(`PARSE FAIL  ${path.basename(file)} script#${blocks}: ${e.message}`);
    }
  }
  if (blocks === 0) console.warn(`note: no <script> blocks in ${file}`);
}

if (failed) {
  console.error(`\n${failed} parse error(s) across ${totalBlocks} block(s)`);
  process.exit(1);
}
console.log(`OK: ${totalBlocks} script block(s) across ${files.length} file(s)`);
