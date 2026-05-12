'use strict';
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { getDB, dbHasData } = require('../db/index');
const { FILE_SACH_DIR, DATA_DIR, EXCEL_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
const str = v => (v != null) ? String(v).trim() : '';

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
  lam_tiep: [0, 1],
  thusuon:  [3, 4],
};

const MADH_COL_HINTS = ['mã đh', 'mã_dh', 'ma_dh', 'mã đơn', 'madh', 'order_id'];

function getSkipStages(lk, gc) {
  const lkLower = (lk || '').toLowerCase();
  const gcLower = (gc || '').toLowerCase();
  if (lkLower.includes('sửa'))      return SKIP_STAGES.sua;
  if (lkLower.includes('làm tiếp')) return SKIP_STAGES.lam_tiep;
  if (gcLower.includes('ts') || gcLower.includes('thử sườn')) return SKIP_STAGES.thusuon;
  return [];
}

function isThuSuonNote(gc) {
  const gcLower = (gc || '').toLowerCase();
  return gcLower.includes('ts') || gcLower.includes('thử sườn');
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
      const xn  = str(row[j.xn]) === 'Có';
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
    const xn  = str(row.xac_nhan) === 'Có';
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
    const skip = getSkipStages(lk, exOrder.gc || '');

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
      stages, done, total,
      pct: total > 0 ? Math.round(done / total * 100) : 0,
      curKtv, lastTg,
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

// ── getDataFromDB ─────────────────────────────────────
function getDataFromDB() {
  const db = getDB();
  const active = getActiveMaDhList();
  let rows;
  if (active && active.ids.length > 0) {
    const ph = active.ids.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao,
             d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
             d.loai_lenh, d.ghi_chu, d.ghi_chu_sx, d.trang_thai, d.tai_khoan_cao, d.routed_to,
             GROUP_CONCAT(
               t.thu_tu||'|'||t.cong_doan||'|'||COALESCE(t.ten_ktv,'')||'|'||
               COALESCE(t.xac_nhan,'Chưa')||'|'||COALESCE(t.thoi_gian_hoan_thanh,''),
               ';;'
             ) AS stages_raw
      FROM don_hang d
      LEFT JOIN tien_do t ON t.ma_dh = d.ma_dh
      WHERE d.ma_dh IN (${ph})
      GROUP BY d.ma_dh
      ORDER BY d.yc_giao ASC, d.nhap_luc ASC
    `).all(...active.ids);
  } else {
    log('⚠ Không tìm được file active, hiển thị toàn bộ DB');
    rows = db.prepare(`
      SELECT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao,
             d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
             d.loai_lenh, d.ghi_chu, d.ghi_chu_sx, d.trang_thai, d.tai_khoan_cao, d.routed_to,
             GROUP_CONCAT(
               t.thu_tu||'|'||t.cong_doan||'|'||COALESCE(t.ten_ktv,'')||'|'||
               COALESCE(t.xac_nhan,'Chưa')||'|'||COALESCE(t.thoi_gian_hoan_thanh,''),
               ';;'
             ) AS stages_raw
      FROM don_hang d
      LEFT JOIN tien_do t ON t.ma_dh = d.ma_dh
      GROUP BY d.ma_dh
      ORDER BY d.yc_giao ASC, d.nhap_luc ASC
    `).all();
  }

  const orders = [];
  for (const row of rows) {
    const lk   = row.loai_lenh || '';
    const gc   = row.ghi_chu   || '';
    const skip = getSkipStages(lk, gc);

    const stagesMap = {};
    for (const part of (row.stages_raw || '').split(';;')) {
      const p = part.split('|');
      if (p.length >= 5) {
        const thu_tu = parseInt(p[0]);
        if (!isNaN(thu_tu)) {
          stagesMap[thu_tu] = { n: p[1], k: p[2], x: p[3] === 'Có' || p[3] === 'xác nhận', t: p[4] };
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
    let curKtv = '';
    for (let i = stages.length - 1; i >= 0; i--) {
      if (!stages[i].sk && stages[i].k) { curKtv = stages[i].k; break; }
    }
    let lastTg = '';
    stages.forEach(s => { if (s.t) lastTg = s.t; });

    orders.push({
      ma_dh: row.ma_dh, nhan: row.nhap_luc || '', yc_ht: row.yc_hoan_thanh || '',
      yc_giao: row.yc_giao || '', kh: row.khach_hang || '', bn: row.benh_nhan || '',
      ph: row.phuc_hinh || '', sl: row.sl || 0, gc: row.ghi_chu || '', ghi_chu_sx: row.ghi_chu_sx || '', lk,
      routed_to: row.routed_to || 'sap',
      tk: row.tai_khoan_cao || '', stages, done, total,
      pct: total > 0 ? Math.round(done / total * 100) : 0, curKtv, lastTg,
    });
  }

  orders.sort((a, b) => {
    if (a.yc_giao && !b.yc_giao) return -1;
    if (!a.yc_giao && b.yc_giao) return 1;
    return (a.yc_giao || '').localeCompare(b.yc_giao || '');
  });

  return { source: { db: 'labo_data.db', active: active?.src || null }, orders };
}

// ── Cache + getData ───────────────────────────────────
let cache     = null;
let cacheKey  = '';
let cacheTime = 0;
const TTL     = 60_000;

function resetCache() {
  cache = null; cacheKey = ''; cacheTime = 0;
}

function getData(forceReload = false) {
  if (dbHasData()) {
    const age = Date.now() - cacheTime;
    const key = 'sqlite';
    if (!forceReload && cache && cacheKey === key && age < TTL) return cache;
    try {
      cache = getDataFromDB(); cacheKey = key; cacheTime = Date.now();
      log(`✓ ${cache.orders.length} đơn (SQLite)`);
      return cache;
    } catch (e) { log(`⚠ SQLite read error: ${e.message} — fallback to files`); }
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

  const orders = buildOrders(excelOrders, excelStageMap, jsonStageMap);
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
  getSkipStages,
  isThuSuonNote,
  userCongDoanToDB,
  findLatest,
  readExcel,
  readJsonScraper,
  buildOrders,
  getActiveMaDhList,
  getDataFromDB,
  getData,
  resetCache,
};
