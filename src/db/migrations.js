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

module.exports = { initErrorTables };
