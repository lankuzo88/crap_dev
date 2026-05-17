'use strict';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function addMonths(monthKey, delta) {
  const [year, month] = String(monthKey).split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function currentBillingMonth(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const billingDate = now.getDate() >= 26 ? new Date(year, month, 1) : now;
  return `${billingDate.getFullYear()}-${pad2(billingDate.getMonth() + 1)}`;
}

function periodForBillingMonth(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  if (!year || !month) return null;
  const end = new Date(year, month - 1, 25);
  const start = new Date(year, month - 2, 26);
  const dateKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return {
    billing_month: `${year}-${pad2(month)}`,
    billing_start: dateKey(start),
    billing_end: dateKey(end),
    label: `Tháng ${month}/${year}`,
    range: `${pad2(start.getDate())}/${pad2(start.getMonth() + 1)}-${pad2(end.getDate())}/${pad2(end.getMonth() + 1)}`,
  };
}

function safePct(part, total) {
  return total > 0 ? Math.round((Number(part) || 0) * 1000 / total) / 10 : 0;
}

function pctChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round((current - previous) * 1000 / previous) / 10;
}

function avgReviewHours(rows) {
  const reviewed = rows
    .map(row => {
      if (!row.submitted_at || !row.reviewed_at) return null;
      const submitted = new Date(String(row.submitted_at).replace(' ', 'T'));
      const reviewedAt = new Date(String(row.reviewed_at).replace(' ', 'T'));
      const diff = reviewedAt - submitted;
      return Number.isFinite(diff) && diff >= 0 ? diff / 3600000 : null;
    })
    .filter(value => value !== null);
  if (!reviewed.length) return null;
  const avg = reviewed.reduce((sum, value) => sum + value, 0) / reviewed.length;
  return Math.round(avg * 10) / 10;
}

function groupCount(rows, keyFn, limit = 0) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'Không rõ';
    map.set(key, (map.get(key) || 0) + 1);
  }
  const data = Array.from(map, ([name, n]) => ({ name, n }))
    .sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name), 'vi'));
  return limit > 0 ? data.slice(0, limit) : data;
}

function summarizeRows(rows, previousRows) {
  const total = rows.length;
  const confirmed = rows.filter(row => row.trang_thai === 'confirmed').length;
  const rejected = rows.filter(row => row.trang_thai === 'rejected').length;
  const pending = rows.filter(row => row.trang_thai === 'pending').length;
  const uniqueOrders = new Set(rows.map(row => row.ma_dh).filter(Boolean)).size;
  return {
    total,
    pending,
    confirmed,
    rejected,
    unique_orders: uniqueOrders,
    previous_total: previousRows.length,
    change_pct: pctChange(total, previousRows.length),
    confirmed_rate: safePct(confirmed, total),
    rejected_rate: safePct(rejected, total),
    avg_review_hours: avgReviewHours(rows),
  };
}

function getAvailableMonths(db, tableName) {
  const rows = db.prepare(`
    SELECT strftime('%Y-%m', date(substr(submitted_at, 1, 10), '+6 days')) AS billing_month,
           COUNT(*) AS n
    FROM ${tableName}
    WHERE submitted_at IS NOT NULL AND submitted_at <> ''
    GROUP BY billing_month
    ORDER BY billing_month DESC
  `).all();
  const current = currentBillingMonth();
  if (!rows.some(row => row.billing_month === current)) rows.unshift({ billing_month: current, n: 0 });
  return rows.map(row => ({ ...row, period: periodForBillingMonth(row.billing_month) }));
}

function loadRowsForPeriod(db, tableName, period) {
  return db.prepare(`
    SELECT *
    FROM ${tableName}
    WHERE date(substr(submitted_at, 1, 10)) BETWEEN date(?) AND date(?)
    ORDER BY submitted_at DESC
  `).all(period.billing_start, period.billing_end);
}

function buildTechnicalErrorMonthlyStats(db, requestedMonth) {
  const months = getAvailableMonths(db, 'error_reports');
  const month = /^\d{4}-\d{2}$/.test(String(requestedMonth || ''))
    ? requestedMonth
    : (months[0]?.billing_month || currentBillingMonth());
  const period = periodForBillingMonth(month);
  const previousPeriod = periodForBillingMonth(addMonths(month, -1));
  const rows = loadRowsForPeriod(db, 'error_reports', period);
  const previousRows = loadRowsForPeriod(db, 'error_reports', previousPeriod);

  return {
    month,
    period,
    previous_period: previousPeriod,
    months,
    summary: summarizeRows(rows, previousRows),
    by_status: groupCount(rows, row => row.trang_thai || 'pending'),
    by_stage: groupCount(rows, row => row.cong_doan),
    by_user: groupCount(rows, row => row.submitted_by),
    top_errors: groupCount(rows, row => row.ma_loi_text, 10),
    recent: rows.slice(0, 12),
  };
}

function buildDelayMonthlyStats(db, requestedMonth) {
  const months = getAvailableMonths(db, 'delay_reports');
  const month = /^\d{4}-\d{2}$/.test(String(requestedMonth || ''))
    ? requestedMonth
    : (months[0]?.billing_month || currentBillingMonth());
  const period = periodForBillingMonth(month);
  const previousPeriod = periodForBillingMonth(addMonths(month, -1));
  const rows = loadRowsForPeriod(db, 'delay_reports', period);
  const previousRows = loadRowsForPeriod(db, 'delay_reports', previousPeriod);

  return {
    month,
    period,
    previous_period: previousPeriod,
    months,
    summary: summarizeRows(rows, previousRows),
    by_status: groupCount(rows, row => row.trang_thai || 'pending'),
    by_stage: groupCount(rows, row => row.cong_doan_bao_tre),
    by_user: groupCount(rows, row => row.submitted_by),
    top_reasons: groupCount(rows, row => row.nguyen_nhan, 10),
    recent: rows.slice(0, 12),
  };
}

module.exports = {
  periodForBillingMonth,
  currentBillingMonth,
  buildTechnicalErrorMonthlyStats,
  buildDelayMonthlyStats,
};
