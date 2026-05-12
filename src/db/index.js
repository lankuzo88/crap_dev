'use strict';
const fs       = require('fs');
const Database = require('better-sqlite3');
const { DB_PATH } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

let _db = null;
let walCheckpointInterval = null;

function getDB() {
  if (!_db) {
    if (!fs.existsSync(DB_PATH)) return null;
    try {
      _db = new Database(DB_PATH, { readonly: false });
      _db.pragma('journal_mode = WAL');
      _db.pragma('busy_timeout = 5000');
    } catch (e) {
      log(`⚠ SQLite open error: ${e.message}`);
      return null;
    }
  }
  return _db;
}

function closeDB() {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
  }
}

function dbHasData() {
  const db = getDB();
  if (!db) return false;
  try {
    const row = db.prepare('SELECT COUNT(*) as n FROM don_hang').get();
    return row && row.n > 0;
  } catch { return false; }
}

function startWALCheckpoint() {
  const CHECKPOINT_INTERVAL = 30 * 60 * 1000;
  walCheckpointInterval = setInterval(() => {
    const db = getDB();
    if (db) {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
        log(`[WAL] Checkpoint completed at ${new Date().toISOString()}`);
      } catch (err) {
        log(`[WAL] Checkpoint error: ${err.message}`);
      }
    }
  }, CHECKPOINT_INTERVAL);
  log(`[WAL] Checkpoint started (every 30 minutes)`);
}

function stopWALCheckpoint() {
  if (walCheckpointInterval) {
    clearInterval(walCheckpointInterval);
    walCheckpointInterval = null;
    log(`[WAL] Checkpoint stopped`);
  }
}

module.exports = { getDB, closeDB, dbHasData, startWALCheckpoint, stopWALCheckpoint };
