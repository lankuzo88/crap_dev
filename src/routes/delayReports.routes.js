'use strict';
const express = require('express');
const path    = require('path');
const router  = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getDB } = require('../db/index');
const { USERS, hasPermission } = require('../repositories/users.repo');
const { uploadLocalImage, saveCompressedLocalImage } = require('../services/image.service');
const { BASE_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function canSubmitDelayReport(req) {
  return hasPermission(req.session?.user, 'delay_reports.submit');
}

function requireDelayReporter(req, res, next) {
  if (!canSubmitDelayReport(req)) {
    return res.status(403).json({ ok: false, error: 'Chỉ user Báo trễ tiến độ mới có quyền gửi báo trễ' });
  }
  next();
}

function mapDelayReport(row) {
  return {
    id: row.id,
    ma_dh: row.ma_dh,
    yc_hoan_thanh: row.yc_hoan_thanh || '',
    cong_doan_bao_tre: row.cong_doan_bao_tre || '',
    nguyen_nhan: row.nguyen_nhan || '',
    hinh_anh: row.hinh_anh || '',
    trang_thai: row.trang_thai || 'pending',
    submitted_by: row.submitted_by || '',
    submitted_at: row.submitted_at || '',
    reviewed_by: row.reviewed_by || '',
    reviewed_at: row.reviewed_at || '',
    ghi_chu_admin: row.ghi_chu_admin || '',
    khach_hang: row.khach_hang || '',
    benh_nhan: row.benh_nhan || '',
    phuc_hinh: row.phuc_hinh || '',
    sl: row.sl || 0,
  };
}

router.get('/bao-tre', requireAuth, requireDelayReporter, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'bao_tre.html'));
});

router.get('/delay-reports', requirePermission('delay_reports.review'), (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'delay_reports.html'));
});

router.post('/api/delay-reports', requireAuth, requireDelayReporter, (req, res) => {
  uploadLocalImage.single('hinh_anh')(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    const maDh = String(req.body?.ma_dh || '').trim();
    const reason = String(req.body?.nguyen_nhan || '').trim();
    if (!maDh || !reason) return res.status(400).json({ ok: false, error: 'ma_dh và nguyên nhân là bắt buộc' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'Cần upload hình để báo trễ tiến độ' });

    try {
      const db = getDB();
      if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

      const order = db.prepare(`
        SELECT ma_dh, yc_hoan_thanh
        FROM don_hang
        WHERE ma_dh = ? OR barcode_labo = ?
        LIMIT 1
      `).get(maDh, maDh);
      if (!order) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng' });

      const existing = db.prepare(`
        SELECT id, trang_thai
        FROM delay_reports
        WHERE ma_dh = ? AND trang_thai IN ('pending', 'confirmed')
        ORDER BY submitted_at DESC
        LIMIT 1
      `).get(order.ma_dh);
      if (existing) {
        return res.status(409).json({ ok: false, error: `Đơn ${order.ma_dh} đã có báo trễ đang xử lý` });
      }

      const username = req.session.user;
      const userInfo = USERS[username] || {};
      const congDoan = String(req.body?.cong_doan_bao_tre || userInfo.cong_doan || '').trim();
      const savedImage = await saveCompressedLocalImage(req.file, order.ma_dh, 'delay');
      const hinhAnh = savedImage.fileName;
      const result = db.prepare(`
        INSERT INTO delay_reports
          (ma_dh, yc_hoan_thanh, cong_doan_bao_tre, nguyen_nhan, hinh_anh, submitted_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(order.ma_dh, order.yc_hoan_thanh || '', congDoan, reason, hinhAnh, username);

      log(`[DelayReport] Submitted: ${order.ma_dh} by ${username}`);
      res.json({ ok: true, id: result.lastInsertRowid, ma_dh: order.ma_dh });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
});

router.get('/api/delay-reports/active', requireAuth, (req, res) => {
  try {
    const canReview = hasPermission(req.session.user, 'delay_reports.review');
    const canView = hasPermission(req.session.user, 'delay_reports.view_active') || canReview;
    if (!canView) return res.json({ ok: true, data: [] });
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const rows = db.prepare(`
      SELECT dr.*, d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl
      FROM delay_reports dr
      LEFT JOIN don_hang d ON d.ma_dh = dr.ma_dh
      WHERE dr.trang_thai IN ('pending', 'confirmed')
      ORDER BY dr.submitted_at DESC
    `).all();
    const data = canReview
      ? rows.map(mapDelayReport)
      : rows.map(row => ({ ma_dh: row.ma_dh, trang_thai: row.trang_thai || 'pending' }));
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/delay-reports', requirePermission('delay_reports.review'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    let sql = `
      SELECT dr.*, d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl
      FROM delay_reports dr
      LEFT JOIN don_hang d ON d.ma_dh = dr.ma_dh
      WHERE 1=1
    `;
    const params = [];
    if (req.query.trang_thai) { sql += ' AND dr.trang_thai=?'; params.push(req.query.trang_thai); }
    sql += ' ORDER BY dr.submitted_at DESC LIMIT 200';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows.map(mapDelayReport) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/api/delay-reports/stats', requirePermission('delay_reports.review'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const byStatus = db.prepare("SELECT trang_thai, COUNT(*) as n FROM delay_reports GROUP BY trang_thai").all();
    const byStage = db.prepare("SELECT cong_doan_bao_tre, COUNT(*) as n FROM delay_reports GROUP BY cong_doan_bao_tre ORDER BY n DESC").all();
    const recent = db.prepare(`
      SELECT dr.*, d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl
      FROM delay_reports dr
      LEFT JOIN don_hang d ON d.ma_dh = dr.ma_dh
      WHERE dr.trang_thai IN ('pending', 'confirmed')
      ORDER BY dr.submitted_at DESC
      LIMIT 20
    `).all();
    res.json({ ok: true, byStatus, byStage, active: recent.map(mapDelayReport) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/api/delay-reports/:id/confirm', requirePermission('delay_reports.review'), express.json(), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const reviewedBy = req.session ? req.session.user : 'admin';
    const note = req.body?.ghi_chu_admin || '';
    db.prepare(`
      UPDATE delay_reports
      SET trang_thai='confirmed', reviewed_by=?, reviewed_at=datetime('now','localtime'), ghi_chu_admin=COALESCE(NULLIF(?, ''), ghi_chu_admin)
      WHERE id=?
    `).run(reviewedBy, note, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/api/delay-reports/:id/reject', requirePermission('delay_reports.review'), express.json(), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const reviewedBy = req.session ? req.session.user : 'admin';
    const note = req.body?.ghi_chu_admin || '';
    db.prepare(`
      UPDATE delay_reports
      SET trang_thai='rejected', reviewed_by=?, reviewed_at=datetime('now','localtime'), ghi_chu_admin=?
      WHERE id=?
    `).run(reviewedBy, note, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
