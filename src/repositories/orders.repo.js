'use strict';
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { getDB, dbHasData } = require('../db/index');
const { queryD1BatchAsync } = require('../db/d1-http-sync');
const { FILE_SACH_DIR, DATA_DIR, EXCEL_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
const str = v => (v != null) ? String(v).trim() : '';
function parseJsonField(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// ── Stage constants ───────────────────────────────────
const STAGE_NAMES = ['CBM', 'SÁP/Cadcam', 'SƯỜN', 'ĐẮP', 'MÀI'];

const CD_TO_DB = {
  'CBM':     'CBM',
  'sáp':     'SÁP/Cadcam',
  'CAD/CAM': 'SÁP/Cadcam',
  'sườn':    'SƯỜN',
  'đắp':     'ĐẮP',
  'mài':     'MÀI',
};

const SKIP_STAGES = {
  sua:      [0, 1, 2],
  lam_tiep: [0, 1, 2],
  thusuon:  [3, 4],
  inmau:    [0],
};

const MADH_COL_HINTS = ['mã đh', 'mã_dh', 'ma_dh', 'mã đơn', 'madh', 'order_id'];

// SQL fragment: aggregate stages của 1 order thành chuỗi "thu_tu|cong_doan|ktv|xac_nhan|thoi_gian"
// nối bằng ';;'. Caller chỉ cần GROUP BY d.ma_dh hoặc tương đương. alias = bảng tien_do.
function stagesGroupConcatSql(alias = 't') {
  const a = alias;
  return `GROUP_CONCAT(
    ${a}.thu_tu||'|'||${a}.cong_doan||'|'||COALESCE(${a}.ten_ktv,'')||'|'||
    COALESCE(${a}.xac_nhan,'Chưa')||'|'||COALESCE(${a}.thoi_gian_hoan_thanh,''),
    ';;'
  ) AS stages_raw`;
}

function normalizeRuleText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isConfirmedStageText(value) {
  const normalized = normalizeRuleText(value);
  return normalized === 'co' || normalized === 'xac nhan';
}

function hasThuSuonMarker(value) {
  const text = normalizeRuleText(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return /\b[a-z]{0,4}ts\b/.test(text) || text.includes('thu suon') || text.includes('thu tho');
}

function hasInMauHamMarker(value) {
  const n = normalizeRuleText(value);
  return (
    n.includes('in mau ham') ||
    (n.includes('in mau') && n.includes('ham')) ||
    (n.includes('in ban') && n.includes('ham')) ||
    (n.includes('in toan') && n.includes('ham'))
  );
}

function getSkipStages(lk, gc, phPlus = '') {
  const lkLower = normalizeRuleText(lk);
  const gcLower = normalizeRuleText(gc);
  const phPlusLower = normalizeRuleText(phPlus);
  const skip = new Set();

  if (lkLower.includes('sua')) {
    SKIP_STAGES.sua.forEach(i => skip.add(i));
  } else if (lkLower.includes('lam tiep')) {
    SKIP_STAGES.lam_tiep.forEach(i => skip.add(i));
  } else if (hasThuSuonMarker(`${lkLower} ${gcLower}`)) {
    SKIP_STAGES.thusuon.forEach(i => skip.add(i));
  }

  if (hasInMauHamMarker(`${phPlusLower} ${gcLower}`)) {
    SKIP_STAGES.inmau.forEach(i => skip.add(i));
  }

  return [...skip].sort((a, b) => a - b);
}

function isThuSuonNote(gc) {
  return hasThuSuonMarker(gc);
}

function getCurrentStageFromStages(stages) {
  const latestDoneIndex = (stages || []).reduce((latest, stage, index) => (
    !stage.sk && stage.x ? Math.max(latest, index) : latest
  ), -1);
  const current = (stages || []).find((stage, index) => (
    !stage.sk && !stage.x && index > latestDoneIndex
  ));
  return current?.n || 'HOÀN TẤT';
}

// Import normalizeUserCongDoan from users.repo to avoid circular dep
// We just need CD_TO_DB here
function userCongDoanToDB(normalizedValue) {
  return CD_TO_DB[normalizedValue] || normalizedValue;
}

// ── Date parser ───────────────────────────────────────
function parseDate(val) {
  if (!val) return '';
  if (val instanceof Date && !isNaN(val)) {
    const p = n => String(n).padStart(2, '0');
    return `${val.getFullYear()}-${p(val.getMonth()+1)}-${p(val.getDate())} ${p(val.getHours())}:${p(val.getMinutes())}:${p(val.getSeconds())}`;
  }
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) {
        const p = n => String(n).padStart(2, '0');
        return `${d.y}-${p(d.m)}-${p(d.d)} ${p(d.H)}:${p(d.M)}:${p(d.S)}`;
      }
    } catch {}
  }
  return String(val);
}

// ── Find latest file ──────────────────────────────────
function findLatest(dir, exts) {
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => exts.some(ext => f.toLowerCase().endsWith(ext)))
      .map(f => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length ? files[0] : null;
  } catch (e) {
    log(`Lỗi đọc thư mục ${dir}: ${e.message}`);
    return null;
  }
}

// ── Read Excel ────────────────────────────────────────
function readExcel(filePath) {
  log(`Đọc Excel: ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm:ss' });

  const getSheet = (...keys) => {
    const name = wb.SheetNames.find(n => keys.some(k => n.toLowerCase().includes(k.toLowerCase())));
    return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) : null;
  };

  const raw1 = getSheet('Đơn hàng', 'Don hang', 'don_hang', 'order');
  if (!raw1) throw new Error('Không tìm thấy sheet "Đơn hàng"');

  const h1 = raw1[0].map(h => str(h));
  const c1 = keyword => h1.findIndex(h => h.includes(keyword));
  const i  = {
    ma: c1('Mã ĐH'), nhan: c1('Nhận'), ht: c1('hoàn thành'),
    giao: c1('giao'), kh: c1('Khách'), bn: c1('ệnh nhân'),
    ph: c1('Phục hình'), sl: c1('SL'), gc: c1('Ghi chú'),
  };

  const orders = {};
  for (let r = 1; r < raw1.length; r++) {
    const row = raw1[r];
    const ma  = str(row[i.ma]);
    if (!ma || ma.includes('TỔNG') || ma === 'Mã ĐH') continue;
    orders[ma] = {
      ma_dh:   ma,
      nhan:    parseDate(row[i.nhan]),
      yc_ht:   parseDate(row[i.ht]),
      yc_giao: parseDate(row[i.giao]),
      kh:      str(row[i.kh]),
      bn:      str(row[i.bn]),
      ph:      str(row[i.ph]).replace(/\r\n/g, ' | '),
      sl:      parseInt(row[i.sl]) || 0,
      gc:      str(row[i.gc]),
    };
  }

  const raw2 = getSheet('Tiến độ', 'Tien do', 'tien_do', 'progress');
  const stageMap = {};
  if (raw2) {
    const h2 = raw2[0].map(h => str(h));
    const c2 = keyword => h2.findIndex(h => h.includes(keyword));
    const j  = {
      ma: c2('Mã ĐH'), cd: c2('Công đoạn'), ktv: c2('KTV'),
      xn: c2('Xác nhận'), tg: c2('Thời gian'), lk: c2('Loại lệnh'), tk: c2('Tài khoản'),
    };
    for (let r = 1; r < raw2.length; r++) {
      const row = raw2[r];
      const ma  = str(row[j.ma]);
      if (!ma || ma === 'Mã ĐH') continue;
      const cd  = str(row[j.cd]);
      const ktv = str(row[j.ktv]).replace(/^-$/, '');
      const xn  = isConfirmedStageText(str(row[j.xn]));
      const tg  = parseDate(row[j.tg]).replace(/^-$/, '');
      const lk  = str(row[j.lk]);
      const tk  = str(row[j.tk]);
      if (!stageMap[ma]) stageMap[ma] = { lk: '', tk: '', stages: {} };
      if (lk) stageMap[ma].lk = lk;
      if (tk) stageMap[ma].tk = tk;
      stageMap[ma].stages[cd] = { ktv, xn, tg };
    }
  }
  return { orders, stageMap };
}

// ── Read JSON scraper ────────────────────────────────
function readJsonScraper(filePath) {
  log(`Đọc JSON: ${path.basename(filePath)}`);
  const raw  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.rows || raw.data || []);
  const stageMap = {};
  for (const row of rows) {
    const ma  = str(row.ma_dh);
    if (!ma) continue;
    const cd  = str(row.cong_doan);
    const ktv = str(row.ten_ktv);
    const xn  = isConfirmedStageText(str(row.xac_nhan));
    const tg  = str(row.thoi_gian_hoan_thanh).replace(/^-$/, '');
    const lk  = str(row.loai_lenh || row.raw_row_text?.split(',').pop()?.trim() || '');
    const tk  = str(row.tai_khoan_cao || row.tai_khoan || '');
    const ph  = str(row.phuc_hinh || '');
    const sl  = parseInt(row.sl) || 0;
    if (!stageMap[ma]) stageMap[ma] = { lk: '', tk: '', stages: {}, ph: '', sl: 0 };
    if (lk) stageMap[ma].lk = lk;
    if (tk) stageMap[ma].tk = tk;
    if (ph) stageMap[ma].ph = ph;
    if (sl) stageMap[ma].sl = sl;
    stageMap[ma].stages[cd] = { ktv, xn, tg };
  }
  return stageMap;
}

// ── Build orders ──────────────────────────────────────
function buildOrders(excelOrders, excelStageMap, jsonStageMap) {
  const allMaDh = new Set([...Object.keys(excelOrders), ...Object.keys(jsonStageMap)]);
  const orders  = [];

  for (const ma of allMaDh) {
    const exOrder  = excelOrders[ma]   || {};
    const exStage  = excelStageMap[ma] || { lk: '', tk: '', stages: {} };
    const jStage   = jsonStageMap[ma]  || { lk: '', tk: '', stages: {}, ph: '', sl: 0 };
    const lk = exStage.lk || jStage.lk || '';
    const tk = exStage.tk || jStage.tk || '';
    const phForSkip = exStage.ph || jStage.ph || '';
    const skip = getSkipStages(lk, exOrder.gc || '', phForSkip);

    const stages = STAGE_NAMES.map((name, i) => {
      const ex = exStage.stages[name] || {};
      const js = jStage.stages[name]  || {};
      const ktv = ex.ktv || js.ktv || '';
      const xn  = ex.xn  || js.xn  || false;
      const tg  = ex.tg  || js.tg  || '';
      return { n: name, k: ktv, x: xn, t: tg, sk: skip.includes(i) };
    });

    const active = stages.filter(s => !s.sk);
    const done   = active.filter(s => s.x).length;
    const total  = active.length;
    const currentStage = getCurrentStageFromStages(stages);
    const activeThuSuon = isThuSuonNote(exOrder.gc || '') && total > 0 && done >= total;
    let curKtv = '';
    for (let i = stages.length - 1; i >= 0; i--) {
      if (!stages[i].sk && stages[i].k) { curKtv = stages[i].k; break; }
    }
    let lastTg = '';
    stages.forEach(s => { if (s.t) lastTg = s.t; });

    orders.push({
      ma_dh:   ma,
      nhan:    exOrder.nhan    || '',
      yc_ht:   exOrder.yc_ht  || '',
      yc_giao: exOrder.yc_giao || '',
      kh:      exOrder.kh || '',
      bn:      exOrder.bn || '',
      ph:      exOrder.ph || jStage.ph || '',
      sl:      exOrder.sl || jStage.sl || 0,
      gc:      exOrder.gc || '',
      lk, tk,
      stages, current_stage: activeThuSuon ? STAGE_NAMES[2] : currentStage, done, total,
      pct: total > 0 ? Math.round(done / total * 100) : 0,
      curKtv, lastTg, active_thu_suon: activeThuSuon,
    });
  }

  orders.sort((a, b) => {
    if (a.yc_giao && !b.yc_giao) return -1;
    if (!a.yc_giao && b.yc_giao) return 1;
    return (a.yc_giao || '').localeCompare(b.yc_giao || '');
  });
  return orders;
}

// ── Active ma_dh list from latest Excel ──────────────
function getActiveMaDhList() {
  const excelFile = findLatest(EXCEL_DIR, ['.xls', '.xlsx', '.xlsm']);
  if (excelFile) {
    try {
      const SHEET_HINTS = ['đơn hàng', 'don hang', 'sheet1', 'sheet'];
      const wb   = XLSX.readFile(excelFile.path, { sheetRows: 0 });
      const name = wb.SheetNames.find(n => SHEET_HINTS.some(h => n.toLowerCase().includes(h))) || wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      const h    = (rows[0] || []).map(c => str(c).toLowerCase().trim());
      const col  = h.findIndex(c => MADH_COL_HINTS.some(hint => c.includes(hint)));
      if (col >= 0) {
        const ids = [...new Set(
          rows.slice(1)
            .map(r => str(r[col]).trim())
            .filter(v => v && !v.toLowerCase().includes('tổng') && v !== 'Mã ĐH')
        )];
        if (ids.length > 0) return { ids, src: excelFile.name };
      }
    } catch (e) { log(`⚠ getActiveMaDhList: ${e.message}`); }
  }
  return null;
}

function dashboardRowsSql(whereSql = '') {
  return `
      SELECT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao,
             d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
             d.loai_lenh, d.ghi_chu, d.ghi_chu_sx, d.keylab_sx_info, d.trang_thai, d.tai_khoan_cao, d.routed_to,
             ${stagesGroupConcatSql('t')}
      FROM don_hang d
      LEFT JOIN tien_do t ON t.ma_dh = d.ma_dh
      ${whereSql}
      GROUP BY d.ma_dh
      ORDER BY d.yc_giao ASC, d.nhap_luc ASC
    `;
}

function buildDashboardOrdersFromRows(rows, active) {
  const activeSet = new Set(active?.ids || []);
  const hasActiveList = activeSet.size > 0;
  const orders = [];
  for (const row of rows) {
    const lk   = row.loai_lenh || '';
    const gc   = row.ghi_chu   || '';
    const skip = getSkipStages(lk, gc, `${row.phuc_hinh || ''} ${row.ghi_chu_sx || ''}`);

    const stagesMap = {};
    for (const part of (row.stages_raw || '').split(';;')) {
      const p = part.split('|');
      if (p.length >= 5) {
        const thu_tu = parseInt(p[0]);
        if (!isNaN(thu_tu)) {
          stagesMap[thu_tu] = { n: p[1], k: p[2], x: isConfirmedStageText(p[3]), t: p[4] };
        }
      }
    }

    const stages = STAGE_NAMES.map((name, i) => {
      const s = stagesMap[i + 1] || { n: name, k: '', x: false, t: '' };
      return { n: name, k: s.k, x: s.x, t: s.t, sk: skip.includes(i) };
    });

    const activeStages = stages.filter(s => !s.sk);
    const done  = activeStages.filter(s => s.x).length;
    const total = activeStages.length;
    const currentStage = getCurrentStageFromStages(stages);
    const activeThuSuon = hasActiveList && activeSet.has(row.ma_dh) && isThuSuonNote(gc) && total > 0 && done >= total;
    let curKtv = '';
    for (let i = stages.length - 1; i >= 0; i--) {
      if (!stages[i].sk && stages[i].k) { curKtv = stages[i].k; break; }
    }
    let lastTg = '';
    stages.forEach(s => { if (s.t) lastTg = s.t; });

    orders.push({
      ma_dh: row.ma_dh, nhan: row.nhap_luc || '', yc_ht: row.yc_hoan_thanh || '',
      yc_giao: row.yc_giao || '', kh: row.khach_hang || '', bn: row.benh_nhan || '',
      ph: row.phuc_hinh || '', sl: row.sl || 0, gc: row.ghi_chu || '', ghi_chu_sx: row.ghi_chu_sx || '',
      keylab_sx_info: parseJsonField(row.keylab_sx_info),
      lk,
      routed_to: row.routed_to || 'sap',
      tk: row.tai_khoan_cao || '', stages, current_stage: activeThuSuon ? STAGE_NAMES[2] : currentStage, done, total,
      pct: total > 0 ? Math.round(done / total * 100) : 0, curKtv, lastTg,
      active_thu_suon: activeThuSuon,
    });
  }

  orders.sort((a, b) => {
    if (a.yc_giao && !b.yc_giao) return -1;
    if (!a.yc_giao && b.yc_giao) return 1;
    return (a.yc_giao || '').localeCompare(b.yc_giao || '');
  });

  return orders;
}

// ── getDataFromDB ─────────────────────────────────────
function getDataFromDB() {
  const db = getDB();
  const active = getActiveMaDhList();
  let rows;
  if (active && active.ids.length > 0) {
    const ph = active.ids.map(() => '?').join(',');
    rows = db.prepare(dashboardRowsSql(`WHERE d.ma_dh IN (${ph})`)).all(...active.ids);
  } else {
    log('⚠ Không tìm được file active, hiển thị toàn bộ DB');
    rows = db.prepare(dashboardRowsSql()).all();
  }

  const orders = buildDashboardOrdersFromRows(rows, active);
  return { source: { db: db.backend === 'd1' ? 'cloudflare-d1' : 'labo_data.db', active: active?.src || null }, orders };
}

// ── Cache + getData ───────────────────────────────────
let cache     = null;
let cacheKey  = '';
let cacheTime = 0;
const TTL     = 60_000;

function resetCache() {
  cache = null; cacheKey = ''; cacheTime = 0;
}

function autoCloseCompletedDelayReports() {
  const db = getDB();
  if (!db) return;
  try {
    // Đơn hoàn thành bị Keylab xóa khỏi export → không còn trong active list.
    // Dùng NOT IN thay vì pct===100 vì getDataFromDB() chỉ trả về đơn đang active.
    const active = getActiveMaDhList();
    if (!active || active.ids.length === 0) return;
    const ph = active.ids.map(() => '?').join(',');
    const result = db.prepare(`
      UPDATE delay_reports
      SET trang_thai    = 'rejected',
          reviewed_by   = 'system',
          reviewed_at   = datetime('now','localtime'),
          ghi_chu_admin = 'Tự động đóng: đơn đã hoàn thành 100% tiến độ'
      WHERE trang_thai IN ('pending', 'confirmed')
        AND ma_dh NOT IN (${ph})
    `).run(...active.ids);
    if (result.changes > 0)
      log(`✅ Tự động đóng ${result.changes} delay report cho đơn hoàn thành`);
  } catch (e) {
    log(`⚠ autoCloseCompletedDelayReports: ${e.message}`);
  }
}

function injectClinicTags(orders) {
  try {
    const { getAllTagsMap } = require('./clinicTags.repo');
    const map = getAllTagsMap();
    if (!map || !map.size) return orders;
    return applyClinicTags(orders, map);
  } catch { return orders; }
}

function buildClinicTagsMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.khach_hang)) map.set(row.khach_hang, []);
    map.get(row.khach_hang).push(row.label);
  }
  return map;
}

function applyClinicTags(orders, map) {
  if (!map || !map.size) return orders;
  return orders.map(o => ({ ...o, clinic_tags: map.get(o.kh || '') || [] }));
}

async function getDataAsync(forceReload = false) {
  const db = getDB();
  if (!db || db.backend !== 'd1') return getData(forceReload);

  const age = Date.now() - cacheTime;
  const key = 'd1';
  if (!forceReload && cache && cacheKey === key && age < TTL) return cache;

  const active = getActiveMaDhList();
  const params = active?.ids?.length ? active.ids : [];
  const whereSql = params.length ? `WHERE d.ma_dh IN (${params.map(() => '?').join(',')})` : '';
  if (!params.length) log('⚠ Không tìm được file active, hiển thị toàn bộ DB');

  const started = Date.now();
  const [orderResult, tagResult] = await queryD1BatchAsync([
    { sql: dashboardRowsSql(whereSql), params },
    { sql: 'SELECT khach_hang, label FROM clinic_tags ORDER BY created_at ASC' },
  ]);

  const tagsMap = buildClinicTagsMap(tagResult?.results || []);
  const orders = applyClinicTags(buildDashboardOrdersFromRows(orderResult?.results || [], active), tagsMap);
  cache = { source: { db: 'cloudflare-d1', active: active?.src || null }, orders };
  cacheKey = key; cacheTime = Date.now();
  log(`✓ ${orders.length} đơn (D1 batch ${cacheTime - started}ms)`);
  return cache;
}

function getData(forceReload = false) {
  if (dbHasData()) {
    const db = getDB();
    const age = Date.now() - cacheTime;
    const isD1 = db?.backend === 'd1';
    const key = isD1 ? 'd1' : 'sqlite';
    if (!forceReload && cache && cacheKey === key && age < TTL) return cache;
    try {
      const raw = getDataFromDB();
      cache = { ...raw, orders: injectClinicTags(raw.orders) };
      cacheKey = key; cacheTime = Date.now();
      log(`✓ ${cache.orders.length} đơn (${isD1 ? 'D1' : 'SQLite'})`);
      return cache;
    } catch (e) { log(`⚠ ${isD1 ? 'D1' : 'SQLite'} read error: ${e.message} — fallback to files`); }
  }

  const excelFile = findLatest(FILE_SACH_DIR, ['.xlsx', '.xls', '.xlsm']);
  const jsonFile  = findLatest(DATA_DIR, ['.json']);
  const key = `${excelFile?.mtime || 0}_${jsonFile?.mtime || 0}`;
  const age = Date.now() - cacheTime;

  if (!forceReload && cache && key === cacheKey && age < TTL) return cache;

  let excelOrders = {}, excelStageMap = {}, jsonStageMap = {}, srcExcel = null, srcJson = null;
  if (excelFile) {
    try { const r = readExcel(excelFile.path); excelOrders = r.orders; excelStageMap = r.stageMap; srcExcel = excelFile.name; }
    catch (e) { log(`⚠ Excel: ${e.message}`); }
  }
  if (jsonFile) {
    try { jsonStageMap = readJsonScraper(jsonFile.path); srcJson = jsonFile.name; }
    catch (e) { log(`⚠ JSON: ${e.message}`); }
  }

  const orders = injectClinicTags(buildOrders(excelOrders, excelStageMap, jsonStageMap));
  cache = { source: { excel: srcExcel, json: srcJson }, orders };
  cacheKey = key; cacheTime = Date.now();
  log(`✓ ${orders.length} đơn | Excel: ${srcExcel || '—'} | JSON: ${srcJson || '—'}`);
  return cache;
}

module.exports = {
  STAGE_NAMES,
  CD_TO_DB,
  SKIP_STAGES,
  MADH_COL_HINTS,
  normalizeRuleText,
  stagesGroupConcatSql,
  getSkipStages,
  isThuSuonNote,
  userCongDoanToDB,
  findLatest,
  readExcel,
  readJsonScraper,
  buildOrders,
  getActiveMaDhList,
  getDataFromDB,
  getDataAsync,
  getData,
  resetCache,
  autoCloseCompletedDelayReports,
  dashboardRowsSql,
  buildDashboardOrdersFromRows,
};
