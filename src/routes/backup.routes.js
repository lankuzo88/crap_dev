'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const { requirePermission } = require('../middleware/auth');
const { getDB }             = require('../db/index');
const { BASE_DIR, EXCEL_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const BACKUP_FILES = [
  { id: 'db',           name: 'labo_data.db',     desc: 'Toàn bộ dữ liệu đơn hàng, lịch sử, stats' },
  { id: 'env',          name: '.env',              desc: 'Credentials R2, tài khoản Labo scraper' },
  { id: 'users',        name: 'users.json',        desc: 'Tài khoản & phân quyền người dùng' },
  { id: 'labo-config',  name: 'labo_config.json',  desc: 'Trạng thái file Excel cuối scraper' },
  { id: 'keylab-state', name: 'keylab_state.json', desc: 'Counter đặt tên file Keylab export' },
  { id: 'excel',        name: '(Excel mới nhất)',  desc: 'File Keylab export gần nhất' },
];

function getLatestExcel() {
  try {
    const files = fs.readdirSync(EXCEL_DIR)
      .filter(f => /\.(xlsx|xls)$/i.test(f) && !/_scraped|_final|_cleaned/.test(f))
      .map(f => ({ name: f, mt: fs.statSync(path.join(EXCEL_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt);
    return files.length ? path.join(EXCEL_DIR, files[0].name) : null;
  } catch { return null; }
}

function resolveFilePath(id) {
  if (id === 'db')           return path.join(BASE_DIR, 'labo_data.db');
  if (id === 'env')          return path.join(BASE_DIR, '.env');
  if (id === 'users')        return path.join(BASE_DIR, 'users.json');
  if (id === 'labo-config')  return path.join(BASE_DIR, 'labo_config.json');
  if (id === 'keylab-state') return path.join(BASE_DIR, 'keylab_state.json');
  if (id === 'excel')        return getLatestExcel();
  return null;
}

router.get('/admin/api/backup/manifest', requirePermission('admin.users.manage'), (req, res) => {
  try {
    const files = BACKUP_FILES.map(item => {
      const fpath = resolveFilePath(item.id);
      let size = 0, mtime = null, exists = false, displayName = item.name;
      if (fpath) {
        try {
          const st = fs.statSync(fpath);
          size = st.size; mtime = st.mtime.toISOString(); exists = true;
          if (item.id === 'excel') displayName = path.basename(fpath);
        } catch {}
      }
      return { id: item.id, name: displayName, desc: item.desc, size, mtime, exists };
    });
    res.json({ ok: true, files });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/admin/api/backup/download/db', requirePermission('admin.users.manage'), async (req, res) => {
  const tmp = path.join(BASE_DIR, `_bkp_${Date.now()}.db`);
  const cleanup = () => { try { fs.unlinkSync(tmp); } catch {} };
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'DB not available' });
    await db.backup(tmp);
    res.setHeader('Content-Disposition', 'attachment; filename="labo_data.db"');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(tmp).size);
    const stream = fs.createReadStream(tmp);
    stream.on('end', cleanup);
    stream.on('error', () => { cleanup(); res.end(); });
    stream.pipe(res);
    log(`[Backup] DB hot-backup downloaded`);
  } catch (e) { cleanup(); res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/admin/api/backup/download/:id', requirePermission('admin.users.manage'), (req, res) => {
  const { id } = req.params;
  if (id === 'db') return res.redirect('/admin/api/backup/download/db');
  const fpath = resolveFilePath(id);
  if (!fpath || !fs.existsSync(fpath)) return res.status(404).json({ ok: false, error: 'File not found' });
  const filename = path.basename(fpath);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(fpath).size);
  fs.createReadStream(fpath).pipe(res);
  log(`[Backup] Downloaded: ${filename}`);
});

module.exports = router;
