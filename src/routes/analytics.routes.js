'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getDB } = require('../db/index');
const { findLatest } = require('../repositories/orders.repo');
const { EXCEL_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

// ── Simple analytics (legacy) ────────────────────────
router.get('/api/analytics/ktv', requireAuth, (req, res) => {
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

router.get('/api/analytics/daily', requireAuth, (req, res) => {
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

router.get('/api/db/stats', requireAuth, (req, res) => {
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
router.get('/api/analytics/trend', requireAuth, (req, res) => {
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

router.get('/api/analytics/customers', requireAuth, (req, res) => {
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

router.post('/api/analytics/refresh', requireAuth, requireAdmin, (req, res) => {
  log('[Analytics] Refresh requested (not implemented yet)');
  res.json({ ok: true, message: 'Analytics refresh queued (not implemented yet)' });
});

// ── Historical analytics ─────────────────────────────
router.get('/api/analytics/history/ktv-performance', requireAuth, (req, res) => {
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

router.get('/api/analytics/history/top-ktv', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const { days = 30, limit = 10 } = req.query;
    const rows = db.prepare(`
      SELECT t.ten_ktv, COUNT(*) as total_done,
             COUNT(DISTINCT t.cong_doan) as stages_worked,
             GROUP_CONCAT(DISTINCT t.cong_doan) as stages
      FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE t.xac_nhan = 'Có' AND t.ten_ktv != ''
        AND SUBSTR(d.nhap_luc,1,10) >= date('now', ?)
      GROUP BY t.ten_ktv ORDER BY total_done DESC LIMIT ?
    `).all(`-${days} days`, parseInt(limit));
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/stage-stats', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const { days = 30 } = req.query;
    const rows = db.prepare(`
      SELECT t.cong_doan, COUNT(*) as total_done, COUNT(DISTINCT t.ten_ktv) as ktv_count,
             COUNT(DISTINCT t.ma_dh) as order_count
      FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE t.xac_nhan = 'Có' AND SUBSTR(d.nhap_luc,1,10) >= date('now', ?)
      GROUP BY t.cong_doan ORDER BY total_done DESC
    `).all(`-${days} days`);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/phuc-hinh-distribution', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const { days = 30 } = req.query;
    const rows = db.prepare(`
      SELECT phuc_hinh, COUNT(*) as total, SUM(sl) as total_rang
      FROM don_hang WHERE SUBSTR(nhap_luc,1,10) >= date('now', ?) AND phuc_hinh != ''
      GROUP BY phuc_hinh ORDER BY total DESC LIMIT 20
    `).all(`-${days} days`);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/top-customers', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const { days = 30, limit = 10 } = req.query;
    const rows = db.prepare(`
      SELECT khach_hang, COUNT(*) as total_orders, SUM(sl) as total_rang,
             COUNT(DISTINCT benh_nhan) as unique_patients
      FROM don_hang WHERE SUBSTR(nhap_luc,1,10) >= date('now', ?) AND khach_hang != ''
      GROUP BY khach_hang ORDER BY total_orders DESC LIMIT ?
    `).all(`-${days} days`, parseInt(limit));
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/analytics/history/overview', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const { days = 30 } = req.query;
    const since = `date('now', '-${days} days')`;
    const total      = db.prepare(`SELECT COUNT(*) as n FROM don_hang WHERE SUBSTR(nhap_luc,1,10) >= ${since}`).get().n;
    const total_rang = db.prepare(`SELECT COALESCE(SUM(sl),0) as n FROM don_hang WHERE SUBSTR(nhap_luc,1,10) >= ${since}`).get().n;
    const completed  = db.prepare(`SELECT COUNT(*) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE t.cong_doan='MÀI' AND t.xac_nhan='Có' AND SUBSTR(d.nhap_luc,1,10) >= ${since}`).get().n;
    const active_ktv = db.prepare(`SELECT COUNT(DISTINCT ten_ktv) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE t.xac_nhan='Có' AND t.ten_ktv != '' AND SUBSTR(d.nhap_luc,1,10) >= ${since}`).get().n;
    res.json({ ok: true, data: { total_orders: total, total_rang, completed_orders: completed, active_ktv } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
