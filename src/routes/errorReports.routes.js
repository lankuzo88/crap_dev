'use strict';
const express = require('express');
const path    = require('path');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getDB } = require('../db/index');
const { USERS, normalizeUserCongDoan } = require('../repositories/users.repo');
const { uploadImage } = require('../services/image.service');
const { BASE_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const STAGE_ORDER = {
  'kim_loai': ['CBM', 'sáp', 'sườn', 'đắp', 'mài'],
  'zirconia': ['CBM', 'CAD/CAM', 'sườn', 'đắp', 'mài'],
};

function getAllowedStages(username, userRole, userCongDoan) {
  userCongDoan = normalizeUserCongDoan(userCongDoan);
  if (userRole === 'qc' || userRole === 'admin') return ['CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài'];
  if (userCongDoan === 'CBM') return ['CBM'];
  if (userCongDoan === 'đắp' || userCongDoan === 'mài') {
    const allowed = new Set();
    for (const flow of Object.values(STAGE_ORDER)) {
      const idx = flow.indexOf(userCongDoan);
      if (idx > 0) for (let i = 0; i < idx; i++) allowed.add(flow[i]);
    }
    allowed.add('đắp'); allowed.add('mài');
    return Array.from(allowed);
  }
  const allowed = new Set();
  for (const flow of Object.values(STAGE_ORDER)) {
    const idx = flow.indexOf(userCongDoan);
    if (idx > 0) for (let i = 0; i < idx; i++) allowed.add(flow[i]);
  }
  return Array.from(allowed);
}

router.get('/bao-loi', requireAuth, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'bao_loi.html'));
});

router.get('/error-reports', requireAdmin, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'error_reports.html'));
});

router.get('/api/error-reports/allowed-stages', requireAuth, (req, res) => {
  try {
    const username = req.session.user;
    const userInfo = USERS[username];
    if (!userInfo) return res.status(403).json({ ok: false, error: 'User not found' });
    const allowed = getAllowedStages(username, userInfo.role, userInfo.cong_doan);
    res.json({ ok: true, stages: allowed });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/error-codes', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    let sql = 'SELECT * FROM error_codes WHERE active=1';
    const params = [];
    if (req.query.cong_doan) { sql += ' AND cong_doan=?'; params.push(req.query.cong_doan); }
    sql += ' ORDER BY cong_doan, ma_loi';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/api/error-codes', requireAdmin, express.json(), (req, res) => {
  const { ma_loi, ten_loi, cong_doan, mo_ta } = req.body;
  if (!ma_loi || !ten_loi || !cong_doan) return res.status(400).json({ ok: false, error: 'ma_loi, ten_loi, cong_doan là bắt buộc' });
  const VALID_CD = ['CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài'];
  if (!VALID_CD.includes(cong_doan)) return res.status(400).json({ ok: false, error: 'cong_doan không hợp lệ' });
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const result = db.prepare('INSERT INTO error_codes (ma_loi, ten_loi, cong_doan, mo_ta) VALUES (?, ?, ?, ?)').run(ma_loi, ten_loi, cong_doan, mo_ta || '');
    log(`[ErrorCode] Created: ${ma_loi} - ${ten_loi} (${cong_doan})`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/api/error-codes/:id', requireAdmin, express.json(), (req, res) => {
  const { id } = req.params;
  const { ma_loi, ten_loi, cong_doan, mo_ta } = req.body;
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    db.prepare('UPDATE error_codes SET ma_loi=COALESCE(?,ma_loi), ten_loi=COALESCE(?,ten_loi), cong_doan=COALESCE(?,cong_doan), mo_ta=COALESCE(?,mo_ta) WHERE id=?')
      .run(ma_loi || null, ten_loi || null, cong_doan || null, mo_ta || null, id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.delete('/api/error-codes/:id', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    db.prepare('UPDATE error_codes SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/api/error-reports', requireAuth, (req, res) => {
  uploadImage.single('hinh_anh')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    const { ma_dh, error_code_id, mo_ta } = req.body;
    if (!ma_dh || !error_code_id) return res.status(400).json({ ok: false, error: 'ma_dh và error_code_id là bắt buộc' });
    try {
      const db = getDB();
      if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
      const code = db.prepare('SELECT * FROM error_codes WHERE id=? AND active=1').get(error_code_id);
      if (!code) return res.status(400).json({ ok: false, error: 'Mã lỗi không hợp lệ' });
      const username = req.session.user;
      const userInfo = USERS[username];
      if (!userInfo) return res.status(403).json({ ok: false, error: 'User not found' });
      const allowedStages = getAllowedStages(username, userInfo.role, userInfo.cong_doan);
      if (!allowedStages.includes(code.cong_doan))
        return res.status(403).json({ ok: false, error: `Bạn không có quyền báo lỗi công đoạn ${code.cong_doan}` });
      const hinh_anh = req.file ? req.file.location : null;
      const submitted_by = req.session ? req.session.user : 'unknown';
      const result = db.prepare(`INSERT INTO error_reports (ma_dh, error_code_id, ma_loi_text, cong_doan, hinh_anh, mo_ta, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(ma_dh, error_code_id, code.ma_loi + ' - ' + code.ten_loi, code.cong_doan, hinh_anh, mo_ta || '', submitted_by);
      log(`[ErrorReport] Submitted: ${ma_dh} lỗi=${code.ma_loi} by ${submitted_by}`);
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
});

router.get('/api/error-reports', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    let sql = 'SELECT * FROM error_reports WHERE 1=1';
    const params = [];
    if (req.query.trang_thai)   { sql += ' AND trang_thai=?';    params.push(req.query.trang_thai); }
    if (req.query.cong_doan)    { sql += ' AND cong_doan=?';     params.push(req.query.cong_doan); }
    if (req.query.submitted_by) { sql += ' AND submitted_by=?';  params.push(req.query.submitted_by); }
    sql += ' ORDER BY submitted_at DESC LIMIT 100';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/error-reports/stats', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const byStatus  = db.prepare("SELECT trang_thai, COUNT(*) as n FROM error_reports GROUP BY trang_thai").all();
    const byStage   = db.prepare("SELECT cong_doan, COUNT(*) as n FROM error_reports GROUP BY cong_doan ORDER BY n DESC").all();
    const byUser    = db.prepare("SELECT submitted_by, COUNT(*) as n FROM error_reports GROUP BY submitted_by ORDER BY n DESC").all();
    const topErrors = db.prepare("SELECT ma_loi_text, COUNT(*) as n FROM error_reports GROUP BY ma_loi_text ORDER BY n DESC LIMIT 10").all();
    res.json({ ok: true, byStatus, byStage, byUser, topErrors });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/api/error-reports/:id/confirm', requireAdmin, express.json(), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const reviewed_by = req.session ? req.session.user : 'admin';
    db.prepare(`UPDATE error_reports SET trang_thai='confirmed', reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?`)
      .run(reviewed_by, req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/api/error-reports/:id/reject', requireAdmin, express.json(), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const reviewed_by = req.session ? req.session.user : 'admin';
    const ghi_chu = req.body?.ghi_chu_admin || '';
    db.prepare(`UPDATE error_reports SET trang_thai='rejected', reviewed_by=?, reviewed_at=datetime('now','localtime'), ghi_chu_admin=? WHERE id=?`)
      .run(reviewed_by, ghi_chu, req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
