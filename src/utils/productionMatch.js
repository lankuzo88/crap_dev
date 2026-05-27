'use strict';

const TOOTH_UPPER = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'];
const TOOTH_LOWER = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];
const TOOTH_ROWS = { upper: TOOTH_UPPER, lower: TOOTH_LOWER };
const TOOTH_INDEX = new Map([
  ...TOOTH_UPPER.map((tooth, index) => [tooth, { row: 'upper', index }]),
  ...TOOTH_LOWER.map((tooth, index) => [tooth, { row: 'lower', index }]),
]);

function normalizeText(value) {
  return String(value || '')
    .replace(/_x[0-9a-fA-F]{4}_/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0111\u0110]/g, 'd')
    .toLowerCase();
}

function cleanText(value) {
  return String(value || '')
    .replace(/_x[0-9a-fA-F]{4}_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonField(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function toothPos(tooth) {
  return TOOTH_INDEX.get(String(tooth || '')) || null;
}

function expandFdiRange(from, to) {
  const a = toothPos(from);
  const b = toothPos(to);
  if (!a || !b || a.row !== b.row) return [from, to].map(String).filter(tooth => toothPos(tooth));
  const row = TOOTH_ROWS[a.row];
  const start = Math.min(a.index, b.index);
  const end = Math.max(a.index, b.index);
  return row.slice(start, end + 1).map(String);
}

function parseToothGroups(rawValue) {
  const raw = cleanText(rawValue);
  if (!raw) return [];
  const groups = [];
  const normalized = normalizeText(raw);
  if (/\bhtren\b/.test(normalized) || normalized.includes('ham tren')) {
    groups.push({ type: 'full', row: 'upper', teeth: TOOTH_UPPER, raw: 'HTren' });
  }
  if (/\bhduoi\b/.test(normalized) || normalized.includes('ham duoi')) {
    groups.push({ type: 'full', row: 'lower', teeth: TOOTH_LOWER, raw: 'HDuoi' });
  }

  const compact = raw
    .replace(/[，、]/g, ',')
    .replace(/[.;．。]/g, ',')
    .replace(/\s+/g, '');
  for (const token of compact.split(',')) {
    if (!token) continue;
    const bridge = token.match(/^(\d{2})-(\d{2})$/);
    if (bridge) {
      const teeth = expandFdiRange(bridge[1], bridge[2]);
      if (teeth.length) groups.push({ type: 'bridge', teeth, raw: `${bridge[1]}-${bridge[2]}` });
      continue;
    }
    const single = token.match(/^(\d{2})$/);
    if (single && toothPos(single[1])) groups.push({ type: 'single', teeth: [single[1]], raw: single[1] });
  }
  return groups;
}

function countGroupTeeth(groups) {
  return (groups || []).reduce((sum, group) => sum + (Array.isArray(group.teeth) ? group.teeth.length : 0), 0);
}

function isJawUnitProductName(name) {
  const n = normalizeText(name);
  return (
    n.includes('khung') ||
    n.includes('nen ham') ||
    n.includes('ham bio') ||
    n.includes('ham nhua') ||
    n.includes('ham thao lap')
  );
}

function countProductUnits(name, groups) {
  if (isJawUnitProductName(name)) {
    const fullCount = (groups || []).filter(group => group.type === 'full').length;
    if (fullCount) return fullCount;
  }
  return countGroupTeeth(groups);
}

function hasInMauHam(text) {
  const n = normalizeText(text);
  return (
    n.includes('in mau ham') ||
    (n.includes('in mau') && n.includes('ham')) ||
    (n.includes('in ban') && n.includes('ham')) ||
    (n.includes('in toan') && n.includes('ham'))
  );
}

function classifyProductName(name) {
  const raw = String(name || '');
  const n = normalizeText(raw);
  const isAccessory = (
    hasInMauHam(raw) ||
    n.includes('in mau') ||
    n.includes('mau ham') ||
    n.includes('khay ca nhan') ||
    n.includes('rang tam') ||
    n.includes('pmma') ||
    n.includes('in resin') ||
    n.includes('dinh da') ||
    n.includes('hot') ||
    n.includes('khoan lo') ||
    n.includes('cui gia') ||
    n.includes('sap can') ||
    n.includes('goi sap') ||
    n.includes('len goi') ||
    n.includes('khay lay dau') ||
    n.includes('lay dau') ||
    n.includes('gia khop') ||
    n.includes('ham doi') ||
    n.includes('thay nen') ||
    n.includes('dem ham') ||
    n.includes('va ham') ||
    n.includes('moc nhua') ||
    n.includes('ep nhua nha si') ||
    n.includes('mang tay') ||
    n.includes('thanh bar') ||
    /\bi\s*bar\b/.test(n) ||
    /\bibar\b/.test(n) ||
    /\bbar\b/.test(n) ||
    n.includes('attachment') ||
    n.includes('khop noi') ||
    n.includes('ngat luc') ||
    n.includes('thao lap') ||
    n.includes('ortolux') ||
    n.includes('kenson') ||
    n.includes('vitadent')
  );
  let family = 'unknown';
  if (n.includes('mat dan') || n.includes('canh dan')) family = 'vnr';
  else if (n.includes('rang tam') || n.includes('pmma') || n.includes('in resin')) family = 'tam';
  else if (
    n.includes('zir') || n.includes('zircornia') || n.includes('zirconia') || n.includes('ziconia') ||
    n.includes('zolid') || n.includes('cercon') || n.includes('diamond') || n.includes('la va') || n.includes('argen')
  ) family = 'zirc';
  else if (n.includes('kim loai') || n.includes('titan') || n.includes('chrome') || n.includes('cobalt')) family = 'kl';
  else if (n.includes('veneer')) family = 'unknown';
  return { isAccessory, family };
}

function splitPhParts(phucHinh) {
  return String(phucHinh || '')
    .split(/;|\r?\n/)
    .map(part => cleanText(part))
    .filter(Boolean);
}

function extractRangFromPart(part) {
  const match = String(part || '').match(/R\s*:\s*([^)]*?)(?:,\s*-\s*SL\s*:|\s*-\s*SL\s*:|\))/i);
  return match ? match[1].replace(/,+\s*$/g, '').trim() : '';
}

function extractQtyFromPart(part) {
  const match = String(part || '').match(/SL\s*:\s*(\d+)/i);
  return match ? Number(match[1]) || 0 : 0;
}

function stripRangBlock(part) {
  return cleanText(part).replace(/\s*\([^)]*R\s*:[^)]*\)\s*/i, '').trim();
}

function parseProducts(row) {
  const info = parseJsonField(row.keylab_sx_info, {});
  const sxProducts = Array.isArray(info.products) ? info.products : [];
  if (sxProducts.length) {
    return sxProducts.map((item, index) => {
      const name = cleanText(item?.san_pham || item?.product || '');
      const rang = cleanText(item?.rang || '');
      const qty = Number(item?.so_luong || item?.sl) || 0;
      const cls = classifyProductName([name, item?.loai_san_pham || '', rang].join(' '));
      const groups = parseToothGroups(rang);
      const toothCount = countProductUnits(name, groups);
      return {
        id: `sx-${index}`,
        source: 'keylab_sx_info',
        name,
        rang,
        qty,
        family: cls.family,
        isAccessory: cls.isAccessory,
        toothCount,
        groups,
      };
    });
  }

  return splitPhParts(row.phuc_hinh).map((part, index) => {
    const name = stripRangBlock(part) || cleanText(part);
    const rang = cleanText(extractRangFromPart(part));
    const qty = extractQtyFromPart(part);
    const cls = classifyProductName(part);
    const groups = parseToothGroups(rang);
    const toothCount = countProductUnits(name, groups);
    return {
      id: `ph-${index}`,
      source: 'phuc_hinh',
      name,
      rang,
      qty,
      family: cls.family,
      isAccessory: cls.isAccessory,
      toothCount,
      groups,
    };
  });
}

function parseProductionToothAdjustments(text) {
  const raw = cleanText(text)
    .replace(/mặt\s+r?\s*\d{2}/gi, ' ')
    .replace(/tựa[^\n.;,]{0,50}mat\s+r?\s*\d{2}/gi, ' ');
  const normalized = normalizeText(raw);
  const excluded = new Set();
  const repeats = new Map();
  let m;

  const excludeRe = /(?:khong|ko)\s+lam\s+r?\s*(\d{2})/g;
  while ((m = excludeRe.exec(normalized))) {
    if (toothPos(m[1])) excluded.add(m[1]);
  }
  const removeRe = /(?:bo|tru|mat|thieu)\s+r?\s*(\d{2})/g;
  while ((m = removeRe.exec(normalized))) {
    if (toothPos(m[1])) excluded.add(m[1]);
  }
  const removeRangeRe = /(?:bo|tru|mat|thieu)\s+r?\s*(\d{2})\s*-\s*(\d{2})/g;
  while ((m = removeRangeRe.exec(normalized))) {
    expandFdiRange(m[1], m[2]).forEach(tooth => excluded.add(tooth));
  }
  if (/(?:moi|moi)\s+ben\s+co\s+(?:hai|2)\s*r?2\b/.test(normalized)) {
    repeats.set('12', Math.max(repeats.get('12') || 1, 2));
    repeats.set('22', Math.max(repeats.get('22') || 1, 2));
  }
  const repeatA = /\b([2-9])\s*(?:r|rang)\s*r?\s*(\d{2})\b/g;
  while ((m = repeatA.exec(normalized))) {
    const count = Number(m[1]) || 0;
    if (count > 1 && toothPos(m[2])) repeats.set(m[2], Math.max(repeats.get(m[2]) || 1, count));
  }
  const repeatB = /\br\s*(\d{2})\s*(?:co|la)?\s*([2-9])\s*(?:r|rang)\b/g;
  while ((m = repeatB.exec(normalized))) {
    const count = Number(m[2]) || 0;
    if (count > 1 && toothPos(m[1])) repeats.set(m[1], Math.max(repeats.get(m[1]) || 1, count));
  }

  return { excluded, repeats };
}

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

function warn(code, severity, message, detail = {}) {
  return { code, severity, message, detail };
}

const DEFAULT_PRODUCTION_MATCH_RULES = [
  {
    id: 'default-accessory-present',
    name: 'Phu kien da tach khoi phuc hinh chinh',
    warningCode: 'ACCESSORY_QTY_PRESENT',
    action: 'suppress',
    reason: 'Phu kien nhu in mau, rang tam, cui gia, mang tay, thanh bar/I-bar khong ve tren so do rang chinh.',
  },
  {
    id: 'default-raw-sl-includes-accessory',
    name: 'SL tong bao gom phu kien',
    warningCode: 'RAW_SL_DIFFERS_MAIN_QTY',
    action: 'suppress',
    reason: 'SL DB khac SL chinh dung bang phu kien, parser da tach phu kien ra khoi so rang chinh.',
    predicate: item => {
      const rawSl = Number(item.rawSl) || 0;
      const mainQty = Number(item.mainQty) || 0;
      const accessoryQty = Number(item.accessoryQty) || 0;
      return accessoryQty > 0 && rawSl === mainQty + accessoryQty;
    },
  },
  {
    id: 'default-note-adjustment-applied',
    name: 'Ghi chu rang da ap dung duoc',
    warningCode: 'NOTE_ADJUSTMENT_APPLIED',
    action: 'suppress',
    reason: 'Ghi chu mat/thieu/khong lam/them rang da duoc parser ap dung vao so do.',
  },
  {
    id: 'default-mixed-main-families',
    name: 'Ca hon hop la thong tin, khong phai loi match',
    warningCode: 'MIXED_MAIN_FAMILIES',
    action: 'suppress',
    reason: 'Don co nhieu nhom phuc hinh chinh van hien thi theo tung nhom vat lieu.',
  },
  {
    id: 'default-accessory-only-order',
    name: 'Don chi co phu kien',
    warningCode: 'NO_MAIN_PRODUCT',
    action: 'suppress',
    reason: 'Don chi co phu kien/khong co phuc hinh chinh thi khong can ve so do rang.',
    predicate: item => (item.mainProducts || []).length === 0 && (item.accessories || []).length > 0,
  },
];

function normalizeProductionRule(rule) {
  const defaultRule = DEFAULT_PRODUCTION_MATCH_RULES.find(item => item.id === (rule.id || rule.rule_id));
  return {
    id: rule.id || rule.rule_id || '',
    name: rule.name || '',
    warningCode: rule.warningCode || rule.warning_code || '',
    action: rule.action || 'suppress',
    reason: rule.reason || '',
    predicate: typeof rule.predicate === 'function' ? rule.predicate : (defaultRule?.predicate || null),
  };
}

function matchProductionRule(item, warning, rules = DEFAULT_PRODUCTION_MATCH_RULES) {
  const normalizedRules = (rules || []).map(normalizeProductionRule);
  return normalizedRules.find(rule => {
    if (!rule || rule.action !== 'suppress') return false;
    if (rule.warningCode && rule.warningCode !== warning.code) return false;
    return rule.predicate ? rule.predicate(item, warning) : true;
  }) || null;
}

function analyzeProductionMatch(row) {
  const products = parseProducts(row);
  const mainProducts = products.filter(product => !product.isAccessory);
  const accessories = products.filter(product => product.isAccessory);
  const rawSl = Number(row.sl) || 0;
  const mainQty = mainProducts.reduce((sum, product) => sum + (Number(product.qty) || 0), 0);
  const accessoryQty = accessories.reduce((sum, product) => sum + (Number(product.qty) || 0), 0);
  const warnings = [];
  const adjustments = parseProductionToothAdjustments(row.ghi_chu_sx || '');
  let chartTotal = 0;
  let appliedAnyAdjustment = false;
  let matchedAnyAdjustment = false;

  if (accessories.length) {
    warnings.push(warn(
      'ACCESSORY_QTY_PRESENT',
      accessoryQty > 0 ? 'info' : 'low',
      accessoryQty > 0
        ? `Co ${accessoryQty} don vi phu kien khong nen cong vao so rang chinh`
        : 'Co phu kien khong ve tren so do rang',
      { accessoryQty, names: accessories.map(item => item.name).filter(Boolean).slice(0, 6) }
    ));
  }
  if (rawSl && mainQty && rawSl !== mainQty) {
    warnings.push(warn(
      'RAW_SL_DIFFERS_MAIN_QTY',
      'warning',
      `SL DB ${rawSl} khac SL phuc hinh chinh ${mainQty}`,
      { rawSl, mainQty, accessoryQty }
    ));
  }
  if (!mainProducts.length && rawSl > 0) {
    warnings.push(warn('NO_MAIN_PRODUCT', 'high', 'Khong tim thay phuc hinh chinh de ve so do', { rawSl }));
  }

  for (const product of mainProducts) {
    const summary = adjustmentSummaryForProduct(product, adjustments);
    matchedAnyAdjustment = matchedAnyAdjustment || summary.hasAdjustment;
    const qty = Number(product.qty) || 0;
    const countWithoutAdjustment = product.toothCount;
    const countWithAdjustment = summary.hasAdjustment ? summary.adjustedCount : countWithoutAdjustment;
    const adjustmentMatchesQty = summary.hasAdjustment && qty > 0 && countWithAdjustment === qty;
    if (adjustmentMatchesQty) appliedAnyAdjustment = true;
    const effectiveCount = adjustmentMatchesQty ? countWithAdjustment : (qty || countWithoutAdjustment);
    chartTotal += effectiveCount;

    if (qty > 0 && countWithoutAdjustment === 0) {
      warnings.push(warn(
        'PRODUCT_WITHOUT_TOOTH_SCOPE',
        'warning',
        `San pham "${product.name}" co SL ${qty} nhung khong co rang cu the`,
        { product: product.name, qty, rang: product.rang }
      ));
    } else if (qty > 0 && countWithoutAdjustment > 0 && qty !== countWithoutAdjustment && !adjustmentMatchesQty) {
      const unitDelta = qty - countWithoutAdjustment;
      const canRepresentUnknownExtra = !summary.hasAdjustment && unitDelta === 1;
      const canRepresentUnknownMissing = !summary.hasAdjustment && unitDelta < 0 && Math.abs(unitDelta) <= 2;
      if (canRepresentUnknownExtra || canRepresentUnknownMissing) continue;
      warnings.push(warn(
        'MAIN_QTY_TOOTH_COUNT_MISMATCH',
        'high',
        `San pham "${product.name}" SL ${qty} khong khop ${countWithoutAdjustment} rang doc duoc`,
        { product: product.name, qty, toothCount: countWithoutAdjustment, adjustedCount: countWithAdjustment, rang: product.rang }
      ));
    }
  }

  if (appliedAnyAdjustment) {
    warnings.push(warn(
      'NOTE_ADJUSTMENT_APPLIED',
      'info',
      'Ghi chu san xuat da dieu chinh so do rang',
      {
        excluded: [...adjustments.excluded],
        repeats: [...adjustments.repeats.entries()].map(([tooth, count]) => ({ tooth, count })),
      }
    ));
  } else if ((adjustments.excluded.size || adjustments.repeats.size) && !matchedAnyAdjustment) {
    const mainTeeth = new Set(mainProducts.flatMap(product => product.groups.flatMap(group => group.teeth || [])));
    const adjustmentTouchesMain = [...adjustments.excluded].some(tooth => mainTeeth.has(tooth))
      || [...adjustments.repeats.keys()].some(tooth => mainTeeth.has(tooth));
    if (mainTeeth.size > 0 && !adjustmentTouchesMain) {
      // Notes such as "lam hinh dang R22 do benh nhan thieu R22" describe context
      // outside the actual prosthesis range and should not create a match warning.
    } else {
    warnings.push(warn(
      'NOTE_ADJUSTMENT_UNMATCHED',
      'warning',
      'Ghi chu co bo/mat/thieu/them rang nhung khong match vao phuc hinh chinh',
      {
        excluded: [...adjustments.excluded],
        repeats: [...adjustments.repeats.entries()].map(([tooth, count]) => ({ tooth, count })),
      }
    ));
    }
  }

  const families = new Set(mainProducts.map(product => product.family).filter(Boolean).filter(family => family !== 'unknown'));
  if (families.size > 1) {
    warnings.push(warn(
      'MIXED_MAIN_FAMILIES',
      'info',
      `Don co nhieu nhom phuc hinh chinh: ${[...families].join(', ')}`,
      { families: [...families] }
    ));
  }

  const byTooth = new Map();
  for (const product of mainProducts) {
    if (isJawUnitProductName(product.name)) continue;
    for (const tooth of new Set(product.groups.flatMap(group => group.teeth || []))) {
      if (!byTooth.has(tooth)) byTooth.set(tooth, []);
      byTooth.get(tooth).push(product.name);
    }
  }
  const overlaps = [...byTooth.entries()]
    .filter(([, names]) => new Set(names).size > 1)
    .map(([tooth, names]) => ({ tooth, products: [...new Set(names)] }));
  if (overlaps.length) {
    warnings.push(warn(
      'OVERLAPPING_TOOTH_PRODUCTS',
      'warning',
      'Mot so rang xuat hien trong nhieu dong phuc hinh chinh',
      { overlaps: overlaps.slice(0, 12) }
    ));
  }

  const severityRank = { high: 3, warning: 2, info: 1, low: 0 };
  warnings.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0) || a.code.localeCompare(b.code));

  return {
    ma_dh: row.ma_dh,
    rawSl,
    mainQty,
    accessoryQty,
    chartTotal: chartTotal || mainQty,
    products,
    mainProducts,
    accessories,
    warnings,
  };
}

function compactAnalysisForApi(row, analysis) {
  return {
    ma_dh: row.ma_dh,
    khach_hang: row.khach_hang || '',
    benh_nhan: row.benh_nhan || '',
    phuc_hinh: row.phuc_hinh || '',
    ghi_chu_sx: row.ghi_chu_sx || '',
    rawSl: analysis.rawSl,
    mainQty: analysis.mainQty,
    accessoryQty: analysis.accessoryQty,
    chartTotal: analysis.chartTotal,
    mainProducts: analysis.mainProducts.map(product => ({
      name: product.name,
      rang: product.rang,
      qty: product.qty,
      family: product.family,
      toothCount: product.toothCount,
    })),
    accessories: analysis.accessories.map(product => ({
      name: product.name,
      rang: product.rang,
      qty: product.qty,
    })),
    warnings: analysis.warnings,
  };
}

module.exports = {
  TOOTH_UPPER,
  TOOTH_LOWER,
  analyzeProductionMatch,
  classifyProductName,
  compactAnalysisForApi,
  countGroupTeeth,
  countProductUnits,
  DEFAULT_PRODUCTION_MATCH_RULES,
  expandFdiRange,
  matchProductionRule,
  normalizeText,
  parseProductionToothAdjustments,
  parseProducts,
  parseToothGroups,
  toothPos,
};
