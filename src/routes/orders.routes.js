'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../db/index');

router.get('/api/orders', requireAuth, (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo. Chạy: python db_manager.py import-all' });
  const { ma_dh_goc, loai_lenh, tai_khoan, limit = 100, offset = 0 } = req.query;
  let sql = `
    SELECT d.*, GROUP_CONCAT(
      t.thu_tu||'|'||t.cong_doan||'|'||COALESCE(t.ten_ktv,'')||'|'||
      COALESCE(t.xac_nhan,'Chưa')||'|'||COALESCE(t.thoi_gian_hoan_thanh,''),
      ';;'
    ) AS stages_raw
    FROM don_hang d LEFT JOIN tien_do t ON t.ma_dh = d.ma_dh WHERE 1=1
  `;
  const params = [];
  if (ma_dh_goc) { sql += ' AND d.ma_dh_goc = ?';    params.push(ma_dh_goc); }
  if (loai_lenh) { sql += ' AND d.loai_lenh = ?';     params.push(loai_lenh); }
  if (tai_khoan) { sql += ' AND d.tai_khoan_cao = ?'; params.push(tai_khoan); }
  sql += ' GROUP BY d.ma_dh ORDER BY d.yc_giao ASC, d.nhap_luc ASC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  try {
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, count: rows.length, orders: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/orders/search', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const query = (req.query.q || '').trim();
    if (!query || query.length < 2) return res.json({ ok: true, data: [] });
    const searchPattern = `%${query}%`;
    const rows = db.prepare(`
      SELECT ma_dh, khach_hang, benh_nhan, phuc_hinh AS loai_rang, trang_thai, barcode_labo FROM don_hang
      WHERE ma_dh LIKE ? OR barcode_labo LIKE ? OR khach_hang LIKE ? OR benh_nhan LIKE ?
      ORDER BY ma_dh DESC LIMIT 20
    `).all(searchPattern, searchPattern, searchPattern, searchPattern);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/orders/:ma_dh', requireAuth, (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo' });
  try {
    const order = db.prepare('SELECT * FROM don_hang WHERE ma_dh = ?').get(req.params.ma_dh);
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    const stages   = db.prepare('SELECT * FROM tien_do WHERE ma_dh = ? ORDER BY thu_tu').all(req.params.ma_dh);
    const variants = db.prepare('SELECT * FROM don_hang WHERE ma_dh_goc = ? AND ma_dh != ?').all(order.ma_dh_goc, order.ma_dh);
    res.json({ order, stages, variants });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
