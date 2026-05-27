'use strict';
const express = require('express');
const crypto = require('crypto');
const path    = require('path');
const router  = express.Router();
const { requirePermission, requireAdmin } = require('../middleware/auth');
const { USERS, PERMISSIONS, normalizeUserCongDoan, isValidUserCongDoan, normalizePermissions, hashPassword } = require('../repositories/users.repo');
const { saveUsers } = require('../repositories/users.repo');
const { BASE_DIR } = require('../config/paths');
const { getDB } = require('../db/index');
const { refreshMonthlyStats, billingPeriodForCompletion, normalizeOrderType } = require('../db/migrations');
const { STAGE_NAMES, getSkipStages, getActiveMaDhList, normalizeRuleText: normalizeText, stagesGroupConcatSql } = require('../repositories/orders.repo');
const { analyzeProductionMatch, compactAnalysisForApi, matchProductionRule } = require('../utils/productionMatch');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

router.get('/admin', requirePermission('admin.users.manage'), (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.sendFile(path.join(BASE_DIR, 'admin.html'));
});

router.get('/admin/api/users', requirePermission('admin.users.manage'), (req, res) => {
  const users = Object.entries(USERS).map(([username, data]) => ({
    username,
    role: data.role,
    cong_doan: data.cong_doan || '',
    permissions: normalizePermissions(data.permissions, data.role),
  }));
  res.json(users);
});

router.post('/admin/api/users', requirePermission('admin.users.manage'), express.json(), async (req, res) => {
  const { username, password, role, cong_doan, permissions } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing username, password, or role' });
  if (USERS[username]) return res.status(400).json({ error: 'Username already exists' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const normalizedCongDoan = normalizeUserCongDoan(cong_doan);
  if (!isValidUserCongDoan(normalizedCongDoan)) return res.status(400).json({ error: 'Invalid cong_doan' });
  try {
    const passwordHash = await hashPassword(password);
    USERS[username] = {
      passwordHash,
      role,
      cong_doan: normalizedCongDoan,
      permissions: normalizePermissions(permissions, role, false),
    };
    saveUsers();
    log(`👤 New user created: ${username} (${role}) cong_doan=${normalizedCongDoan || 'none'}`);
    res.json({ ok: true, username, role, cong_doan: normalizedCongDoan });
  } catch (err) {
    log(`❌ Error creating user: ${err.message}`);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.patch('/admin/api/users/:username/cong-doan', requirePermission('admin.users.manage'), express.json(), (req, res) => {
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

router.patch('/admin/api/users/:username/role', requirePermission('admin.users.manage'), express.json(), (req, res) => {
  const { username } = req.params;
  const { role } = req.body;
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (username === req.session.user && role !== 'admin') return res.status(400).json({ error: 'Cannot remove your own admin role' });
  USERS[username].role = role;
  USERS[username].permissions = normalizePermissions(undefined, role);
  saveUsers();
  log(`🔧 role set: ${username} → ${role}`);
  res.json({ ok: true, username, role });
});

router.patch('/admin/api/users/:username/permissions', requirePermission('admin.users.manage'), express.json(), (req, res) => {
  const { username } = req.params;
  const { permissions } = req.body;
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions must be an array' });
  USERS[username].permissions = normalizePermissions(permissions, USERS[username].role);
  saveUsers();
  log(`🔐 permissions set: ${username} → ${USERS[username].permissions.join(',') || 'none'}`);
  res.json({ ok: true, username, permissions: USERS[username].permissions });
});

router.delete('/admin/api/users/:username', requirePermission('admin.users.manage'), (req, res) => {
  const { username } = req.params;
  if (username === req.session.user) return res.status(400).json({ error: 'Cannot delete your own account' });
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  delete USERS[username];
  saveUsers();
  log(`🗑 User deleted: ${username}`);
  res.json({ ok: true, username });
});

router.post('/admin/api/users/:username/reset-password', requirePermission('admin.users.manage'), express.json(), async (req, res) => {
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

function parseDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return null;

  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function formatDateTime(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function hoursBetween(from, to) {
  if (!from || !to) return null;
  return (to.getTime() - from.getTime()) / 36e5;
}

function percentile(values, q) {
  const arr = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!arr.length) return null;
  const index = Math.min(arr.length - 1, Math.max(0, Math.floor((arr.length - 1) * q)));
  return arr[index];
}

function rateAtOrBelow(values, threshold) {
  if (!values?.length || !Number.isFinite(threshold)) return null;
  let count = 0;
  for (const value of values) {
    if (value <= threshold) count += 1;
  }
  return count / values.length;
}

function isStageDone(stage) {
  const status = normalizeText(stage.xac_nhan || stage.x || '');
  if (status === 'co' || status.includes('xac nhan')) return true;
  return String(stage.thoi_gian_hoan_thanh || stage.t || '').trim() !== '';
}

function buildRiskBenchmarks(db) {
  const hasHistory = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tien_do_history'").get();
  if (!hasHistory) return { byKey: new Map(), sampleOrders: 0 };

  const rows = db.prepare(`
    SELECT ma_dh, thu_tu, cong_doan, thoi_gian_hoan_thanh, ngay_nhan, imported_at
    FROM tien_do_history
    WHERE TRIM(COALESCE(thoi_gian_hoan_thanh, '')) NOT IN ('', '-')
      AND TRIM(COALESCE(ma_dh, '')) != ''
    ORDER BY ma_dh, thu_tu, imported_at
  `).all();

  const latestByStage = new Map();
  for (const row of rows) {
    const key = [row.ma_dh, row.thu_tu, row.cong_doan].join('\u001f');
    const prev = latestByStage.get(key);
    if (!prev || String(row.imported_at || '').localeCompare(String(prev.imported_at || '')) >= 0) {
      latestByStage.set(key, row);
    }
  }

  const orders = new Map();
  for (const row of latestByStage.values()) {
    if (!orders.has(row.ma_dh)) orders.set(row.ma_dh, []);
    orders.get(row.ma_dh).push(row);
  }

  const samples = new Map();
  let sampleOrders = 0;
  const addSample = (total, done, value) => {
    if (!Number.isFinite(value) || value < 0) return;
    const key = `${total}:${done}`;
    if (!samples.has(key)) samples.set(key, []);
    samples.get(key).push(value);
  };

  for (const stages of orders.values()) {
    stages.sort((a, b) => Number(a.thu_tu || 0) - Number(b.thu_tu || 0));
    const start = parseDateTime(stages[0]?.ngay_nhan);
    if (!start) continue;

    const completed = stages
      .map(stage => ({ ...stage, doneAt: parseDateTime(stage.thoi_gian_hoan_thanh) }))
      .filter(stage => stage.doneAt && stage.doneAt >= start);
    if (!completed.length) continue;

    const total = completed.length;
    const finish = completed.reduce((max, stage) => stage.doneAt > max ? stage.doneAt : max, completed[0].doneAt);
    if (!finish || finish <= start) continue;
    sampleOrders += 1;

    addSample(total, 0, hoursBetween(start, finish));
    for (let done = 1; done < total; done++) {
      const anchor = completed.slice(0, done).reduce((max, stage) => stage.doneAt > max ? stage.doneAt : max, completed[0].doneAt);
      addSample(total, done, hoursBetween(anchor, finish));
    }
  }

  const byKey = new Map();
  for (const [key, values] of samples.entries()) {
    const sorted = values.filter(v => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
    byKey.set(key, {
      n: sorted.length,
      values: sorted,
      p50: percentile(sorted, 0.50),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.90),
    });
  }

  return { byKey, sampleOrders };
}

function parseStagesRaw(stagesRaw) {
  const stagesMap = {};
  for (const part of String(stagesRaw || '').split(';;')) {
    const p = part.split('|');
    if (p.length >= 5) {
      const thuTu = parseInt(p[0], 10);
      if (!Number.isNaN(thuTu)) {
        stagesMap[thuTu] = {
          n: p[1],
          k: p[2],
          x: p[3],
          t: p[4],
        };
      }
    }
  }
  return stagesMap;
}

function loadCurrentOrdersForRisk(db) {
  const active = getActiveMaDhList();
  const where = active?.ids?.length ? `WHERE d.ma_dh IN (${active.ids.map(() => '?').join(',')})` : '';
  const rows = db.prepare(`
    SELECT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao, d.khach_hang, d.benh_nhan,
           d.phuc_hinh, d.sl, d.loai_lenh, d.ghi_chu, d.ghi_chu_sx, d.routed_to,
           ${stagesGroupConcatSql('t')}
    FROM don_hang d
    LEFT JOIN tien_do t ON t.ma_dh = d.ma_dh
    ${where}
    GROUP BY d.ma_dh
  `).all(...(active?.ids || []));

  return { activeSource: active?.src || null, rows };
}

function chooseValidDueAt(row, startAt) {
  const candidates = [
    parseDateTime(row.yc_hoan_thanh),
    parseDateTime(row.yc_giao),
  ].filter(Boolean);
  return candidates.find(date => date > startAt) || null;
}

function buildDelayRiskOrders(db) {
  const now = new Date();
  const benchmarks = buildRiskBenchmarks(db);
  const current = loadCurrentOrdersForRisk(db);
  const risks = [];

  for (const row of current.rows) {
    const startAt = parseDateTime(row.nhap_luc);
    const dueAt = startAt ? chooseValidDueAt(row, startAt) : null;
    if (!startAt || !dueAt) continue;

    const skip = getSkipStages(
      row.loai_lenh || '',
      row.ghi_chu || '',
      `${row.phuc_hinh || ''} ${row.ghi_chu_sx || ''}`
    );
    const stagesMap = parseStagesRaw(row.stages_raw);
    const stages = STAGE_NAMES.map((name, index) => {
      const s = stagesMap[index + 1] || {};
      return {
        n: name,
        k: s.k || '',
        x: isStageDone({ x: s.x, t: s.t }),
        t: s.t || '',
        sk: skip.includes(index),
      };
    });
    const activeStages = stages.filter(stage => !stage.sk);
    const total = activeStages.length;
    const done = activeStages.filter(stage => stage.x).length;
    if (!total || done >= total) continue;
    const latestDoneIndex = stages.reduce((latest, stage, index) => (
      !stage.sk && stage.x ? Math.max(latest, index) : latest
    ), -1);
    const currentStage = (
      stages.find((stage, index) => !stage.sk && !stage.x && index > latestDoneIndex)?.n ||
      'HOAN TAT'
    );

    const doneDates = activeStages
      .filter(stage => stage.x)
      .map(stage => parseDateTime(stage.t))
      .filter(Boolean);
    const anchorAt = doneDates.length
      ? doneDates.reduce((max, item) => item > max ? item : max, doneDates[0])
      : startAt;

    const key = `${total}:${done}`;
    const bench = benchmarks.byKey.get(key) || benchmarks.byKey.get(`${total}:0`);
    if (!bench?.p75) continue;

    const expectedFinishAt = new Date(anchorAt.getTime() + bench.p75 * 36e5);
    const medianFinishAt = bench.p50 ? new Date(anchorAt.getTime() + bench.p50 * 36e5) : null;
    const hoursUntilDue = hoursBetween(now, dueAt);
    const availableFromAnchorHours = hoursBetween(anchorAt, dueAt);
    const projectedLateHours = hoursBetween(dueAt, expectedFinishAt);
    const remainingModelHours = Math.max(0, hoursBetween(now, expectedFinishAt) || 0);
    const elapsedHours = Math.max(0, hoursBetween(startAt, now) || 0);
    const totalAvailableHours = Math.max(0, hoursBetween(startAt, dueAt) || 0);
    const progressPct = Math.round((done / total) * 100);
    const onTimeRate = rateAtOrBelow(bench.values, availableFromAnchorHours);
    const lateRate = onTimeRate == null ? null : 1 - onTimeRate;

    let severity = '';
    const reasons = [];
    if (hoursUntilDue <= 0) {
      severity = 'critical';
      reasons.push(`Qua han ${Math.abs(hoursUntilDue).toFixed(1)} gio`);
    } else if (lateRate != null && lateRate >= 0.80) {
      severity = 'critical';
      reasons.push(`Ca tuong tu tre ${(lateRate * 100).toFixed(0)}%`);
    } else if (lateRate != null && lateRate >= 0.55 && projectedLateHours >= 2) {
      severity = 'high';
      reasons.push(`Ca tuong tu tre ${(lateRate * 100).toFixed(0)}%`);
      reasons.push(`P75 du kien tre ${projectedLateHours.toFixed(1)} gio`);
    } else if (lateRate != null && lateRate >= 0.45 && projectedLateHours >= 3) {
      severity = 'watch';
      reasons.push(`Ca tuong tu tre ${(lateRate * 100).toFixed(0)}%`);
      reasons.push(`P75 du kien tre ${projectedLateHours.toFixed(1)} gio`);
    } else {
      continue;
    }

    if (done === 0) reasons.push('Chua xong cong doan nao');
    reasons.push(`Tien do ${done}/${total}, dang cho ${currentStage || 'cong doan tiep theo'}`);

    risks.push({
      ma_dh: row.ma_dh,
      severity,
      reasons,
      khach_hang: row.khach_hang || '',
      benh_nhan: row.benh_nhan || '',
      phuc_hinh: row.phuc_hinh || '',
      sl: Number(row.sl) || 0,
      loai_lenh: row.loai_lenh || '',
      nhap_luc: row.nhap_luc || '',
      due_at: formatDateTime(dueAt),
      expected_finish_at: formatDateTime(expectedFinishAt),
      median_finish_at: formatDateTime(medianFinishAt),
      current_stage: currentStage,
      done,
      total,
      progress_pct: progressPct,
      elapsed_hours: Number(elapsedHours.toFixed(1)),
      available_hours: Number(totalAvailableHours.toFixed(1)),
      available_from_anchor_hours: Number((availableFromAnchorHours || 0).toFixed(1)),
      hours_until_due: Number((hoursUntilDue || 0).toFixed(1)),
      projected_late_hours: Number((projectedLateHours || 0).toFixed(1)),
      remaining_model_hours: Number(remainingModelHours.toFixed(1)),
      similar_on_time_rate: onTimeRate == null ? null : Number(onTimeRate.toFixed(3)),
      similar_late_rate: lateRate == null ? null : Number(lateRate.toFixed(3)),
      benchmark: {
        key,
        n: bench.n,
        p50_hours: bench.p50 == null ? null : Number(bench.p50.toFixed(1)),
        p75_hours: bench.p75 == null ? null : Number(bench.p75.toFixed(1)),
        p90_hours: bench.p90 == null ? null : Number(bench.p90.toFixed(1)),
      },
    });
  }

  const severityRank = { critical: 0, high: 1, watch: 2 };
  risks.sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity] ||
    b.projected_late_hours - a.projected_late_hours ||
    a.due_at.localeCompare(b.due_at)
  );

  return {
    generatedAt: now.toISOString(),
    activeSource: current.activeSource,
    sampleOrders: benchmarks.sampleOrders,
    count: risks.length,
    counts: {
      critical: risks.filter(item => item.severity === 'critical').length,
      high: risks.filter(item => item.severity === 'high').length,
      watch: risks.filter(item => item.severity === 'watch').length,
    },
    data: risks,
  };
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

function productionWarningKey(warning) {
  const stable = JSON.stringify({ code: warning.code, detail: warning.detail || {} });
  const hash = crypto.createHash('sha1').update(stable).digest('hex').slice(0, 12);
  return `${warning.code}:${hash}`;
}

function loadProductionMatchReviews(db) {
  const rows = db.prepare(`
    SELECT ma_dh, warning_key, warning_code, status, note, reviewed_by, reviewed_at, updated_at
    FROM production_match_reviews
  `).all();
  return new Map(rows.map(row => [`${row.ma_dh}\u001f${row.warning_key}`, row]));
}

function loadProductionMatchRules(db) {
  const rows = db.prepare(`
    SELECT rule_id, name, warning_code, action, reason
    FROM production_match_rules
    WHERE active = 1
    ORDER BY id
  `).all();
  return rows.map(row => ({
    id: row.rule_id,
    name: row.name,
    warningCode: row.warning_code,
    action: row.action,
    reason: row.reason,
  }));
}

function buildProductionMatchWarnings(db) {
  const rows = db.prepare(`
    SELECT ma_dh, khach_hang, benh_nhan, phuc_hinh, sl, ghi_chu_sx, keylab_sx_info, updated_at
    FROM don_hang
    WHERE TRIM(COALESCE(ma_dh, '')) <> ''
      AND (
        TRIM(COALESCE(phuc_hinh, '')) <> ''
        OR TRIM(COALESCE(keylab_sx_info, '')) <> ''
      )
    ORDER BY COALESCE(updated_at, created_at, '') DESC, ma_dh DESC
    LIMIT 8000
  `).all();
  const reviews = loadProductionMatchReviews(db);
  const rules = loadProductionMatchRules(db);
  const items = [];

  for (const row of rows) {
    const analysis = analyzeProductionMatch(row);
    if (!analysis.warnings.length) continue;
    const base = compactAnalysisForApi(row, analysis);
    for (const warning of analysis.warnings) {
      const warningKey = productionWarningKey(warning);
      const review = reviews.get(`${row.ma_dh}\u001f${warningKey}`) || null;
      const baseItem = { ...base, updated_at: row.updated_at || '' };
      const matchedRule = review ? null : matchProductionRule(baseItem, warning, rules);
      items.push({
        ...baseItem,
        warning: {
          ...warning,
          key: warningKey,
          status: review?.status || (matchedRule ? 'suppressed' : 'open'),
          note: review?.note || '',
          reviewed_by: review?.reviewed_by || '',
          reviewed_at: review?.reviewed_at || '',
          rule: matchedRule ? {
            id: matchedRule.id,
            name: matchedRule.name,
            reason: matchedRule.reason,
          } : null,
        },
      });
    }
  }
  return items;
}

function summarizeProductionMatchWarnings(items) {
  const summary = {
    total: items.length,
    open: 0,
    resolved: 0,
    ignored: 0,
    suppressed: 0,
    byCode: {},
    bySeverity: {},
  };
  for (const item of items) {
    const status = item.warning.status || 'open';
    summary[status] = (summary[status] || 0) + 1;
    summary.byCode[item.warning.code] = (summary.byCode[item.warning.code] || 0) + 1;
    summary.bySeverity[item.warning.severity] = (summary.bySeverity[item.warning.severity] || 0) + 1;
  }
  return summary;
}

router.get('/admin/api/production-match', requirePermission('admin.users.manage'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const status = String(req.query.status || 'open').trim();
    const allowedStatuses = new Set(['open', 'resolved', 'ignored', 'suppressed', 'all']);
    if (!allowedStatuses.has(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
    const limit = Math.min(300, Math.max(1, parseInt(req.query.limit, 10) || 120));
    const allItems = buildProductionMatchWarnings(db);
    const filtered = status === 'all' ? allItems : allItems.filter(item => item.warning.status === status);
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      status,
      limit,
      summary: summarizeProductionMatchWarnings(allItems),
      warnings: filtered.slice(0, limit),
    });
  } catch (err) {
    log(`Production match error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.patch('/admin/api/production-match/review', requirePermission('admin.users.manage'), express.json(), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const maDh = String(req.body?.ma_dh || '').trim();
    const warningKey = String(req.body?.warning_key || '').trim();
    const warningCode = String(req.body?.warning_code || '').trim().slice(0, 80);
    const status = String(req.body?.status || '').trim();
    const note = String(req.body?.note || '').trim().slice(0, 500);
    if (!maDh || !warningKey) return res.status(400).json({ ok: false, error: 'Missing order or warning key' });
    if (!['open', 'resolved', 'ignored'].includes(status)) return res.status(400).json({ ok: false, error: 'Invalid status' });
    db.prepare(`
      INSERT INTO production_match_reviews
        (ma_dh, warning_key, warning_code, status, note, reviewed_by, reviewed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
      ON CONFLICT(ma_dh, warning_key) DO UPDATE SET
        warning_code = excluded.warning_code,
        status = excluded.status,
        note = excluded.note,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        updated_at = excluded.updated_at
    `).run(maDh, warningKey, warningCode, status, note, req.session.user || '');
    res.json({ ok: true, ma_dh: maDh, warning_key: warningKey, status });
  } catch (err) {
    log(`Production match review error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/admin/api/production-stats', requirePermission('stats.view_production'), (req, res) => {
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
    const stageOrder = STAGE_NAMES;
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

router.get('/admin/api/delay-risk-orders', requirePermission('stats.view_production'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const payload = buildDelayRiskOrders(db);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 80));
    res.json({ ok: true, ...payload, data: payload.data.slice(0, limit), limit });
  } catch (err) {
    log(`Delay risk error: ${err.message}`);
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

router.get('/admin/api/monthly-stats', requirePermission('stats.view_monthly'), (req, res) => {
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

// ── Clinic Tags ───────────────────────────────────────
const clinicTags = require('../repositories/clinicTags.repo');

// GET /admin/api/clinic-tags — list nha khoa + chips + label suggestions (admin only)
router.get('/admin/api/clinic-tags', requireAdmin, (req, res) => {
  try {
    res.json({
      ok: true,
      clinics: clinicTags.listClinicsWithCounts(),
      labels:  clinicTags.listAllLabels(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /admin/api/clinic-tags/:khach_hang — chips của 1 nha khoa
router.get('/admin/api/clinic-tags/:khach_hang', requirePermission('clinic_notes.edit'), (req, res) => {
  try {
    res.json({ ok: true, tags: clinicTags.listTagsByClinic(req.params.khach_hang) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /admin/api/clinic-tags — thêm chip
router.post('/admin/api/clinic-tags', express.json(), requirePermission('clinic_notes.edit'), (req, res) => {
  const { khach_hang, label } = req.body || {};
  try {
    const tag = clinicTags.addTag(khach_hang, label, req.session.user);
    log(`➕ clinic_tag added: "${label}" → "${khach_hang}" by ${req.session.user}`);
    res.json({ ok: true, tag });
  } catch (err) {
    if (err.code === 'DUPLICATE') return res.status(409).json({ ok: false, error: 'duplicate' });
    if (err.code === 'INVALID') return res.status(400).json({ ok: false, error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /admin/api/clinic-tags/:id — xoá chip (chỉ admin)
router.delete('/admin/api/clinic-tags/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ ok: false, error: 'Invalid id' });
  const deleted = clinicTags.deleteTag(id);
  if (!deleted) return res.status(404).json({ ok: false, error: 'Tag not found' });
  log(`🗑 clinic_tag id=${id} deleted by ${req.session.user}`);
  res.json({ ok: true });
});

module.exports = router;
