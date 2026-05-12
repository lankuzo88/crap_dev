'use strict';
/**
 * ASIA LAB - Server entry point (refactored)
 * Main application wiring lives in src/app.js.
 */
const app = require('./src/app');
const { PORT } = require('./src/config/env');
const { loadUsers } = require('./src/repositories/users.repo');
const { loadSessions } = require('./src/services/session.service');
const { initErrorTables, initSessionsTable, initOrderBarcodeColumn, initRoutedToColumn, initKeylabNotesRouting, initMonthlyStatsTables } = require('./src/db/migrations');
const { startImageCleanupSchedule } = require('./src/services/image.service');
const { startWALCheckpoint } = require('./src/db/index');
const { getData, findLatest } = require('./src/repositories/orders.repo');
const { EXCEL_DIR, DB_PATH } = require('./src/config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

loadUsers();
loadSessions();
initErrorTables();
initSessionsTable();
initOrderBarcodeColumn();
initRoutedToColumn();
initKeylabNotesRouting();
initMonthlyStatsTables();
startImageCleanupSchedule();

app.listen(PORT, '127.0.0.1', () => {
  const latestExport = findLatest(EXCEL_DIR, ['.xls', '.xlsx', '.xlsm']);

  console.log('');
  console.log('  ASIA LAB Dashboard Server (refactored)');
  console.log('  ---------------------------------------');
  console.log(`  URL        : http://localhost:${PORT}`);
  console.log(`  Excel dir  : ${EXCEL_DIR}`);
  console.log(`  Export moi : ${latestExport?.name || 'Chua co file'}`);
  console.log(`  DB         : ${DB_PATH}`);
  console.log(`  Reload     : http://localhost:${PORT}/reload`);
  console.log(`  Status     : http://localhost:${PORT}/status`);
  console.log('');
  console.log('  Nhan Ctrl+C de dung');
  console.log('');

  startWALCheckpoint();
  try { getData(); } catch (e) { log(`Pre-load warning: ${e.message}`); }
});
