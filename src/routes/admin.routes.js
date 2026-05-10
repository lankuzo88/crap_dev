'use strict';
const express = require('express');
const path    = require('path');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { sessions, getSessionToken } = require('../services/session.service');
const { USERS, normalizeUserCongDoan, isValidUserCongDoan, hashPassword } = require('../repositories/users.repo');
const { saveUsers } = require('../repositories/users.repo');
const { BASE_DIR } = require('../config/paths');
const { getDB } = require('../db/index');
const { refreshMonthlyStats, billingPeriodForCompletion, normalizeOrderType } = require('../db/migrations');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

router.get('/admin', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(BASE_DIR, 'admin.html'));
});

router.get('/admin/api/users', requireAdmin, (req, res) => {
  const users = Object.entries(USERS).map(([username, data]) => ({
    username, role: data.role, cong_doan: data.cong_doan || '', can_view_stats: data.can_view_stats === true,
  }));
  res.json(users);
});

router.post('/admin/api/users', requireAdmin, express.json(), async (req, res) => {
  const { username, password, role, cong_doan } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing username, password, or role' });
  if (USERS[username]) return res.status(400).json({ error: 'Username already exists' });
  if (!['admin', 'user', 'qc'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const normalizedCongDoan = normalizeUserCongDoan(cong_doan);
  if (!isValidUserCongDoan(normalizedCongDoan)) return res.status(400).json({ error: 'Invalid cong_doan' });
  try {
    const passwordHash = await hashPassword(password);
    USERS[username] = { passwordHash, role, cong_doan: normalizedCongDoan };
    saveUsers();
    log(`👤 New user created: ${username} (${role}) cong_doan=${normalizedCongDoan || 'none'}`);
    res.json({ ok: true, username, role, cong_doan: normalizedCongDoan });
  } catch (err) {
    log(`❌ Error creating user: ${err.message}`);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.patch('/admin/api/users/:username/cong-doan', requireAdmin, express.json(), (req, res) => {
  const { username } = req.params;
  const { cong_doan } = req.body;
  const normalizedCongDoan = normalizeUserCongDoan(cong_doan);
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  if (!isValidUserCongDoan(normalizedCongDoan)) return res.status(400).json({ error: 'Invalid cong_doan' });
  USERS[username].cong_doan = normalizedCongDoan;
  saveUsers();
  log(`🔧 cong_doan set: ${username} → ${normalizedCongDoan || 'none'}`);
  res.json({ ok: true });
});

router.delete('/admin/api/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (username === sess.user) return res.status(400).json({ error: 'Cannot delete your own account' });
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  delete USERS[username];
  saveUsers();
  log(`🗑 User deleted: ${username}`);
  res.json({ ok: true, username });
});

router.post('/admin/api/users/:username/reset-password', requireAdmin, express.json(), async (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'newPassword is required' });
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  try {
    const passwordHash = await hashPassword(newPassword);
    USERS[username].passwordHash = passwordHash;
    saveUsers();
    log(`🔑 Password reset for: ${username}`);
    res.json({ ok: true, username });
  } catch (err) {
    log(`❌ Error resetting password: ${err.message}`);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.patch('/api/admin/users/:username/stats-permission', requireAdmin, express.json(), (req, res) => {
  const { username } = req.params;
  const { can_view_stats } = req.body;
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  USERS[username].can_view_stats = can_view_stats === true;
  saveUsers();
  log(`📊 stats-permission: ${username} → ${USERS[username].can_view_stats}`);
  res.json({ ok: true, username, can_view_stats: USERS[username].can_view_stats });
});

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function displayDate(key) {
  const [yyyy, mm, dd] = key.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

function parseScrapedDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  return '';
}

function buildProductionDaysFromRows(rows) {
  const dates = [...new Set(rows.map(row => parseScrapedDate(row.thoi_gian_hoan_thanh)).filter(Boolean))]
    .sort()
    .slice(-3);
  return dates.map(date => ({
    key: date,
    label: displayDate(date),
    date,
    display: date,
  }));
}

function newTypeStats() {
  return {};
}

function addTypeStat(stats, type, qty, maDh) {
  const key = normalizeOrderType(type);
  if (!stats[key]) stats[key] = { qty: 0, orders: 0, rows: 0, orderIds: new Set() };
  stats[key].qty += Number(qty) || 0;
  stats[key].rows += 1;
  stats[key].orderIds.add(maDh);
  stats[key].orders = stats[key].orderIds.size;
}

function serializeStats(value) {
  if (Array.isArray(value)) return value.map(serializeStats);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Set) return value.size;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'orderIds') continue;
    out[key] = serializeStats(item);
  }
  return out;
}

function parseTypeBreakdown(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

router.get('/admin/api/production-stats', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const rows = db.prepare(`
      SELECT t.ma_dh, t.cong_doan, t.ten_ktv, t.thoi_gian_hoan_thanh,
             COALESCE(d.sl, 0) AS sl, COALESCE(d.loai_lenh, '') AS loai_lenh,
             d.khach_hang, d.benh_nhan, d.phuc_hinh
      FROM tien_do t
      LEFT JOIN don_hang d ON d.ma_dh = t.ma_dh
      WHERE TRIM(COALESCE(t.ten_ktv, '')) NOT IN ('', '-')
        AND TRIM(COALESCE(t.thoi_gian_hoan_thanh, '')) NOT IN ('', '-')
    `).all();

    const days = buildProductionDaysFromRows(rows);
    const wantedDates = new Set(days.map(d => d.date));
    const stageOrder = ['CBM', 'SÁP/Cadcam', 'SƯỜN', 'ĐẮP', 'MÀI'];
    const dayStats = () => Object.fromEntries(days.map(d => [d.date, { qty: 0, orders: 0, entries: [], types: newTypeStats() }]));
    const totals = {
      qty: 0,
      orders: 0,
      employees: new Set(),
      byDay: Object.fromEntries(days.map(d => [d.date, { qty: 0, orders: 0, types: newTypeStats() }])),
    };
    const stageMap = new Map();

    for (const row of rows) {
      const doneDate = parseScrapedDate(row.thoi_gian_hoan_thanh);
      if (!wantedDates.has(doneDate)) continue;

      const stage = String(row.cong_doan || 'Khác').trim() || 'Khác';
      const ktv = String(row.ten_ktv || 'Không rõ').trim() || 'Không rõ';
      const qty = Number(row.sl) || 0;

      if (!stageMap.has(stage)) {
        stageMap.set(stage, {
          stage,
          totalQty: 0,
          totalOrders: 0,
          byDay: dayStats(),
          employees: new Map(),
        });
      }

      const stageStats = stageMap.get(stage);
      if (!stageStats.employees.has(ktv)) {
        stageStats.employees.set(ktv, {
          ktv,
          totalQty: 0,
          totalOrders: 0,
          byDay: dayStats(),
        });
      }

      const employee = stageStats.employees.get(ktv);
      const entry = {
        ma_dh: row.ma_dh,
        qty,
        time: row.thoi_gian_hoan_thanh,
        loai_lenh: normalizeOrderType(row.loai_lenh),
        khach_hang: row.khach_hang || '',
        benh_nhan: row.benh_nhan || '',
        phuc_hinh: row.phuc_hinh || '',
      };
      employee.byDay[doneDate].qty += qty;
      employee.byDay[doneDate].orders += 1;
      employee.byDay[doneDate].entries.push(entry);
      addTypeStat(employee.byDay[doneDate].types, row.loai_lenh, qty, row.ma_dh);
      employee.totalQty += qty;
      employee.totalOrders += 1;

      stageStats.byDay[doneDate].qty += qty;
      stageStats.byDay[doneDate].orders += 1;
      stageStats.byDay[doneDate].entries.push(entry);
      addTypeStat(stageStats.byDay[doneDate].types, row.loai_lenh, qty, row.ma_dh);
      stageStats.totalQty += qty;
      stageStats.totalOrders += 1;

      totals.byDay[doneDate].qty += qty;
      totals.byDay[doneDate].orders += 1;
      addTypeStat(totals.byDay[doneDate].types, row.loai_lenh, qty, row.ma_dh);
      totals.qty += qty;
      totals.orders += 1;
      totals.employees.add(ktv);
    }

    const stages = Array.from(stageMap.values())
      .map(stage => ({
        ...stage,
        employees: Array.from(stage.employees.values())
          .map(employee => {
            for (const value of Object.values(employee.byDay)) {
              value.entries.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
            }
            return employee;
          })
          .sort((a, b) => b.totalQty - a.totalQty || b.totalOrders - a.totalOrders || a.ktv.localeCompare(b.ktv, 'vi')),
      }))
      .sort((a, b) => {
        const ai = stageOrder.indexOf(a.stage);
        const bi = stageOrder.indexOf(b.stage);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.stage.localeCompare(b.stage, 'vi');
      });

    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      days,
      totals: {
        qty: totals.qty,
        orders: totals.orders,
        employees: totals.employees.size,
        byDay: serializeStats(totals.byDay),
      },
      stages: serializeStats(stages),
    });
  } catch (err) {
    log(`Production stats error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function buildMonthlyEntries(db, targetMonth) {
  const hasHistory = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tien_do_history'").get();
  const rows = hasHistory
    ? db.prepare(`
        SELECT id, ma_dh, thu_tu, cong_doan, ten_ktv, thoi_gian_hoan_thanh,
               COALESCE(so_luong, 0) AS sl, COALESCE(loai_lenh, '') AS loai_lenh,
               COALESCE(ten_nha_khoa, '') AS khach_hang, COALESCE(benh_nhan, '') AS benh_nhan,
               COALESCE(phuc_hinh, '') AS phuc_hinh, COALESCE(imported_at, '') AS imported_at
        FROM tien_do_history
        WHERE TRIM(COALESCE(ten_ktv, '')) NOT IN ('', '-')
          AND TRIM(COALESCE(thoi_gian_hoan_thanh, '')) NOT IN ('', '-')
      `).all()
    : db.prepare(`
        SELECT NULL AS id, t.ma_dh, t.thu_tu, t.cong_doan, t.ten_ktv, t.thoi_gian_hoan_thanh,
               COALESCE(d.sl, 0) AS sl, COALESCE(d.loai_lenh, '') AS loai_lenh,
               COALESCE(d.khach_hang, '') AS khach_hang, COALESCE(d.benh_nhan, '') AS benh_nhan,
               COALESCE(d.phuc_hinh, '') AS phuc_hinh, COALESCE(t.updated_at, '') AS imported_at
        FROM tien_do t
        LEFT JOIN don_hang d ON d.ma_dh = t.ma_dh
        WHERE TRIM(COALESCE(t.ten_ktv, '')) NOT IN ('', '-')
          AND TRIM(COALESCE(t.thoi_gian_hoan_thanh, '')) NOT IN ('', '-')
      `).all();

  const latestByOrderStage = new Map();
  for (const row of rows) {
    const key = [row.ma_dh, row.thu_tu, row.cong_doan].join('\u001f');
    const prev = latestByOrderStage.get(key);
    if (!prev || String(row.imported_at || '').localeCompare(String(prev.imported_at || '')) >= 0) {
      latestByOrderStage.set(key, row);
    }
  }

  const grouped = new Map();
  for (const row of latestByOrderStage.values()) {
    const period = billingPeriodForCompletion(row.thoi_gian_hoan_thanh);
    if (!period || period.billingMonth !== targetMonth) continue;
    const key = [row.cong_doan || 'Khác', row.ten_ktv || 'Không rõ'].join('\u001f');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      ma_dh: row.ma_dh,
      qty: Number(row.sl) || 0,
      time: row.thoi_gian_hoan_thanh,
      loai_lenh: normalizeOrderType(row.loai_lenh),
      khach_hang: row.khach_hang || '',
      benh_nhan: row.benh_nhan || '',
      phuc_hinh: row.phuc_hinh || '',
    });
  }

  for (const entries of grouped.values()) {
    entries.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  }
  return grouped;
}

router.get('/admin/api/monthly-stats', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    refreshMonthlyStats();

    const month = String(req.query.month || '').trim();
    const months = db.prepare(`
      SELECT billing_month, MIN(billing_start) AS billing_start, MAX(billing_end) AS billing_end,
             SUM(orders_completed) AS orders_completed, SUM(total_sl) AS total_sl, SUM(source_rows) AS source_rows
      FROM ktv_monthly_stats
      GROUP BY billing_month
      ORDER BY billing_month DESC
    `).all();
    const latest = months[0];
    const targetMonth = /^\d{4}-\d{2}$/.test(month) ? month : latest?.billing_month;
    if (!targetMonth) return res.json({ ok: true, month: '', months: [], period: null, data: [] });

    const rows = db.prepare(`
      SELECT billing_month, billing_start, billing_end, cong_doan, ten_ktv,
             orders_completed, total_sl, source_rows, type_breakdown, updated_at
      FROM ktv_monthly_stats
      WHERE billing_month = ?
      ORDER BY cong_doan, total_sl DESC, orders_completed DESC, ten_ktv
    `).all(targetMonth);
    const period = months.find(item => item.billing_month === targetMonth) || rows[0] || null;
    const entriesByEmployee = buildMonthlyEntries(db, targetMonth);
    const data = rows.map(row => {
      const key = [row.cong_doan || 'Khác', row.ten_ktv || 'Không rõ'].join('\u001f');
      return {
        ...row,
        type_breakdown: parseTypeBreakdown(row.type_breakdown),
        entries: entriesByEmployee.get(key) || [],
      };
    });

    res.json({ ok: true, month: targetMonth, months, period, data });
  } catch (err) {
    log(`Monthly stats error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
