const assert = require('assert');
const {
  analyzeProductionMatch,
  classifyProductName,
  DEFAULT_PRODUCTION_MATCH_RULES,
  matchProductionRule,
  parseProductionToothAdjustments,
} = require('../src/utils/productionMatch');

function codes(result) {
  return result.warnings.map(w => w.code).sort();
}

assert.strictEqual(classifyProductName('Khay ca nhan').isAccessory, true);
assert.strictEqual(classifyProductName('Thay nen').isAccessory, true);
assert.strictEqual(classifyProductName('Dem Ham').isAccessory, true);
assert.strictEqual(classifyProductName('\u0110\u1ec7m H\u00e0m').isAccessory, true);
assert.strictEqual(classifyProductName('Va Ham').isAccessory, true);
assert.strictEqual(classifyProductName('Moc nhua deo').isAccessory, true);
assert.strictEqual(classifyProductName('EP nhua nha si len rang').isAccessory, true);

assert.strictEqual(classifyProductName('In Mẫu Toàn Hàm').isAccessory, true);
assert.strictEqual(classifyProductName('Cùi giả Zirconia HT theo mão sứ').isAccessory, true);
assert.strictEqual(classifyProductName('Thanh Bar kim loại Titanium- Từ 2-6đv ( ibar)').isAccessory, true);
assert.strictEqual(classifyProductName('Lên gối sáp').isAccessory, true);
assert.strictEqual(classifyProductName('Máng tẩy mềm 1.0mm').isAccessory, true);
assert.strictEqual(classifyProductName('Răng Tạm').isAccessory, true);
assert.strictEqual(classifyProductName('Gia công khoan lỗ').isAccessory, true);
assert.strictEqual(classifyProductName('Đính đá hột 2.5 li').isAccessory, true);
assert.strictEqual(classifyProductName('Răng sứ Zircornia').isAccessory, false);
assert.strictEqual(classifyProductName('Veneer sứ Ziconia (Cut Back)').family, 'zirc');
assert.strictEqual(classifyProductName('Veneer sứ kim loại thường (Cut Back)').family, 'kl');
assert.strictEqual(classifyProductName('Mặt dán sứ').family, 'vnr');
assert.strictEqual(classifyProductName('Cánh dán Zirconia').family, 'vnr');

{
  const adjustments = parseProductionToothAdjustments('Làm cầu (23-28) 5R mất R26, 2R22');
  assert(adjustments.excluded.has('26'));
  assert.strictEqual(adjustments.repeats.get('22'), 2);
}

{
  const adjustments = parseProductionToothAdjustments('A. Lân đã xem: mất R24-25. Mỗi bên có hai R2.');
  assert(adjustments.excluded.has('24'));
  assert(adjustments.excluded.has('25'));
  assert.strictEqual(adjustments.repeats.get('12'), 2);
  assert.strictEqual(adjustments.repeats.get('22'), 2);
}

{
  const result = analyzeProductionMatch({
    ma_dh: '262405018',
    sl: 16,
    phuc_hinh: 'Răng sứ Zircornia (R:13-17,12-27, - SL: 14); Thanh Bar kim loại Titanium- Từ 2-6đv ( ibar) (R:14-17,23-27, - SL: 2)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.mainQty, 14);
  assert.strictEqual(result.accessoryQty, 2);
  assert(codes(result).includes('RAW_SL_DIFFERS_MAIN_QTY'));
  assert(codes(result).includes('ACCESSORY_QTY_PRESENT'));
  const base = {
    rawSl: result.rawSl,
    mainQty: result.mainQty,
    accessoryQty: result.accessoryQty,
    mainProducts: result.mainProducts,
    accessories: result.accessories,
  };
  assert(matchProductionRule(base, result.warnings.find(w => w.code === 'ACCESSORY_QTY_PRESENT'), DEFAULT_PRODUCTION_MATCH_RULES));
  assert(matchProductionRule(base, result.warnings.find(w => w.code === 'RAW_SL_DIFFERS_MAIN_QTY'), DEFAULT_PRODUCTION_MATCH_RULES));
}

{
  const result = analyzeProductionMatch({
    ma_dh: '262305029',
    sl: 6,
    phuc_hinh: 'Răng sứ kim loại thường (R:11-26, - SL: 6)',
    ghi_chu_sx: 'Làm 6R, không làm R25.',
  });
  assert.strictEqual(result.chartTotal, 6);
  assert(codes(result).includes('NOTE_ADJUSTMENT_APPLIED'));
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
  assert(matchProductionRule(result, result.warnings.find(w => w.code === 'NOTE_ADJUSTMENT_APPLIED'), DEFAULT_PRODUCTION_MATCH_RULES));
}

{
  const result = analyzeProductionMatch({
    ma_dh: '262305029-1',
    sl: 6,
    phuc_hinh: 'Răng sứ kim loại thường (R:11-26, - SL: 6)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.chartTotal, 6);
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'raw-diff-real',
    sl: 9,
    phuc_hinh: 'Răng sứ Zircornia (R:11-13, - SL: 3)',
    ghi_chu_sx: '',
  });
  const rawDiff = result.warnings.find(w => w.code === 'RAW_SL_DIFFERS_MAIN_QTY');
  assert(rawDiff);
  assert.strictEqual(matchProductionRule(result, rawDiff, DEFAULT_PRODUCTION_MATCH_RULES), null);
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'rang-tam-accessory',
    sl: 12,
    phuc_hinh: 'Răng sứ kim loại thường (R:13-23, - SL: 6); Răng Tạm (R:13-23, - SL: 6)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.mainQty, 6);
  assert.strictEqual(result.accessoryQty, 6);
  assert.strictEqual(result.chartTotal, 6);
  assert(!codes(result).includes('OVERLAPPING_TOOTH_PRODUCTS'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'tua-mat-not-missing',
    sl: 3,
    phuc_hinh: 'Răng sứ kim loại thường (R:45-47, - SL: 3)',
    ghi_chu_sx: 'Với R47, tựa lên mặt R48',
  });
  assert(!codes(result).includes('NOTE_ADJUSTMENT_UNMATCHED'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'missing-range',
    sl: 3,
    phuc_hinh: 'Răng sứ kim loại thường (R:22-26, - SL: 3)',
    ghi_chu_sx: 'A. Lân đã xem: mất R24-25',
  });
  assert.strictEqual(result.chartTotal, 3);
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'shape-context-not-missing',
    sl: 4,
    phuc_hinh: 'Răng sứ kim loại thường (R:23-26, - SL: 4)',
    ghi_chu_sx: 'R23 làm hình dáng R22 do BN thiếu R22',
  });
  assert(!codes(result).includes('NOTE_ADJUSTMENT_UNMATCHED'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'moi-ben-co-hai-r2',
    sl: 8,
    phuc_hinh: 'Gia công đắp sứ Kim loại (R:13-23, - SL: 8)',
    ghi_chu_sx: 'Mỗi bên có hai R2',
  });
  assert.strictEqual(result.chartTotal, 8);
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'unknown-extra-single',
    sl: 4,
    phuc_hinh: 'Răng sứ kim loại thường (R:12-21, - SL: 4)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.chartTotal, 4);
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'unknown-missing-single',
    sl: 5,
    phuc_hinh: 'Rang su Titanium (R:33-43, - SL: 5)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.chartTotal, 5);
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'unknown-missing-double',
    sl: 4,
    phuc_hinh: 'Rang su Titanium (R:33-43, - SL: 4)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.chartTotal, 4);
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'jaw-unit-khung',
    sl: 4,
    phuc_hinh: 'Khung kim loai (R:HTren,HDuoi, - SL: 2); Len goi sap (R:HTren,HDuoi, - SL: 2)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.mainQty, 2);
  assert.strictEqual(result.accessoryQty, 2);
  assert.strictEqual(result.mainProducts[0].toothCount, 2);
  assert.strictEqual(result.chartTotal, 2);
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'jaw-unit-nen-ham',
    sl: 1,
    phuc_hinh: 'Nen ham Bio (R:HTren, - SL: 1)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.mainProducts[0].toothCount, 1);
  assert.strictEqual(result.chartTotal, 1);
  assert(!codes(result).includes('MAIN_QTY_TOOTH_COUNT_MISMATCH'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: 'jaw-unit-overlap',
    sl: 4,
    phuc_hinh: 'Khung co su tren khung -Titanium (R:HDuoi, - SL: 1); Rang su Titanium tren khung (R:35-37, - SL: 3)',
    ghi_chu_sx: '',
  });
  assert.strictEqual(result.mainQty, 4);
  assert.strictEqual(result.chartTotal, 4);
  assert(!codes(result).includes('OVERLAPPING_TOOTH_PRODUCTS'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: '261705012',
    sl: 4,
    phuc_hinh: 'Răng sứ kim loại thường (R:32-41, - SL: 4)',
    ghi_chu_sx: 'A Lân đã xem cùi : (32-41) 2R32 vói R32 nhỏ',
  });
  assert.strictEqual(result.chartTotal, 4);
  assert(codes(result).includes('NOTE_ADJUSTMENT_APPLIED'));
}

{
  const result = analyzeProductionMatch({
    ma_dh: '260204042-2',
    sl: 2,
    phuc_hinh: 'Răng sứ Zircornia (R:11, - SL: 1); Răng sứ Titanium (R:25, - SL: 1)',
    ghi_chu_sx: '',
  });
  assert(codes(result).includes('MIXED_MAIN_FAMILIES'));
  assert(matchProductionRule(result, result.warnings.find(w => w.code === 'MIXED_MAIN_FAMILIES'), DEFAULT_PRODUCTION_MATCH_RULES));
}

console.log('production match tests passed');
