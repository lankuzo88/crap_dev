'use strict';
// Survey ghi_chu_sx content to discover what patterns KTV actually writes
// for "missing tooth", "extra tooth", and "duplicate tooth", so we can
// tune the parser.

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { getDB } = require('../src/db');
const { getActiveMaDhList } = require('../src/repositories/orders.repo');

const active = getActiveMaDhList();
const db = getDB();
const ph = active.ids.map(() => '?').join(',');
const rows = db.prepare(`
  SELECT ma_dh, ghi_chu_sx FROM don_hang WHERE ma_dh IN (${ph}) AND ghi_chu_sx <> ''
`).all(...active.ids);

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

function findContext(text, keyword, window = 60) {
  const n = norm(text);
  const i = n.indexOf(keyword);
  if (i < 0) return null;
  const start = Math.max(0, i - 20);
  const end = Math.min(text.length, i + keyword.length + window);
  return text.slice(start, end).replace(/\s+/g, ' ');
}

const patterns = {
  mat: [],      // "mat" (mất)
  thieu: [],    // "thieu" (thiếu)
  them: [],     // "them" (thêm) — not isolated to "lam them"
  bo: [],       // "bo" (bỏ)
  khong_lam: [], // "khong lam" (không làm)
  ko_lam: [],
  ngoai_them: [], // "thêm" not preceded by "làm"
  duplicate: [], // patterns like "2 r45", "r45 co 2 r", etc.
};

for (const r of rows) {
  const text = r.ghi_chu_sx;
  const n = norm(text);
  if (/\bmat\s/.test(n)) patterns.mat.push({ ma_dh: r.ma_dh, ctx: findContext(text, 'mat', 50) });
  if (/\bthieu/.test(n)) patterns.thieu.push({ ma_dh: r.ma_dh, ctx: findContext(text, 'thieu', 50) });
  if (/\bthem\b/.test(n) && !/lam\s+them/.test(n)) patterns.ngoai_them.push({ ma_dh: r.ma_dh, ctx: findContext(text, 'them', 50) });
  if (/\bthem\s+r?\s*\d/.test(n)) patterns.them.push({ ma_dh: r.ma_dh, ctx: findContext(text, 'them', 50) });
  if (/\bbo\s+r/.test(n)) patterns.bo.push({ ma_dh: r.ma_dh, ctx: findContext(text, 'bo', 50) });
  if (/khong\s+lam/.test(n)) patterns.khong_lam.push({ ma_dh: r.ma_dh, ctx: findContext(text, 'khong lam', 50) });
  if (/\bko\s+lam/.test(n)) patterns.ko_lam.push({ ma_dh: r.ma_dh, ctx: findContext(text, 'ko lam', 50) });
  if (/\d+\s*(?:r|rang)\s*\d{2}/.test(n) || /r\s*\d{2}\s*(?:co|la)?\s*\d+\s*(?:r|rang)/.test(n)) {
    patterns.duplicate.push({ ma_dh: r.ma_dh, ctx: text.slice(0, 200).replace(/\s+/g, ' ') });
  }
}

console.log(`Scanned ${rows.length} non-empty notes\n`);
for (const [name, hits] of Object.entries(patterns)) {
  console.log(`=== "${name}" mentions: ${hits.length} ===`);
  hits.slice(0, 6).forEach(h => console.log(`[${h.ma_dh}] ${h.ctx}`));
  console.log();
}
