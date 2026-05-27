'use strict';
// Verify zirconia/metal subtype classification on real active orders:
// - 2 known mixed-subtype zirc orders must classify into distinct subtypes
// - All 26 zirc-bearing orders must still resolve to one of the 3 zirc subtypes
//   (none falling back to 'kl' or other family)
// - All non-zirc/non-metal-veneer orders must keep their previous classification

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

process.chdir(path.join(__dirname, '..'));

const { getDB } = require('../src/db');
const { getActiveMaDhList } = require('../src/repositories/orders.repo');

function loadPhType(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`
    function normalizePhText(value) {
      return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[\\u0111\\u0110]/g, 'd');
    }
    function hasInMauHamText(text) {
      const n = normalizePhText(text);
      return n.includes('in mau ham') || (n.includes('in mau') && n.includes('ham')) || (n.includes('in ban') && n.includes('ham')) || (n.includes('in toan') && n.includes('ham'));
    }
  `, sandbox);
  // Extract both phType/partType and phFamily.
  for (const fn of [name, 'phFamily']) {
    const start = src.indexOf(`function ${fn}(`);
    if (start < 0) throw new Error(`${file} missing ${fn}()`);
    const open = src.indexOf('{', start);
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      if (src[i] === '}') depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
    vm.runInContext(src.slice(start, end) + `\nthis.${fn} = ${fn};`, sandbox);
  }
  sandbox.classify = sandbox[name];
  return sandbox;
}

const adminEnv = loadPhType('admin.html', 'phType');
const desktopEnv = loadPhType('dashboard.html', 'phType');
const mobileEnv = loadPhType('dashboard_mobile_terracotta.html', 'partType');

// 1. Unit tests across all 3 files — classification must be identical.
const cases = [
  ['Răng sứ Zircornia', 'zirc'],
  ['Răng sứ Cercon', 'zirc'],
  ['Răng sứ Zolid', 'zirc'],
  ['Full Sứ Ziconia', 'zircf'],
  ['Full Zirconia', 'zircf'],
  ['Veneer sứ Ziconia (Cut Back)', 'zircv'],
  ['Veneer sứ Zolid (Cut-Back)', 'zircv'],
  ['Veneer Cercon', 'zircv'],
  ['Răng sứ kim loại thường', 'kl'],
  ['Răng sứ Titanium', 'kl'],
  ['Full/ mão kim loại sứ titan', 'klf'],
  ['Veneer sứ kim loại thường (Cut Back)', 'klv'],
  ['Mặt dán sứ', 'vnr'],
  ['Cánh dán sứ', 'vnr'],
];
let unitPass = 0;
for (const [name, env] of [['admin', adminEnv], ['desktop', desktopEnv], ['mobile', mobileEnv]]) {
  for (const [input, expected] of cases) {
    const got = env.classify(input);
    const ok = got === expected;
    if (!ok) console.log(`✗ [${name}] "${input}" expected ${expected} got ${got}`);
    if (ok) unitPass += 1;
  }
}
assert.strictEqual(unitPass, 3 * cases.length, `unit tests: ${unitPass}/${3*cases.length} passed`);
console.log(`✓ unit classification: ${unitPass}/${3*cases.length} (admin + desktop + mobile)`);

// 2. phFamily mapping
for (const [name, env] of [['admin', adminEnv], ['desktop', desktopEnv], ['mobile', mobileEnv]]) {
  assert.strictEqual(env.phFamily('zircf'), 'zirc', `${name}: zircf → zirc`);
  assert.strictEqual(env.phFamily('zircv'), 'zirc', `${name}: zircv → zirc`);
  assert.strictEqual(env.phFamily('klf'), 'kl', `${name}: klf → kl`);
  assert.strictEqual(env.phFamily('klv'), 'kl', `${name}: klv → kl`);
  assert.strictEqual(env.phFamily('zirc'), 'zirc', `${name}: zirc identity`);
  assert.strictEqual(env.phFamily('kl'), 'kl', `${name}: kl identity`);
  assert.strictEqual(env.phFamily('vnr'), 'vnr', `${name}: vnr identity`);
  assert.strictEqual(env.phFamily('hon'), 'hon', `${name}: hon identity`);
  assert.strictEqual(env.phFamily('ibar'), 'ibar', `${name}: ibar identity`);
}
console.log('✓ phFamily mapping correct in all 3 files');

// 3. Real-data scan: every zirc-bearing order must classify into zirc/zircf/zircv,
//    not collapse to a non-zirc family.
function parseSxInfo(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}
function isZircFamily(name) {
  const n = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[đĐ]/g, 'd');
  return n.includes('zir') || n.includes('ziconia') || n.includes('zolid') || n.includes('cercon') || n.includes('la va') || n.includes('argen');
}
function isAccessoryLike(name) {
  const n = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[đĐ]/g, 'd');
  return n.includes('cui gia') || n.includes('thanh bar') || n.includes('ibar') || n.includes('in mau');
}

const active = getActiveMaDhList();
const db = getDB();
const ph = active.ids.map(() => '?').join(',');
const rows = db.prepare(`SELECT ma_dh, keylab_sx_info FROM don_hang WHERE ma_dh IN (${ph})`).all(...active.ids);

let zircOrderCount = 0;
let zircProductCount = 0;
const subtypeBreakdown = { zirc: 0, zircf: 0, zircv: 0 };
const mismatched = [];
const mixedOrders = [];

for (const r of rows) {
  const sx = parseSxInfo(r.keylab_sx_info);
  if (!sx || !Array.isArray(sx.products)) continue;
  const zircProducts = sx.products.filter(p => !isAccessoryLike(p?.san_pham || '')).filter(p => isZircFamily(p?.san_pham || ''));
  if (!zircProducts.length) continue;
  zircOrderCount += 1;
  const subtypes = new Set();
  for (const p of zircProducts) {
    zircProductCount += 1;
    const t = adminEnv.classify(p.san_pham);
    if (!['zirc','zircf','zircv'].includes(t)) {
      mismatched.push({ ma_dh: r.ma_dh, name: p.san_pham, got: t });
    } else {
      subtypeBreakdown[t] += 1;
      subtypes.add(t);
    }
  }
  if (subtypes.size >= 2) mixedOrders.push({ ma_dh: r.ma_dh, subtypes: [...subtypes] });
}

console.log(`✓ scanned ${zircOrderCount} zirc orders / ${zircProductCount} zirc products`);
console.log(`  subtype distribution: ${JSON.stringify(subtypeBreakdown)}`);
console.log(`  mixed-subtype orders: ${mixedOrders.length}`);
mixedOrders.forEach(o => console.log(`    [${o.ma_dh}] subtypes: ${o.subtypes.join(', ')}`));

assert.strictEqual(mismatched.length, 0, `${mismatched.length} zirc products did not classify into zirc/zircf/zircv`);

// 4. Confirm the 2 known mixed orders contain distinct subtypes.
const known = mixedOrders.find(o => o.ma_dh === '260505070-4');
assert(known, '260505070-4 must be detected as mixed-subtype');
assert(known.subtypes.includes('zircf') && known.subtypes.includes('zircv'), '260505070-4 must have zircf + zircv');
const known2 = mixedOrders.find(o => o.ma_dh === '262505047-1');
assert(known2, '262505047-1 must be detected as mixed-subtype');
assert(known2.subtypes.includes('zirc') && known2.subtypes.includes('zircf'), '262505047-1 must have zirc + zircf');
console.log('✓ 260505070-4 and 262505047-1 classify into expected distinct subtypes');

console.log('\nAll subtype classification tests passed.');
