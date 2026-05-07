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

require('dotenv').config();

const express  = require('express');
const XLSX     = require('xlsx');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const multer   = require('multer');
const { spawn }  = require('child_process');
const Database = require('better-sqlite3');
const bcrypt   = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── AUTH ──────────────────────────────────────────────
const USERS_JSON_PATH = path.join(__dirname, 'users.json');
let USERS = {};

// Bcrypt helper functions
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
      USERS = {};
      data.users.forEach(u => {
        USERS[u.username] = {
          passwordHash: u.passwordHash || u.password,  // Support both old/new format during migration
          role: u.role,
          cong_doan: u.cong_doan || '',
          can_view_stats: u.can_view_stats === true
        };
      });
      log(`📋 Loaded ${data.users.length} user(s) from users.json`);
    } else {
      // Create default admin with hashed password
      USERS = { admin: { passwordHash: '$2b$10$placeholder', role: 'admin' } };
      saveUsers();
      log(`✅ Created default admin user`);
    }
  } catch (e) {
    log(`⚠ Error loading users: ${e.message}`);
    USERS = { admin: { passwordHash: '$2b$10$placeholder', role: 'admin' } };
  }
}

function saveUsers() {
  try {
    const users = Object.entries(USERS).map(([username, data]) => ({
      username,
      passwordHash: data.passwordHash,
      role: data.role,
      cong_doan: data.cong_doan || '',
      can_view_stats: data.can_view_stats === true,
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
  req.session = sess;
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
      _db = new Database(DB_PATH, { readonly: false });
    } catch (e) {
      log(`⚠ SQLite open error: ${e.message}`);
      return null;
    }
  }
  return _db;
}

let walCheckpointInterval = null;

function startWALCheckpoint() {
  const CHECKPOINT_INTERVAL = 30 * 60 * 1000; // 30 minutes

  walCheckpointInterval = setInterval(() => {
    const db = getDB();
    if (db) {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        log(`[WAL] Checkpoint completed at ${new Date().toISOString()}`);
      } catch (err) {
        log(`[WAL] Checkpoint error: ${err.message}`);
      }
    }
  }, CHECKPOINT_INTERVAL);

  log(`[WAL] Checkpoint started (every 30 minutes)`);
}

function stopWALCheckpoint() {
  if (walCheckpointInterval) {
    clearInterval(walCheckpointInterval);
    walCheckpointInterval = null;
    log(`[WAL] Checkpoint stopped`);
  }
}

function dbHasData() {
  const db = getDB();
  if (!db) return false;
  try {
    const row = db.prepare('SELECT COUNT(*) as n FROM don_hang').get();
    return row && row.n > 0;
  } catch { return false; }
}

function initErrorTables() {
  const db = getDB();
  if (!db) { log('⚠ initErrorTables: DB not available'); return; }
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_loi TEXT NOT NULL,
      ten_loi TEXT NOT NULL,
      cong_doan TEXT NOT NULL,
      mo_ta TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS error_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_dh TEXT,
      error_code_id INTEGER,
      ma_loi_text TEXT,
      cong_doan TEXT,
      hinh_anh TEXT,
      mo_ta TEXT,
      trang_thai TEXT DEFAULT 'pending',
      submitted_by TEXT,
      submitted_at TEXT DEFAULT (datetime('now','localtime')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      ghi_chu_admin TEXT
    );
  `);
  log('✅ Error tables initialized');
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
          // Accept both "Có" and "xác nhận" as confirmed
          const isConfirmed = p[3] === 'Có' || p[3] === 'xác nhận';
          stagesMap[thu_tu] = { n: p[1], k: p[2], x: isConfirmed, t: p[4] };
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

// Map từ cong_doan user (lưu lowercase) → cong_doan trong bảng tien_do (từ Excel)
const CD_TO_DB = {
  'CBM':     'CBM',
  'sáp':     'SÁP/Cadcam',
  'CAD/CAM': 'SÁP/Cadcam',
  'sườn':    'SƯỜN',
  'đắp':     'ĐẮP',
  'mài':     'MÀI',
};

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

// Auto-scrape interval: every 10 minutes, 24/7
const AUTO_SCRAPE_INTERVAL = 10 * 60 * 1000; // 10 minutes
let autoScrapeTimer = null;

function autoScrape() {
  if (scrapeJob.running) {
    log(`⏳ Auto-scrape skipped (scraper đang chạy: ${scrapeJob.file})`);
    return;
  }

  const latest = findLatest(EXCEL_DIR, ['.xls', '.xlsx', '.xlsm']);
  if (!latest) {
    log(`⚠ Auto-scrape: không tìm thấy file Excel trong ${EXCEL_DIR}`);
    return;
  }

  log(`🔄 Auto-scrape: ${latest.name}`);
  spawnScraper(latest.path);
}

function startAutoScrapeTimer() {
  if (autoScrapeTimer) clearInterval(autoScrapeTimer);

  log(`⏰ Auto-scrape 24/7: chạy ngay, sau đó mỗi 10 phút`);
  autoScrape();
  autoScrapeTimer = setInterval(autoScrape, AUTO_SCRAPE_INTERVAL);
}

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

// ── UPLOAD ẢNH → Cloudflare R2 ───────────────────────
class R2Storage {
  _handleFile(req, file, cb) {
    const ma_dh = (req.body?.ma_dh || 'unknown').replace(/[^a-zA-Z0-9\-]/g, '_');
    const ext   = path.extname(file.originalname).toLowerCase() || '.jpg';
    const key   = `error-images/${ma_dh}_${Date.now()}${ext}`;
    const chunks = [];

    file.stream.on('data', chunk => chunks.push(chunk));
    file.stream.on('end', async () => {
      try {
        const body = Buffer.concat(chunks);
        await r2Client.send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: body,
          ContentType: file.mimetype,
        }));
        cb(null, {
          key,
          location: `${process.env.R2_PUBLIC_URL}/${key}`,
          size: body.length,
        });
      } catch (err) {
        log(`[R2] Upload failed: ${err.message}`);
        cb(err);
      }
    });
    file.stream.on('error', cb);
  }

  _removeFile(req, file, cb) { cb(null); }
}

const uploadImage = multer({
  storage: new R2Storage(),
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── ROUTES ────────────────────────────────────────────
// Rate limiter for login: 5 attempts per IP per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 requests per windowMs
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res) => {
    log(`🚨 Login rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      ok: false,
      error: 'Quá nhiều lần thử sai. Vui lòng thử lại sau 15 phút.',
      retryAfter: 900
    });
  },
});

app.get('/login', (req, res) => {
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (sess && sess.expires > Date.now()) return res.redirect('/');
  res.sendFile(path.join(BASE_DIR, 'login.html'));
});

app.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = USERS[username];

    if (!user) {
      return res.redirect('/login?error=1');
    }

    // Verify password using bcrypt
    const isValid = await verifyPassword(password, user.passwordHash);

    if (isValid) {
      const token = genToken();
      sessions.set(token, { user: username, role: user.role, expires: Date.now() + SESS_TTL });
      saveSessions();
      log(`✅ Login successful: ${username}`);
      res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESS_COOKIE_AGE}`);
      return res.redirect('/');
    }

    // Invalid password
    return res.redirect('/login?error=1');
  } catch (err) {
    log(`❌ Login error: ${err.message}`);
    next(err);
  }
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

app.get('/api/auto-scrape/status', requireAuth, (req, res) => {
  res.json({
    enabled: autoScrapeTimer !== null,
    running: scrapeJob.running,
    currentFile: scrapeJob.file,
    nextRun: '10 phút',
    mode: '24/7',
    queue: scrapeQueue.length,
  });
});

app.post('/api/auto-scrape/run', requireAuth, requireAdmin, (req, res) => {
  if (scrapeJob.running) {
    return res.json({ ok: false, error: 'Scraper đang chạy: ' + scrapeJob.file });
  }
  const latest = findLatest(EXCEL_DIR, ['.xls', '.xlsx', '.xlsm']);
  if (!latest) {
    return res.json({ ok: false, error: 'Không tìm thấy file Excel' });
  }
  log(`🔄 Manual auto-scrape: ${latest.name}`);
  spawnScraper(latest.path);
  res.json({ ok: true, file: latest.name });
});

app.get('/keylab-status', requireAuth, (req, res) => {
  res.json(keylabExportJob);
});

// ── KEYLAB HEALTH CHECK ───────────────────────────────
app.get('/keylab-health', requireAuth, (req, res) => {
  const proc = spawn(PYTHON, ['keylab_exporter.py', '--check'], {
    cwd: BASE_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  const timeout = setTimeout(() => {
    proc.kill();
    res.json({ ok: false, message: 'Health check timeout' });
  }, 3000);

  proc.on('close', code => {
    clearTimeout(timeout);
    if (code === 0) {
      const match = stdout.match(/OK: (.+)/);
      const title = match ? match[1].trim() : 'Keylab2022';
      res.json({ ok: true, message: `Keylab đang chạy: ${title}` });
    } else {
      const error = stdout.includes('ERROR:')
        ? stdout.split('ERROR:')[1].trim()
        : 'Keylab2022 không chạy';
      res.json({ ok: false, message: error });
    }
  });

  proc.on('error', err => {
    clearTimeout(timeout);
    res.json({ ok: false, message: `Spawn error: ${err.message}` });
  });
});

// Helper function for health check
function checkKeylabHealth() {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, ['keylab_exporter.py', '--check'], {
      cwd: BASE_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Health check timeout'));
    }, 3000);

    proc.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) {
        const match = stdout.match(/OK: (.+)/);
        const title = match ? match[1].trim() : 'Keylab2022';
        resolve({ ok: true, message: `Keylab đang chạy: ${title}` });
      } else {
        const error = stdout.includes('ERROR:')
          ? stdout.split('ERROR:')[1].trim()
          : 'Keylab2022 không chạy';
        resolve({ ok: false, message: error });
      }
    });

    proc.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

app.post('/keylab-export-now', requireAuth, requireAdmin, async (req, res) => {
  if (keylabExportJob.running) {
    return res.status(409).json({ ok: false, message: 'Đang chạy rồi, vui lòng đợi...' });
  }

  // Pre-flight health check
  try {
    const healthCheck = await checkKeylabHealth();
    if (!healthCheck.ok) {
      log(`⚠ Pre-flight check failed: ${healthCheck.message}`);
      return res.status(503).json({
        ok: false,
        message: 'Keylab2022 không chạy. Vui lòng mở app trước.'
      });
    }
    log(`✓ Pre-flight check passed: ${healthCheck.message}`);
  } catch (err) {
    log(`⚠ Health check error: ${err.message}`);
    return res.status(500).json({
      ok: false,
      message: 'Không thể kiểm tra Keylab2022'
    });
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

app.get('/analytics', requireAuth, requireAdmin, (req, res) => {
  const analyticsFile = path.join(BASE_DIR, 'analytics.html');
  if (fs.existsSync(analyticsFile)) {
    res.sendFile(analyticsFile);
  } else {
    res.status(404).send('<h2>Không tìm thấy analytics.html</h2>');
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
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (fs.existsSync(DASHBOARD_MOBILE)) res.sendFile(DASHBOARD_MOBILE);
  else res.redirect('/');
});

// ── USER API ──────────────────────────────────────────
app.get('/user', requireAuth, (req, res) => {
  const token = getSessionToken(req);
  const sess = sessions.get(token);
  const u = USERS[sess.user] || {};
  res.json({ username: sess.user, role: sess.role, cong_doan: u.cong_doan || '', can_view_stats: u.can_view_stats === true });
});

app.get('/api/user/pending-orders', requireAuth, (req, res) => {
  const token = getSessionToken(req);
  const sess = sessions.get(token);
  const userCongDoan = USERS[sess.user]?.cong_doan;

  if (!userCongDoan) {
    return res.json({ ok: true, orders: [] });
  }

  const db = getDB();
  if (!db) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }

  try {
    // Get active ma_dh list from latest Excel file
    const active = getActiveMaDhList();
    if (!active) {
      log(`[User Orders] No active Excel file found`);
      return res.json({ ok: true, orders: [] });
    }

    // Map cong_doan user (lowercase) → giá trị trong bảng tien_do (từ Excel)
    const dbCongDoan = CD_TO_DB[userCongDoan] || userCongDoan;

    // ĐẮP and MÀI see all orders including repairs; other công đoạn filter out 'Sửa'
    const showRepairs = dbCongDoan === 'ĐẮP' || dbCongDoan === 'MÀI';
    const repairFilter = showRepairs ? '' : `AND d.loai_lenh != 'Sửa'`;

    // Step 1: Find orders pending for user's công đoạn in Excel file
    const ph = active.ids.map(() => '?').join(',');
    const pendingOrders = db.prepare(`
      SELECT DISTINCT d.ma_dh
      FROM tien_do t
      JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE d.ma_dh IN (${ph})
        AND t.cong_doan = ?
        AND NOT (LOWER(COALESCE(t.xac_nhan, '')) IN ('có', 'xác nhận'))
        ${repairFilter}
    `).all(...active.ids, dbCongDoan);

    const pendingMaDhs = pendingOrders.map(r => r.ma_dh);
    if (pendingMaDhs.length === 0) {
      return res.json({ ok: true, orders: [] });
    }

    // Step 2: Get all stages for those orders (not filtered by cong_doan)
    const phPending = pendingMaDhs.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT DISTINCT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao,
             d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
             d.loai_lenh, d.ghi_chu,
             GROUP_CONCAT(
               t.thu_tu||'|'||t.cong_doan||'|'||COALESCE(t.ten_ktv,'')||'|'||
               COALESCE(t.xac_nhan,'Chưa')||'|'||COALESCE(t.thoi_gian_hoan_thanh,''),
               ';;'
             ) AS stages_raw
      FROM tien_do t
      JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE d.ma_dh IN (${phPending})
      GROUP BY d.ma_dh
      ORDER BY d.nhap_luc DESC
    `).all(...pendingMaDhs);

    const orders = [];
    for (const row of rows) {
      const lk = row.loai_lenh || '';
      const gc = row.ghi_chu || '';

      const stagesMap = {};
      for (const part of (row.stages_raw || '').split(';;')) {
        const p = part.split('|');
        if (p.length >= 5) {
          const thu_tu = parseInt(p[0]);
          if (!isNaN(thu_tu)) {
            const isConfirmed = p[3] === 'Có' || p[3] === 'xác nhận';
            stagesMap[thu_tu] = { n: p[1], k: p[2], x: isConfirmed, t: p[4] };
          }
        }
      }

      const stages = STAGE_NAMES.map((name, i) => {
        const s = stagesMap[i + 1] || { n: name, k: '', x: false, t: '' };
        return { n: name, k: s.k, x: s.x, t: s.t, sk: false };
      });

      const active = stages.filter(s => !s.sk);
      const done = active.filter(s => s.x).length;
      const total = active.length;

      let curKtv = '';
      for (let i = stages.length - 1; i >= 0; i--) {
        if (!stages[i].sk && stages[i].k) { curKtv = stages[i].k; break; }
      }
      let lastTg = '';
      stages.forEach(s => { if (s.t) lastTg = s.t; });

      orders.push({
        ma_dh: row.ma_dh,
        nhan: row.nhap_luc || '',
        yc_ht: row.yc_hoan_thanh || '',
        yc_giao: row.yc_giao || '',
        kh: row.khach_hang || '',
        bn: row.benh_nhan || '',
        ph: row.phuc_hinh || '',
        sl: row.sl || 0,
        gc: row.ghi_chu || '',
        lk,
        stages, done, total,
        pct: total > 0 ? Math.round(done / total * 100) : 0,
        curKtv, lastTg,
      });
    }

    res.json({ ok: true, orders });
  } catch (err) {
    log(`[User Orders] Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'admin.html'));
});

app.get('/admin/api/users', requireAdmin, (req, res) => {
  const users = Object.entries(USERS).map(([username, data]) => ({
    username,
    role: data.role,
    cong_doan: data.cong_doan || '',
    can_view_stats: data.can_view_stats === true,
  }));
  res.json(users);
});

app.post('/admin/api/users', requireAdmin, express.json(), async (req, res) => {
  const { username, password, role, cong_doan } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Missing username, password, or role' });
  }
  if (USERS[username]) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  if (!['admin', 'user', 'qc'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  const VALID_CD = ['CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài', ''];
  if (cong_doan && !VALID_CD.includes(cong_doan)) {
    return res.status(400).json({ error: 'Invalid cong_doan' });
  }

  try {
    const passwordHash = await hashPassword(password);
    USERS[username] = { passwordHash, role, cong_doan: cong_doan || '' };
    saveUsers();
    log(`👤 New user created: ${username} (${role}) cong_doan=${cong_doan || 'none'}`);
    res.json({ ok: true, username, role, cong_doan: cong_doan || '' });
  } catch (err) {
    log(`❌ Error creating user: ${err.message}`);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.patch('/admin/api/users/:username/cong-doan', requireAdmin, express.json(), (req, res) => {
  const { username } = req.params;
  const { cong_doan } = req.body;
  const VALID_CD = ['CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài', ''];
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  if (!VALID_CD.includes(cong_doan)) return res.status(400).json({ error: 'Invalid cong_doan' });
  USERS[username].cong_doan = cong_doan;
  saveUsers();
  log(`🔧 cong_doan set: ${username} → ${cong_doan || 'none'}`);
  res.json({ ok: true });
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

app.post('/admin/api/users/:username/reset-password', requireAdmin, express.json(), async (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ error: 'newPassword is required' });
  }
  if (!USERS[username]) {
    return res.status(404).json({ error: 'User not found' });
  }

  try {
    const passwordHash = await hashPassword(newPassword);
    USERS[username].passwordHash = passwordHash;
    saveUsers();
    log(`🔑 Password reset for: ${username}`);
    res.json({ ok: true, username });
  } catch (err) {
    log(`❌ Error resetting password: ${err.message}`);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ── ANALYTICS API ──────────────────────────────────────────────────────────
app.get('/api/analytics/trend', requireAuth, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  try {
    const sql = `
      SELECT date, total_orders, completed_orders, zirc_count, kl_count, vnr_count, hon_count
      FROM analytics_daily
      WHERE date >= date('now', '-${days} days')
      ORDER BY date ASC
    `;
    const rows = db.prepare(sql).all();
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Analytics] Error fetching trend: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/analytics/ktv', requireAuth, (req, res) => {
  const days = parseInt(req.query.days) || 7;
  try {
    const sql = `
      SELECT ktv_name, stage, SUM(orders_completed) as total, AVG(avg_time_hours) as avg_time
      FROM ktv_performance
      WHERE date >= date('now', '-${days} days')
      GROUP BY ktv_name, stage
      ORDER BY total DESC
    `;
    const rows = db.prepare(sql).all();
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Analytics] Error fetching KTV performance: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/analytics/customers', requireAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  try {
    const sql = `
      SELECT khach_hang, COUNT(*) as total_orders,
             SUM(CASE WHEN trang_thai='Hoàn thành' THEN 1 ELSE 0 END) as completed,
             ROUND(AVG(julianday(yc_giao) - julianday(nhap_luc)), 2) as avg_days
      FROM don_hang
      WHERE nhap_luc >= date('now', '-30 days')
      GROUP BY khach_hang
      ORDER BY total_orders DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(limit);
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Analytics] Error fetching customers: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/analytics/refresh', requireAuth, requireAdmin, (req, res) => {
  // TODO: Implement background job to calculate analytics_daily and ktv_performance
  log('[Analytics] Refresh requested (not implemented yet)');
  res.json({ ok: true, message: 'Analytics refresh queued (not implemented yet)' });
});

// ── HISTORICAL ANALYTICS API (tien_do_history) ────────────────────────────────
app.get('/api/analytics/history/ktv-performance', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const sql = `
      SELECT
        ten_ktv,
        cong_doan,
        COUNT(*) as total_stages,
        COUNT(CASE WHEN xac_nhan='Có' THEN 1 END) as completed,
        COUNT(DISTINCT ma_dh) as unique_orders
      FROM tien_do_history
      WHERE ten_ktv != ''
      GROUP BY ten_ktv, cong_doan
      ORDER BY total_stages DESC
    `;

    const rows = db.prepare(sql).all();
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Analytics] Error fetching KTV performance: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/analytics/history/top-ktv', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const limit = parseInt(req.query.limit) || 10;

    const sql = `
      SELECT
        ten_ktv,
        COUNT(*) as total_stages,
        COUNT(CASE WHEN xac_nhan='Có' THEN 1 END) as completed,
        COUNT(DISTINCT ma_dh) as unique_orders,
        ROUND(COUNT(CASE WHEN xac_nhan='Có' THEN 1 END) * 100.0 / COUNT(*), 1) as completion_rate
      FROM tien_do_history
      WHERE ten_ktv != ''
      GROUP BY ten_ktv
      ORDER BY total_stages DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(limit);
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Analytics] Error fetching top KTV: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/analytics/history/stage-stats', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const sql = `
      SELECT
        cong_doan,
        COUNT(*) as total,
        COUNT(CASE WHEN xac_nhan='Có' THEN 1 END) as completed,
        COUNT(DISTINCT ten_ktv) as unique_ktv,
        ROUND(COUNT(CASE WHEN xac_nhan='Có' THEN 1 END) * 100.0 / COUNT(*), 1) as completion_rate
      FROM tien_do_history
      WHERE cong_doan != ''
      GROUP BY cong_doan
      ORDER BY
        CASE cong_doan
          WHEN 'CBM' THEN 1
          WHEN 'SÁP/Cadcam' THEN 2
          WHEN 'SƯỜN' THEN 3
          WHEN 'ĐẮP' THEN 4
          WHEN 'MÀI' THEN 5
          ELSE 6
        END
    `;

    const rows = db.prepare(sql).all();
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Analytics] Error fetching stage stats: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/analytics/history/phuc-hinh-distribution', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const sql = `
      SELECT
        loai_phuc_hinh,
        COUNT(DISTINCT ma_dh) as orders,
        SUM(so_luong) as total_rang
      FROM tien_do_history
      WHERE loai_phuc_hinh IS NOT NULL
      GROUP BY loai_phuc_hinh
      ORDER BY orders DESC
    `;

    const rows = db.prepare(sql).all();
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Analytics] Error fetching phuc hinh distribution: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/analytics/history/top-customers', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const limit = parseInt(req.query.limit) || 10;

    const sql = `
      SELECT
        ten_nha_khoa,
        COUNT(DISTINCT ma_dh) as total_orders,
        SUM(so_luong) as total_rang
      FROM tien_do_history
      WHERE ten_nha_khoa IS NOT NULL
      GROUP BY ten_nha_khoa
      ORDER BY total_orders DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(limit);
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Analytics] Error fetching top customers: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/analytics/history/overview', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const stats = {
      total_records: db.prepare('SELECT COUNT(*) as cnt FROM tien_do_history').get().cnt,
      unique_orders: db.prepare('SELECT COUNT(DISTINCT ma_dh) as cnt FROM tien_do_history').get().cnt,
      unique_ktv: db.prepare('SELECT COUNT(DISTINCT ten_ktv) as cnt FROM tien_do_history WHERE ten_ktv != ""').get().cnt,
      unique_customers: db.prepare('SELECT COUNT(DISTINCT ten_nha_khoa) as cnt FROM tien_do_history WHERE ten_nha_khoa IS NOT NULL').get().cnt,
      completed_stages: db.prepare('SELECT COUNT(*) as cnt FROM tien_do_history WHERE xac_nhan="Có"').get().cnt,
    };

    res.json({ ok: true, data: stats });
  } catch (err) {
    log(`[Analytics] Error fetching overview: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── MUNGER DASHBOARD ──────────────────────────────────────────────────────

// Kỳ tính theo quy ước: 26 tháng trước → 25 tháng này = "tháng này"
// Ví dụ: 26/3 → 25/4 = Tháng 4
function getBillingPeriods() {
  const today = new Date();
  const d = today.getDate();
  const m = today.getMonth(); // 0-indexed
  const y = today.getFullYear();

  let currStart, currEnd, prevStart, prevEnd;
  if (d >= 26) {
    // Từ ngày 26 trở đi: bắt đầu kỳ mới (26/tháng này → 25/tháng sau)
    currStart = new Date(y, m, 26);
    currEnd   = new Date(y, m + 1, 25);
    prevStart = new Date(y, m - 1, 26);
    prevEnd   = new Date(y, m, 25);
  } else {
    // Từ ngày 1-25: đang trong kỳ (26/tháng trước → 25/tháng này)
    currStart = new Date(y, m - 1, 26);
    currEnd   = new Date(y, m, 25);
    prevStart = new Date(y, m - 2, 26);
    prevEnd   = new Date(y, m - 1, 25);
  }
  const fmt = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  const fmtD = dt => `${dt.getDate()}/${dt.getMonth() + 1}`;
  const currLabel = `Tháng ${currEnd.getMonth() + 1}/${currEnd.getFullYear()}`;
  const prevLabel = `Tháng ${prevEnd.getMonth() + 1}/${prevEnd.getFullYear()}`;
  return {
    curr: { start: fmt(currStart), end: fmt(currEnd), label: currLabel, range: `${fmtD(currStart)}–${fmtD(currEnd)}` },
    prev: { start: fmt(prevStart), end: fmt(prevEnd), label: prevLabel, range: `${fmtD(prevStart)}–${fmtD(prevEnd)}` },
  };
}

app.get('/munger', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'munger.html'));
});

app.get('/api/munger/metrics', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const days = parseInt(req.query.days) || 30;

    // Khi days=30: dùng kỳ 26-25 thay vì rolling 30 ngày
    const billing = getBillingPeriods();
    const isMonthlyView = days === 30;
    const sinceStr = isMonthlyView ? billing.curr.start : (() => {
      const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10);
    })();

    // 1. Bus Factor per Stage — ai đang gánh quá nhiều
    const STAGES = ['CBM', 'SÁP/Cadcam', 'SƯỜN', 'ĐẮP', 'MÀI'];
    const busFactor = {};
    for (const stage of STAGES) {
      const total = db.prepare(`
        SELECT COUNT(*) as n FROM tien_do t
        JOIN don_hang d ON t.ma_dh = d.ma_dh
        WHERE t.cong_doan = ? AND t.xac_nhan = 'Có'
          AND t.ten_ktv NOT IN ('', '-') AND t.ten_ktv IS NOT NULL
          AND SUBSTR(d.nhap_luc, 1, 10) >= ?
      `).get(stage, sinceStr).n;
      const top = db.prepare(`
        SELECT t.ten_ktv, COUNT(*) as n FROM tien_do t
        JOIN don_hang d ON t.ma_dh = d.ma_dh
        WHERE t.cong_doan = ? AND t.xac_nhan = 'Có'
          AND t.ten_ktv NOT IN ('', '-') AND t.ten_ktv IS NOT NULL
          AND SUBSTR(d.nhap_luc, 1, 10) >= ?
        GROUP BY t.ten_ktv ORDER BY n DESC LIMIT 3
      `).all(stage, sinceStr);
      const top1pct = total > 0 && top[0] ? Math.round(top[0].n * 100 / total) : 0;
      busFactor[stage] = {
        total,
        top1_ktv: top[0]?.ten_ktv || '-',
        top1_pct: top1pct,
        top3: top.map(r => ({ ktv: r.ten_ktv, n: r.n, pct: total > 0 ? Math.round(r.n * 100 / total) : 0 })),
      };
    }
    const worstStage = STAGES.reduce((a, b) => busFactor[a].top1_pct > busFactor[b].top1_pct ? a : b);
    const worstPct = busFactor[worstStage].top1_pct;

    // 2. WIP Ratio — đơn đang đọng cuối pipeline vs đầu pipeline
    const wipRows = db.prepare(`
      SELECT t.cong_doan, COUNT(DISTINCT t.ma_dh) as wip
      FROM tien_do t
      JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE (t.xac_nhan != 'Có' OR t.xac_nhan IS NULL)
        AND SUBSTR(d.nhap_luc, 1, 10) >= ?
      GROUP BY t.cong_doan
    `).all(sinceStr);
    const wipMap = {};
    wipRows.forEach(r => { wipMap[r.cong_doan] = r.wip; });
    const wipHead = (wipMap['CBM'] || 0) + (wipMap['SÁP/Cadcam'] || 0);
    const wipTail = (wipMap['ĐẮP'] || 0) + (wipMap['MÀI'] || 0);
    const wipRatio = wipHead > 0 ? Math.round(wipTail / wipHead * 100) / 100 : 0;

    // 3. First-pass Yield — % đơn không phải rework
    const fpy = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN loai_lenh NOT IN ('Sửa','Làm lại','Bảo hành') THEN 1 ELSE 0 END) as fresh
      FROM don_hang
      WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND nhap_luc IS NOT NULL
    `).get(sinceStr);
    const fpyPct = fpy.total > 0 ? Math.round(fpy.fresh * 100 / fpy.total) : 0;

    // 4. On-time Rate — % đơn xong MÀI trước yc_ht
    const ot = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN m.thoi_gian_hoan_thanh <= d.yc_hoan_thanh THEN 1 ELSE 0 END) as on_time
      FROM don_hang d
      JOIN tien_do m ON d.ma_dh = m.ma_dh AND m.cong_doan = 'MÀI'
      WHERE SUBSTR(d.nhap_luc, 1, 10) >= ?
        AND d.yc_hoan_thanh IS NOT NULL AND d.yc_hoan_thanh != ''
        AND m.xac_nhan = 'Có'
    `).get(sinceStr);
    const otPct = ot.total > 0 ? Math.round(ot.on_time * 100 / ot.total) : 0;

    // 5. Customer Concentration — top-5 chiếm % tổng răng
    const custRows = db.prepare(`
      SELECT khach_hang, SUM(sl) as rang
      FROM don_hang
      WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND khach_hang IS NOT NULL AND sl > 0
      GROUP BY khach_hang ORDER BY rang DESC
    `).all(sinceStr);
    const totalRang = custRows.reduce((s, r) => s + r.rang, 0);
    const top5Rang = custRows.slice(0, 5).reduce((s, r) => s + r.rang, 0);
    const top5Pct = totalRang > 0 ? Math.round(top5Rang * 100 / totalRang) : 0;

    // 6. Demand Trend
    // days=30: so sánh kỳ hiện tại (26-25) vs kỳ trước — dữ liệu thực tế theo kỳ
    // days=7/60: rolling window bình thường
    let currRang, prevRang, trendPct, runRate, dailyRows, trendLabel, prevLabel;

    if (isMonthlyView) {
      // Số ngày đã trôi qua trong kỳ hiện tại (tính từ ngày bắt đầu kỳ đến hôm nay)
      const todayLocal = new Date();
      const currStartDate = new Date(billing.curr.start);
      const daysElapsed = Math.max(1, Math.floor((todayLocal - currStartDate) / 86400000) + 1);

      // Kỳ này: billing.curr.start → hôm nay (số ngày đã trôi qua)
      const aggCurr = db.prepare(`
        SELECT COALESCE(SUM(sl), 0) as rang FROM don_hang
        WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND SUBSTR(nhap_luc, 1, 10) <= ?
          AND sl > 0 AND nhap_luc IS NOT NULL
      `).get(billing.curr.start, (() => { const t = new Date(todayLocal); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`; })());

      // Kỳ trước: billing.prev.start → billing.prev.start + daysElapsed (so sánh công bằng)
      const prevSameEndDate = new Date(billing.prev.start);
      prevSameEndDate.setDate(prevSameEndDate.getDate() + daysElapsed - 1);
      const prevSameEnd = `${prevSameEndDate.getFullYear()}-${String(prevSameEndDate.getMonth()+1).padStart(2,'0')}-${String(prevSameEndDate.getDate()).padStart(2,'0')}`;

      const aggPrev = db.prepare(`
        SELECT COALESCE(SUM(sl), 0) as rang FROM don_hang
        WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND SUBSTR(nhap_luc, 1, 10) <= ?
          AND sl > 0 AND nhap_luc IS NOT NULL
      `).get(billing.prev.start, prevSameEnd);

      // Tổng cả kỳ trước (để hiển thị run_rate đầy đủ)
      const aggPrevFull = db.prepare(`
        SELECT COALESCE(SUM(sl), 0) as rang FROM don_hang
        WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND SUBSTR(nhap_luc, 1, 10) <= ?
          AND sl > 0 AND nhap_luc IS NOT NULL
      `).get(billing.prev.start, billing.prev.end);

      currRang  = aggCurr.rang;
      prevRang  = aggPrev.rang;   // cùng số ngày kỳ trước
      trendPct  = prevRang > 0 ? Math.round((currRang - prevRang) / prevRang * 100) : 0;
      runRate   = aggPrevFull.rang; // tổng đầy đủ kỳ trước để làm mốc tham chiếu
      trendLabel = `${billing.curr.label} — ${daysElapsed} ngày đầu kỳ`;
      prevLabel  = `${billing.prev.label} (${daysElapsed} ngày đầu)`;

      // Sparkline: mỗi ngày trong kỳ hiện tại
      dailyRows = db.prepare(`
        SELECT SUBSTR(nhap_luc, 1, 10) as ngay, SUM(sl) as rang
        FROM don_hang
        WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND SUBSTR(nhap_luc, 1, 10) <= ?
          AND sl > 0 AND nhap_luc IS NOT NULL
        GROUP BY ngay ORDER BY ngay
      `).all(billing.curr.start, billing.curr.end);
    } else {
      // Rolling window: last N days vs N days trước đó
      const halfStr = (() => { const d = new Date(); d.setDate(d.getDate() - Math.floor(days / 2)); return d.toISOString().slice(0, 10); })();
      dailyRows = db.prepare(`
        SELECT SUBSTR(nhap_luc, 1, 10) as ngay, SUM(sl) as rang
        FROM don_hang
        WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND sl > 0 AND nhap_luc IS NOT NULL
        GROUP BY ngay ORDER BY ngay
      `).all(sinceStr);
      currRang  = dailyRows.filter(r => r.ngay >= halfStr).reduce((s, r) => s + r.rang, 0);
      prevRang  = dailyRows.filter(r => r.ngay < halfStr).reduce((s, r) => s + r.rang, 0);
      trendPct  = prevRang > 0 ? Math.round((currRang - prevRang) / prevRang * 100) : 0;
      runRate   = Math.round(currRang / (days / 2) * 30);
      trendLabel = `${Math.floor(days / 2)} ngày gần`;
      prevLabel  = `${Math.floor(days / 2)} ngày trước`;
    }

    // 7. Scale Countdown — tiến độ đến 10K/kỳ
    const TARGET = 10000;
    let daysUntil = null;
    if (isMonthlyView) {
      // Dự báo: nếu kỳ này chưa xong, tính theo tốc độ ngày hiện tại
      const today = new Date();
      const startDate = new Date(billing.curr.start);
      const endDate   = new Date(billing.curr.end);
      const daysElapsed = Math.max(1, Math.round((today - startDate) / 86400000));
      const daysTotal   = Math.round((endDate - startDate) / 86400000) + 1;
      const dailyRate   = currRang / daysElapsed;
      const projected   = Math.round(dailyRate * daysTotal);
      if (projected >= TARGET || runRate >= TARGET) {
        daysUntil = 0;
      } else if (trendPct > 0) {
        // Ước tính bao nhiêu kỳ nữa với tốc độ tăng trưởng hiện tại
        let rate = projected > 0 ? projected : runRate;
        let months = 0;
        while (rate < TARGET && months < 24) { rate *= (1 + trendPct / 100); months++; }
        daysUntil = months * 30;
      }
    } else {
      if (runRate < TARGET && trendPct > 0) {
        let rate = runRate; let d = 0;
        while (rate < TARGET && d < 730) { rate *= (1 + trendPct / 100); d += 7; }
        daysUntil = d;
      } else if (runRate >= TARGET) {
        daysUntil = 0;
      }
    }

    res.json({
      ok: true,
      updated_at: new Date().toISOString(),
      days,
      billing_period: isMonthlyView ? billing.curr : null,
      data: {
        bus_factor: {
          stages: STAGES.map(s => ({
            stage: s, total: busFactor[s].total,
            top1_ktv: busFactor[s].top1_ktv, top1_pct: busFactor[s].top1_pct,
            top3: busFactor[s].top3,
          })),
          worst_stage: worstStage, worst_pct: worstPct,
          status: worstPct > 50 ? 'red' : worstPct > 35 ? 'yellow' : 'green',
        },
        wip_ratio: {
          head: wipHead, tail: wipTail, ratio: wipRatio,
          by_stage: wipMap,
          status: wipRatio > 1.1 ? 'red' : wipRatio > 0.9 ? 'yellow' : 'green',
        },
        first_pass_yield: {
          value: fpyPct, total: fpy.total, rework: fpy.total - fpy.fresh, target: 90,
          status: fpyPct >= 90 ? 'green' : fpyPct >= 85 ? 'yellow' : 'red',
        },
        on_time_rate: {
          value: otPct, on_time: ot.on_time, total: ot.total, target: 90,
          status: otPct >= 90 ? 'green' : otPct >= 80 ? 'yellow' : 'red',
        },
        customer_concentration: {
          top5_pct: top5Pct, total_rang: totalRang, top5_rang: top5Rang,
          top5: custRows.slice(0, 5).map(r => ({ name: r.khach_hang, rang: r.rang, pct: Math.round(r.rang * 100 / totalRang) })),
          status: top5Pct < 35 ? 'green' : top5Pct < 50 ? 'yellow' : 'red',
        },
        demand_trend: {
          curr_rang: currRang, prev_rang: prevRang, change_pct: trendPct,
          prev_full: runRate, daily_avg: Math.round(currRang / (isMonthlyView ? Math.max(1, Math.round((new Date() - new Date(billing.curr.start)) / 86400000)) : days / 2)),
          trend_label: trendLabel, prev_label: prevLabel,
          sparkline: dailyRows,
          status: trendPct > 0 ? 'green' : trendPct === 0 ? 'yellow' : 'red',
        },
        scale_countdown: {
          target: TARGET, current_rate: currRang,
          pct_of_target: Math.min(100, Math.round(currRang / TARGET * 100)),
          days_until: daysUntil,
          status: daysUntil === null ? 'red' : daysUntil === 0 ? 'green' : daysUntil > 90 ? 'green' : daysUntil > 30 ? 'yellow' : 'red',
        },
      },
    });
  } catch (err) {
    log(`[Munger] Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── FEEDBACK API ───────────────────────────────────────────────────────────
app.get('/api/feedback/types', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const rows = db.prepare('SELECT * FROM feedback_types WHERE active=1 ORDER BY category, name').all();
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Feedback] Error fetching types: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/feedback/types', requireAuth, requireAdmin, express.json(), (req, res) => {
  const { name, category, description } = req.body;
  if (!name || !category) {
    return res.status(400).json({ ok: false, error: 'name and category are required' });
  }
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const stmt = db.prepare('INSERT INTO feedback_types (name, category, description) VALUES (?, ?, ?)');
    const result = stmt.run(name, category, description || '');
    log(`[Feedback] Type created: ${name} (${category})`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    log(`[Feedback] Error creating type: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/feedback/types/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    // Soft delete
    db.prepare('UPDATE feedback_types SET active=0 WHERE id=?').run(id);
    log(`[Feedback] Type deleted: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    log(`[Feedback] Error deleting type: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/feedbacks', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    let sql = `
      SELECT f.*, ft.name as type_name, ft.category
      FROM feedbacks f
      JOIN feedback_types ft ON f.feedback_type_id=ft.id
      WHERE 1=1
    `;
    const params = [];

    if (req.query.ma_dh) {
      sql += ' AND f.ma_dh=?';
      params.push(req.query.ma_dh);
    }
    if (req.query.status) {
      sql += ' AND f.status=?';
      params.push(req.query.status);
    }

    sql += ' ORDER BY f.created_at DESC LIMIT 100';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Feedback] Error fetching feedbacks: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/feedbacks', requireAuth, express.json(), (req, res) => {
  const { ma_dh, feedback_type_id, description, severity } = req.body;
  if (!ma_dh || !feedback_type_id || !description) {
    return res.status(400).json({ ok: false, error: 'ma_dh, feedback_type_id, and description are required' });
  }
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const username = req.session ? req.session.user : 'unknown';

    const stmt = db.prepare(`
      INSERT INTO feedbacks (ma_dh, feedback_type_id, description, severity, reported_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(ma_dh, feedback_type_id, description, severity || 'medium', username);
    log(`[Feedback] Created: ${ma_dh} by ${username}`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    log(`[Feedback] Error creating feedback: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Search đơn hàng cho autocomplete
app.get('/api/orders/search', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const query = (req.query.q || '').trim();
    if (!query || query.length < 2) {
      return res.json({ ok: true, data: [] });
    }

    const searchPattern = `%${query}%`;
    const sql = `
      SELECT ma_dh, khach_hang, benh_nhan, loai_rang, trang_thai
      FROM don_hang
      WHERE ma_dh LIKE ? OR khach_hang LIKE ? OR benh_nhan LIKE ?
      ORDER BY ma_dh DESC
      LIMIT 20
    `;
    const rows = db.prepare(sql).all(searchPattern, searchPattern, searchPattern);
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Search] Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/feedbacks/:id', requireAuth, express.json(), (req, res) => {
  const { id } = req.params;
  const { status, assigned_to } = req.body;
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const updates = [];
    const params = [];

    if (status) {
      updates.push('status=?');
      params.push(status);
      if (status === 'resolved' || status === 'closed') {
        updates.push("resolved_at=datetime('now','localtime')");
      }
    }
    if (assigned_to !== undefined) {
      updates.push('assigned_to=?');
      params.push(assigned_to);
    }

    updates.push("updated_at=datetime('now','localtime')");
    params.push(id);

    const sql = `UPDATE feedbacks SET ${updates.join(', ')} WHERE id=?`;
    db.prepare(sql).run(...params);
    log(`[Feedback] Updated: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    log(`[Feedback] Error updating feedback: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── BÁO LỖI LOGIC ─────────────────────────────────────
const STAGE_ORDER = {
  'kim_loai': ['CBM', 'sáp', 'sườn', 'đắp', 'mài'],
  'zirconia': ['CBM', 'CAD/CAM', 'sườn', 'đắp', 'mài']
};

function getAllowedStages(username, userRole, userCongDoan) {
  // QC và Admin: tất cả công đoạn
  if (userRole === 'qc' || userRole === 'admin') {
    return ['CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài'];
  }

  // CBM: chỉ báo lỗi CBM (lỗi thực tế)
  if (userCongDoan === 'CBM') {
    return ['CBM'];
  }

  // Đắp và Mài: báo lỗi lẫn nhau + tất cả công đoạn trước
  if (userCongDoan === 'đắp' || userCongDoan === 'mài') {
    const allowed = new Set();
    // Thêm tất cả công đoạn trước trong cả 2 flow
    for (const flow of Object.values(STAGE_ORDER)) {
      const idx = flow.indexOf(userCongDoan);
      if (idx > 0) {
        for (let i = 0; i < idx; i++) {
          allowed.add(flow[i]);
        }
      }
    }
    // Thêm đắp và mài (báo lẫn nhau)
    allowed.add('đắp');
    allowed.add('mài');
    return Array.from(allowed);
  }

  // User thường: chỉ báo lỗi công đoạn TRƯỚC
  const allowed = new Set();
  for (const flow of Object.values(STAGE_ORDER)) {
    const idx = flow.indexOf(userCongDoan);
    if (idx > 0) {
      for (let i = 0; i < idx; i++) {
        allowed.add(flow[i]);
      }
    }
  }
  return Array.from(allowed);
}

// ── BÁO LỖI PAGES ────────────────────────────────────
app.get('/bao-loi', requireAuth, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'bao_loi.html'));
});

app.get('/error-reports', requireAdmin, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'error_reports.html'));
});

// ── ERROR REPORTS ALLOWED STAGES API ──────────────────
app.get('/api/error-reports/allowed-stages', requireAuth, (req, res) => {
  try {
    const username = req.session.user;
    const userInfo = USERS[username];
    if (!userInfo) return res.status(403).json({ ok: false, error: 'User not found' });

    const allowed = getAllowedStages(username, userInfo.role, userInfo.cong_doan);
    res.json({ ok: true, stages: allowed });
  } catch (err) {
    log(`[ErrorReport] Error getting allowed stages: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── ERROR CODES API ───────────────────────────────────
app.get('/api/error-codes', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    let sql = 'SELECT * FROM error_codes WHERE active=1';
    const params = [];
    if (req.query.cong_doan) {
      sql += ' AND cong_doan=?';
      params.push(req.query.cong_doan);
    }
    sql += ' ORDER BY cong_doan, ma_loi';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[ErrorCode] Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/error-codes', requireAdmin, express.json(), (req, res) => {
  const { ma_loi, ten_loi, cong_doan, mo_ta } = req.body;
  if (!ma_loi || !ten_loi || !cong_doan) {
    return res.status(400).json({ ok: false, error: 'ma_loi, ten_loi, cong_doan là bắt buộc' });
  }
  const VALID_CD = ['CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài'];
  if (!VALID_CD.includes(cong_doan)) {
    return res.status(400).json({ ok: false, error: 'cong_doan không hợp lệ' });
  }
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const result = db.prepare(
      'INSERT INTO error_codes (ma_loi, ten_loi, cong_doan, mo_ta) VALUES (?, ?, ?, ?)'
    ).run(ma_loi, ten_loi, cong_doan, mo_ta || '');
    log(`[ErrorCode] Created: ${ma_loi} - ${ten_loi} (${cong_doan})`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    log(`[ErrorCode] Error creating: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/error-codes/:id', requireAdmin, express.json(), (req, res) => {
  const { id } = req.params;
  const { ma_loi, ten_loi, cong_doan, mo_ta } = req.body;
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    db.prepare(
      'UPDATE error_codes SET ma_loi=COALESCE(?,ma_loi), ten_loi=COALESCE(?,ten_loi), cong_doan=COALESCE(?,cong_doan), mo_ta=COALESCE(?,mo_ta) WHERE id=?'
    ).run(ma_loi || null, ten_loi || null, cong_doan || null, mo_ta || null, id);
    res.json({ ok: true });
  } catch (err) {
    log(`[ErrorCode] Error updating: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/error-codes/:id', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    db.prepare('UPDATE error_codes SET active=0 WHERE id=?').run(req.params.id);
    log(`[ErrorCode] Deleted: ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    log(`[ErrorCode] Error deleting: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── ERROR REPORTS API ─────────────────────────────────
app.post('/api/error-reports', requireAuth, (req, res) => {
  uploadImage.single('hinh_anh')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    const { ma_dh, error_code_id, mo_ta } = req.body;
    if (!ma_dh || !error_code_id) {
      return res.status(400).json({ ok: false, error: 'ma_dh và error_code_id là bắt buộc' });
    }
    try {
      const db = getDB();
      if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
      const code = db.prepare('SELECT * FROM error_codes WHERE id=? AND active=1').get(error_code_id);
      if (!code) return res.status(400).json({ ok: false, error: 'Mã lỗi không hợp lệ' });

      // Validate permission: user có được phép báo lỗi công đoạn này không?
      const username = req.session.user;
      const userInfo = USERS[username];
      if (!userInfo) return res.status(403).json({ ok: false, error: 'User not found' });

      const allowedStages = getAllowedStages(username, userInfo.role, userInfo.cong_doan);
      if (!allowedStages.includes(code.cong_doan)) {
        return res.status(403).json({ ok: false, error: `Bạn không có quyền báo lỗi công đoạn ${code.cong_doan}` });
      }

      const hinh_anh = req.file ? req.file.location : null;
      const submitted_by = req.session ? req.session.user : 'unknown';
      const result = db.prepare(`
        INSERT INTO error_reports (ma_dh, error_code_id, ma_loi_text, cong_doan, hinh_anh, mo_ta, submitted_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(ma_dh, error_code_id, code.ma_loi + ' - ' + code.ten_loi, code.cong_doan, hinh_anh, mo_ta || '', submitted_by);
      log(`[ErrorReport] Submitted: ${ma_dh} lỗi=${code.ma_loi} by ${submitted_by}`);
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (e) {
      log(`[ErrorReport] Error: ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
});

app.get('/api/error-reports', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    let sql = 'SELECT * FROM error_reports WHERE 1=1';
    const params = [];
    if (req.query.trang_thai) { sql += ' AND trang_thai=?'; params.push(req.query.trang_thai); }
    if (req.query.cong_doan)  { sql += ' AND cong_doan=?';  params.push(req.query.cong_doan); }
    if (req.query.submitted_by) { sql += ' AND submitted_by=?'; params.push(req.query.submitted_by); }
    sql += ' ORDER BY submitted_at DESC LIMIT 100';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[ErrorReport] Error listing: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/error-reports/stats', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const byStatus  = db.prepare("SELECT trang_thai, COUNT(*) as n FROM error_reports GROUP BY trang_thai").all();
    const byStage   = db.prepare("SELECT cong_doan, COUNT(*) as n FROM error_reports GROUP BY cong_doan ORDER BY n DESC").all();
    const byUser    = db.prepare("SELECT submitted_by, COUNT(*) as n FROM error_reports GROUP BY submitted_by ORDER BY n DESC").all();
    const topErrors = db.prepare("SELECT ma_loi_text, COUNT(*) as n FROM error_reports GROUP BY ma_loi_text ORDER BY n DESC LIMIT 10").all();
    res.json({ ok: true, byStatus, byStage, byUser, topErrors });
  } catch (err) {
    log(`[ErrorReport] Stats error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/error-reports/:id/confirm', requireAdmin, express.json(), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const reviewed_by = req.session ? req.session.user : 'admin';
    db.prepare(`
      UPDATE error_reports SET trang_thai='confirmed', reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?
    `).run(reviewed_by, req.params.id);
    log(`[ErrorReport] Confirmed: ${req.params.id} by ${reviewed_by}`);
    res.json({ ok: true });
  } catch (err) {
    log(`[ErrorReport] Confirm error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.patch('/api/error-reports/:id/reject', requireAdmin, express.json(), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const reviewed_by = req.session ? req.session.user : 'admin';
    const ghi_chu = req.body?.ghi_chu_admin || '';
    db.prepare(`
      UPDATE error_reports SET trang_thai='rejected', reviewed_by=?, reviewed_at=datetime('now','localtime'), ghi_chu_admin=? WHERE id=?
    `).run(reviewed_by, ghi_chu, req.params.id);
    log(`[ErrorReport] Rejected: ${req.params.id} by ${reviewed_by}`);
    res.json({ ok: true });
  } catch (err) {
    log(`[ErrorReport] Reject error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── STATS PERMISSION ──────────────────────────────────────────────────────
app.patch('/api/admin/users/:username/stats-permission', requireAdmin, express.json(), (req, res) => {
  const { username } = req.params;
  const { can_view_stats } = req.body;
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  USERS[username].can_view_stats = can_view_stats === true;
  saveUsers();
  log(`📊 stats-permission: ${username} → ${USERS[username].can_view_stats}`);
  res.json({ ok: true, username, can_view_stats: USERS[username].can_view_stats });
});

// ── DAILY STATS API ────────────────────────────────────────────────────────
app.get('/api/stats/daily', requireAuth, (req, res) => {
  const token = getSessionToken(req);
  const sess = sessions.get(token);
  const userInfo = USERS[sess.user];
  if (!userInfo || (userInfo.role !== 'admin' && !userInfo.can_view_stats)) {
    return res.status(403).json({ error: 'Không có quyền xem thống kê' });
  }
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const active = getActiveMaDhList();
    if (!active || !active.ids.length) {
      return res.json({ ok: true, data: [] });
    }
    const ph = active.ids.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT
        substr(yc_hoan_thanh, 1, 10) AS ngay,
        substr(yc_hoan_thanh,7,4)||'-'||substr(yc_hoan_thanh,4,2)||'-'||substr(yc_hoan_thanh,1,2) AS ngay_sort,
        SUM(CASE WHEN LOWER(phuc_hinh) LIKE '%mặt dán%' OR LOWER(phuc_hinh) LIKE '%veneer%'
            THEN COALESCE(sl,0) ELSE 0 END) AS mat_dan,
        SUM(CASE WHEN
            LOWER(phuc_hinh) NOT LIKE '%mặt dán%' AND LOWER(phuc_hinh) NOT LIKE '%veneer%'
            AND LOWER(phuc_hinh) NOT LIKE '%cùi giả zirconia%'
            AND LOWER(phuc_hinh) NOT LIKE '%cui gia zirconia%'
            AND (
              LOWER(phuc_hinh) LIKE '%zirconia%' OR LOWER(phuc_hinh) LIKE '%zircornia%'
              OR LOWER(phuc_hinh) LIKE '%ziconia%' OR LOWER(phuc_hinh) LIKE '%zir-%'
              OR LOWER(phuc_hinh) LIKE '%zolid%' OR LOWER(phuc_hinh) LIKE '%cercon%'
              OR LOWER(phuc_hinh) LIKE '%la va%'
            )
            THEN COALESCE(sl,0) ELSE 0 END) AS zirco,
        SUM(CASE WHEN
            LOWER(phuc_hinh) NOT LIKE '%mặt dán%' AND LOWER(phuc_hinh) NOT LIKE '%veneer%'
            AND LOWER(phuc_hinh) NOT LIKE '%cùi giả zirconia%'
            AND LOWER(phuc_hinh) NOT LIKE '%cui gia zirconia%'
            AND LOWER(phuc_hinh) NOT LIKE '%zirconia%' AND LOWER(phuc_hinh) NOT LIKE '%zircornia%'
            AND LOWER(phuc_hinh) NOT LIKE '%ziconia%' AND LOWER(phuc_hinh) NOT LIKE '%zir-%'
            AND LOWER(phuc_hinh) NOT LIKE '%zolid%' AND LOWER(phuc_hinh) NOT LIKE '%cercon%'
            AND LOWER(phuc_hinh) NOT LIKE '%la va%'
            THEN COALESCE(sl,0) ELSE 0 END) AS kim_loai
      FROM don_hang
      WHERE ma_dh IN (${ph})
        AND yc_hoan_thanh IS NOT NULL AND yc_hoan_thanh != ''
      GROUP BY ngay
      ORDER BY ngay_sort
      LIMIT 14
    `).all(...active.ids);
    const data = rows.map(r => {
      const ngay = r.ngay || '';
      let display;
      if (ngay.includes('/')) {
        display = ngay.slice(0, 5);           // "DD/MM" from "DD/MM/YYYY"
      } else if (ngay.length >= 10) {
        display = ngay.slice(8, 10) + '/' + ngay.slice(5, 7); // "DD/MM" from "YYYY-MM-DD"
      } else {
        display = ngay.slice(0, 5);
      }
      return {
        date: ngay,
        date_display: display,
        zirco: r.zirco || 0,
        kim_loai: r.kim_loai || 0,
        mat_dan: r.mat_dan || 0,
        total: (r.zirco || 0) + (r.kim_loai || 0) + (r.mat_dan || 0),
      };
    });
    res.json({ ok: true, data });
  } catch (err) {
    log(`[Stats] Daily error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
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
initErrorTables();
// startExcelWatcher(); // Disabled: use auto_scrape_headless.py via PM2 instead
// startAutoScrapeTimer(); // Disabled: use auto_scrape_headless.py via PM2 instead

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

  // Start WAL checkpoint
  startWALCheckpoint();

  // Pre-load ngay lúc khởi động
  try { getData(); } catch (e) { log(`⚠ Pre-load: ${e.message}`); }
});
