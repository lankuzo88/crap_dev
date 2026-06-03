'use strict';
/**
 * Routes cho đơn tạo từ dashboard (tab Order).
 * Mount: /api/orders-new
 *
 * Permission: orders.create_dashboard cho mọi mutation; orders.view_all cho đọc
 * (tái dùng permission đã có vì đơn dashboard hiển thị chung với đơn KeyLab).
 */
const express = require('express');
const router  = express.Router();
const { requirePermission } = require('../middleware/auth');
const { getDB } = require('../db/index');
const {
  createOrder, createPhuLuc, getOrder, listOrders, updateOrder, EDITABLE_FIELDS,
} = require('../repositories/ordersNew.repo');

const LOAI_LENH_ALLOWED = new Set(['Làm mới', 'Sửa', 'Làm lại', 'Bảo hành', 'Làm tiếp', 'Làm thêm']);
const EDITABLE_SET = new Set(EDITABLE_FIELDS);

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] [orders-new] ${msg}`);
const str = v => (v != null) ? String(v).trim() : '';

function validatePayload(body) {
  const khach_hang = str(body?.khach_hang);
  const phuc_hinh  = str(body?.phuc_hinh);
  const loai_lenh  = str(body?.loai_lenh);
  const sl         = Number(body?.sl);

  if (!khach_hang)                       return 'khach_hang là bắt buộc';
  if (!phuc_hinh)                        return 'phuc_hinh là bắt buộc';
  if (!loai_lenh)                        return 'loai_lenh là bắt buộc';
  if (!LOAI_LENH_ALLOWED.has(loai_lenh)) return `loai_lenh không hợp lệ: ${loai_lenh}`;
  if (!Number.isFinite(sl) || sl <= 0)   return 'sl phải > 0';
  return null;
}

// ── LIST ──────────────────────────────────────────────
router.get('/api/orders-new', requirePermission('orders.view_all'), (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ ok: false, error: 'DB chưa khởi tạo' });
  try {
    const { limit, offset, ma_dh_goc, loai_lenh, created_by, la_don_phu } = req.query;
    const filters = { limit, offset, ma_dh_goc, loai_lenh, created_by };
    if (la_don_phu === '0' || la_don_phu === '1') filters.la_don_phu = Number(la_don_phu);
    const orders = listOrders(db, filters);
    res.json({ ok: true, count: orders.length, orders });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET single ────────────────────────────────────────
router.get('/api/orders-new/:ma_dh', requirePermission('orders.view_all'), (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ ok: false, error: 'DB chưa khởi tạo' });
  try {
    const result = getOrder(db, req.params.ma_dh);
    if (!result) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn' });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── CREATE đơn mới ────────────────────────────────────
router.post('/api/orders-new', requirePermission('orders.create_dashboard'), (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ ok: false, error: 'DB chưa khởi tạo' });
  const err = validatePayload(req.body);
  if (err) return res.status(400).json({ ok: false, error: err });

  try {
    const ma_dh = createOrder(db, req.body, req.session.user);
    log(`${req.session.user} created ${ma_dh}`);
    const created = getOrder(db, ma_dh);
    res.status(201).json({ ok: true, ma_dh, ...created });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── CREATE phụ lục cho ma_dh_goc ─────────────────────
router.post('/api/orders-new/:ma_dh_goc/phu-luc', requirePermission('orders.create_dashboard'), (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ ok: false, error: 'DB chưa khởi tạo' });
  const err = validatePayload(req.body);
  if (err) return res.status(400).json({ ok: false, error: err });

  try {
    const { ma_dh, so_phu } = createPhuLuc(db, req.params.ma_dh_goc, req.body, req.session.user);
    log(`${req.session.user} created phụ lục ${ma_dh} (gốc ${req.params.ma_dh_goc})`);
    const created = getOrder(db, ma_dh);
    res.status(201).json({ ok: true, ma_dh, so_phu, ...created });
  } catch (e) {
    if (e.message.includes('không tồn tại')) return res.status(404).json({ ok: false, error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PATCH sửa metadata ───────────────────────────────
router.patch('/api/orders-new/:ma_dh', requirePermission('orders.edit_dashboard'), (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ ok: false, error: 'DB chưa khởi tạo' });
  const body = req.body || {};
  const patch = {};
  for (const k of Object.keys(body)) {
    if (EDITABLE_SET.has(k)) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ ok: false, error: 'Không có field hợp lệ để cập nhật' });
  }
  if (patch.loai_lenh && !LOAI_LENH_ALLOWED.has(str(patch.loai_lenh))) {
    return res.status(400).json({ ok: false, error: `loai_lenh không hợp lệ: ${patch.loai_lenh}` });
  }
  try {
    const updated = updateOrder(db, req.params.ma_dh, patch, req.session.user);
    log(`${req.session.user} edited ${req.params.ma_dh} (${Object.keys(patch).join(',')})`);
    res.json({ ok: true, ...updated });
  } catch (e) {
    if (e.message.includes('không tồn tại')) return res.status(404).json({ ok: false, error: e.message });
    if (e.message.includes('sl phải') || e.message.includes('Không có field')) return res.status(400).json({ ok: false, error: e.message });
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
