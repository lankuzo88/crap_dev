'use strict';
// Scan active orders for zirconia products and classify their sub-categories
// (full crown vs veneer vs cut-back etc.) — so we can design a richer display.

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { getDB } = require('../src/db');
const { getActiveMaDhList } = require('../src/repositories/orders.repo');
const { normalizeText } = require('../src/utils/productionMatch');

function parseSxInfo(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

function isZircFamily(name) {
  const n = normalizeText(name);
  return (
    n.includes('zir') || n.includes('zircornia') || n.includes('zirconia') || n.includes('ziconia') ||
    n.includes('zolid') || n.includes('cercon') || n.includes('diamond') || n.includes('la va') || n.includes('argen')
  );
}

function classifyZircSubtype(name) {
  const n = normalizeText(name);
  if (n.includes('veneer') || n.includes('mat dan') || n.includes('canh dan')) return 'veneer';
  if (n.includes('cut back') || n.includes('cut-back') || n.includes('cutback')) return 'cutback';
  if (n.includes('full')) return 'full';
  if (n.includes('inlay') || n.includes('onlay')) return 'inlay';
  return 'crown';
}

function isAccessoryLike(name) {
  const n = normalizeText(name);
  return (
    n.includes('cui gia') || n.includes('in mau') || n.includes('thanh bar') || n.includes('ibar') ||
    n.includes('rang tam') || n.includes('khay') || n.includes('mang') || n.includes('khoan lo') ||
    n.includes('dinh da') || n.includes('attachment')
  );
}

function main() {
  const active = getActiveMaDhList();
  if (!active || !active.ids.length) { console.error('No active'); process.exit(1); }
  const db = getDB();
  const ph = active.ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT ma_dh, ghi_chu_sx, keylab_sx_info FROM don_hang WHERE ma_dh IN (${ph})`).all(...active.ids);

  const subtypeCounts = { crown: 0, veneer: 0, cutback: 0, full: 0, inlay: 0 };
  const mixedOrders = [];
  let zircOrderCount = 0;

  for (const r of rows) {
    const sx = parseSxInfo(r.keylab_sx_info);
    if (!sx || !Array.isArray(sx.products)) continue;
    const zircProducts = sx.products
      .filter(p => !isAccessoryLike(p?.san_pham || ''))
      .filter(p => isZircFamily(p?.san_pham || ''))
      .map(p => ({ name: p.san_pham, rang: p.rang, sl: p.so_luong, subtype: classifyZircSubtype(p.san_pham) }));
    if (!zircProducts.length) continue;
    zircOrderCount += 1;
    zircProducts.forEach(p => { subtypeCounts[p.subtype] = (subtypeCounts[p.subtype] || 0) + 1; });
    const subtypeSet = new Set(zircProducts.map(p => p.subtype));
    if (subtypeSet.size >= 2) {
      mixedOrders.push({ ma_dh: r.ma_dh, products: zircProducts, subtypes: [...subtypeSet] });
    }
  }

  console.log(`Active orders with zirconia main products: ${zircOrderCount}`);
  console.log('Subtype occurrences (product-level):', subtypeCounts);
  console.log(`Orders with MIXED zirconia subtypes: ${mixedOrders.length}`);
  console.log();
  mixedOrders.slice(0, 12).forEach(o => {
    console.log(`[${o.ma_dh}] subtypes: ${o.subtypes.join(', ')}`);
    o.products.forEach(p => console.log(`   - [${p.subtype}] ${p.name} | R:${p.rang} SL:${p.sl}`));
  });
}

main();
