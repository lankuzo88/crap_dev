const Database = require('better-sqlite3');
const db = new Database('C:/Users/Administrator/Desktop/crap_dev/labo_data.db');

console.log('=== DATABASE HEALTH CHECK ===\n');

// 1. Integrity check
try {
  const integrity = db.pragma('integrity_check');
  console.log('✓ Integrity check:', integrity[0]?.integrity_check || 'OK');
} catch (e) {
  console.log('✗ Integrity check failed:', e.message);
}

// 2. WAL info before checkpoint
try {
  console.log('\n📊 WAL Status (before checkpoint):');
  const pageSize = db.pragma('page_size');
  const journalMode = db.pragma('journal_mode');
  console.log('  - Journal mode:', journalMode[0]?.journal_mode || 'unknown');
  console.log('  - Page size:', pageSize[0]?.page_size + ' bytes');
} catch (e) {
  console.log('✗ Failed:', e.message);
}

// 3. Execute checkpoint and get result
try {
  const checkpointResult = db.pragma('wal_checkpoint(TRUNCATE)');
  console.log('\n✓ WAL checkpoint (TRUNCATE) executed:');
  console.log('  - Busy: ' + checkpointResult.busy);
  console.log('  - Checkpoints: ' + checkpointResult.checkpoints);
  console.log('  - Pages: ' + checkpointResult.pages);
} catch (e) {
  console.log('✗ WAL checkpoint failed:', e.message);
}

// 4. Page count
try {
  const pageCount = db.pragma('page_count');
  console.log('\n✓ Page info:');
  console.log('  - Total pages: ' + pageCount[0]?.page_count);
} catch (e) {
  console.log('✗ Page info failed:', e.message);
}

// 5. Table stats
try {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all();

  console.log('\n✓ Tables (' + tables.length + '):');
  tables.forEach(t => {
    const count = db.prepare('SELECT COUNT(*) as n FROM `' + t.name + '`').get();
    console.log('  - ' + t.name + ': ' + count.n + ' rows');
  });
} catch (e) {
  console.log('✗ Table stats failed:', e.message);
}

db.close();
console.log('\n=== END CHECK ===');
