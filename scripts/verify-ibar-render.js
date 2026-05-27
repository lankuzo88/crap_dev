'use strict';
// Verify isIbarProduct + getToothChartIbars by loading from admin.html
// (same logic in dashboard.html and dashboard_mobile_terracotta.html).

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

process.chdir(path.join(__dirname, '..'));

function loadFunctions(file, names) {
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  // Stub helpers minimal but functional for ibar checks.
  vm.runInContext(`
    function cleanDisplayText(value) { return String(value == null ? '' : value).trim(); }
    function normalizePhText(value) {
      return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[\\u0111\\u0110]/g, 'd');
    }
    function parseKeylabSxInfo(raw) {
      if (!raw) return {};
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(raw) || {}; } catch { return {}; }
    }
    function splitPhParts(ph) {
      return String(ph || '').split(/;|\\r?\\n/).map(p => p.trim()).filter(Boolean);
    }
    function partQty(part) {
      const m = String(part || '').match(/SL\\s*:\\s*(\\d+)/i);
      return m ? Number(m[1]) || 0 : 0;
    }
    function extractRangFromPart(part) {
      const m = String(part || '').match(/R\\s*:\\s*([^)]*?)(?:,\\s*-\\s*SL\\s*:|\\s*-\\s*SL\\s*:|\\))/i);
      return m ? m[1].replace(/,+\\s*$/g, '').trim() : '';
    }
    function stripRangBlock(part) {
      return cleanDisplayText(part).replace(/\\s*\\([^)]*R\\s*:[^)]*\\)\\s*/i, '').trim();
    }
    const TOOTH_UPPER = ['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28'];
    const TOOTH_LOWER = ['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38'];
    const TOOTH_ROWS = { upper: TOOTH_UPPER, lower: TOOTH_LOWER };
    const TOOTH_INDEX = new Map();
    TOOTH_UPPER.forEach((t, i) => TOOTH_INDEX.set(t, { row: 'upper', index: i }));
    TOOTH_LOWER.forEach((t, i) => TOOTH_INDEX.set(t, { row: 'lower', index: i }));
    function toothPos(t) { return TOOTH_INDEX.get(String(t)) || null; }
    function expandFdiRange(from, to) {
      const a = toothPos(from), b = toothPos(to);
      if (!a || !b || a.row !== b.row) return [String(from), String(to)].filter(toothPos);
      const row = TOOTH_ROWS[a.row];
      return row.slice(Math.min(a.index, b.index), Math.max(a.index, b.index) + 1);
    }
    function parseToothGroups(rawValue) {
      const raw = cleanDisplayText(rawValue);
      if (!raw) return [];
      const groups = [];
      const normalized = normalizePhText(raw);
      if (/\\bhtren\\b/.test(normalized) || normalized.includes('ham tren')) groups.push({ type: 'full', row: 'upper', teeth: TOOTH_UPPER.slice(), raw: 'HTren' });
      if (/\\bhduoi\\b/.test(normalized) || normalized.includes('ham duoi')) groups.push({ type: 'full', row: 'lower', teeth: TOOTH_LOWER.slice(), raw: 'HDuoi' });
      raw.replace(/[，、]/g, ',').replace(/[.;．。]/g, ',').replace(/\\s+/g, '').split(',').forEach(token => {
        if (!token) return;
        const bridge = token.match(/^(\\d{2})-(\\d{2})$/);
        if (bridge) {
          const teeth = expandFdiRange(bridge[1], bridge[2]);
          if (teeth.length) groups.push({ type: 'bridge', teeth, raw: bridge[1] + '-' + bridge[2] });
          return;
        }
        const single = token.match(/^(\\d{2})$/);
        if (single && toothPos(single[1])) groups.push({ type: 'single', teeth: [single[1]], raw: single[1] });
      });
      return groups;
    }
    function getAdminPhText(o) { return cleanDisplayText(o?.allPh || o?.ph || o?.phuc_hinh || ''); }
  `, sandbox);
  // Now extract requested functions from the file.
  for (const name of names) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`${file} missing ${name}()`);
    const open = src.indexOf('{', start);
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      if (src[i] === '}') depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
    vm.runInContext(src.slice(start, end) + `\nthis.${name} = ${name};`, sandbox);
  }
  return sandbox;
}

const env = loadFunctions('admin.html', ['isIbarProduct', 'getToothChartIbars']);
const { isIbarProduct, getToothChartIbars } = env;

// Test 1: isIbarProduct positive matches
assert.strictEqual(isIbarProduct('Thanh Bar kim loại Titanium - trên 6 đv (ibar)'), true, 'should match thanh bar ibar long');
assert.strictEqual(isIbarProduct('Thanh Bar kim loại Titanium- Từ 2-6đv ( ibar)'), true, 'should match thanh bar ibar short');
assert.strictEqual(isIbarProduct('I-bar Titanium'), true, 'should match I-bar');
assert.strictEqual(isIbarProduct('ibar khung'), true, 'should match ibar word');

// Test 2: isIbarProduct negative — generic accessories shouldn't be picked up as ibar
assert.strictEqual(isIbarProduct('Răng sứ Zircornia'), false, 'zirc product not ibar');
assert.strictEqual(isIbarProduct('Khay cá nhân'), false, 'tray not ibar');
assert.strictEqual(isIbarProduct('Đính đá'), false, 'attachment not ibar');
// We narrow to thanh bar / ibar / i-bar / i bar to avoid false positives from
// the word "bar" appearing in other product descriptions.
assert.strictEqual(isIbarProduct('Bar code label'), false, 'generic "bar" word not matched');

// Test 3: getToothChartIbars on order 262705034
const order262705034 = {
  keylab_sx_info: JSON.stringify({
    products: [
      { san_pham: 'Veneer sứ Zolid (Cut-Back)', rang: '16-25,', so_luong: '11', loai_san_pham: 'Làm mới' },
      { san_pham: 'Thanh Bar kim loại Titanium - trên 6 đv (ibar)', rang: '16-25,', so_luong: '1', loai_san_pham: 'Làm mới' },
    ],
  }),
};
const ibars = getToothChartIbars(order262705034);
assert.strictEqual(ibars.length, 1, 'expected 1 ibar from 262705034');
assert.strictEqual(ibars[0].qty, 1, 'ibar SL=1');
assert.strictEqual(ibars[0].rang, '16-25,', 'ibar rang preserved');
// Compare as joined string to avoid VM-sandbox vs main-context Array prototype mismatch.
assert.strictEqual(
  Array.from(ibars[0].groups[0].teeth).join(','),
  '16,15,14,13,12,11,21,22,23,24,25',
  'ibar spans 11 teeth from 16 to 25'
);

// Test 4: order with NO ibar returns empty
const orderNoIbar = {
  keylab_sx_info: JSON.stringify({
    products: [
      { san_pham: 'Răng sứ Zircornia', rang: '13-23,', so_luong: '6' },
    ],
  }),
};
assert.strictEqual(getToothChartIbars(orderNoIbar).length, 0, 'order without ibar returns empty');

console.log('✓ all ibar tests passed');
