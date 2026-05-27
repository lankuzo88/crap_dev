const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadFunction(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf(`function ${name}(`);
  assert(start >= 0, `${file} missing ${name}()`);
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') depth -= 1;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
  assert(end > open, `${file} has incomplete ${name}()`);
  const fnSource = src.slice(start, end);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`
    function cleanDisplayText(value) { return String(value || ''); }
    function normalizePhText(value) {
      return String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\u0111/g, 'd');
    }
    function hasInMauHamText(text) {
      const n = normalizePhText(text);
      return n.includes('in mau ham') || (n.includes('in mau') && n.includes('ham')) || (n.includes('in ban') && n.includes('ham')) || (n.includes('in toan') && n.includes('ham'));
    }
    function toothPos(tooth) { return /^[1-4][1-8]$/.test(String(tooth || '')) ? { row: Number(String(tooth)[0]) <= 2 ? 'upper' : 'lower', index: 0 } : null; }
    function expandFdiRange(from, to) { return [String(from), String(to)].filter(tooth => toothPos(tooth)); }
    ${fnSource}
    this.fn = ${name};
  `, sandbox);
  return sandbox.fn;
}

const desktopAccessory = loadFunction('dashboard.html', 'isToothChartAccessory');
const mobileAccessory = loadFunction('dashboard_mobile_terracotta.html', 'isToothChartAccessory');
const desktopType = loadFunction('dashboard.html', 'phType');
const mobileType = loadFunction('dashboard_mobile_terracotta.html', 'partType');
const desktopAdjustments = loadFunction('dashboard.html', 'parseProductionToothAdjustments');
const mobileAdjustments = loadFunction('dashboard_mobile_terracotta.html', 'parseProductionToothAdjustments');
const desktopSource = fs.readFileSync('dashboard.html', 'utf8');
const mobileSource = fs.readFileSync('dashboard_mobile_terracotta.html', 'utf8');
const adminSource = fs.readFileSync('admin.html', 'utf8');

for (const fn of [desktopAccessory, mobileAccessory]) {
  assert.strictEqual(fn('In Mẫu Toàn Hàm (R:HTren,HDuoi, - SL: 2)'), true);
  assert.strictEqual(fn('Cùi giả Zirconia HT theo mão sứ (R:11, - SL: 1)'), true);
  assert.strictEqual(fn('Thanh Bar kim loại Titanium- Từ 2-6đv ( ibar) (R:14-17, - SL: 1)'), true);
  assert.strictEqual(fn('Giá khớp'), true);
  assert.strictEqual(fn('Máng tẩy mềm 1.0mm (R:HTren,HDuoi, - SL: 1)'), true);
  assert.strictEqual(fn('Răng Tạm (R:11-12, - SL: 2)'), true);
  assert.strictEqual(fn('Gia công khoan lỗ (R:23, - SL: 1)'), true);
  assert.strictEqual(fn('Răng sứ Zircornia (R:13-17, - SL: 5)'), false);
  assert.strictEqual(fn('Veneer sứ Ziconia (Cut Back) (R:11, - SL: 1)'), false);
  assert.strictEqual(fn('Khay ca nhan (R:HTren, - SL: 1)'), true);
  assert.strictEqual(fn('Thay nen (R:HTren, - SL: 1)'), true);
  assert.strictEqual(fn('Dem Ham (R:HTren, - SL: 1)'), true);
  assert.strictEqual(fn('Va Ham (R:HDuoi, - SL: 1)'), true);
  assert.strictEqual(fn('Moc nhua deo (R:HTren, - SL: 2)'), true);
  assert.strictEqual(fn('EP nhua nha si len rang (R:HDuoi, - SL: 14)'), true);
}

for (const fn of [desktopType, mobileType]) {
  // Zirconia subtypes
  assert.strictEqual(fn('Răng sứ Zircornia (R:13-17, - SL: 5)'), 'zirc', 'plain Zirconia crown → zirc');
  assert.strictEqual(fn('Răng sứ Cercon (R:11, - SL: 1)'), 'zirc', 'Cercon crown → zirc');
  assert.strictEqual(fn('Full Sứ Ziconia (R:26-27, - SL: 2)'), 'zircf', 'Full Ziconia → zircf');
  assert.strictEqual(fn('Full Zirconia (R:14, - SL: 1)'), 'zircf', 'Full Zirconia → zircf');
  assert.strictEqual(fn('Veneer sứ Ziconia (Cut Back) (R:11, - SL: 1)'), 'zircv', 'Veneer Ziconia cut-back → zircv');
  assert.strictEqual(fn('Veneer sứ Zolid (Cut-Back) (R:16-25, - SL: 11)'), 'zircv', 'Veneer Zolid cut-back → zircv');
  // Metal subtypes
  assert.strictEqual(fn('Răng sứ kim loại thường (R:33-42, - SL: 5)'), 'kl', 'plain metal crown → kl');
  assert.strictEqual(fn('Full/ mão kim loại sứ titan (R:38, - SL: 1)'), 'klf', 'Full metal → klf');
  assert.strictEqual(fn('Veneer sứ kim loại thường (Cut Back) (R:11, - SL: 1)'), 'klv', 'Veneer metal → klv');
  // Pure veneer / mặt dán with no material specified stays vnr
  assert.strictEqual(fn('Mặt dán sứ (R:37, - SL: 1)'), 'vnr', 'Mặt dán sứ → vnr (no material)');
  assert.strictEqual(fn('Cánh dán sứ (R:11, - SL: 1)'), 'vnr', 'Cánh dán sứ → vnr (no material)');
}

// phFamily helper must exist and map subtypes → parent for backward filter compat.
for (const [name, source] of [['desktop', desktopSource], ['mobile', mobileSource], ['admin', adminSource]]) {
  assert(source.includes('function phFamily'), `${name} must define phFamily`);
}

assert(desktopSource.includes('const chartTotal = products.reduce'), 'desktop tooth chart should total parsed main products');
assert(mobileSource.includes('const chartTotal = products.reduce'), 'mobile tooth chart should total parsed main products');
assert(!desktopSource.includes('tooth-chart-total">${Number(o?.sl) || 0}'), 'desktop tooth chart must not use raw order.sl');
assert(!mobileSource.includes('tooth-chart-total">${Number(order?.sl) || 0}'), 'mobile tooth chart must not use raw order.sl');
assert(desktopSource.includes('function buildToothRowSlots'), 'desktop should render duplicate teeth as row slots');
assert(mobileSource.includes('function buildToothRowSlots'), 'mobile should render duplicate teeth as row slots');
assert(desktopSource.includes('.tooth-chip.missing'), 'desktop should style missing teeth');
assert(mobileSource.includes('.tooth-chip.missing'), 'mobile should style missing teeth');
assert(desktopSource.includes('function isJawUnitProductName'), 'desktop should count full-jaw frames as jaw units');
assert(mobileSource.includes('function isJawUnitProductName'), 'mobile should count full-jaw frames as jaw units');
assert(adminSource.includes('function isJawUnitProductName'), 'admin modal should count full-jaw frames as jaw units');
assert(desktopSource.includes('unknownMissingTeeth'), 'desktop should mark unknown missing teeth');
assert(mobileSource.includes('unknownMissingTeeth'), 'mobile should mark unknown missing teeth');
assert(adminSource.includes('unknownMissingTeeth'), 'admin modal should mark unknown missing teeth');
// Bridge bars: KTV note "Cầu (XX-YY)" merges KeyLab pair-segments by overlap
// (replace only product bridges that share teeth, keep unrelated bridges).
for (const [name, source] of [['desktop', desktopSource], ['mobile', mobileSource], ['admin', adminSource]]) {
  assert(source.includes('function parseClinicalBridges'), `${name} tooth chart must define parseClinicalBridges`);
  assert(source.includes('function mergeClinicalBridges'), `${name} tooth chart must define mergeClinicalBridges`);
  assert(source.includes('mergeClinicalBridges(productBridgeGroups'), `${name} tooth chart must call merge at render site`);
  // Guard against the old buggy replace-all pattern.
  assert(!/clinicalBridges\.length\s*\?\s*clinicalBridges\.map/.test(source), `${name} tooth chart must not replace all product bridges when any clinical bridge is found`);
}

for (const fn of [desktopAdjustments, mobileAdjustments]) {
  const adjusted = fn('Làm cầu (23-28) 5R mất R26, 2R22');
  assert(adjusted.excluded.has('26'), 'missing tooth note should mark R26 excluded');
  assert.strictEqual(adjusted.repeats.get('22'), 2, 'duplicate tooth note should repeat R22');
  const rangeAdjusted = fn('A. Lân đã xem: mất R24-25. Mỗi bên có hai R2.');
  assert(rangeAdjusted.excluded.has('24'), 'missing tooth range should mark R24 excluded');
  assert(rangeAdjusted.excluded.has('25'), 'missing tooth range should mark R25 excluded');
  assert.strictEqual(rangeAdjusted.repeats.get('12'), 2, 'each side R2 should repeat R12');
  assert.strictEqual(rangeAdjusted.repeats.get('22'), 2, 'each side R2 should repeat R22');
}

console.log('tooth chart classification tests passed');
