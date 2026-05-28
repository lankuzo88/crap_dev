'use strict';
// Check coverage of parseProductionToothAdjustments() against:
//  1. synthetic edge-case inputs the user might write
//  2. real ghi_chu_sx text on active orders
//  3. whether adjustments actually get APPLIED to the chart (not just parsed)

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { getDB } = require('../src/db');
const { getActiveMaDhList } = require('../src/repositories/orders.repo');
const {
  parseProductionToothAdjustments,
  parseProducts,
  adjustmentSummaryForProduct,
} = require('../src/utils/productionMatch');

// 1. Synthetic tests covering user-mentioned cases.
const synthetic = [
  // Exclusion
  ['mất R45',                  { excluded: ['45'], repeats: [] }],
  ['không làm R26',            { excluded: ['26'], repeats: [] }],
  ['bỏ R26',                   { excluded: ['26'], repeats: [] }],
  ['thiếu R45',                { excluded: ['45'], repeats: [] }],
  ['mất R45-46',               { excluded: ['45','46'], repeats: [] }],
  ['mất 1 răng',               { excluded: [], repeats: [] }], // no number → not detected
  // Repeats
  ['2 răng 45',                { excluded: [], repeats: [['45',2]] }],
  ['R45 có 2 răng',            { excluded: [], repeats: [['45',2]] }],
  ['Mỗi bên có 2 R2',          { excluded: [], repeats: [['12',2],['22',2]] }],
  // Additions ("thêm") — none of these are currently detected
  ['thêm R45',                 { excluded: [], repeats: [] }],
  ['thêm 1 R45',               { excluded: [], repeats: [] }],
  ['+ R45',                    { excluded: [], repeats: [] }],
  ['thêm 1 răng',              { excluded: [], repeats: [] }],
  // Anatomical "mặt R##" (should be ignored)
  ['lưu ý mặt R45',            { excluded: [], repeats: [] }],
  // Border cases
  ['Làm cầu (23-28) 5R mất R26', { excluded: ['26'], repeats: [] }],
  ['mất R26 27 28',            { excluded: ['26','27','28'], repeats: [] }], // current regex iterates so picks all
];

console.log('=== Synthetic input coverage ===\n');
let pass = 0, fail = 0;
for (const [input, expect] of synthetic) {
  const got = parseProductionToothAdjustments(input);
  const gotExcluded = [...got.excluded].sort();
  const gotRepeats = [...got.repeats.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  const expExcluded = [...expect.excluded].sort();
  const expRepeats = [...expect.repeats].sort((a,b) => a[0].localeCompare(b[0]));
  const okExcluded = JSON.stringify(gotExcluded) === JSON.stringify(expExcluded);
  const okRepeats = JSON.stringify(gotRepeats) === JSON.stringify(expRepeats);
  const ok = okExcluded && okRepeats;
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} "${input}"`);
  if (!ok) {
    console.log(`   expected excluded=${JSON.stringify(expExcluded)} repeats=${JSON.stringify(expRepeats)}`);
    console.log(`   got      excluded=${JSON.stringify(gotExcluded)} repeats=${JSON.stringify(gotRepeats)}`);
  }
}
console.log(`\n${pass}/${pass+fail} synthetic cases match current behavior.`);

// 2. Scan active orders: which ghi_chu_sx notes actually trigger adjustments?
const active = getActiveMaDhList();
const db = getDB();
const ph = active.ids.map(() => '?').join(',');
const rows = db.prepare(`
  SELECT ma_dh, ghi_chu_sx, phuc_hinh, sl, keylab_sx_info
  FROM don_hang WHERE ma_dh IN (${ph})
`).all(...active.ids);

let triggered = 0;
let applied = 0;
let droppedDueToQty = 0;
let parsedButNoMatchingProduct = 0;
const examples = [];
const candidateMisses = [];

for (const r of rows) {
  if (!r.ghi_chu_sx) continue;
  const adj = parseProductionToothAdjustments(r.ghi_chu_sx);
  const hasAdj = adj.excluded.size > 0 || adj.repeats.size > 0;
  if (hasAdj) {
    triggered++;
    const products = parseProducts(r);
    const main = products.filter(p => !p.isAccessory);
    let matched = false;
    let anyMatchesQty = false;
    for (const product of main) {
      const summary = adjustmentSummaryForProduct(product, adj);
      if (summary.hasAdjustment) {
        matched = true;
        const qty = Number(product.qty) || 0;
        if (summary.adjustedCount === qty) anyMatchesQty = true;
      }
    }
    if (anyMatchesQty) applied++;
    else if (matched) droppedDueToQty++;
    else parsedButNoMatchingProduct++;
    if (examples.length < 8) {
      examples.push({
        ma_dh: r.ma_dh,
        note: String(r.ghi_chu_sx).replace(/\r?\n/g, ' | ').slice(0, 160),
        excluded: [...adj.excluded],
        repeats: [...adj.repeats.entries()],
        applied: anyMatchesQty,
      });
    }
  } else {
    // Look for "missed" patterns: notes mentioning tooth numbers and adjustment-like
    // keywords that the current parser does NOT detect.
    const text = String(r.ghi_chu_sx).toLowerCase();
    const norm = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd');
    // Look for "them" (thêm) followed by a tooth digit
    const hasThem = /\bthem\s+(?:1\s+)?r?\s*\d{2}/.test(norm) || /\bthem\s+\d+\s*r/.test(norm);
    // "lam them" (làm thêm) is common in keylab notes but usually means "additional work", not extra teeth
    const isLamThem = /lam\s+them/.test(norm);
    if (hasThem && !isLamThem && candidateMisses.length < 12) {
      candidateMisses.push({
        ma_dh: r.ma_dh,
        snippet: text.slice(0, 200).replace(/\s+/g, ' '),
      });
    }
  }
}

console.log('\n=== Real-data scan (72 active orders) ===');
console.log(`Notes that triggered adjustments: ${triggered}`);
console.log(`  - applied (adjustedCount === qty)   : ${applied}`);
console.log(`  - parsed but dropped due to qty diff: ${droppedDueToQty}`);
console.log(`  - parsed but no product affected   : ${parsedButNoMatchingProduct}`);

console.log('\nFirst examples:');
examples.forEach(e => {
  console.log(`[${e.ma_dh}] ${e.applied ? '✓ applied' : '✗ parsed-only'}`);
  console.log(`  excluded: ${JSON.stringify(e.excluded)} repeats: ${JSON.stringify(e.repeats)}`);
  console.log(`  note: ${e.note}`);
});

if (candidateMisses.length) {
  console.log('\nCandidate "thêm" mentions not detected by parser:');
  candidateMisses.forEach(m => console.log(`[${m.ma_dh}] ${m.snippet}`));
} else {
  console.log('\nNo "thêm R##" pattern found in active-order notes that current parser missed.');
}
