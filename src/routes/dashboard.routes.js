'use strict';
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const multer   = require('multer');
const router   = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getData, resetCache, findLatest } = require('../repositories/orders.repo');
const { closeDB, getDB } = require('../db/index');
const { queueOrScrape } = require('../services/scraper.service');
const { webUploadFiles } = require('../services/scraper.service');
const { BASE_DIR, DASHBOARD, DASHBOARD_MOBILE, EXCEL_DIR, DB_PATH } = require('../config/paths');
const { initKeylabNotesRouting } = require('../db/migrations');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function isMobile(req) {
  const ua = req.headers['user-agent'] || '';
  return /Mobile|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(ua);
}

// Multer for Excel upload
if (!fs.existsSync(EXCEL_DIR)) fs.mkdirSync(EXCEL_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, EXCEL_DIR),
    filename:    (req, file, cb) => {
      const ext  = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-À-ɏḀ-ỿ]/g, '_');
      cb(null, `${name}_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const ok = ['.xlsx', '.xls', '.xlsm'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Chỉ chấp nhận file Excel (.xlsx/.xls/.xlsm)'), ok);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get('/', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const file = isMobile(req) ? DASHBOARD_MOBILE : DASHBOARD;
  if (fs.existsSync(file)) return res.sendFile(file);
  if (fs.existsSync(DASHBOARD)) return res.sendFile(DASHBOARD);
  res.status(404).send(`<h2>Không tìm thấy dashboard.html</h2><p>Đặt file <b>dashboard.html</b> trong thư mục gốc</p>`);
});

router.get('/mobile', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (fs.existsSync(DASHBOARD_MOBILE)) res.sendFile(DASHBOARD_MOBILE);
  else res.redirect('/');
});

router.get(['/analytics', '/analytics.html'], requirePermission('analytics.view'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const analyticsFile = path.join(BASE_DIR, 'analytics.html');
  if (fs.existsSync(analyticsFile)) res.sendFile(analyticsFile);
  else res.status(404).send('<h2>Không tìm thấy analytics.html</h2>');
});

router.get('/data.json', requireAuth, (req, res) => {
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

router.get('/reload', requireAuth, (req, res) => {
  resetCache();
  closeDB();
  try {
    initKeylabNotesRouting();
    const data = getData(true);
    res.json({ ok: true, orders: data.orders.length, source: data.source });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/status', requireAuth, (req, res) => {
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
    status: 'online',
    time: new Date().toLocaleString('vi-VN'),
    excel_dir: EXCEL_DIR,
    latest_export: latestExport?.name || null,
    db: dbStats,
  });
});

router.get('/files', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(EXCEL_DIR)
      .filter(f => ['.xlsx', '.xls', '.xlsm'].some(e => f.toLowerCase().endsWith(e)))
      .map(f => { const stat = fs.statSync(path.join(EXCEL_DIR, f)); return { name: f, size: stat.size, mtime: stat.mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch { res.json([]); }
});

router.get('/upload', requirePermission('admin.upload_excel'), (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'upload.html'));
});

router.post('/upload', requirePermission('admin.upload_excel'), (req, res) => {
  upload.single('excel')(req, res, err => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    if (!req.file) return res.status(400).json({ ok: false, error: 'Không có file nào được gửi lên' });
    log(`📤 Upload: ${req.file.filename} (${(req.file.size/1024).toFixed(0)} KB)`);
    webUploadFiles.add(req.file.filename);
    setTimeout(() => webUploadFiles.delete(req.file.filename), 30000);
    queueOrScrape(req.file.path);
    res.json({ ok: true, filename: req.file.filename, size: req.file.size });
  });
});

module.exports = router;
