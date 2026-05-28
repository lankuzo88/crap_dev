'use strict';
// Survey ALL 981 orders with non-empty ghi_chu_sx (not just active 72)
// to discover real-world adjustment patterns and parser misses.

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { getDB } = require('../src/db');
const {
  parseProductionToothAdjustments,
  parseProducts,
} = require('../src/utils/productionMatch');

// Inline copy of adjustmentSummaryForProduct (not exported).
function adjustmentSummaryForProduct(product, adjustments) {
  const originalTeeth = new Set(product.groups.flatMap(group => group.teeth || []));
  const excludedTeeth = [...adjustments.excluded].filter(tooth => originalTeeth.has(tooth));
  const repeats = new Map();
  adjustments.repeats.forEach((count, tooth) => {
    if (originalTeeth.has(tooth)) repeats.set(tooth, count);
  });
  const extra = [...repeats.values()].reduce((sum, count) => sum + Math.max(0, Number(count) - 1), 0);
  const adjustedCount = Math.max(0, originalTeeth.size - excludedTeeth.length + extra);
  return {
    originalCount: originalTeeth.size,
    adjustedCount,
    excludedTeeth,
    repeatTeeth: [...repeats.entries()].map(([tooth, count]) => ({ tooth, count })),
    hasAdjustment: excludedTeeth.length > 0 || repeats.size > 0,
  };
}

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

const db = getDB();
const rows = db.prepare(`
  SELECT ma_dh, ghi_chu_sx, phuc_hinh, sl, keylab_sx_info, nhap_luc
  FROM don_hang
  WHERE TRIM(COALESCE(ghi_chu_sx, '')) <> ''
  ORDER BY nhap_luc DESC
`).all();

console.log(`Scanning ${rows.length} orders with non-empty ghi_chu_sx...\n`);

let triggered = 0, applied = 0, droppedQty = 0, parsedNoProd = 0;
const triggeredExamples = [];
const missThemRang = []; // "thêm R##" not detected
const missMatChain = []; // "mất R26 27 28" form

for (const r of rows) {
  const text = r.ghi_chu_sx || '';
  const n = norm(text);
  const adj = parseProductionToothAdjustments(text);
  const hasAdj = adj.excluded.size > 0 || adj.repeats.size > 0;
  if (hasAdj) {
    triggered++;
    const products = parseProducts(r);
    const main = products.filter(p => !p.isAccessory);
    let matched = false, anyQty = false;
    for (const product of main) {
      const summary = adjustmentSummaryForProduct(product, adj);
      if (summary.hasAdjustment) {
        matched = true;
        const qty = Number(product.qty) || 0;
        if (summary.adjustedCount === qty) anyQty = true;
      }
    }
    if (anyQty) applied++;
    else if (matched) droppedQty++;
    else parsedNoProd++;
    if (triggeredExamples.length < 12) {
      triggeredExamples.push({
        ma_dh: r.ma_dh,
        date: r.nhap_luc,
        excluded: [...adj.excluded],
        repeats: [...adj.repeats.entries()],
        status: anyQty ? 'applied' : (matched ? 'qty-mismatch' : 'no-prod-match'),
        note: text.replace(/\r?\n/g, ' | ').slice(0, 180),
      });
    }
  }

  // Detect candidate "thêm R##" misses — exclude common non-count meanings
  const themRangMatch = /\bthem\s+(?:1\s+|2\s+|3\s+|mot\s+|hai\s+)?r\s*(\d{2})\b/.exec(n);
  if (themRangMatch) {
    // Skip if the context suggests technique not count
    const isTechnique = /them\s+su|them\s+khop\s+can|them\s+ngan|them\s+chi\s+dinh|them\s+vat\s+lieu|them\s+vien|lam\s+them/.test(n);
    if (!isTechnique && missThemRang.length < 10) {
      missThemRang.push({
        ma_dh: r.ma_dh,
        date: r.nhap_luc,
        match: themRangMatch[0],
        tooth: themRangMatch[1],
        note: text.replace(/\r?\n/g, ' | ').slice(0, 200),
      });
    }
  }

  // Detect candidate "mất R26 27 28" chained-numbers form
  const chainMatch = /(?:mat|thieu|bo|khong\s+lam)\s+r?\s*\d{2}\s+\d{2}/.exec(n);
  if (chainMatch && missMatChain.length < 10) {
    missMatChain.push({
      ma_dh: r.ma_dh,
      date: r.nhap_luc,
      match: chainMatch[0],
      note: text.replace(/\r?\n/g, ' | ').slice(0, 200),
    });
  }
}

console.log('=== Parser-triggered orders ===');
console.log(`Triggered: ${triggered} / ${rows.length}`);
console.log(`  applied   (count matches SL): ${applied}`);
console.log(`  qty-mismatch (dropped)      : ${droppedQty}`);
console.log(`  no-product-match           : ${parsedNoProd}\n`);

if (triggeredExamples.length) {
  console.log('Triggered examples:');
  triggeredExamples.forEach(e => {
    console.log(`[${e.ma_dh}] ${e.date} — ${e.status}`);
    console.log(`  excluded=${JSON.stringify(e.excluded)} repeats=${JSON.stringify(e.repeats)}`);
    console.log(`  note: ${e.note}`);
  });
} else {
  console.log('(no examples)');
}

console.log('\n=== Candidate "thêm R##" misses ===');
console.log(`Count: ${missThemRang.length}`);
missThemRang.forEach(m => {
  console.log(`[${m.ma_dh}] ${m.date} match="${m.match}" → R${m.tooth}`);
  console.log(`  note: ${m.note}`);
});

console.log('\n=== Candidate "mất R## ## ##" chained misses ===');
console.log(`Count: ${missMatChain.length}`);
missMatChain.forEach(m => {
  console.log(`[${m.ma_dh}] ${m.date} match="${m.match}"`);
  console.log(`  note: ${m.note}`);
});
