'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { sessions, getSessionToken } = require('../services/session.service');
const { USERS } = require('../repositories/users.repo');
const { getDB } = require('../db/index');
const { getActiveMaDhList } = require('../repositories/orders.repo');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

router.get('/api/stats/daily', requireAuth, (req, res) => {
  const token    = getSessionToken(req);
  const sess     = sessions.get(token);
  const userInfo = USERS[sess.user];
  if (!userInfo || (userInfo.role !== 'admin' && !userInfo.can_view_stats)) {
    return res.status(403).json({ error: 'Không có quyền xem thống kê' });
  }
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const active = getActiveMaDhList();
    if (!active || !active.ids.length) return res.json({ ok: true, data: [] });
    const ph = active.ids.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT
        substr(yc_hoan_thanh, 1, 10) AS ngay,
        substr(yc_hoan_thanh,7,4)||'-'||substr(yc_hoan_thanh,4,2)||'-'||substr(yc_hoan_thanh,1,2) AS ngay_sort,
        SUM(CASE WHEN LOWER(phuc_hinh) LIKE '%mặt dán%' OR LOWER(phuc_hinh) LIKE '%veneer%'
            THEN COALESCE(sl,0) ELSE 0 END) AS mat_dan,
        SUM(CASE WHEN
            LOWER(phuc_hinh) NOT LIKE '%mặt dán%' AND LOWER(phuc_hinh) NOT LIKE '%veneer%'
            AND LOWER(phuc_hinh) NOT LIKE '%cùi giả zirconia%'
            AND LOWER(phuc_hinh) NOT LIKE '%zirconia%'
            THEN COALESCE(sl,0) ELSE 0 END) AS kim_loai,
        SUM(CASE WHEN LOWER(phuc_hinh) LIKE '%zirconia%' AND LOWER(phuc_hinh) NOT LIKE '%cùi giả zirconia%'
            THEN COALESCE(sl,0) ELSE 0 END) AS zirconia,
        SUM(CASE WHEN LOWER(phuc_hinh) LIKE '%cùi giả zirconia%'
            THEN COALESCE(sl,0) ELSE 0 END) AS cui_gia,
        SUM(COALESCE(sl,0)) AS tong
      FROM don_hang
      WHERE ma_dh IN (${ph})
        AND yc_hoan_thanh IS NOT NULL AND yc_hoan_thanh != ''
      GROUP BY ngay
      ORDER BY ngay_sort ASC
    `).all(...active.ids);

    res.json({ ok: true, data: rows });
  } catch (err) {
    log(`[Stats] Daily error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
