'use strict';
const { getDB } = require('./index');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

function initErrorTables() {
  const db = getDB();
  if (!db) { log('⚠ initErrorTables: DB not available'); return; }
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_loi TEXT NOT NULL,
      ten_loi TEXT NOT NULL,
      cong_doan TEXT NOT NULL,
      mo_ta TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS error_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ma_dh TEXT,
      error_code_id INTEGER,
      ma_loi_text TEXT,
      cong_doan TEXT,
      hinh_anh TEXT,
      mo_ta TEXT,
      trang_thai TEXT DEFAULT 'pending',
      submitted_by TEXT,
      submitted_at TEXT DEFAULT (datetime('now','localtime')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      ghi_chu_admin TEXT
    );
  `);
  log('✅ Error tables initialized');
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function initSessionsTable() {
  const db = getDB();
  if (!db) { log('⚠ initSessionsTable: DB not available'); return; }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
  `);
}

function initOrderBarcodeColumn() {
  const db = getDB();
  if (!db) { log('⚠ initOrderBarcodeColumn: DB not available'); return; }
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='don_hang'").get()) {
    log('⚠ initOrderBarcodeColumn: don_hang table not found');
    return;
  }
  if (!hasColumn(db, 'don_hang', 'barcode_labo')) {
    db.exec("ALTER TABLE don_hang ADD COLUMN barcode_labo TEXT DEFAULT ''");
    log('✅ Added don_hang.barcode_labo');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_don_hang_barcode_labo ON don_hang(barcode_labo)');
}

function parseCompletionDate(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return null;

  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      iso: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`,
    };
  }

  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    return {
      year: Number(m[3]),
      month: Number(m[2]),
      day: Number(m[1]),
      iso: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
    };
  }

  return null;
}

function addMonths(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function billingPeriodForCompletion(value) {
  const parsed = parseCompletionDate(value);
  if (!parsed) return null;

  const billing = parsed.day >= 26
    ? addMonths(parsed.year, parsed.month, 1)
    : { year: parsed.year, month: parsed.month };
  const prev = addMonths(billing.year, billing.month, -1);

  return {
    completionDate: parsed.iso,
    billingMonth: `${billing.year}-${String(billing.month).padStart(2, '0')}`,
    billingStart: `${prev.year}-${String(prev.month).padStart(2, '0')}-26`,
    billingEnd: `${billing.year}-${String(billing.month).padStart(2, '0')}-25`,
  };
}

function initMonthlyStatsTables() {
  const db = getDB();
  if (!db) { log('⚠ initMonthlyStatsTables: DB not available'); return; }

  db.exec(`
    CREATE TABLE IF NOT EXISTS ktv_monthly_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      billing_month TEXT NOT NULL,
      billing_start TEXT NOT NULL,
      billing_end TEXT NOT NULL,
      cong_doan TEXT NOT NULL,
      ten_ktv TEXT NOT NULL,
      orders_completed INTEGER DEFAULT 0,
      total_sl INTEGER DEFAULT 0,
      source_rows INTEGER DEFAULT 0,
      type_breakdown TEXT DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(billing_month, cong_doan, ten_ktv)
    );
    CREATE INDEX IF NOT EXISTS idx_ktv_monthly_stats_month ON ktv_monthly_stats(billing_month);
    CREATE INDEX IF NOT EXISTS idx_ktv_monthly_stats_ktv ON ktv_monthly_stats(ten_ktv);
    CREATE INDEX IF NOT EXISTS idx_ktv_monthly_stats_stage ON ktv_monthly_stats(cong_doan);

    CREATE TABLE IF NOT EXISTS ktv_monthly_type_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      billing_month TEXT NOT NULL,
      billing_start TEXT NOT NULL,
      billing_end TEXT NOT NULL,
      cong_doan TEXT NOT NULL,
      ten_ktv TEXT NOT NULL,
      loai_lenh TEXT NOT NULL,
      orders_completed INTEGER DEFAULT 0,
      total_sl INTEGER DEFAULT 0,
      source_rows INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(billing_month, cong_doan, ten_ktv, loai_lenh)
    );
    CREATE INDEX IF NOT EXISTS idx_ktv_monthly_type_month ON ktv_monthly_type_stats(billing_month);
    CREATE INDEX IF NOT EXISTS idx_ktv_monthly_type_ktv ON ktv_monthly_type_stats(ten_ktv);
    CREATE INDEX IF NOT EXISTS idx_ktv_monthly_type_stage ON ktv_monthly_type_stats(cong_doan);
    CREATE INDEX IF NOT EXISTS idx_ktv_monthly_type_order_type ON ktv_monthly_type_stats(loai_lenh);

    CREATE TABLE IF NOT EXISTS ktv_daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      completion_date TEXT NOT NULL,
      cong_doan TEXT NOT NULL,
      ten_ktv TEXT NOT NULL,
      orders_completed INTEGER DEFAULT 0,
      total_sl INTEGER DEFAULT 0,
      source_rows INTEGER DEFAULT 0,
      type_breakdown TEXT DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(completion_date, cong_doan, ten_ktv)
    );
    CREATE INDEX IF NOT EXISTS idx_ktv_daily_stats_date ON ktv_daily_stats(completion_date);
    CREATE INDEX IF NOT EXISTS idx_ktv_daily_stats_ktv ON ktv_daily_stats(ten_ktv);
    CREATE INDEX IF NOT EXISTS idx_ktv_daily_stats_stage ON ktv_daily_stats(cong_doan);

    CREATE TABLE IF NOT EXISTS ktv_daily_type_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      completion_date TEXT NOT NULL,
      cong_doan TEXT NOT NULL,
      ten_ktv TEXT NOT NULL,
      loai_lenh TEXT NOT NULL,
      orders_completed INTEGER DEFAULT 0,
      total_sl INTEGER DEFAULT 0,
      source_rows INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(completion_date, cong_doan, ten_ktv, loai_lenh)
    );
    CREATE INDEX IF NOT EXISTS idx_ktv_daily_type_date ON ktv_daily_type_stats(completion_date);
    CREATE INDEX IF NOT EXISTS idx_ktv_daily_type_ktv ON ktv_daily_type_stats(ten_ktv);
    CREATE INDEX IF NOT EXISTS idx_ktv_daily_type_stage ON ktv_daily_type_stats(cong_doan);
    CREATE INDEX IF NOT EXISTS idx_ktv_daily_type_order_type ON ktv_daily_type_stats(loai_lenh);
  `);
  if (!hasColumn(db, 'ktv_monthly_stats', 'type_breakdown')) {
    db.exec('ALTER TABLE ktv_monthly_stats ADD COLUMN type_breakdown TEXT DEFAULT "{}"');
  }

  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tien_do_history'").get()) {
    if (!hasColumn(db, 'tien_do_history', 'billing_month')) db.exec('ALTER TABLE tien_do_history ADD COLUMN billing_month TEXT DEFAULT ""');
    if (!hasColumn(db, 'tien_do_history', 'billing_start')) db.exec('ALTER TABLE tien_do_history ADD COLUMN billing_start TEXT DEFAULT ""');
    if (!hasColumn(db, 'tien_do_history', 'billing_end')) db.exec('ALTER TABLE tien_do_history ADD COLUMN billing_end TEXT DEFAULT ""');
    if (!hasColumn(db, 'tien_do_history', 'completion_date')) db.exec('ALTER TABLE tien_do_history ADD COLUMN completion_date TEXT DEFAULT ""');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tdh_billing_month ON tien_do_history(billing_month)');
  }

  refreshMonthlyStats();
  log('✅ Monthly stats tables initialized');
}

function normalizeOrderType(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
  if (!normalized) return 'Khác';
  if (normalized.includes('lam moi')) return 'Làm mới';
  if (normalized.includes('lam them')) return 'Làm thêm';
  if (normalized.includes('lam lai')) return 'Làm lại';
  if (normalized.includes('bao hanh')) return 'Bảo hành';
  if (normalized.includes('sua')) return 'Sửa';
  if (normalized.includes('lam tiep')) return 'Làm tiếp';
  return raw;
}

function addTypeBreakdown(bucket, type, qty, maDh) {
  const key = normalizeOrderType(type);
  if (!bucket.type_breakdown[key]) {
    bucket.type_breakdown[key] = { qty: 0, orders: 0, rows: 0, orderSet: new Set() };
  }
  const item = bucket.type_breakdown[key];
  item.qty += Number(qty) || 0;
  item.rows += 1;
  item.orderSet.add(maDh);
  item.orders = item.orderSet.size;
}

function serializeTypeBreakdown(typeBreakdown) {
  const out = {};
  for (const [key, value] of Object.entries(typeBreakdown || {})) {
    out[key] = {
      qty: value.qty || 0,
      orders: value.orders || 0,
      rows: value.rows || 0,
    };
  }
  return JSON.stringify(out);
}

function refreshMonthlyStats() {
  const db = getDB();
  if (!db) return;

  const hasHistory = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tien_do_history'").get();
  if (hasHistory) syncCurrentProgressToHistory(db);

  const sourceRows = hasHistory
    ? db.prepare(`
        SELECT id, ma_dh, thu_tu, cong_doan, ten_ktv, thoi_gian_hoan_thanh, COALESCE(so_luong, 0) AS sl,
               COALESCE(loai_lenh, '') AS loai_lenh, COALESCE(imported_at, '') AS imported_at
        FROM tien_do_history
        WHERE TRIM(COALESCE(ten_ktv, '')) NOT IN ('', '-')
          AND TRIM(COALESCE(thoi_gian_hoan_thanh, '')) NOT IN ('', '-')
      `).all()
    : db.prepare(`
        SELECT NULL AS id, t.ma_dh, t.thu_tu, t.cong_doan, t.ten_ktv, t.thoi_gian_hoan_thanh,
               COALESCE(d.sl, 0) AS sl, COALESCE(d.loai_lenh, '') AS loai_lenh, COALESCE(t.updated_at, '') AS imported_at
        FROM tien_do t
        LEFT JOIN don_hang d ON d.ma_dh = t.ma_dh
        WHERE TRIM(COALESCE(t.ten_ktv, '')) NOT IN ('', '-')
          AND TRIM(COALESCE(t.thoi_gian_hoan_thanh, '')) NOT IN ('', '-')
      `).all();

  const monthly = new Map();
  const daily = new Map();
  const updateHistory = hasHistory && hasColumn(db, 'tien_do_history', 'billing_month')
    ? db.prepare(`
        UPDATE tien_do_history
        SET billing_month = ?, billing_start = ?, billing_end = ?, completion_date = ?
        WHERE id = ?
      `)
    : null;

  const tx = db.transaction(rows => {
    const latestByOrderStage = new Map();
    for (const row of rows) {
      const key = [row.ma_dh, row.thu_tu, row.cong_doan].join('\u001f');
      const prev = latestByOrderStage.get(key);
      if (!prev || String(row.imported_at || '').localeCompare(String(prev.imported_at || '')) >= 0) {
        latestByOrderStage.set(key, row);
      }
    }

    for (const row of latestByOrderStage.values()) {
      const period = billingPeriodForCompletion(row.thoi_gian_hoan_thanh);
      if (!period) continue;

      if (updateHistory && row.id) {
        updateHistory.run(period.billingMonth, period.billingStart, period.billingEnd, period.completionDate, row.id);
      }

      const key = [period.billingMonth, row.cong_doan || 'Khác', row.ten_ktv || 'Không rõ'].join('\u001f');
      if (!monthly.has(key)) {
        monthly.set(key, {
          ...period,
          cong_doan: row.cong_doan || 'Khác',
          ten_ktv: row.ten_ktv || 'Không rõ',
          total_sl: 0,
          source_rows: 0,
          orders: new Set(),
          type_breakdown: {},
        });
      }

      const bucket = monthly.get(key);
      bucket.total_sl += Number(row.sl) || 0;
      bucket.source_rows += 1;
      bucket.orders.add(row.ma_dh);
      addTypeBreakdown(bucket, row.loai_lenh, row.sl, row.ma_dh);

      const dailyKey = [period.completionDate, row.cong_doan || 'Khác', row.ten_ktv || 'Không rõ'].join('\u001f');
      if (!daily.has(dailyKey)) {
        daily.set(dailyKey, {
          completionDate: period.completionDate,
          cong_doan: row.cong_doan || 'Khác',
          ten_ktv: row.ten_ktv || 'Không rõ',
          total_sl: 0,
          source_rows: 0,
          orders: new Set(),
          type_breakdown: {},
        });
      }

      const dailyBucket = daily.get(dailyKey);
      dailyBucket.total_sl += Number(row.sl) || 0;
      dailyBucket.source_rows += 1;
      dailyBucket.orders.add(row.ma_dh);
      addTypeBreakdown(dailyBucket, row.loai_lenh, row.sl, row.ma_dh);
    }

    db.prepare('DELETE FROM ktv_monthly_stats').run();
    db.prepare('DELETE FROM ktv_monthly_type_stats').run();
    db.prepare('DELETE FROM ktv_daily_stats').run();
    db.prepare('DELETE FROM ktv_daily_type_stats').run();

    const insertMonthly = db.prepare(`
      INSERT INTO ktv_monthly_stats
        (billing_month, billing_start, billing_end, cong_doan, ten_ktv, orders_completed, total_sl, source_rows, type_breakdown, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `);
    const insertMonthlyType = db.prepare(`
      INSERT INTO ktv_monthly_type_stats
        (billing_month, billing_start, billing_end, cong_doan, ten_ktv, loai_lenh, orders_completed, total_sl, source_rows, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `);
    const insertDaily = db.prepare(`
      INSERT INTO ktv_daily_stats
        (completion_date, cong_doan, ten_ktv, orders_completed, total_sl, source_rows, type_breakdown, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `);
    const insertDailyType = db.prepare(`
      INSERT INTO ktv_daily_type_stats
        (completion_date, cong_doan, ten_ktv, loai_lenh, orders_completed, total_sl, source_rows, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `);

    for (const item of monthly.values()) {
      insertMonthly.run(
        item.billingMonth,
        item.billingStart,
        item.billingEnd,
        item.cong_doan,
        item.ten_ktv,
        item.orders.size,
        item.total_sl,
        item.source_rows,
        serializeTypeBreakdown(item.type_breakdown),
      );
      for (const [type, stats] of Object.entries(item.type_breakdown)) {
        insertMonthlyType.run(
          item.billingMonth,
          item.billingStart,
          item.billingEnd,
          item.cong_doan,
          item.ten_ktv,
          type,
          stats.orders || 0,
          stats.qty || 0,
          stats.rows || 0,
        );
      }
    }

    for (const item of daily.values()) {
      insertDaily.run(
        item.completionDate,
        item.cong_doan,
        item.ten_ktv,
        item.orders.size,
        item.total_sl,
        item.source_rows,
        serializeTypeBreakdown(item.type_breakdown),
      );
      for (const [type, stats] of Object.entries(item.type_breakdown)) {
        insertDailyType.run(
          item.completionDate,
          item.cong_doan,
          item.ten_ktv,
          type,
          stats.orders || 0,
          stats.qty || 0,
          stats.rows || 0,
        );
      }
    }
  });

  tx(sourceRows);
}

function syncCurrentProgressToHistory(db) {
  const hasBillingColumns = hasColumn(db, 'tien_do_history', 'billing_month');
  const rows = db.prepare(`
    SELECT t.ma_dh, t.thu_tu, t.cong_doan, t.ten_ktv, t.xac_nhan, t.thoi_gian_hoan_thanh,
           d.nhap_luc, d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl, d.loai_lenh,
           d.tai_khoan_cao, t.raw_row_text
    FROM tien_do t
    LEFT JOIN don_hang d ON d.ma_dh = t.ma_dh
  `).all();

  const insert = hasBillingColumns
    ? db.prepare(`
        INSERT OR IGNORE INTO tien_do_history
          (ma_dh, thu_tu, cong_doan, ten_ktv, xac_nhan, thoi_gian_hoan_thanh,
           ngay_nhan, ma_kh, ten_nha_khoa, bac_si, benh_nhan, phuc_hinh, so_luong,
           loai_lenh, loai_phuc_hinh, tai_khoan_cao, raw_row_text,
           billing_month, billing_start, billing_end, completion_date)
        VALUES
          (@ma_dh, @thu_tu, @cong_doan, @ten_ktv, @xac_nhan, @thoi_gian_hoan_thanh,
           @ngay_nhan, '', @ten_nha_khoa, '', @benh_nhan, @phuc_hinh, @so_luong,
           @loai_lenh, '', @tai_khoan_cao, @raw_row_text,
           @billing_month, @billing_start, @billing_end, @completion_date)
      `)
    : db.prepare(`
        INSERT OR IGNORE INTO tien_do_history
          (ma_dh, thu_tu, cong_doan, ten_ktv, xac_nhan, thoi_gian_hoan_thanh,
           ngay_nhan, ma_kh, ten_nha_khoa, bac_si, benh_nhan, phuc_hinh, so_luong,
           loai_lenh, loai_phuc_hinh, tai_khoan_cao, raw_row_text)
        VALUES
          (@ma_dh, @thu_tu, @cong_doan, @ten_ktv, @xac_nhan, @thoi_gian_hoan_thanh,
           @ngay_nhan, '', @ten_nha_khoa, '', @benh_nhan, @phuc_hinh, @so_luong,
           @loai_lenh, '', @tai_khoan_cao, @raw_row_text)
      `);

  const tx = db.transaction(items => {
    for (const row of items) {
      const period = billingPeriodForCompletion(row.thoi_gian_hoan_thanh) || {};
      insert.run({
        ma_dh: row.ma_dh || '',
        thu_tu: row.thu_tu || 0,
        cong_doan: row.cong_doan || '',
        ten_ktv: row.ten_ktv || '',
        xac_nhan: row.xac_nhan || '',
        thoi_gian_hoan_thanh: row.thoi_gian_hoan_thanh || '',
        ngay_nhan: row.nhap_luc || '',
        ten_nha_khoa: row.khach_hang || '',
        benh_nhan: row.benh_nhan || '',
        phuc_hinh: row.phuc_hinh || '',
        so_luong: Number(row.sl) || 0,
        loai_lenh: row.loai_lenh || '',
        tai_khoan_cao: row.tai_khoan_cao || '',
        raw_row_text: row.raw_row_text || '',
        billing_month: period.billingMonth || '',
        billing_start: period.billingStart || '',
        billing_end: period.billingEnd || '',
        completion_date: period.completionDate || '',
      });
    }
  });

  tx(rows);
}

module.exports = { initErrorTables, initSessionsTable, initOrderBarcodeColumn, initMonthlyStatsTables, refreshMonthlyStats, billingPeriodForCompletion, normalizeOrderType };
