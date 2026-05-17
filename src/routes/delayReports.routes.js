'use strict';
const express = require('express');
const path    = require('path');
const router  = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getDB } = require('../db/index');
const { USERS, normalizeUserCongDoan, hasPermission } = require('../repositories/users.repo');
const { uploadImage, parseImageRefs, stringifyImageRefs, deleteErrorImage, REPORT_IMAGE_LIMIT } = require('../services/image.service');
const { BASE_DIR } = require('../config/paths');
const { buildDelayMonthlyStats } = require('../utils/reportStats');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const STAGE_ORDER = {
  kim_loai: ['CBM', 'sáp', 'sườn', 'đắp', 'mài'],
  zirconia: ['CBM', 'CAD/CAM', 'sườn', 'đắp', 'mài'],
};
const ALL_STAGES = ['CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài'];

function getAllowedDelayStages(userInfo = {}) {
  if (userInfo.role === 'admin' || userInfo.role === 'qc') return ALL_STAGES;
  const userStage = normalizeUserCongDoan(userInfo.cong_doan);
  if (!userStage) return [];

  const allowed = new Set();
  for (const flow of Object.values(STAGE_ORDER)) {
    const idx = flow.indexOf(userStage);
    if (idx >= 0) {
      for (let i = 0; i <= idx; i++) allowed.add(flow[i]);
    }
  }

  if (userStage === 'sáp' || userStage === 'CAD/CAM') {
    allowed.add('sáp');
    allowed.add('CAD/CAM');
  }
  if (userStage === 'đắp' || userStage === 'mài') {
    allowed.add('đắp');
    allowed.add('mài');
  }

  return ALL_STAGES.filter(stage => allowed.has(stage));
}

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
    hinh_anh_list: parseImageRefs(row.hinh_anh),
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

async function cleanupUploadedFiles(files) {
  await Promise.allSettled((files || []).map(file => deleteErrorImage(file.location)));
}

router.get('/bao-tre', requireAuth, requireDelayReporter, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'bao_tre.html'));
});

router.get('/delay-reports', requirePermission('delay_reports.review'), (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'delay_reports.html'));
});

router.get('/api/delay-reports/allowed-stages', requireAuth, requireDelayReporter, (req, res) => {
  try {
    const username = req.session.user;
    const userInfo = USERS[username];
    if (!userInfo) return res.status(403).json({ ok: false, error: 'User not found' });
    res.json({ ok: true, stages: getAllowedDelayStages(userInfo) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/delay-reports', requireAuth, requireDelayReporter, (req, res) => {
  uploadImage.array('hinh_anh', REPORT_IMAGE_LIMIT)(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    const fail = async (status, error) => {
      await cleanupUploadedFiles(req.files);
      return res.status(status).json({ ok: false, error });
    };
    req.file = req.files?.[0] || null;
    const maDh = String(req.body?.ma_dh || '').trim();
    const reason = String(req.body?.nguyen_nhan || '').trim();
    if (!maDh || !reason) return fail(400, 'ma_dh và nguyên nhân là bắt buộc');
    if (!req.file) return fail(400, 'Cần upload hình để báo trễ tiến độ');

    try {
      const db = getDB();
      if (!db) return fail(500, 'Database not available');

      const order = db.prepare(`
        SELECT ma_dh, yc_hoan_thanh
        FROM don_hang
        WHERE ma_dh = ? OR barcode_labo = ?
        LIMIT 1
      `).get(maDh, maDh);
      if (!order) return fail(404, 'Không tìm thấy đơn hàng');

      const existing = db.prepare(`
        SELECT id, trang_thai
        FROM delay_reports
        WHERE ma_dh = ? AND trang_thai IN ('pending', 'confirmed')
        ORDER BY submitted_at DESC
        LIMIT 1
      `).get(order.ma_dh);
      if (existing) {
        return fail(409, `Đơn ${order.ma_dh} đã có báo trễ đang xử lý`);
      }

      const username = req.session.user;
      const userInfo = USERS[username] || {};
      const allowedStages = getAllowedDelayStages(userInfo);
      const congDoan = normalizeUserCongDoan(String(req.body?.cong_doan_bao_tre || '').trim());
      if (!congDoan) return fail(400, 'Vui lòng chọn công đoạn muốn báo');
      if (!allowedStages.includes(congDoan)) return fail(403, `Bạn không có quyền báo công đoạn ${congDoan}`);
      const hinhAnh = stringifyImageRefs(req.files.map(file => file.location));
      const result = db.prepare(`
        INSERT INTO delay_reports
          (ma_dh, yc_hoan_thanh, cong_doan_bao_tre, nguyen_nhan, hinh_anh, submitted_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(order.ma_dh, order.yc_hoan_thanh || '', congDoan, reason, hinhAnh, username);

      log(`[DelayReport] Submitted: ${order.ma_dh} by ${username}`);
      res.json({ ok: true, id: result.lastInsertRowid, ma_dh: order.ma_dh });
    } catch (e) {
      await cleanupUploadedFiles(req.files);
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

router.get('/api/delay-reports/monthly-stats', requirePermission('delay_reports.review'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    res.json({ ok: true, ...buildDelayMonthlyStats(db, req.query.month) });
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
