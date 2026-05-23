'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { USERS, hasPermission } = require('../repositories/users.repo');
const { getDB } = require('../db/index');
const { getActiveMaDhList, getSkipStages, isThuSuonNote, STAGE_NAMES } = require('../repositories/orders.repo');

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

function pad2(value) {
  return String(value).padStart(2, '0');
}

const VIETNAM_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function localDateKey(date = new Date()) {
  return VIETNAM_DATE_FORMATTER.format(date);
}

function parseDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;

  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return `${match[3]}-${pad2(match[2])}-${pad2(match[1])}`;

  return '';
}

function parseDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(
      Number(m[3]), Number(m[2]) - 1, Number(m[1]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
    );
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)
    );
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  const native = Date.parse(raw);
  return Number.isNaN(native) ? null : native;
}

function daysBetweenDateKeys(fromKey, toKey) {
  if (!fromKey || !toKey) return null;
  const from = new Date(`${fromKey}T00:00:00`);
  const to = new Date(`${toKey}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}

function isStageDone(row) {
  return String(row?.xac_nhan || '').trim() === 'Có' ||
    String(row?.xac_nhan || '').trim().toLowerCase() === 'xác nhận' ||
    String(row?.thoi_gian_hoan_thanh || '').trim() !== '';
}

function makeEmptyStage(name, index, skip) {
  return {
    n: name,
    k: '',
    x: false,
    t: '',
    sk: skip.includes(index),
  };
}

function getCurrentStageFromStages(stages) {
  const latestDoneIndex = stages.reduce((latest, stage, index) => (
    !stage.sk && stage.x ? Math.max(latest, index) : latest
  ), -1);
  const current = stages.find((stage, index) => (
    !stage.sk && !stage.x && index > latestDoneIndex
  ));
  return current?.n || 'HOÀN TẤT';
}

function buildWipOrder(row, stagesByOrder, todayKey) {
  const skip = getSkipStages(
    row.loai_lenh || '',
    row.ghi_chu || '',
    `${row.phuc_hinh || ''} ${row.ghi_chu_sx || ''}`
  );
  const stageRows = stagesByOrder.get(row.ma_dh) || [];
  const byThuTu = new Map();
  const byName = new Map();

  for (const stage of stageRows) {
    byThuTu.set(Number(stage.thu_tu), stage);
    byName.set(stage.cong_doan, stage);
  }

  const stages = STAGE_NAMES.map((name, index) => {
    const stage = byThuTu.get(index + 1) || byName.get(name);
    if (!stage) return makeEmptyStage(name, index, skip);
    return {
      n: stage.cong_doan || name,
      k: stage.ten_ktv || '',
      x: isStageDone(stage),
      t: stage.thoi_gian_hoan_thanh || '',
      sk: skip.includes(index),
    };
  });

  const currentStage = getCurrentStageFromStages(stages);
  const activeStages = stages.filter(stage => !stage.sk);
  const done = activeStages.filter(stage => stage.x).length;
  const total = activeStages.length;
  const receivedDate = parseDateKey(row.nhap_luc);
  const receiveAgeDays = daysBetweenDateKeys(receivedDate, todayKey);

  let currentStageStartedAt = null;
  if (currentStage !== 'HOÀN TẤT') {
    let latestDoneAt = null;
    for (const stage of stages) {
      if (!stage.x || stage.sk) continue;
      const ts = parseDateTime(stage.t);
      if (ts != null && (latestDoneAt == null || ts > latestDoneAt)) latestDoneAt = ts;
    }
    currentStageStartedAt = latestDoneAt != null ? latestDoneAt : parseDateTime(row.nhap_luc);
  }
  const currentStageAgeMinutes = currentStageStartedAt != null
    ? Math.max(0, Math.floor((Date.now() - currentStageStartedAt) / 60000))
    : null;

  return {
    ma_dh: row.ma_dh,
    nhan: row.nhap_luc || '',
    received_date: receivedDate,
    receive_age_days: receiveAgeDays,
    yc_ht: row.yc_hoan_thanh || '',
    yc_giao: row.yc_giao || '',
    khach_hang: row.khach_hang || '',
    benh_nhan: row.benh_nhan || '',
    phuc_hinh: row.phuc_hinh || '',
    sl: Number(row.sl) || 0,
    loai_lenh: row.loai_lenh || '',
    ghi_chu: row.ghi_chu || '',
    ghi_chu_sx: row.ghi_chu_sx || '',
    routed_to: row.routed_to || 'sap',
    current_stage: currentStage,
    current_stage_started_at: currentStageStartedAt,
    current_stage_age_minutes: currentStageAgeMinutes,
    stagesData: stages,
    done,
    total,
    pct: total > 0 ? Math.round(done / total * 100) : 0,
  };
}

function keepActiveThuSuonOrder(order, activeSet) {
  if (!activeSet.has(order.ma_dh)) return order;
  if (!isThuSuonNote(order.ghi_chu)) return order;
  if (!(order.total > 0 && order.done >= order.total)) return order;

  const suonStage = (order.stagesData || []).find(stage => stage.n === STAGE_NAMES[2]);
  const startedAt = parseDateTime(suonStage?.t) || parseDateTime(order.nhan) || order.current_stage_started_at;
  return {
    ...order,
    active_thu_suon: true,
    current_stage: STAGE_NAMES[2],
    current_stage_started_at: startedAt,
    current_stage_age_minutes: startedAt != null
      ? Math.max(0, Math.floor((Date.now() - startedAt) / 60000))
      : order.current_stage_age_minutes,
  };
}

function summarizeWipOrders(orders) {
  const byStage = new Map();
  const stages = ['all', ...STAGE_NAMES, 'HOÀN TẤT'];
  for (const stage of stages) byStage.set(stage, { stage, orders: 0, qty: 0 });

  for (const order of orders) {
    const all = byStage.get('all');
    all.orders += 1;
    all.qty += Number(order.sl) || 0;

    const stage = byStage.get(order.current_stage) || { stage: order.current_stage, orders: 0, qty: 0 };
    stage.orders += 1;
    stage.qty += Number(order.sl) || 0;
    byStage.set(order.current_stage, stage);
  }

  return Array.from(byStage.values());
}

const WORK_START_H = 8;
const WORK_END_H = 21;

function workingMinutesBetween(startMs, endMs) {
  if (startMs == null || endMs <= startMs) return 0;
  let total = 0;
  let cursor = startMs;
  while (cursor < endMs) {
    const d = new Date(cursor);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), WORK_START_H, 0, 0, 0).getTime();
    const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), WORK_END_H,   0, 0, 0).getTime();
    const segStart = Math.max(cursor, dayStart);
    const segEnd   = Math.min(endMs, dayEnd);
    if (segEnd > segStart) total += segEnd - segStart;
    cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
  }
  return Math.floor(total / 60000);
}

let stageP75Cache = null;
let stageP75CacheTime = 0;
const STAGE_P75_TTL = 30 * 60 * 1000;

function computeStageP75(db) {
  if (stageP75Cache && Date.now() - stageP75CacheTime < STAGE_P75_TTL) return stageP75Cache;
  const rows = db.prepare(`
    SELECT ma_dh, thu_tu, cong_doan, thoi_gian_hoan_thanh, ngay_nhan
    FROM tien_do_history
    WHERE xac_nhan = 'Có'
      AND thoi_gian_hoan_thanh IS NOT NULL AND thoi_gian_hoan_thanh != ''
      AND completion_date >= date('now', '-30 days')
    ORDER BY ma_dh, thu_tu
  `).all();

  const byMa = new Map();
  for (const r of rows) {
    if (!byMa.has(r.ma_dh)) byMa.set(r.ma_dh, []);
    byMa.get(r.ma_dh).push(r);
  }

  const durations = {};
  for (const stages of byMa.values()) {
    let prevTime = null;
    for (const s of stages) {
      const end = parseDateTime(s.thoi_gian_hoan_thanh);
      if (end == null) continue;
      const start = prevTime != null ? prevTime : parseDateTime(s.ngay_nhan);
      if (start != null && end > start) {
        const dur = workingMinutesBetween(start, end);
        if (dur > 0 && dur < 7 * 24 * 60) {
          if (!durations[s.cong_doan]) durations[s.cong_doan] = [];
          durations[s.cong_doan].push(dur);
        }
      }
      prevTime = end;
    }
  }

  const result = {};
  for (const [stage, arr] of Object.entries(durations)) {
    arr.sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(arr.length - 1, Math.floor(arr.length * 0.75)));
    result[stage] = { p50: arr[Math.floor(arr.length * 0.5)] || 0, p75: arr[idx] || 0, n: arr.length };
  }
  stageP75Cache = result;
  stageP75CacheTime = Date.now();
  return result;
}

function getThroughputToday(db, todayKey) {
  const [yyyy, mm, dd] = todayKey.split('-');
  const isoLike = `${todayKey}%`;
  const viLike = `${dd}/${mm}/${yyyy}%`;
  const received = db.prepare(
    `SELECT COUNT(*) AS n FROM don_hang WHERE nhap_luc LIKE ? OR nhap_luc LIKE ?`
  ).get(isoLike, viLike).n;
  const completedToday = db.prepare(
    `SELECT COALESCE(SUM(orders_completed), 0) AS n FROM ktv_daily_stats WHERE completion_date = ?`
  ).get(todayKey).n;
  const avgRow = db.prepare(`
    SELECT AVG(daily_total) AS avg FROM (
      SELECT completion_date, SUM(orders_completed) AS daily_total
      FROM ktv_daily_stats
      WHERE completion_date >= date(?, '-7 days') AND completion_date < ?
      GROUP BY completion_date
    )
  `).get(todayKey, todayKey);
  const avg7day = Math.round(avgRow.avg || 0);
  const deltaPct = avg7day > 0 ? Math.round((completedToday - avg7day) / avg7day * 100) : null;
  return {
    received_today: received,
    completed_today: completedToday,
    net_today: received - completedToday,
    avg_7day: avg7day,
    delta_pct: deltaPct,
  };
}

function computeDeadlineKPI(orders) {
  const now = Date.now();
  let count = 0;
  let urgentCount = 0;
  let minMinutes = null;
  for (const o of orders) {
    if (o.current_stage === 'HOÀN TẤT') continue;
    const dl = parseDateTime(o.yc_ht);
    if (dl == null) continue;
    const mins = Math.floor((dl - now) / 60000);
    if (mins > 240) continue;
    count++;
    if (mins <= 60) urgentCount++;
    if (minMinutes == null || mins < minMinutes) minMinutes = mins;
  }
  return { count, urgent_count: urgentCount, most_urgent_minutes: minMinutes };
}

function computeBottleneckKPI(orders, stageP75) {
  const byStage = new Map();
  for (const o of orders) {
    if (o.current_stage === 'HOÀN TẤT') continue;
    const stage = o.current_stage;
    if (!byStage.has(stage)) byStage.set(stage, { count: 0, overP75: 0, ratios: [] });
    const s = byStage.get(stage);
    s.count++;
    const age = o.current_stage_age_minutes;
    const p75 = stageP75[stage]?.p75 || 0;
    if (age != null && p75 > 0) {
      if (age >= p75) s.overP75++;
      s.ratios.push(age / p75);
    }
  }
  let best = null;
  for (const [stage, s] of byStage) {
    if (!best || s.overP75 > best.overP75 || (s.overP75 === best.overP75 && s.count > best.count)) {
      best = { stage, ...s };
    }
  }
  if (!best) return null;
  const avgRatio = best.ratios.length
    ? best.ratios.reduce((a, b) => a + b, 0) / best.ratios.length
    : null;
  return {
    stage: best.stage,
    stage_count: best.count,
    over_p75_count: best.overP75,
    avg_ratio: avgRatio ? Math.round(avgRatio * 10) / 10 : null,
    p75_minutes: stageP75[best.stage]?.p75 || null,
  };
}

function ktvForOrderCurrent(o) {
  if (!o || o.current_stage === 'HOÀN TẤT') return null;
  const stages = o.stagesData || [];
  const current = stages.find(s => !s.sk && s.n === o.current_stage);
  return current && current.k ? current.k : null;
}

function computeBalanceKPI(orders) {
  const wip = orders.filter(o => o.current_stage !== 'HOÀN TẤT');
  const counts = new Map();
  let unclaimed = 0;
  for (const o of wip) {
    const k = ktvForOrderCurrent(o);
    if (!k) unclaimed++;
    else counts.set(k, (counts.get(k) || 0) + 1);
  }
  const total = wip.length;
  if (counts.size === 0) {
    return {
      top_ktv: null, top_ktv_count: 0, median_ktv_count: 0,
      unclaimed_count: unclaimed,
      unclaimed_pct: total ? Math.round(unclaimed / total * 100) : 0,
    };
  }
  const arr = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = arr[0];
  const median = arr[Math.floor(arr.length / 2)];
  return {
    top_ktv: top[0],
    top_ktv_count: top[1],
    median_ktv_count: median[1],
    unclaimed_count: unclaimed,
    unclaimed_pct: total ? Math.round(unclaimed / total * 100) : 0,
  };
}

function loadWipOrders(db, whereSql, params, todayKey) {
  const rows = db.prepare(`
    SELECT ma_dh, nhap_luc, yc_hoan_thanh, yc_giao, khach_hang, benh_nhan,
           phuc_hinh, sl, loai_lenh, ghi_chu, ghi_chu_sx, routed_to
    FROM don_hang
    ${whereSql}
    ORDER BY yc_giao ASC, yc_hoan_thanh ASC, nhap_luc ASC
  `).all(...params);

  if (!rows.length) return [];

  const ids = rows.map(row => row.ma_dh);
  const placeholders = ids.map(() => '?').join(',');
  const stageRows = db.prepare(`
    SELECT ma_dh, thu_tu, cong_doan, ten_ktv, xac_nhan, thoi_gian_hoan_thanh
    FROM tien_do
    WHERE ma_dh IN (${placeholders})
    ORDER BY ma_dh, thu_tu
  `).all(...ids);

  const stagesByOrder = new Map();
  for (const stage of stageRows) {
    if (!stagesByOrder.has(stage.ma_dh)) stagesByOrder.set(stage.ma_dh, []);
    stagesByOrder.get(stage.ma_dh).push(stage);
  }

  return rows.map(row => buildWipOrder(row, stagesByOrder, todayKey));
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

router.get('/api/stats/wip', requireAuth, (req, res) => {
  const sess = req.session;
  const userInfo = USERS[sess.user];
  if (!userInfo || !hasPermission(sess.user, 'stats.view_wip')) {
    return res.status(403).json({ error: 'Không có quyền xem WIP' });
  }

  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });

    const todayKey = localDateKey();
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
      ? String(req.query.date)
      : todayKey;
    const [yyyy, mm, dd] = dateKey.split('-');
    const isoLike = `${dateKey}%`;
    const viLike = `${dd}/${mm}/${yyyy}%`;

    const active = getActiveMaDhList();
    const activeSet = new Set(active?.ids || []);
    let activeSource = active?.src || null;

    const rawReceived = loadWipOrders(
      db,
      `WHERE nhap_luc LIKE ? OR nhap_luc LIKE ?`,
      [isoLike, viLike],
      todayKey
    ).map(order => keepActiveThuSuonOrder(order, activeSet));

    const now = Date.now();
    const isAbandonedOrder = order => {
      if (order.current_stage === 'HOÀN TẤT') return false;
      if (activeSet.has(order.ma_dh)) return false;
      const anyDone = (order.stagesData || []).some(s => s.x && !s.sk);
      if (anyDone) return false;
      const giaoTime = parseDateTime(order.yc_giao);
      if (giaoTime != null && giaoTime > now) return false;
      return true;
    };

    const abandonedReceived = rawReceived.filter(isAbandonedOrder);
    const receivedOrders = rawReceived.filter(order => !isAbandonedOrder(order));

    let carryoverOrders = [];
    if (active && active.ids.length) {
      const placeholders = active.ids.map(() => '?').join(',');
      carryoverOrders = loadWipOrders(
        db,
        `WHERE ma_dh IN (${placeholders})`,
        active.ids,
        todayKey
      )
        .map(order => keepActiveThuSuonOrder(order, activeSet))
        .filter(order => order.current_stage !== 'HOÀN TẤT' && order.received_date && order.received_date < dateKey);
    }

    const todayWip = receivedOrders.filter(order => order.current_stage !== 'HOÀN TẤT');
    const completedToday = receivedOrders.filter(order => order.current_stage === 'HOÀN TẤT');

    const wipOrdersAll = [...todayWip, ...carryoverOrders];
    let stageP75 = {};
    let kpis = null;
    try {
      stageP75 = computeStageP75(db);
      kpis = {
        throughput:  getThroughputToday(db, todayKey),
        deadline:    computeDeadlineKPI(wipOrdersAll),
        bottleneck:  computeBottleneckKPI(wipOrdersAll, stageP75),
        balance:     computeBalanceKPI(wipOrdersAll),
      };
    } catch (kpiErr) {
      log(`[Stats] WIP KPI calc error: ${kpiErr.message}`);
    }

    res.json({
      ok: true,
      date: dateKey,
      today: todayKey,
      active_source: activeSource,
      kpis,
      stage_p75: stageP75,
      abandoned: {
        orders: abandonedReceived,
        total_orders: abandonedReceived.length,
        total_qty: abandonedReceived.reduce((sum, order) => sum + (Number(order.sl) || 0), 0),
      },
      received: {
        orders: receivedOrders,
        summary: summarizeWipOrders(receivedOrders),
        total_orders: receivedOrders.length,
        total_qty: receivedOrders.reduce((sum, order) => sum + (Number(order.sl) || 0), 0),
        wip_orders: todayWip.length,
        wip_qty: todayWip.reduce((sum, order) => sum + (Number(order.sl) || 0), 0),
        completed_orders: completedToday.length,
        completed_qty: completedToday.reduce((sum, order) => sum + (Number(order.sl) || 0), 0),
      },
      carryover: {
        orders: carryoverOrders,
        summary: summarizeWipOrders(carryoverOrders),
        total_orders: carryoverOrders.length,
        total_qty: carryoverOrders.reduce((sum, order) => sum + (Number(order.sl) || 0), 0),
      },
    });
  } catch (err) {
    log(`[Stats] WIP error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
