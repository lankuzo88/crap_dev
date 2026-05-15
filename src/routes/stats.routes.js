'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { USERS, hasPermission } = require('../repositories/users.repo');
const { getDB } = require('../db/index');
const { getActiveMaDhList } = require('../repositories/orders.repo');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function classifyPhucHinhPart(text) {
  const raw = String(text || '').toLowerCase();
  const normalized = normalizeText(text);
  const isZirconiaMaterial =
    raw.includes('zircornia') || raw.includes('zirconia') || raw.includes('ziconia') ||
    raw.includes('zir-') || raw.includes('zolid') || raw.includes('cercon') ||
    raw.includes('la va') || raw.includes('full zirconia') || normalized.includes('argen');
  const isMetalMaterial =
    normalized.includes('kim loai') || raw.includes('titanium') || normalized.includes('titan') ||
    raw.includes('chrome') || raw.includes('cobalt');
  const isTemporaryMaterial =
    normalized.includes('rang tam') || raw.includes('pmma') || normalized.includes('in resin');

  if (normalized.includes('in mau') || normalized.includes('mau ham')) return 'in_mau_ham';
  if (isTemporaryMaterial) return 'rang_tam';
  if (raw.includes('cùi giả zirconia') || normalized.includes('cui gia zirconia')) return 'cui_gia';
  if (raw.includes('veneer')) {
    if (isZirconiaMaterial) return 'zirconia';
    if (isMetalMaterial) return 'kim_loai';
    return 'mat_dan';
  }
  if (raw.includes('mặt dán') || normalized.includes('mat dan')) return 'mat_dan';
  if (isZirconiaMaterial) return 'zirconia';
  return 'kim_loai';
}

function extractPartQty(text) {
  const match = String(text || '').match(/SL\s*:\s*(\d+)/i);
  return match ? Number(match[1]) || 0 : 0;
}

function splitPhucHinhParts(phucHinh) {
  return String(phucHinh || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean);
}

function summarizePhucHinh(phucHinh, totalQty) {
  const summary = { mat_dan: 0, kim_loai: 0, zirconia: 0, cui_gia: 0, in_mau_ham: 0, rang_tam: 0 };
  const parts = splitPhucHinhParts(phucHinh);
  if (!parts.length) {
    summary.kim_loai = Number(totalQty) || 0;
    return summary;
  }

  let assigned = 0;
  for (const part of parts) {
    const qty = extractPartQty(part);
    if (!qty) continue;
    const type = classifyPhucHinhPart(part);
    summary[type] += qty;
    assigned += qty;
  }

  if (assigned === 0) {
    const type = classifyPhucHinhPart(phucHinh);
    summary[type] += Number(totalQty) || 0;
  }

  return summary;
}

function getDayInfo(ycHoanThanh) {
  const raw = String(ycHoanThanh || '').trim();
  const date = raw.split(/\s+/)[0] || '';
  if (!date) return null;

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
    const [dd, mm, yyyy] = date.split('/');
    return {
      ngay: date,
      ngay_sort: `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`,
    };
  }

  return { ngay: date, ngay_sort: date.slice(0, 10) };
}

router.get('/api/stats/daily', requireAuth, (req, res) => {
  const sess     = req.session;
  const userInfo = USERS[sess.user];
  if (!userInfo || !hasPermission(sess.user, 'stats.view_daily')) {
    return res.status(403).json({ error: 'Không có quyền xem thống kê' });
  }
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const active = getActiveMaDhList();
    if (!active || !active.ids.length) return res.json({ ok: true, data: [] });
    const ph = active.ids.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT yc_hoan_thanh, phuc_hinh, sl
      FROM don_hang
      WHERE ma_dh IN (${ph})
        AND yc_hoan_thanh IS NOT NULL AND yc_hoan_thanh != ''
    `).all(...active.ids);

    const byDay = new Map();
    for (const row of rows) {
      const day = getDayInfo(row.yc_hoan_thanh);
      if (!day) continue;
      if (!byDay.has(day.ngay_sort)) {
        byDay.set(day.ngay_sort, {
          ngay: day.ngay,
          ngay_sort: day.ngay_sort,
          mat_dan: 0,
          kim_loai: 0,
          zirconia: 0,
          cui_gia: 0,
          in_mau_ham: 0,
          rang_tam: 0,
          tong: 0,
        });
      }

      const target = byDay.get(day.ngay_sort);
      const summary = summarizePhucHinh(row.phuc_hinh, row.sl);
      target.mat_dan += summary.mat_dan;
      target.kim_loai += summary.kim_loai;
      target.zirconia += summary.zirconia;
      target.cui_gia += summary.cui_gia;
      target.in_mau_ham += summary.in_mau_ham;
      target.rang_tam += summary.rang_tam;
      target.tong += summary.mat_dan + summary.kim_loai + summary.zirconia + summary.cui_gia + summary.in_mau_ham + summary.rang_tam;
    }

    res.json({ ok: true, data: Array.from(byDay.values()).sort((a, b) => a.ngay_sort.localeCompare(b.ngay_sort)) });
  } catch (err) {
    log(`[Stats] Daily error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
