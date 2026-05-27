'use strict';

// Read-only diagnostic: scan all active orders for cases where
// parseClinicalBridges(ghi_chu_sx) returns fewer/different bridges than
// the product range field, causing the modal to render only the noted
// bridges and the rest as separate teeth.
//
// Does NOT modify any data. Safe to run on prod.

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const { getDB } = require('../src/db');
const { getActiveMaDhList } = require('../src/repositories/orders.repo');
const { parseToothGroups, expandFdiRange, toothPos, normalizeText } = require('../src/utils/productionMatch');

function cleanDisplayText(value) { return String(value || ''); }

function parseClinicalBridges(note) {
  if (!note || !/\bcau\b/.test(normalizeText(note))) return [];
  const bridges = [];
  const rx = /\((\d{2})\s*-\s*(\d{2})\)/g;
  let m;
  const normalized = normalizeText(cleanDisplayText(note));
  while ((m = rx.exec(normalized))) {
    const teeth = expandFdiRange(m[1], m[2]).map(String);
    if (teeth.length >= 2 && teeth.every(t => toothPos(t))) {
      bridges.push({ from: m[1], to: m[2], teeth });
    }
  }
  return bridges;
}

function parseSxInfo(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

function collectProductBridges(sxInfo) {
  const products = (sxInfo && Array.isArray(sxInfo.products)) ? sxInfo.products : [];
  const bridges = [];
  for (const p of products) {
    const groups = parseToothGroups(p?.rang || '');
    for (const g of groups) {
      if (g.type === 'bridge') bridges.push({ raw: g.raw, teeth: g.teeth, product: p?.san_pham || '' });
    }
  }
  return bridges;
}

function bridgeKey(b) { return b.teeth.join(','); }

function main() {
  const active = getActiveMaDhList();
  if (!active || !active.ids.length) {
    console.error('No active orders (Excel file not found?)');
    process.exit(1);
  }
  const db = getDB();
  if (!db) {
    console.error('No DB');
    process.exit(1);
  }
  const ph = active.ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ma_dh, ghi_chu_sx, keylab_sx_info
    FROM don_hang
    WHERE ma_dh IN (${ph})
  `).all(...active.ids);

  const issues = [];
  const okMatches = [];
  const noClinical = []; // product bridges exist but no clinical override → no issue
  const noProductBridges = []; // single-tooth orders, ignore

  for (const r of rows) {
    const sxInfo = parseSxInfo(r.keylab_sx_info);
    if (!sxInfo) continue;
    const productBridges = collectProductBridges(sxInfo);
    const clinical = parseClinicalBridges(r.ghi_chu_sx || '');

    if (!productBridges.length) {
      noProductBridges.push(r.ma_dh);
      continue;
    }
    if (!clinical.length) {
      noClinical.push(r.ma_dh);
      continue;
    }

    const pKeys = new Set(productBridges.map(bridgeKey));
    const cKeys = new Set(clinical.map(bridgeKey));
    const droppedFromProduct = [...pKeys].filter(k => !cKeys.has(k));
    const extraInClinical = [...cKeys].filter(k => !pKeys.has(k));

    if (droppedFromProduct.length === 0 && extraInClinical.length === 0) {
      okMatches.push(r.ma_dh);
      continue;
    }

    issues.push({
      ma_dh: r.ma_dh,
      ghi_chu_sx: r.ghi_chu_sx || '',
      productBridges: productBridges.map(b => b.raw),
      clinicalBridges: clinical.map(b => `${b.from}-${b.to}`),
      droppedProductBridges: droppedFromProduct.map(k => productBridges.find(b => bridgeKey(b) === k)?.raw).filter(Boolean),
      extraClinicalBridges: extraInClinical.map(k => clinical.find(b => bridgeKey(b) === k))
        .filter(Boolean).map(b => `${b.from}-${b.to}`),
    });
  }

  console.log(`Active orders scanned: ${rows.length}`);
  console.log(`- no product bridges (single-tooth orders): ${noProductBridges.length}`);
  console.log(`- product bridges only, no clinical override: ${noClinical.length}`);
  console.log(`- product == clinical (override is harmless): ${okMatches.length}`);
  console.log(`- MISMATCH (override drops product bridges): ${issues.length}`);
  console.log();

  if (!issues.length) return;

  console.log('=== MISMATCH DETAIL ===');
  for (const it of issues) {
    console.log(`\n[${it.ma_dh}]`);
    console.log(`  product bridges  : ${it.productBridges.join('  ') || '(none)'}`);
    console.log(`  clinical bridges : ${it.clinicalBridges.join('  ') || '(none)'}`);
    console.log(`  DROPPED          : ${it.droppedProductBridges.join('  ') || '(none)'}`);
    if (it.extraClinicalBridges.length) {
      console.log(`  extra in clinical: ${it.extraClinicalBridges.join('  ')}`);
    }
    const note = String(it.ghi_chu_sx).replace(/\r?\n/g, ' | ').slice(0, 220);
    console.log(`  ghi_chu_sx       : ${note}`);
  }
}

main();
