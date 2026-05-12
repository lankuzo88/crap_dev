'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../db/index');
const { classifyPhucHinh } = require('../utils/phucHinh');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function isConfirmed(value) {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return raw === 'có'
    || raw === 'cã³'
    || raw === 'xã¡c nháº­n'
    || normalized === 'co'
    || normalized === 'xac nhan';
}

function isSapCadcamStage(value) {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  return normalized === 'sapcadcam';
}

function getSapCadcamConfirmedStage(db, maDh) {
  return db.prepare(`
    SELECT cong_doan, xac_nhan
    FROM tien_do
    WHERE ma_dh = ?
    ORDER BY thu_tu
  `).all(maDh).find(stage => isSapCadcamStage(stage.cong_doan) && isConfirmed(stage.xac_nhan)) || null;
}

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

router.get('/api/orders/by-barcode/:code', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(400).json({ ok: false, error: 'Missing code' });

    const row = db.prepare(`
      SELECT d.ma_dh, d.phuc_hinh, d.loai_lenh, d.ghi_chu_sx, d.routed_to, d.barcode_labo
      FROM don_hang d
      WHERE d.barcode_labo = ? OR d.ma_dh = ?
      LIMIT 1
    `).get(code, code);
    if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn' });
    const confirmedStage = getSapCadcamConfirmedStage(db, row.ma_dh);
    res.json({
      ok: true,
      order: {
        ...row,
        phuc_hinh_type: classifyPhucHinh(row.phuc_hinh),
        has_confirmed: Boolean(confirmedStage),
        confirmed_stage: confirmedStage ? confirmedStage.cong_doan : '',
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/orders/route', requireAuth, express.json(), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const { ma_dh, target_room } = req.body || {};
    if (!ma_dh || !['sap', 'zirco', 'both'].includes(target_room)) {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    const order = db.prepare(`
      SELECT d.ma_dh, d.routed_to, d.phuc_hinh
      FROM don_hang d
      WHERE d.ma_dh = ?
    `).get(ma_dh);
    if (!order) return res.status(404).json({ ok: false, error: 'Đơn không tồn tại' });
    const confirmedStage = getSapCadcamConfirmedStage(db, ma_dh);
    if (confirmedStage) {
      return res.status(409).json({
        ok: false,
        error: `Đơn đã có xác nhận ở công đoạn ${confirmedStage.cong_doan}, không thể chuyển`,
      });
    }

    const prev = order.routed_to || 'sap';
    if (prev === target_room) {
      return res.json({ ok: true, order: { ma_dh, routed_to: target_room }, noop: true });
    }

    db.prepare('UPDATE don_hang SET routed_to = ? WHERE ma_dh = ?').run(target_room, ma_dh);
    log(`[Route] ${req.session.user} chuyển ${ma_dh}: ${prev} -> ${target_room}`);
    res.json({ ok: true, order: { ma_dh, routed_to: target_room, prev } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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
