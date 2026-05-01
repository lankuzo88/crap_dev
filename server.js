/**
 * ASIA LAB — Dashboard Server v3
 * Đọc: File_sach/ (Excel sạch mới nhất) + Data/ (JSON tiến độ)
 *
 * Cách chạy:
 *   cd C:\Users\...\Desktop\crap_dev
 *   npm install express xlsx
 *   node server.js
 *
 * Mở browser: http://localhost:3000
 */

const express  = require('express');
const XLSX     = require('xlsx');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const multer   = require('multer');
const { spawn }  = require('child_process');
const Database = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));

// ── AUTH ──────────────────────────────────────────────
const USERS_JSON_PATH = path.join(__dirname, 'users.json');
let USERS = {};

function loadUsers() {
  try {
    if (fs.existsSync(USERS_JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
      USERS = {};
      data.users.forEach(u => {
        USERS[u.username] = { password: u.password, role: u.role };
      });
      log(`📋 Loaded ${data.users.length} user(s) from users.json`);
    } else {
      USERS = { admin: { password: '142536', role: 'admin' } };
      saveUsers();
      log(`✅ Created default admin user`);
    }
  } catch (e) {
    log(`⚠ Error loading users: ${e.message}`);
    USERS = { admin: { password: '142536', role: 'admin' } };
  }
}

function saveUsers() {
  try {
    const users = Object.entries(USERS).map(([username, data]) => ({
      username,
      password: data.password,
      role: data.role,
    }));
    fs.writeFileSync(USERS_JSON_PATH, JSON.stringify({ users }, null, 2));
  } catch (e) {
    log(`❌ Error saving users: ${e.message}`);
  }
}

const sessions = new Map();
const SESS_TTL        = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const SESS_COOKIE_AGE = 7 * 24 * 60 * 60;         // 7 ngày (giây, cho Max-Age)
const SESSIONS_PATH   = path.join(__dirname, 'sessions.json');

function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
    const now = Date.now();
    let loaded = 0;
    for (const [token, sess] of Object.entries(raw)) {
      if (sess.expires > now) { sessions.set(token, sess); loaded++; }
    }
    if (loaded) log(`🔑 Restored ${loaded} session(s)`);
  } catch (e) {
    log(`⚠ Could not load sessions: ${e.message}`);
  }
}

function saveSessions() {
  try {
    const obj = {};
    for (const [token, sess] of sessions) obj[token] = sess;
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(obj));
  } catch (e) {
    log(`⚠ Could not save sessions: ${e.message}`);
  }
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getSessionToken(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 'sid') return decodeURIComponent(v);
  }
  return '';
}

function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (!sess || sess.expires < Date.now()) {
    sessions.delete(token);
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (!sess || sess.expires < Date.now()) {
    sessions.delete(token);
    return res.redirect('/login');
  }
  if (sess.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ── CẤU HÌNH ĐƯỜNG DẪN ───────────────────────────────
const BASE_DIR      = __dirname;
const FILE_SACH_DIR = path.join(BASE_DIR, 'File_sach');
const DATA_DIR      = path.join(BASE_DIR, 'Data');
const DASHBOARD        = path.join(BASE_DIR, 'dashboard.html');
const DASHBOARD_MOBILE = path.join(BASE_DIR, 'dashboard_mobile_terracotta.html');
const EXCEL_DIR        = path.join(BASE_DIR, 'Excel');
const DB_PATH          = path.join(BASE_DIR, 'labo_data.db');

// ── SQLITE ────────────────────────────────────────────
let _db = null;
function getDB() {
  if (!_db) {
    if (!fs.existsSync(DB_PATH)) return null;
    try {
      _db = new Database(DB_PATH, { readonly: true });
    } catch (e) {
      log(`⚠ SQLite open error: ${e.message}`);
      return null;
    }
  }
  return _db;
}

function dbHasData() {
  const db = getDB();
  if (!db) return false;
  try {
    const row = db.prepare('SELECT COUNT(*) as n FROM don_hang').get();
    return row && row.n > 0;
  } catch { return false; }
}

// Tên cột mã đơn hàng trong file keylab Excel
const MADH_COL_HINTS = ['mã đh', 'mã_dh', 'ma_dh', 'mã đơn', 'madh', 'order_id'];

function getActiveMaDhList() {
  // Nguồn chính: file .xls mới nhất trong Excel/ (keylab export)
  const excelFile = findLatest(EXCEL_DIR, ['.xls', '.xlsx', '.xlsm']);
  if (excelFile) {
    try {
      const SHEET_HINTS = ['đơn hàng', 'don hang', 'sheet1', 'sheet'];
      const wb   = XLSX.readFile(excelFile.path, { sheetRows: 0 });
      const name = wb.SheetNames.find(n =>
        SHEET_HINTS.some(h => n.toLowerCase().includes(h))
      ) || wb.SheetNames[0];
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

function getDataFromDB() {
  const db = getDB();

  // Chỉ lấy đơn hàng có trong file export mới nhất
  const active = getActiveMaDhList();
  let rows;
  if (active && active.ids.length > 0) {
    const ph = active.ids.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao,
             d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
             d.loai_lenh, d.ghi_chu, d.trang_thai, d.tai_khoan_cao,
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
    // Không tìm được file active → fallback: lấy tất cả (cũ)
    log('⚠ Không tìm được file active, hiển thị toàn bộ DB');
    rows = db.prepare(`
      SELECT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao,
             d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
             d.loai_lenh, d.ghi_chu, d.trang_thai, d.tai_khoan_cao,
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
          stagesMap[thu_tu] = { n: p[1], k: p[2], x: p[3] === 'Có', t: p[4] };
        }
      }
    }

    const stages = STAGE_NAMES.map((name, i) => {
      const s = stagesMap[i + 1] || { n: name, k: '', x: false, t: '' };
      return { n: name, k: s.k, x: s.x, t: s.t, sk: skip.includes(i) };
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
      ma_dh:   row.ma_dh,
      nhan:    row.nhap_luc      || '',
      yc_ht:   row.yc_hoan_thanh || '',
      yc_giao: row.yc_giao       || '',
      kh:      row.khach_hang    || '',
      bn:      row.benh_nhan     || '',
      ph:      row.phuc_hinh     || '',
      sl:      row.sl            || 0,
      gc:      row.ghi_chu       || '',
      lk,
      tk:      row.tai_khoan_cao || '',
      stages, done, total,
      pct:     total > 0 ? Math.round(done / total * 100) : 0,
      curKtv,  lastTg,
    });
  }

  orders.sort((a, b) => {
    if (a.yc_giao && !b.yc_giao) return -1;
    if (!a.yc_giao && b.yc_giao) return 1;
    return (a.yc_giao || '').localeCompare(b.yc_giao || '');
  });

  return { source: { db: 'labo_data.db', active: active?.src || null }, orders };
}

// Python: dùng full path để tránh lỗi PATH trong Task Scheduler
const PYTHON = (() => {
  const candidates = [
    'C:\\Users\\Administrator\\AppData\\Local\\Python\\bin\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    'python',
  ];
  return candidates.find(p => p === 'python' || fs.existsSync(p)) || 'python';
})();

const STAGE_NAMES = ['CBM', 'SÁP/Cadcam', 'SƯỜN', 'ĐẮP', 'MÀI'];

// Công đoạn bị bỏ qua theo loại đơn (0-indexed)
// - "Sửa" / "Làm tiếp" → bỏ CBM(0), SÁP(1), SƯỜN(2) → chỉ còn ĐẮP(3), MÀI(4) = 2 stage
// - "TS" / "Thử sườn" trong ghi chú → bỏ ĐẮP(3), MÀI(4) → chỉ còn CBM(0), SÁP(1), SƯỜN(2) = 3 stage
const SKIP_STAGES = {
  sua_laitiep: [0, 1, 2],  // CBM, SÁP, SƯỜN
  thusuon:     [3, 4],     // ĐẮP, MÀI
};

function getSkipStages(lk, gc) {
  const lkLower = (lk || '').toLowerCase();
  const gcLower = (gc || '').toLowerCase();
  if (lkLower.includes('sửa') || lkLower.includes('làm tiếp')) {
    return SKIP_STAGES.sua_laitiep;
  }
  if (gcLower.includes('ts') || gcLower.includes('thử sườn')) {
    return SKIP_STAGES.thusuon;
  }
  return [];
}

// ── CACHE ─────────────────────────────────────────────
let cache     = null;
let cacheKey  = '';
let cacheTime = 0;
const TTL     = 60_000; // 1 phút

// ── UTILS ─────────────────────────────────────────────
const str   = v => (v != null) ? String(v).trim() : '';
const log   = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

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

// ── TÌM FILE MỚI NHẤT ─────────────────────────────────
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

// ── ĐỌC FILE EXCEL (File_sach) ─────────────────────────
function readExcel(filePath) {
  log(`Đọc Excel: ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath, { cellDates: true, dateNF: 'yyyy-mm-dd hh:mm:ss' });

  // Tìm sheet theo từ khóa
  const getSheet = (...keys) => {
    const name = wb.SheetNames.find(n => keys.some(k => n.toLowerCase().includes(k.toLowerCase())));
    return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) : null;
  };

  // ── Sheet "Đơn hàng" ──────────────────────────────
  const raw1 = getSheet('Đơn hàng', 'Don hang', 'don_hang', 'order');
  if (!raw1) throw new Error('Không tìm thấy sheet "Đơn hàng"');

  const h1  = raw1[0].map(h => str(h));
  const c1  = keyword => h1.findIndex(h => h.includes(keyword));

  const i = {
    ma:   c1('Mã ĐH'),
    nhan: c1('Nhận'),
    ht:   c1('hoàn thành'),
    giao: c1('giao'),
    kh:   c1('Khách'),
    bn:   c1('ệnh nhân'),
    ph:   c1('Phục hình'),
    sl:   c1('SL'),
    gc:   c1('Ghi chú'),
  };

  const orders = {};
  for (let r = 1; r < raw1.length; r++) {
    const row = raw1[r];
    const ma  = str(row[i.ma]);
    if (!ma || ma.includes('TỔNG') || ma === 'Mã ĐH') continue;
    const sl = parseInt(row[i.sl]) || 0;
    orders[ma] = {
      ma_dh:    ma,
      nhan:     parseDate(row[i.nhan]),
      yc_ht:    parseDate(row[i.ht]),
      yc_giao:  parseDate(row[i.giao]),
      kh:       str(row[i.kh]),
      bn:       str(row[i.bn]),
      ph:       str(row[i.ph]).replace(/\r\n/g, ' | '),
      sl:       sl,
      gc:       str(row[i.gc]),
    };
  }

  // ── Sheet "Tiến độ" ───────────────────────────────
  const raw2 = getSheet('Tiến độ', 'Tien do', 'tien_do', 'progress');
  const stageMap = {};

  if (raw2) {
    const h2 = raw2[0].map(h => str(h));
    const c2 = keyword => h2.findIndex(h => h.includes(keyword));
    const j = {
      ma:  c2('Mã ĐH'),
      cd:  c2('Công đoạn'),
      ktv: c2('KTV'),
      xn:  c2('Xác nhận'),
      tg:  c2('Thời gian'),
      lk:  c2('Loại lệnh'),
      tk:  c2('Tài khoản'),
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

// ── ĐỌC JSON SCRAPER (Data/) ──────────────────────────
function readJsonScraper(filePath) {
  log(`Đọc JSON: ${path.basename(filePath)}`);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

    if (!stageMap[ma]) stageMap[ma] = { lk: '', tk: '', stages: {}, ph: '', sl: 0 };
    if (tk) stageMap[ma].tk = tk;

    // Parse ph và sl từ raw_row_text nếu có
    if (row.raw_row_text && !stageMap[ma].ph) {
      const txt = str(row.raw_row_text);
      const slM = txt.match(/SL:(\d+)/);
      const slIdx = txt.indexOf(' SL:');
      stageMap[ma].ph  = slIdx > 0 ? txt.substring(0, slIdx).trim() : '';
      stageMap[ma].sl  = slM ? parseInt(slM[1]) : 0;
      // Detect loai_lenh từ cuối string
      const lkM = txt.match(/,\s*(\S[^,]*)$/);
      if (lkM) stageMap[ma].lk = lkM[1].trim();
    }

    stageMap[ma].stages[cd] = { ktv, xn, tg };
  }
  return stageMap;
}

// ── MERGE & BUILD ORDERS ──────────────────────────────
function buildOrders(excelOrders, excelStageMap, jsonStageMap) {
  const result = [];

  // Tập hợp tất cả ma_dh
  const allIds = new Set([
    ...Object.keys(excelOrders),
    ...Object.keys(excelStageMap),
    ...Object.keys(jsonStageMap),
  ]);

  for (const ma of allIds) {
    const order  = excelOrders[ma] || {};
    // Ưu tiên JSON scraper (realtime) > Excel stage
    const sm     = jsonStageMap[ma]   || excelStageMap[ma] || { lk: '', tk: '', stages: {} };

    const gc      = order.gc || '';
    const skip    = getSkipStages(sm.lk, gc);
    const stages  = STAGE_NAMES.map((n, i) => {
      const sd = sm.stages[n] || { ktv: '', xn: false, tg: '' };
      return { n, k: sd.ktv, x: sd.xn, t: sd.tg, sk: skip.includes(i) };
    });

    const activeStages = stages.filter(s => !s.sk);
    const done   = activeStages.filter(s => s.x).length;
    const totalStages = activeStages.length;
    const pct   = totalStages > 0 ? Math.round(done / totalStages * 100) : 0;

    let curKtv   = '';
    for (let i = stages.indexOf(activeStages[activeStages.length - 1]); i >= 0; i--) {
      if (!stages[i].sk && stages[i].k) { curKtv = stages[i].k; break; }
    }
    let lastTg = '';
    stages.forEach(s => { if (s.t) lastTg = s.t; });

    result.push({
      ma_dh:    ma,
      nhan:     order.nhan     || '',
      yc_ht:    order.yc_ht   || '',
      yc_giao:  order.yc_giao || '',
      kh:       order.kh      || '',
      bn:       order.bn      || '',
      ph:       order.ph      || sm.ph || '',
      sl:       order.sl      || sm.sl || 0,
      gc:       order.gc      || '',
      lk:       sm.lk         || '',
      tk:       sm.tk         || 'lanhn',
      stages,
      done,
      total:    totalStages,
      pct:      totalStages > 0 ? Math.round(done / totalStages * 100) : 0,
      curKtv,
      lastTg,
    });
  }

  // Sắp xếp: có yc_giao trước, sau đó theo thời gian giao
  result.sort((a, b) => {
    if (a.yc_giao && !b.yc_giao) return -1;
    if (!a.yc_giao && b.yc_giao) return 1;
    return (a.yc_giao || '').localeCompare(b.yc_giao || '');
  });

  return result;
}

// ── LẤY DATA (cache) ──────────────────────────────────
function getData(forceReload = false) {
  // Ưu tiên SQLite nếu DB đã có dữ liệu
  if (dbHasData()) {
    const age = Date.now() - cacheTime;
    const key = 'sqlite';
    if (!forceReload && cache && cacheKey === key && age < TTL) {
      return cache;
    }
    try {
      cache     = getDataFromDB();
      cacheKey  = key;
      cacheTime = Date.now();
      log(`✓ ${cache.orders.length} đơn (SQLite)`);
      return cache;
    } catch (e) {
      log(`⚠ SQLite read error: ${e.message} — fallback to files`);
    }
  }

  // Fallback: đọc từ file (trước khi import lịch sử)
  const excelFile = findLatest(FILE_SACH_DIR, ['.xlsx', '.xls', '.xlsm']);
  const jsonFile  = findLatest(DATA_DIR, ['.json']);

  const key = `${excelFile?.mtime || 0}_${jsonFile?.mtime || 0}`;
  const age = Date.now() - cacheTime;

  if (!forceReload && cache && key === cacheKey && age < TTL) {
    return cache;
  }

  let excelOrders   = {};
  let excelStageMap = {};
  let jsonStageMap  = {};
  let srcExcel      = null;
  let srcJson       = null;

  if (excelFile) {
    try {
      const r = readExcel(excelFile.path);
      excelOrders   = r.orders;
      excelStageMap = r.stageMap;
      srcExcel      = excelFile.name;
    } catch (e) { log(`⚠ Excel: ${e.message}`); }
  }

  if (jsonFile) {
    try {
      jsonStageMap = readJsonScraper(jsonFile.path);
      srcJson      = jsonFile.name;
    } catch (e) { log(`⚠ JSON: ${e.message}`); }
  }

  const orders = buildOrders(excelOrders, excelStageMap, jsonStageMap);

  cache     = { source: { excel: srcExcel, json: srcJson }, orders };
  cacheKey  = key;
  cacheTime = Date.now();

  log(`✓ ${orders.length} đơn | Excel: ${srcExcel || '—'} | JSON: ${srcJson || '—'}`);
  return cache;
}

// ── SCRAPE STATUS ─────────────────────────────────────
let scrapeJob = { running: false, file: null, log: [], exitCode: null, startedAt: null };
const scrapeQueue = []; // Queue of filePaths waiting to be scraped

// Tracks files uploaded via web UI so the watcher doesn't double-process them
const webUploadFiles = new Set();
const manualKeyLabExports = new Set(); // Track files từ manual export (admin click button)

// Pattern file do keylab_exporter tạo ra: DDMMYYYY_N.xls(x)
const KEYLAB_FILE_RE = /^\d{8}_\d+\.(xls|xlsx|xlsm)$/i;

function queueOrScrape(filePath) {
  const filename = path.basename(filePath);
  if (scrapeJob.running) {
    // Avoid duplicates in queue
    if (!scrapeQueue.some(f => path.basename(f) === filename)) {
      scrapeQueue.push(filePath);
      log(`📋 Xếp hàng: ${filename} (hàng chờ: ${scrapeQueue.length})`);
    }
  } else {
    spawnScraper(filePath);
  }
}

function spawnScraper(filePath) {
  scrapeJob = {
    running: true,
    file: path.basename(filePath),
    log: [],
    exitCode: null,
    startedAt: new Date().toISOString(),
    progress: { done: 0, failed: 0, total: 0 }
  };
  log(`🚀 Bắt đầu cào: ${scrapeJob.file}`);

  const proc = spawn(PYTHON, ['run_scrape.py', filePath], {
    cwd: BASE_DIR,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PLAYWRIGHT_BROWSERS_PATH: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright',
      LABO_USER1: 'lanhn',
      LABO_PASS1: '796803',
      LABO_USER2: 'kythuat',
      LABO_PASS2: '670226',
    },
  });

  const pushLog = (chunk) => {
    const lines = chunk.toString('utf-8').split('\n').filter(l => l.trim());

    // Parse progress from log lines
    lines.forEach(l => {
      if (l.includes('OK') && l.includes(':')) {
        scrapeJob.progress.done++;
      } else if (l.includes('FAIL') && l.includes(':')) {
        scrapeJob.progress.failed++;
      } else if (l.match(/Tổng \d+ đơn hàng/)) {
        const match = l.match(/Tổng (\d+) đơn/);
        if (match) scrapeJob.progress.total = parseInt(match[1]);
      }
    });

    scrapeJob.log.push(...lines);
    if (scrapeJob.log.length > 300) scrapeJob.log = scrapeJob.log.slice(-300);
  };

  proc.stdout.on('data', pushLog);
  proc.stderr.on('data', pushLog);

  proc.on('error', err => {
    scrapeJob.running = false;
    scrapeJob.exitCode = -1;
    scrapeJob.log.push(`[spawn error] ${err.message}`);
    log(`❌ Scraper spawn error: ${err.message}`);
  });

  proc.on('close', code => {
    scrapeJob.running = false;
    scrapeJob.exitCode = code;
    cache = null; cacheKey = ''; cacheTime = 0;
    // Re-open DB để đọc dữ liệu mới vừa import
    if (_db) { try { _db.close(); } catch {} _db = null; }
    log(`🏁 Scraper done: ${scrapeJob.file}, exit=${code}`);

    if (scrapeQueue.length > 0) {
      const next = scrapeQueue.shift();
      log(`📋 Xử lý tiếp từ hàng chờ: ${path.basename(next)} (còn lại: ${scrapeQueue.length})`);
      setTimeout(() => spawnScraper(next), 1000);
    }
  });
}

// ── FILE STABILITY CHECK ──────────────────────────────
async function waitForFileStable(filePath, filename, timeoutMs = 2000) {
  const startTime = Date.now();
  let lastSize = -1;
  let stableCount = 0;
  const requiredStableChecks = 4; // 4 checks × 500ms = 2s stable

  while (Date.now() - startTime < timeoutMs + 2000) {
    if (!fs.existsSync(filePath)) {
      throw new Error('File disappeared during stability check');
    }

    const stat = fs.statSync(filePath);
    const currentSize = stat.size;

    if (currentSize === lastSize && currentSize > 0) {
      stableCount++;
      if (stableCount >= requiredStableChecks) {
        log(`  ✓ File stable: ${filename} (${currentSize} bytes)`);
        return;
      }
    } else {
      stableCount = 0;
      lastSize = currentSize;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  throw new Error(`Timeout waiting for file stability (last size: ${lastSize})`);
}

// ── FILE WATCHER ──────────────────────────────────────
function startExcelWatcher() {
  if (!fs.existsSync(EXCEL_DIR)) return;

  // Snapshot files already present at startup — don't process these
  const existing = new Set(fs.readdirSync(EXCEL_DIR));
  const pending  = new Map(); // debounce timers per filename

  fs.watch(EXCEL_DIR, (eventType, filename) => {
    if (!filename) return;
    const ext = path.extname(filename).toLowerCase();
    if (!['.xlsx', '.xls', '.xlsm'].includes(ext)) return;

    // Skip files that existed before server started
    if (existing.has(filename)) return;
    existing.add(filename);

    // Skip files that came in via web upload (already handled)
    if (webUploadFiles.has(filename)) return;

    // Skip Keylab auto-export files (chỉ scrape nếu từ manual export button)
    const isKeyLabFile = KEYLAB_FILE_RE.test(filename);
    if (isKeyLabFile && !manualKeyLabExports.has(filename)) {
      log(`⏭  Skip auto-export Keylab file: ${filename} (chỉ scrape từ manual export)`);
      return;
    }
    if (isKeyLabFile && manualKeyLabExports.has(filename)) {
      manualKeyLabExports.delete(filename); // Cleanup
    }

    // File thường (upload tay): chờ 3s
    const debounceMs = 3_000;

    if (pending.has(filename)) clearTimeout(pending.get(filename));

    pending.set(filename, setTimeout(() => {
      pending.delete(filename);
      const filePath = path.join(EXCEL_DIR, filename);

      // Check file exists
      if (!fs.existsSync(filePath)) {
        log(`⚠ File disappeared: ${filename}`);
        return;
      }

      // Wait for file size to stabilize (2 seconds)
      waitForFileStable(filePath, filename, 2000)
        .then(() => {
          log(`📂 Phát hiện file mới (stable): ${filename}`);
          queueOrScrape(filePath);
        })
        .catch(err => {
          log(`⚠ File not stable after timeout: ${filename} - ${err.message}`);
        });
    }, debounceMs));
  });

  log(`👀 Đang theo dõi thư mục Excel/`);
}

// ── KEYLAB EXPORT ON-DEMAND ───────────────────────────
// Không tự chạy nữa — chỉ xuất khi admin bấm nút trên dashboard
let keylabExportJob = { running: false, startedAt: null, exitCode: null, savedFile: null };

// ── UPLOAD (multer) ───────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, EXCEL_DIR),
    filename:    (req, file, cb) => {
      const ext  = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext)
                       .replace(/[^a-zA-Z0-9_\-À-ɏḀ-ỿ]/g, '_');
      cb(null, `${name}_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.xlsm'].includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(ok ? null : new Error('Chỉ chấp nhận file Excel (.xlsx/.xls/.xlsm)'), ok);
  },
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

if (!fs.existsSync(EXCEL_DIR)) fs.mkdirSync(EXCEL_DIR, { recursive: true });

// ── ROUTES ────────────────────────────────────────────
app.get('/login', (req, res) => {
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (sess && sess.expires > Date.now()) return res.redirect('/');
  res.sendFile(path.join(BASE_DIR, 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS[username];
  if (user && user.password === password) {
    const token = genToken();
    sessions.set(token, { user: username, role: user.role, expires: Date.now() + SESS_TTL });
    saveSessions();
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESS_COOKIE_AGE}`);
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  const token = getSessionToken(req);
  sessions.delete(token);
  saveSessions();
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.redirect('/login');
});

app.get('/upload', requireAuth, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'upload.html'));
});

app.post('/upload', requireAuth, (req, res) => {
  const token = getSessionToken(req);
  const sess = sessions.get(token);

  if (sess.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Chỉ admin có quyền upload file' });
  }

  upload.single('excel')(req, res, err => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Không có file nào được gửi lên' });
    }
    log(`📤 Upload: ${req.file.filename} (${(req.file.size/1024).toFixed(0)} KB) → cào tự động`);
    webUploadFiles.add(req.file.filename);
    setTimeout(() => webUploadFiles.delete(req.file.filename), 30000);
    queueOrScrape(req.file.path);
    res.json({ ok: true, filename: req.file.filename, size: req.file.size });
  });
});

app.get('/scrape-status', requireAuth, (req, res) => {
  res.json({ ...scrapeJob, queue: scrapeQueue.map(f => path.basename(f)) });
});

app.get('/keylab-status', requireAuth, (req, res) => {
  res.json(keylabExportJob);
});

app.post('/keylab-export-now', requireAuth, requireAdmin, (req, res) => {
  if (keylabExportJob.running) {
    return res.status(409).json({ ok: false, message: 'Đang chạy rồi, vui lòng đợi...' });
  }

  keylabExportJob = { running: true, startedAt: new Date().toISOString(), exitCode: null, savedFile: null };
  log('⌨  Keylab export triggered manually');

  const proc = spawn(PYTHON, ['keylab_exporter.py', '--once'], {
    cwd: BASE_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let stdout = '';
  proc.stdout.on('data', d => {
    const chunk = d.toString();
    stdout += chunk;
    chunk.split('\n').filter(Boolean).forEach(l => log(`[keylab] ${l}`));
  });
  proc.stderr.on('data', d => {
    d.toString().split('\n').filter(Boolean).forEach(l => log(`[keylab] ${l}`));
  });
  proc.on('error', err => {
    keylabExportJob.running = false;
    keylabExportJob.exitCode = -1;
    log(`[keylab] spawn error: ${err.message}`);
  });
  proc.on('close', code => {
    keylabExportJob.running = false;
    keylabExportJob.exitCode = code;
    const match = stdout.match(/SAVED:(.+)/);
    if (match) {
      keylabExportJob.savedFile = match[1].trim();
      // Mark this file as manual export so file watcher will scrape it
      const filename = path.basename(keylabExportJob.savedFile);
      manualKeyLabExports.add(filename);
      log(`[keylab] Marked for scrape: ${filename}`);
    }
    log(`[keylab] done (exit=${code})${keylabExportJob.savedFile ? ' → ' + keylabExportJob.savedFile : ''}`);
  });

  res.json({ ok: true, message: 'Đang xuất Excel từ KeyLab...' });
});

app.get('/keylab-export-status', requireAuth, (req, res) => {
  res.json(keylabExportJob);
});

app.get('/files', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(EXCEL_DIR)
      .filter(f => ['.xlsx','.xls','.xlsm'].some(e => f.toLowerCase().endsWith(e)))
      .map(f => {
        const stat = fs.statSync(path.join(EXCEL_DIR, f));
        return { name: f, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch { res.json([]); }
});

function isMobile(req) {
  const ua = req.headers['user-agent'] || '';
  return /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(ua);
}

app.get('/', requireAuth, (req, res) => {
  const file = isMobile(req) ? DASHBOARD_MOBILE : DASHBOARD;
  if (fs.existsSync(file)) {
    res.sendFile(file);
  } else if (fs.existsSync(DASHBOARD)) {
    res.sendFile(DASHBOARD);
  } else {
    res.status(404).send(`<h2>Không tìm thấy dashboard.html</h2><p>Đặt file <b>dashboard.html</b> trong thư mục <b>crap_dev/</b></p>`);
  }
});

app.get('/data.json', requireAuth, (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const data = getData();
    if (!data.orders.length) {
      return res.status(404).json({
        error: 'Không tìm thấy dữ liệu',
        hint: `Kiểm tra thư mục Excel/ (${EXCEL_DIR}) và DB (${DB_PATH})`,
      });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/reload', requireAuth, (req, res) => {
  cache = null; cacheKey = ''; cacheTime = 0;
  // Re-open DB connection để nhận dữ liệu mới
  if (_db) { try { _db.close(); } catch {} _db = null; }
  try {
    const data = getData(true);
    res.json({ ok: true, orders: data.orders.length, source: data.source });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ANALYTICS API ─────────────────────────────────────
app.get('/api/orders', requireAuth, (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo. Chạy: python db_manager.py import-all' });

  const { ma_dh_goc, loai_lenh, tai_khoan, limit = 100, offset = 0 } = req.query;
  let sql = `
    SELECT d.*, GROUP_CONCAT(
      t.thu_tu||'|'||t.cong_doan||'|'||COALESCE(t.ten_ktv,'')||'|'||
      COALESCE(t.xac_nhan,'Chưa')||'|'||COALESCE(t.thoi_gian_hoan_thanh,''),
      ';;'
    ) AS stages_raw
    FROM don_hang d
    LEFT JOIN tien_do t ON t.ma_dh = d.ma_dh
    WHERE 1=1
  `;
  const params = [];
  if (ma_dh_goc)  { sql += ' AND d.ma_dh_goc = ?';     params.push(ma_dh_goc); }
  if (loai_lenh)  { sql += ' AND d.loai_lenh = ?';      params.push(loai_lenh); }
  if (tai_khoan)  { sql += ' AND d.tai_khoan_cao = ?';  params.push(tai_khoan); }
  sql += ' GROUP BY d.ma_dh ORDER BY d.yc_giao ASC, d.nhap_luc ASC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  try {
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, count: rows.length, orders: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/orders/:ma_dh', requireAuth, (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo' });
  try {
    const order  = db.prepare('SELECT * FROM don_hang WHERE ma_dh = ?').get(req.params.ma_dh);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    const stages  = db.prepare('SELECT * FROM tien_do WHERE ma_dh = ? ORDER BY thu_tu').all(req.params.ma_dh);
    const variants = db.prepare('SELECT * FROM don_hang WHERE ma_dh_goc = ? AND ma_dh != ?')
                       .all(order.ma_dh_goc, order.ma_dh);
    res.json({ order, stages, variants });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analytics/ktv', requireAuth, (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo' });
  try {
    const rows = db.prepare(`
      SELECT ten_ktv, cong_doan,
             COUNT(*) AS tong,
             SUM(CASE WHEN xac_nhan='Có' THEN 1 ELSE 0 END) AS da_xong
      FROM tien_do
      WHERE ten_ktv != ''
      GROUP BY ten_ktv, cong_doan
      ORDER BY ten_ktv, thu_tu
    `).all();
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analytics/daily', requireAuth, (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo' });
  try {
    const rows = db.prepare(`
      SELECT substr(thoi_gian_hoan_thanh, 7, 4)||'-'||
             substr(thoi_gian_hoan_thanh, 4, 2)||'-'||
             substr(thoi_gian_hoan_thanh, 1, 2) AS ngay,
             cong_doan,
             COUNT(*) AS so_cong_doan
      FROM tien_do
      WHERE xac_nhan='Có' AND thoi_gian_hoan_thanh != ''
      GROUP BY ngay, cong_doan
      ORDER BY ngay DESC
      LIMIT 90
    `).all();
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/db/stats', requireAuth, (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo' });
  try {
    const n_dh   = db.prepare('SELECT COUNT(*) as n FROM don_hang').get().n;
    const n_phu  = db.prepare('SELECT COUNT(*) as n FROM don_hang WHERE la_don_phu=1').get().n;
    const n_td   = db.prepare('SELECT COUNT(*) as n FROM tien_do').get().n;
    const n_log  = db.prepare("SELECT COUNT(*) as n FROM import_log WHERE trang_thai='ok'").get().n;
    const last   = db.prepare('SELECT ngay_import, ten_file FROM import_log ORDER BY id DESC LIMIT 1').get();
    res.json({ ok: true, don_hang: n_dh, don_phu: n_phu, tien_do: n_td, files_imported: n_log, last_import: last });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/status', requireAuth, (req, res) => {
  const latestExport = findLatest(EXCEL_DIR, ['.xls', '.xlsx', '.xlsm']);
  const db = getDB();
  let dbStats = null;
  if (db) {
    try {
      dbStats = {
        don_hang: db.prepare('SELECT COUNT(*) as n FROM don_hang').get().n,
        tien_do:  db.prepare('SELECT COUNT(*) as n FROM tien_do').get().n,
      };
    } catch {}
  }
  res.json({
    status:         'online',
    time:           new Date().toLocaleString('vi-VN'),
    excel_dir:      EXCEL_DIR,
    latest_export:  latestExport?.name || null,
    active_source:  cache?.source?.active || null,
    cached_orders:  cache?.orders?.length || 0,
    cache_age_s:    cacheTime ? Math.round((Date.now()-cacheTime)/1000) : null,
    db:             dbStats,
  });
});

app.get('/mobile', requireAuth, (req, res) => {
  if (fs.existsSync(DASHBOARD_MOBILE)) res.sendFile(DASHBOARD_MOBILE);
  else res.redirect('/');
});

// ── USER API ──────────────────────────────────────────
app.get('/user', requireAuth, (req, res) => {
  const token = getSessionToken(req);
  const sess = sessions.get(token);
  res.json({ username: sess.user, role: sess.role });
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'admin.html'));
});

app.get('/admin/api/users', requireAdmin, (req, res) => {
  const users = Object.entries(USERS).map(([username, data]) => ({
    username,
    role: data.role,
  }));
  res.json(users);
});

app.post('/admin/api/users', requireAdmin, express.json(), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Missing username, password, or role' });
  }
  if (USERS[username]) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  USERS[username] = { password, role };
  saveUsers();
  log(`👤 New user created: ${username} (${role})`);
  res.json({ ok: true, username, role });
});

app.delete('/admin/api/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  const token = getSessionToken(req);
  const sess = sessions.get(token);

  if (username === sess.user) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  if (!USERS[username]) {
    return res.status(404).json({ error: 'User not found' });
  }

  delete USERS[username];
  saveUsers();
  log(`🗑 User deleted: ${username}`);
  res.json({ ok: true, username });
});

app.post('/admin/api/users/:username/reset-password', requireAdmin, express.json(), (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ error: 'newPassword is required' });
  }
  if (!USERS[username]) {
    return res.status(404).json({ error: 'User not found' });
  }

  USERS[username].password = newPassword;
  saveUsers();
  log(`🔑 Password reset for: ${username}`);
  res.json({ ok: true, username, newPassword });
});

// Chặn truy cập trực tiếp vào file HTML dashboard qua static (trừ login.html)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') && req.path !== '/login.html') {
    return requireAuth(req, res, next);
  }
  next();
});

app.use(express.static(BASE_DIR));

// ── START ──────────────────────────────────────────────
loadUsers();
loadSessions();
startExcelWatcher();

app.listen(PORT, '127.0.0.1', () => {
  const latestExport = findLatest(EXCEL_DIR, ['.xls', '.xlsx', '.xlsm']);

  console.log('');
  console.log('  🦷  ASIA LAB Dashboard Server');
  console.log('  ──────────────────────────────────────');
  console.log(`  URL        : http://localhost:${PORT}`);
  console.log(`  Excel dir  : ${EXCEL_DIR}`);
  console.log(`  Export mới : ${latestExport?.name || '⚠ Chưa có file'}`);
  console.log(`  DB         : ${DB_PATH}`);
  console.log(`  Reload     : http://localhost:${PORT}/reload`);
  console.log(`  Status     : http://localhost:${PORT}/status`);
  console.log('');
  console.log('  Nhấn Ctrl+C để dừng');
  console.log('');

  // Pre-load ngay lúc khởi động
  try { getData(); } catch (e) { log(`⚠ Pre-load: ${e.message}`); }
});
