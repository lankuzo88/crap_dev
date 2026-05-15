'use strict';
const express  = require('express');
const router   = express.Router();
const { requireAuth } = require('../middleware/auth');
const { USERS } = require('../repositories/users.repo');
const { getDB } = require('../db/index');
const {
  STAGE_NAMES, getSkipStages, isThuSuonNote, userCongDoanToDB, getActiveMaDhList,
} = require('../repositories/orders.repo');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function roomForUserCongDoan(congDoan) {
  const raw = String(congDoan || '').trim();
  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'sap') return 'sap';
  if (raw.toUpperCase() === 'CAD/CAM') return 'zirco';
  return null;
}

router.get('/user', requireAuth, (req, res) => {
  const sess = req.session;
  const u = USERS[sess.user] || {};
  res.json({
    username: sess.user,
    role: u.role || sess.role,
    cong_doan: u.cong_doan || '',
    can_view_stats: u.can_view_stats === true,
    permissions: u.permissions || [],
  });
});

router.get('/api/user/pending-orders', requireAuth, (req, res) => {
  const sess = req.session;
  const userCongDoan = USERS[sess.user]?.cong_doan;
  if (!userCongDoan) return res.json({ ok: true, orders: [] });

  const db = getDB();
  if (!db) return res.status(503).json({ ok: false, error: 'Database not available' });

  try {
    const active = getActiveMaDhList();
    if (!active) { log(`[User Orders] No active Excel file found`); return res.json({ ok: true, orders: [] }); }

    const dbCongDoan = userCongDoanToDB(userCongDoan);
    let loaiLenhFilter = '';
    if (dbCongDoan === 'CBM' || dbCongDoan === STAGE_NAMES[1]) {
      loaiLenhFilter = `AND COALESCE(d.loai_lenh, '') NOT IN ('Sửa', 'Làm tiếp')`;
    } else if (dbCongDoan === STAGE_NAMES[2]) {
      loaiLenhFilter = `AND COALESCE(d.loai_lenh, '') != 'Sửa'`;
    }
    const room = roomForUserCongDoan(userCongDoan);
    const roomFilter = room
      ? `AND COALESCE(d.routed_to, 'sap') IN ('sap', 'zirco', 'both')`
      : '';
    const completionFilter = dbCongDoan === STAGE_NAMES[4]
      ? ''
      : `AND NOT (LOWER(COALESCE(t.xac_nhan, '')) IN ('có', 'xác nhận'))`;

    const ph = active.ids.map(() => '?').join(',');
    const pendingOrders = db.prepare(`
      SELECT DISTINCT d.ma_dh, d.loai_lenh, d.ghi_chu, d.routed_to
      FROM tien_do t
      JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE d.ma_dh IN (${ph})
        AND t.cong_doan = ?
        ${completionFilter}
        ${loaiLenhFilter}
        ${roomFilter}
    `).all(...active.ids, dbCongDoan);

    const userStageIndex = STAGE_NAMES.indexOf(dbCongDoan);
    const pendingMaDhs = pendingOrders
      .filter(r => {
        if (userStageIndex < 0) return true;
        if ((dbCongDoan === STAGE_NAMES[3] || dbCongDoan === STAGE_NAMES[4]) && isThuSuonNote(r.ghi_chu)) return false;
        return !getSkipStages(r.loai_lenh || '', r.ghi_chu || '').includes(userStageIndex);
      })
      .map(r => r.ma_dh);

    if (pendingMaDhs.length === 0) return res.json({ ok: true, orders: [] });

    const phPending = pendingMaDhs.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT DISTINCT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao,
             d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
             d.loai_lenh, d.ghi_chu, d.ghi_chu_sx, d.routed_to,
             GROUP_CONCAT(
               t.thu_tu||'|'||t.cong_doan||'|'||COALESCE(t.ten_ktv,'')||'|'||
               COALESCE(t.xac_nhan,'Chưa')||'|'||COALESCE(t.thoi_gian_hoan_thanh,''),
               ';;'
             ) AS stages_raw
      FROM tien_do t
      JOIN don_hang d ON t.ma_dh = d.ma_dh
      WHERE d.ma_dh IN (${phPending})
      GROUP BY d.ma_dh
      ORDER BY d.nhap_luc DESC
    `).all(...pendingMaDhs);

    const orders = [];
    for (const row of rows) {
      const lk = row.loai_lenh || '';
      const gc = row.ghi_chu   || '';
      const stagesMap = {};
      for (const part of (row.stages_raw || '').split(';;')) {
        const p = part.split('|');
        if (p.length >= 5) {
          const thu_tu = parseInt(p[0]);
          if (!isNaN(thu_tu)) stagesMap[thu_tu] = { n: p[1], k: p[2], x: p[3] === 'Có' || p[3] === 'xác nhận', t: p[4] };
        }
      }
      const skip = getSkipStages(lk, gc);
      const stages = STAGE_NAMES.map((name, i) => {
        const s = stagesMap[i + 1] || { n: name, k: '', x: false, t: '' };
        return { n: name, k: s.k, x: s.x, t: s.t, sk: skip.includes(i) };
      });
      const active2 = stages.filter(s => !s.sk);
      const done = active2.filter(s => s.x).length;
      const total = active2.length;
      let curKtv = '';
      for (let i = stages.length - 1; i >= 0; i--) {
        if (!stages[i].sk && stages[i].k) { curKtv = stages[i].k; break; }
      }
      let lastTg = '';
      stages.forEach(s => { if (s.t) lastTg = s.t; });
      orders.push({
        ma_dh: row.ma_dh, nhan: row.nhap_luc || '', yc_ht: row.yc_hoan_thanh || '',
        yc_giao: row.yc_giao || '', kh: row.khach_hang || '', bn: row.benh_nhan || '',
        ph: row.phuc_hinh || '', sl: row.sl || 0, gc, ghi_chu_sx: row.ghi_chu_sx || '', lk, routed_to: row.routed_to || 'sap',
        stages, done, total, pct: total > 0 ? Math.round(done / total * 100) : 0, curKtv, lastTg,
      });
    }
    res.json({ ok: true, orders });
  } catch (err) {
    log(`[User Orders] Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
