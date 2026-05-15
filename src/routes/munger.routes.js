'use strict';
const express = require('express');
const path    = require('path');
const router  = express.Router();
const { requirePermission } = require('../middleware/auth');
const { getDB } = require('../db/index');
const { BASE_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function getBillingPeriods() {
  const today = new Date();
  const d = today.getDate();
  const m = today.getMonth();
  const y = today.getFullYear();
  let currStart, currEnd, prevStart, prevEnd;
  if (d >= 26) {
    currStart = new Date(y, m, 26);     currEnd = new Date(y, m + 1, 25);
    prevStart = new Date(y, m - 1, 26); prevEnd = new Date(y, m, 25);
  } else {
    currStart = new Date(y, m - 1, 26); currEnd = new Date(y, m, 25);
    prevStart = new Date(y, m - 2, 26); prevEnd = new Date(y, m - 1, 25);
  }
  const fmt  = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  const fmtD = dt => `${dt.getDate()}/${dt.getMonth() + 1}`;
  return {
    curr: { start: fmt(currStart), end: fmt(currEnd), label: `Tháng ${currEnd.getMonth() + 1}/${currEnd.getFullYear()}`, range: `${fmtD(currStart)}–${fmtD(currEnd)}` },
    prev: { start: fmt(prevStart), end: fmt(prevEnd), label: `Tháng ${prevEnd.getMonth() + 1}/${prevEnd.getFullYear()}`, range: `${fmtD(prevStart)}–${fmtD(prevEnd)}` },
  };
}

router.get('/munger', requirePermission('munger.view'), (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'munger.html'));
});

router.get('/api/munger/metrics', requirePermission('munger.view'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const days = parseInt(req.query.days) || 30;
    const billing = getBillingPeriods();
    const isMonthlyView = days === 30;
    const sinceStr = isMonthlyView ? billing.curr.start : (() => {
      const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10);
    })();

    const STAGES = ['CBM', 'SÁP/Cadcam', 'SƯỜN', 'ĐẮP', 'MÀI'];
    const busFactor = {};
    for (const stage of STAGES) {
      const total = db.prepare(`SELECT COUNT(*) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE t.cong_doan = ? AND t.xac_nhan = 'Có' AND t.ten_ktv NOT IN ('', '-') AND t.ten_ktv IS NOT NULL AND SUBSTR(d.nhap_luc, 1, 10) >= ?`).get(stage, sinceStr).n;
      const top   = db.prepare(`SELECT t.ten_ktv, COUNT(*) as n FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE t.cong_doan = ? AND t.xac_nhan = 'Có' AND t.ten_ktv NOT IN ('', '-') AND t.ten_ktv IS NOT NULL AND SUBSTR(d.nhap_luc, 1, 10) >= ? GROUP BY t.ten_ktv ORDER BY n DESC LIMIT 3`).all(stage, sinceStr);
      const top1pct = total > 0 && top[0] ? Math.round(top[0].n * 100 / total) : 0;
      busFactor[stage] = { total, top1_ktv: top[0]?.ten_ktv || '-', top1_pct: top1pct, top3: top.map(r => ({ ktv: r.ten_ktv, n: r.n, pct: total > 0 ? Math.round(r.n * 100 / total) : 0 })) };
    }
    const worstStage = STAGES.reduce((a, b) => busFactor[a].top1_pct > busFactor[b].top1_pct ? a : b);
    const worstPct   = busFactor[worstStage].top1_pct;

    const wipRows = db.prepare(`SELECT t.cong_doan, COUNT(DISTINCT t.ma_dh) as wip FROM tien_do t JOIN don_hang d ON t.ma_dh = d.ma_dh WHERE (t.xac_nhan != 'Có' OR t.xac_nhan IS NULL) AND SUBSTR(d.nhap_luc, 1, 10) >= ? GROUP BY t.cong_doan`).all(sinceStr);
    const wipMap  = {};
    wipRows.forEach(r => { wipMap[r.cong_doan] = r.wip; });
    const wipHead  = (wipMap['CBM'] || 0) + (wipMap['SÁP/Cadcam'] || 0);
    const wipTail  = (wipMap['ĐẮP'] || 0) + (wipMap['MÀI'] || 0);
    const wipRatio = wipHead > 0 ? Math.round(wipTail / wipHead * 100) / 100 : 0;

    const fpy   = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN loai_lenh NOT IN ('Sửa','Làm lại','Bảo hành') THEN 1 ELSE 0 END) as fresh FROM don_hang WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND nhap_luc IS NOT NULL`).get(sinceStr);
    const fpyPct = fpy.total > 0 ? Math.round(fpy.fresh * 100 / fpy.total) : 0;

    const ot    = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN m.thoi_gian_hoan_thanh <= d.yc_hoan_thanh THEN 1 ELSE 0 END) as on_time FROM don_hang d JOIN tien_do m ON d.ma_dh = m.ma_dh AND m.cong_doan = 'MÀI' WHERE SUBSTR(d.nhap_luc, 1, 10) >= ? AND d.yc_hoan_thanh IS NOT NULL AND d.yc_hoan_thanh != '' AND m.xac_nhan = 'Có'`).get(sinceStr);
    const otPct = ot.total > 0 ? Math.round(ot.on_time * 100 / ot.total) : 0;

    const custRows  = db.prepare(`SELECT khach_hang, SUM(sl) as rang FROM don_hang WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND khach_hang IS NOT NULL AND sl > 0 GROUP BY khach_hang ORDER BY rang DESC`).all(sinceStr);
    const totalRang = custRows.reduce((s, r) => s + r.rang, 0);
    const top5Rang  = custRows.slice(0, 5).reduce((s, r) => s + r.rang, 0);
    const top5Pct   = totalRang > 0 ? Math.round(top5Rang * 100 / totalRang) : 0;

    let currRang, prevRang, trendPct, runRate, dailyRows, trendLabel, prevLabel;
    if (isMonthlyView) {
      const todayLocal = new Date();
      const currStartDate = new Date(billing.curr.start);
      const daysElapsed = Math.max(1, Math.floor((todayLocal - currStartDate) / 86400000) + 1);
      const todayStr = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth()+1).padStart(2,'0')}-${String(todayLocal.getDate()).padStart(2,'0')}`;
      const aggCurr  = db.prepare(`SELECT COALESCE(SUM(sl), 0) as rang FROM don_hang WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND SUBSTR(nhap_luc, 1, 10) <= ? AND sl > 0 AND nhap_luc IS NOT NULL`).get(billing.curr.start, todayStr);
      const prevSameEndDate = new Date(billing.prev.start);
      prevSameEndDate.setDate(prevSameEndDate.getDate() + daysElapsed - 1);
      const prevSameEnd = `${prevSameEndDate.getFullYear()}-${String(prevSameEndDate.getMonth()+1).padStart(2,'0')}-${String(prevSameEndDate.getDate()).padStart(2,'0')}`;
      const aggPrev     = db.prepare(`SELECT COALESCE(SUM(sl), 0) as rang FROM don_hang WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND SUBSTR(nhap_luc, 1, 10) <= ? AND sl > 0 AND nhap_luc IS NOT NULL`).get(billing.prev.start, prevSameEnd);
      const aggPrevFull = db.prepare(`SELECT COALESCE(SUM(sl), 0) as rang FROM don_hang WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND SUBSTR(nhap_luc, 1, 10) <= ? AND sl > 0 AND nhap_luc IS NOT NULL`).get(billing.prev.start, billing.prev.end);
      currRang = aggCurr.rang; prevRang = aggPrev.rang;
      trendPct = prevRang > 0 ? Math.round((currRang - prevRang) / prevRang * 100) : 0;
      runRate  = aggPrevFull.rang;
      trendLabel = `${billing.curr.label} — ${daysElapsed} ngày đầu kỳ`;
      prevLabel  = `${billing.prev.label} (${daysElapsed} ngày đầu)`;
      dailyRows  = db.prepare(`SELECT SUBSTR(nhap_luc, 1, 10) as ngay, SUM(sl) as rang FROM don_hang WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND SUBSTR(nhap_luc, 1, 10) <= ? AND sl > 0 AND nhap_luc IS NOT NULL GROUP BY ngay ORDER BY ngay`).all(billing.curr.start, billing.curr.end);
    } else {
      const halfStr = (() => { const d = new Date(); d.setDate(d.getDate() - Math.floor(days / 2)); return d.toISOString().slice(0, 10); })();
      dailyRows = db.prepare(`SELECT SUBSTR(nhap_luc, 1, 10) as ngay, SUM(sl) as rang FROM don_hang WHERE SUBSTR(nhap_luc, 1, 10) >= ? AND sl > 0 AND nhap_luc IS NOT NULL GROUP BY ngay ORDER BY ngay`).all(sinceStr);
      currRang  = dailyRows.filter(r => r.ngay >= halfStr).reduce((s, r) => s + r.rang, 0);
      prevRang  = dailyRows.filter(r => r.ngay < halfStr).reduce((s, r) => s + r.rang, 0);
      trendPct  = prevRang > 0 ? Math.round((currRang - prevRang) / prevRang * 100) : 0;
      runRate   = Math.round(currRang / (days / 2) * 30);
      trendLabel = `${Math.floor(days / 2)} ngày gần`;
      prevLabel  = `${Math.floor(days / 2)} ngày trước`;
    }

    const TARGET = 10000;
    let daysUntil = null;
    if (isMonthlyView) {
      const today = new Date();
      const startDate = new Date(billing.curr.start);
      const endDate   = new Date(billing.curr.end);
      const daysElapsed = Math.max(1, Math.round((today - startDate) / 86400000));
      const daysTotal   = Math.round((endDate - startDate) / 86400000) + 1;
      const projected   = Math.round((currRang / daysElapsed) * daysTotal);
      if (projected >= TARGET || runRate >= TARGET) { daysUntil = 0; }
      else if (trendPct > 0) {
        let rate = projected > 0 ? projected : runRate;
        let months = 0;
        while (rate < TARGET && months < 24) { rate *= (1 + trendPct / 100); months++; }
        daysUntil = months * 30;
      }
    } else {
      if (runRate < TARGET && trendPct > 0) {
        let rate = runRate; let d = 0;
        while (rate < TARGET && d < 730) { rate *= (1 + trendPct / 100); d += 7; }
        daysUntil = d;
      } else if (runRate >= TARGET) { daysUntil = 0; }
    }

    res.json({
      ok: true, updated_at: new Date().toISOString(), days,
      billing_period: isMonthlyView ? billing.curr : null,
      data: {
        bus_factor: {
          stages: STAGES.map(s => ({ stage: s, total: busFactor[s].total, top1_ktv: busFactor[s].top1_ktv, top1_pct: busFactor[s].top1_pct, top3: busFactor[s].top3 })),
          worst_stage: worstStage, worst_pct: worstPct,
          status: worstPct > 50 ? 'red' : worstPct > 35 ? 'yellow' : 'green',
        },
        wip_ratio: { head: wipHead, tail: wipTail, ratio: wipRatio, by_stage: wipMap, status: wipRatio > 1.1 ? 'red' : wipRatio > 0.9 ? 'yellow' : 'green' },
        first_pass_yield: { value: fpyPct, total: fpy.total, rework: fpy.total - fpy.fresh, target: 90, status: fpyPct >= 90 ? 'green' : fpyPct >= 85 ? 'yellow' : 'red' },
        on_time_rate: { value: otPct, on_time: ot.on_time, total: ot.total, target: 90, status: otPct >= 90 ? 'green' : otPct >= 80 ? 'yellow' : 'red' },
        customer_concentration: { top5_pct: top5Pct, total_rang: totalRang, top5_rang: top5Rang, top5: custRows.slice(0, 5).map(r => ({ name: r.khach_hang, rang: r.rang, pct: Math.round(r.rang * 100 / totalRang) })), status: top5Pct < 35 ? 'green' : top5Pct < 50 ? 'yellow' : 'red' },
        demand_trend: {
          curr_rang: currRang, prev_rang: prevRang, change_pct: trendPct, prev_full: runRate,
          daily_avg: Math.round(currRang / (isMonthlyView ? Math.max(1, Math.round((new Date() - new Date(billing.curr.start)) / 86400000)) : days / 2)),
          trend_label: trendLabel, prev_label: prevLabel, sparkline: dailyRows,
          status: trendPct > 0 ? 'green' : trendPct === 0 ? 'yellow' : 'red',
        },
        scale_countdown: { target: TARGET, current_rate: currRang, pct_of_target: Math.min(100, Math.round(currRang / TARGET * 100)), days_until: daysUntil, status: daysUntil === null ? 'red' : daysUntil === 0 ? 'green' : daysUntil > 90 ? 'green' : daysUntil > 30 ? 'yellow' : 'red' },
      },
    });
  } catch (err) {
    log(`[Munger] Error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
