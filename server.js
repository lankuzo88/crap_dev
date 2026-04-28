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

const express = require('express');
const XLSX    = require('xlsx');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));

// ── AUTH ──────────────────────────────────────────────
const USERS    = { admin: '142536' };
const sessions = new Map();
const SESS_TTL = 8 * 60 * 60 * 1000; // 8 giờ

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

// ── CẤU HÌNH ĐƯỜNG DẪN ───────────────────────────────
const BASE_DIR      = __dirname;
const FILE_SACH_DIR = path.join(BASE_DIR, 'File_sach');
const DATA_DIR      = path.join(BASE_DIR, 'Data');
const DASHBOARD        = path.join(BASE_DIR, 'dashboard.html');
const DASHBOARD_MOBILE = path.join(BASE_DIR, 'dashboard_mobile_terracotta.html');
const EXCEL_DIR        = path.join(BASE_DIR, 'Excel');

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

function spawnScraper(filePath) {
  scrapeJob = { running: true, file: path.basename(filePath), log: [], exitCode: null, startedAt: new Date().toISOString() };
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
    log(`🏁 Scraper done: ${scrapeJob.file}, exit=${code}`);
  });
}

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
  if (USERS[username] && USERS[username] === password) {
    const token = genToken();
    sessions.set(token, { user: username, expires: Date.now() + SESS_TTL });
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  const token = getSessionToken(req);
  sessions.delete(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.redirect('/login');
});

app.get('/upload', requireAuth, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'upload.html'));
});

app.post('/upload', requireAuth, (req, res) => {
  upload.single('excel')(req, res, err => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Không có file nào được gửi lên' });
    }
    log(`📤 Upload: ${req.file.filename} (${(req.file.size/1024).toFixed(0)} KB) → cào tự động`);
    spawnScraper(req.file.path);
    res.json({ ok: true, filename: req.file.filename, size: req.file.size });
  });
});

app.get('/scrape-status', requireAuth, (req, res) => {
  res.json(scrapeJob);
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
    if (!data.orders.length && !data.source.excel && !data.source.json) {
      return res.status(404).json({
        error: 'Không tìm thấy dữ liệu',
        hint: `Kiểm tra thư mục File_sach/ (${FILE_SACH_DIR}) và Data/ (${DATA_DIR})`,
      });
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/reload', requireAuth, (req, res) => {
  cache = null; cacheKey = ''; cacheTime = 0;
  try {
    const data = getData(true);
    res.json({ ok: true, orders: data.orders.length, source: data.source });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/status', requireAuth, (req, res) => {
  const excelFile = findLatest(FILE_SACH_DIR, ['.xlsx', '.xls', '.xlsm']);
  const jsonFile  = findLatest(DATA_DIR, ['.json']);
  res.json({
    status:         'online',
    time:           new Date().toLocaleString('vi-VN'),
    file_sach_dir:  FILE_SACH_DIR,
    data_dir:       DATA_DIR,
    latest_excel:   excelFile?.name || null,
    latest_json:    jsonFile?.name  || null,
    cached_orders:  cache?.orders?.length || 0,
    cache_age_s:    cacheTime ? Math.round((Date.now()-cacheTime)/1000) : null,
  });
});

app.get('/mobile', requireAuth, (req, res) => {
  if (fs.existsSync(DASHBOARD_MOBILE)) res.sendFile(DASHBOARD_MOBILE);
  else res.redirect('/');
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
app.listen(PORT, '127.0.0.1', () => {
  const excelFile = findLatest(FILE_SACH_DIR, ['.xlsx', '.xls', '.xlsm']);
  const jsonFile  = findLatest(DATA_DIR, ['.json']);

  console.log('');
  console.log('  🦷  ASIA LAB Dashboard Server');
  console.log('  ──────────────────────────────────────');
  console.log(`  URL      : http://localhost:${PORT}`);
  console.log(`  File_sach: ${FILE_SACH_DIR}`);
  console.log(`  Excel mới: ${excelFile?.name || '⚠ Chưa có file'}`);
  console.log(`  Data/JSON: ${jsonFile?.name  || '⚠ Chưa có file'}`);
  console.log(`  Reload   : http://localhost:${PORT}/reload`);
  console.log(`  Status   : http://localhost:${PORT}/status`);
  console.log('');
  console.log('  Nhấn Ctrl+C để dừng');
  console.log('');

  // Pre-load ngay lúc khởi động
  try { getData(); } catch (e) { log(`⚠ Pre-load: ${e.message}`); }
});
