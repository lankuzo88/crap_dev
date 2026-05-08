'use strict';
/**
 * ASIA LAB — Server entry point (refactored)
 * Tách module: src/app.js
 */
const app = require('./src/app');
const { PORT } = require('./src/config/env');
const { loadUsers }  = require('./src/repositories/users.repo');
const { loadSessions } = require('./src/services/session.service');
const { initErrorTables } = require('./src/db/migrations');
const { startImageCleanupSchedule } = require('./src/services/image.service');
const { startWALCheckpoint } = require('./src/db/index');
const { getData } = require('./src/repositories/orders.repo');
const { findLatest } = require('./src/repositories/orders.repo');
const { EXCEL_DIR, DB_PATH } = require('./src/config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

// ── Bootstrap ─────────────────────────────────────────
loadUsers();
loadSessions();
initErrorTables();
startImageCleanupSchedule();
// startExcelWatcher(); // Disabled: dùng auto_scrape_headless.py qua PM2

// ── Start server ──────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  const latestExport = findLatest(EXCEL_DIR, ['.xls', '.xlsx', '.xlsm']);

  console.log('');
  console.log('  🦷  ASIA LAB Dashboard Server (refactored)');
  console.log('  ──────────────────────────────────────');
  console.log(`  URL        : http://localhost:${PORT}`);
  console.log(`  Excel dir  : ${EXCEL_DIR}`);
  console.log(`  Export mới : ${latestExport?.name || '⚠ Chưa có file'}`);
  console.log(`  DB         : ${DB_PATH}`);
  console.log(`  Reload     : http://localhost:${PORT}/reload`);
  console.log(`  Status     : http://localhost:${PORT}/status`);
  console.log('');
  console.log('  Nhấn Ctrl+C để dừng');
  console.log('');

  startWALCheckpoint();
  try { getData(); } catch (e) { log(`⚠ Pre-load: ${e.message}`); }
});
