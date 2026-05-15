'use strict';
const express = require('express');
const router  = express.Router();
const { requirePermission } = require('../middleware/auth');
const { getDB } = require('../db/index');
const { findLatest } = require('../repositories/orders.repo');
const { EXCEL_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function classifyPhucHinh(text) {
  if (!text) return 'hon';
  const t = text.toLowerCase();
  if (t.includes('zirconia')) return 'zirc';
  if (t.includes('kim loại') || t.includes('kim loai')) return 'kl';
  if (t.includes('mặt dán') || t.includes('mat dan')) return 'vnr';
  return 'hon';
}

// ── Simple analytics (legacy) ────────────────────────
router.get('/api/analytics/ktv', requirePermission('analytics.view'), (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo' });
  try {
    const rows = db.prepare(`
      SELECT ten_ktv, cong_doan, COUNT(*) AS tong,
             SUM(CASE WHEN xac_nhan='Có' THEN 1 ELSE 0 END) AS da_xong
      FROM tien_do WHERE ten_ktv != ''
      GROUP BY ten_ktv, cong_doan ORDER BY ten_ktv, thu_tu
    `).all();
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/analytics/daily', requirePermission('analytics.view'), (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo' });
  try {
    const rows = db.prepare(`
      SELECT substr(thoi_gian_hoan_thanh, 7, 4)||'-'||substr(thoi_gian_hoan_thanh, 4, 2)||'-'||substr(thoi_gian_hoan_thanh, 1, 2) AS ngay,
             cong_doan, COUNT(*) AS so_cong_doan
      FROM tien_do WHERE xac_nhan='Có' AND thoi_gian_hoan_thanh != ''
      GROUP BY ngay, cong_doan ORDER BY ngay DESC LIMIT 90
    `).all();
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/db/stats', requirePermission('analytics.view'), (req, res) => {
  const db = getDB();
  if (!db) return res.status(503).json({ error: 'DB chưa khởi tạo' });
  try {
    const n_dh  = db.prepare('SELECT COUNT(*) as n FROM don_hang').get().n;
    const n_phu = db.prepare('SELECT COUNT(*) as n FROM don_hang WHERE la_don_phu=1').get().n;
    const n_td  = db.prepare('SELECT COUNT(*) as n FROM tien_do').get().n;
    const n_log = db.prepare("SELECT COUNT(*) as n FROM import_log WHERE trang_thai='ok'").get().n;
    const last  = db.prepare('SELECT ngay_import, ten_file FROM import_log ORDER BY id DESC LIMIT 1').get();
    res.json({ ok: true, don_hang: n_dh, don_phu: n_phu, tien_do: n_td, files_imported: n_log, last_import: last });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Advanced analytics (analytics.html) ─────────────
router.get('/api/analytics/trend', requirePermission('analytics.view'), (req, res) => {
  const days = parseInt(req.query.days) || 7;
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const rows = db.prepare(`
      SELECT date, total_orders, completed_orders, zirc_count, kl_count, vnr_count, hon_count
      FROM analytics_daily WHERE date >= date('now', '-${days} days') ORDER BY date ASC
    `).all();
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/customers', requirePermission('analytics.view'), (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const rows = db.prepare(`
      SELECT khach_hang, COUNT(*) as total_orders,
             SUM(CASE WHEN trang_thai='Hoàn thành' THEN 1 ELSE 0 END) as completed,
             ROUND(AVG(julianday(yc_giao) - julianday(nhap_luc)), 2) as avg_days
      FROM don_hang WHERE nhap_luc >= date('now', '-30 days')
      GROUP BY khach_hang ORDER BY total_orders DESC LIMIT ?
    `).all(limit);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/api/analytics/refresh', requirePermission('analytics.view'), (req, res) => {
  log('[Analytics] Refresh requested (not implemented yet)');
  res.json({ ok: true, message: 'Analytics refresh queued (not implemented yet)' });
});

// ── Historical analytics ─────────────────────────────
router.get('/api/analytics/history/ktv-performance', requirePermission('analytics.view'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const { days = 30, cong_doan } = req.query;
    let sql = `
      SELECT t.ten_ktv, t.cong_doan, COUNT(*) as total_done,
             AVG(CASE WHEN t.thoi_gian_hoan_thanh != '' AND d.nhap_luc != '' THEN
               (julianday(SUBSTR(t.thoi_gian_hoan_thanh,7,4)||'-'||SUBSTR(t.thoi_gian_hoan_thanh,4,2)||'-'||SUBSTR(t.thoi_gian_hoan_thanh,1,2)) -
                julianday(SUBSTR(d.nhap_luc,1,10))) * 24
             END) as avg_hours
      FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE t.xac_nhan = 'Có' AND t.ten_ktv != ''
        AND SUBSTR(d.nhap_luc,1,10) >= date('now', ?)
    `;
    const params = [`-${days} days`];
    if (cong_doan) { sql += ' AND t.cong_doan = ?'; params.push(cong_doan); }
    sql += ' GROUP BY t.ten_ktv, t.cong_doan ORDER BY total_done DESC';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/top-ktv', requirePermission('analytics.view'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 3650);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const rows = db.prepare(`
      SELECT t.ten_ktv, COUNT(*) as total_stages,
             COUNT(CASE WHEN t.xac_nhan='Có' THEN 1 END) as completed,
             COUNT(DISTINCT t.ma_dh) as unique_orders
      FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE t.ten_ktv != '' AND SUBSTR(d.nhap_luc,1,10) >= date('now', ?)
      GROUP BY t.ten_ktv ORDER BY total_stages DESC LIMIT ?
    `).all(`-${days} days`, limit);
    const result = rows.map(r => ({
      ...r,
      completion_rate: r.total_stages > 0 ? Math.round((r.completed / r.total_stages) * 100) : 0
    }));
    res.json({ ok: true, data: result });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/stage-stats', requirePermission('analytics.view'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 3650);
    const rows = db.prepare(`
      SELECT t.cong_doan, COUNT(*) as total, COUNT(CASE WHEN t.xac_nhan='Có' THEN 1 END) as completed
      FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE SUBSTR(d.nhap_luc,1,10) >= date('now', ?)
      GROUP BY t.cong_doan ORDER BY total DESC
    `).all(`-${days} days`);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/phuc-hinh-distribution', requirePermission('analytics.view'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 3650);
    const rows = db.prepare(`
      SELECT phuc_hinh, COUNT(*) as cnt, SUM(sl) as total_rang
      FROM don_hang WHERE SUBSTR(nhap_luc,1,10) >= date('now', ?) AND phuc_hinh != ''
      GROUP BY phuc_hinh ORDER BY cnt DESC LIMIT 20
    `).all(`-${days} days`);
    const grouped = new Map();
    for (const row of rows) {
      const type = classifyPhucHinh(row.phuc_hinh);
      const existing = grouped.get(type) || { loai_phuc_hinh: type, orders: 0, total_rang: 0 };
      existing.orders += row.cnt;
      existing.total_rang += row.total_rang || 0;
      grouped.set(type, existing);
    }
    res.json({ ok: true, data: Array.from(grouped.values()) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/top-customers', requirePermission('analytics.view'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 3650);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const rows = db.prepare(`
      SELECT khach_hang as ten_nha_khoa, COUNT(*) as total_orders, SUM(sl) as total_rang
      FROM don_hang WHERE SUBSTR(nhap_luc,1,10) >= date('now', ?) AND khach_hang != ''
      GROUP BY khach_hang ORDER BY total_orders DESC LIMIT ?
    `).all(`-${days} days`, limit);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/overview', requirePermission('analytics.view'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 3650);
    const since = `date('now', '-${days} days')`;
    const total_records  = db.prepare(`SELECT COUNT(*) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE SUBSTR(d.nhap_luc,1,10) >= ${since}`).get().n;
    const unique_orders  = db.prepare(`SELECT COUNT(DISTINCT t.ma_dh) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE SUBSTR(d.nhap_luc,1,10) >= ${since}`).get().n;
    const unique_ktv     = db.prepare(`SELECT COUNT(DISTINCT ten_ktv) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE t.ten_ktv != '' AND SUBSTR(d.nhap_luc,1,10) >= ${since}`).get().n;
    const unique_customers = db.prepare(`SELECT COUNT(DISTINCT d.khach_hang) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE d.khach_hang != '' AND SUBSTR(d.nhap_luc,1,10) >= ${since}`).get().n;
    const completed_stages = db.prepare(`SELECT COUNT(*) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE t.xac_nhan='Có' AND SUBSTR(d.nhap_luc,1,10) >= ${since}`).get().n;
    res.json({ ok: true, data: { total_records, unique_orders, unique_ktv, unique_customers, completed_stages } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
