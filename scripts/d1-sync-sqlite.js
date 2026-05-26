'use strict';
require('../src/config/env');
const Database = require('better-sqlite3');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('../src/config/paths');
const env = require('../src/config/env');
const { queryD1Async } = require('../src/db/d1-http-sync');

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const prefix = `--${name}=`;
  const found = args.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const hasArg = name => args.includes(`--${name}`);

const directionArg = getArg('direction', 'auto').toLowerCase();
const loop = hasArg('loop');
const dryRun = hasArg('dry-run');
const replaceTarget = hasArg('replace');
const forceFull = hasArg('full');
const intervalSec = Math.max(10, Number(getArg('interval', '60')) || 60);
const batchRows = Math.max(1, Number(getArg('batch-rows', '100')) || 100);
const fetchRows = Math.max(1, Number(getArg('fetch-rows', '500')) || 500);
const fullSyncHours = Math.max(1, Number(getArg('full-sync-hours', '24')) || 24);
const tableArg = getArg('tables', '');
const excludeArg = getArg('exclude', '');

const BASE_TABLE_ORDER = [
  'analytics_daily',
  'error_codes',
  'feedback_types',
  'don_hang',
  'clinic_tags',
  'import_log',
  'ktv_daily_stats',
  'ktv_daily_type_stats',
  'ktv_monthly_stats',
  'ktv_monthly_type_stats',
  'ktv_performance',
  'tien_do',
  'tien_do_history',
  'delay_reports',
  'error_reports',
  'feedbacks',
  'sessions',
];

// Per-table sync strategy. Tables not listed default to 'full' (safe fallback).
// 'incremental' requires a monotonic watermark column.
const TABLE_CONFIG = {
  don_hang:               { mode: 'incremental', col: 'updated_at',   type: 'text' },
  tien_do:                { mode: 'incremental', col: 'updated_at',   type: 'text' },
  tien_do_history:        { mode: 'incremental', col: 'updated_at',   type: 'text' },
  ktv_daily_stats:        { mode: 'incremental', col: 'updated_at',   type: 'text' },
  ktv_daily_type_stats:   { mode: 'incremental', col: 'updated_at',   type: 'text' },
  ktv_monthly_stats:      { mode: 'incremental', col: 'updated_at',   type: 'text' },
  ktv_monthly_type_stats: { mode: 'incremental', col: 'updated_at',   type: 'text' },
  feedbacks:              { mode: 'incremental', col: 'updated_at',   type: 'text' },
  import_log:             { mode: 'incremental', col: 'id',           type: 'int'  },
  // Small / static / no-watermark tables: full sync each cycle is cheap.
  analytics_daily:        { mode: 'full' },
  clinic_tags:            { mode: 'full' },
  delay_reports:          { mode: 'full' },
  error_codes:            { mode: 'full' },
  error_reports:          { mode: 'full' },
  feedback_types:         { mode: 'full' },
  ktv_performance:        { mode: 'full' },
  sessions:               { mode: 'full' },
};

const STATE_PATH = path.join(path.dirname(DB_PATH), '.d1-sync-state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      if (raw && typeof raw === 'object') {
        return {
          version: raw.version || 1,
          last_full_sync_at: raw.last_full_sync_at || null,
          tables: raw.tables && typeof raw.tables === 'object' ? raw.tables : {},
        };
      }
    }
  } catch (err) {
    log(`state file unreadable, treating as empty: ${err.message}`);
  }
  return { version: 1, last_full_sync_at: null, tables: {} };
}

function saveState(state) {
  if (dryRun) { log(`[dry-run] would save state to ${STATE_PATH}`); return; }
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_PATH);
}

function isFullSyncDue(state) {
  if (forceFull || replaceTarget) return true;
  if (!state.last_full_sync_at) return true;
  const ageMs = Date.now() - new Date(state.last_full_sync_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return true;
  return ageMs > fullSyncHours * 3600 * 1000;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function makeSchemaSqlIdempotent(sql) {
  return String(sql || '')
    .replace(/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
    .replace(/^CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE INDEX IF NOT EXISTS ');
}

function openSqlite(readonly = false) {
  return new Database(DB_PATH, { readonly });
}

function sqliteSidecar(suffix) {
  return path.join(path.dirname(DB_PATH), `${path.basename(DB_PATH)}${suffix}`);
}

function getSqliteTables(db) {
  const existing = new Set(db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
  `).all().map(row => row.name));
  const ordered = BASE_TABLE_ORDER.filter(table => existing.has(table));
  for (const table of existing) {
    if (!ordered.includes(table)) ordered.push(table);
  }
  const selected = tableArg
    ? new Set(tableArg.split(',').map(s => s.trim()).filter(Boolean))
    : null;
  const excluded = new Set(excludeArg.split(',').map(s => s.trim()).filter(Boolean));
  return ordered.filter(table => (!selected || selected.has(table)) && !excluded.has(table));
}

function getSqliteColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map(col => col.name);
}

function getSqliteSchema(db, tables) {
  const tableSet = new Set(tables);
  const schema = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name
  `).all();
  return schema.filter(row => tableSet.has(row.type === 'table' ? row.name : row.tbl_name));
}

function createSqliteMirrorDb(schemaRows) {
  const tmpPath = sqliteSidecar('.sync.tmp');
  for (const file of [tmpPath, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
  const tmpDb = new Database(tmpPath);
  tmpDb.pragma('journal_mode = DELETE');
  tmpDb.pragma('foreign_keys = OFF');
  for (const row of schemaRows.filter(row => row.type === 'table')) {
    tmpDb.exec(row.sql);
  }
  for (const row of schemaRows.filter(row => row.type !== 'table')) {
    tmpDb.exec(row.sql);
  }
  tmpDb.pragma('foreign_keys = ON');
  return { tmpDb, tmpPath };
}

function replaceSqliteDb(tmpPath) {
  const backupPath = sqliteSidecar(`.sync.backup.${Date.now()}`);
  for (const file of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
  if (fs.existsSync(DB_PATH)) fs.renameSync(DB_PATH, backupPath);
  fs.renameSync(tmpPath, DB_PATH);
  for (const file of [backupPath, `${backupPath}-wal`, `${backupPath}-shm`, `${tmpPath}-wal`, `${tmpPath}-shm`]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
}

async function ensureD1Schema(db, tables) {
  // Triggers là local concern (auto-bump updated_at). D1 không cần — payload đẩy lên
  // đã có updated_at sẵn từ trigger fire ở SQLite. Bỏ ra để tránh "already exists".
  const rows = getSqliteSchema(db, tables).filter(row => row.type !== 'trigger');
  for (const row of rows) {
    if (dryRun) log(`[dry-run] D1 schema ${row.type} ${row.name}`);
    else await queryD1Async(makeSchemaSqlIdempotent(row.sql));
  }
  await ensureD1ColumnDrift(db, tables);
}

// CREATE TABLE IF NOT EXISTS không cập nhật cột cho table đã tồn tại trên D1.
// Khi local thêm cột (vd updated_at vào tien_do_history), D1 vẫn schema cũ và INSERT
// payload mới sẽ fail. Đối chiếu PRAGMA table_info hai bên, ALTER ADD COLUMN cho cột thiếu.
async function ensureD1ColumnDrift(db, tables) {
  for (const table of tables) {
    let d1Info;
    try {
      const res = await queryD1Async(`PRAGMA table_info(${quoteIdent(table)})`);
      d1Info = res.results || [];
    } catch (err) {
      log(`column drift check skipped for ${table}: ${err.message}`);
      continue;
    }
    if (!d1Info.length) continue; // CREATE TABLE ở trên sẽ lo phần này
    const d1Cols = new Set(d1Info.map(r => r.name));
    const localInfo = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
    for (const col of localInfo) {
      if (d1Cols.has(col.name)) continue;
      // SQLite ALTER cấm DEFAULT là expression. Bỏ DEFAULT cho an toàn; row mới
      // từ sync sẽ điền giá trị từ payload, row cũ trên D1 nhận NULL.
      const alterSql = `ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${quoteIdent(col.name)} ${col.type || 'TEXT'}`;
      if (dryRun) log(`[dry-run] D1 ${alterSql}`);
      else {
        try {
          await queryD1Async(alterSql);
          log(`D1 added column ${table}.${col.name}`);
        } catch (err) {
          if (!/duplicate column/i.test(err.message)) throw err;
        }
      }
    }
  }
}

async function clearD1Tables(tables) {
  for (const table of [...tables].reverse()) {
    const sql = `DELETE FROM ${quoteIdent(table)}`;
    if (dryRun) log(`[dry-run] D1 ${sql}`);
    else await queryD1Async(sql);
  }
}

function clearSqliteTables(db, tables) {
  db.pragma('foreign_keys = OFF');
  const clear = db.transaction(() => {
    for (const table of [...tables].reverse()) {
      if (dryRun) log(`[dry-run] SQLite DELETE FROM ${table}`);
      else db.prepare(`DELETE FROM ${quoteIdent(table)}`).run();
    }
  });
  clear();
  db.pragma('foreign_keys = ON');
}

async function insertRowsToD1(table, columns, rows) {
  if (!rows.length) return;
  let batch = [];
  let approxSqlSize = 0;
  const flush = async () => {
    if (!batch.length) return;
    const tuples = batch.map(row => `(${columns.map(col => sqlLiteral(row[col])).join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES ${tuples}`;
    if (dryRun) log(`[dry-run] D1 upsert ${table}: ${batch.length}`);
    else await queryD1Async(sql);
    batch = [];
    approxSqlSize = 0;
  };

  for (const row of rows) {
    batch.push(row);
    approxSqlSize += columns.reduce((n, col) => n + String(row[col] ?? '').length + 8, 0);
    if (batch.length >= batchRows || approxSqlSize >= 85000) await flush();
  }
  await flush();
}

function insertRowsToSqlite(db, table, columns, rows) {
  if (!rows.length) return;
  const sql = `INSERT OR REPLACE INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
  const stmt = db.prepare(sql);
  const insert = db.transaction(batch => {
    for (const row of batch) stmt.run(columns.map(col => row[col]));
  });
  for (let i = 0; i < rows.length; i += batchRows) {
    const batch = rows.slice(i, i + batchRows);
    if (dryRun) log(`[dry-run] SQLite upsert ${table}: ${batch.length}`);
    else insert(batch);
  }
}

async function copySqliteToD1(db, table) {
  const columns = getSqliteColumns(db, table);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get().n;
  const select = db.prepare(`SELECT ${columns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)}`);
  let batch = [];
  let copied = 0;
  for (const row of select.iterate()) {
    batch.push(row);
    if (batch.length >= batchRows) {
      await insertRowsToD1(table, columns, batch);
      copied += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await insertRowsToD1(table, columns, batch);
    copied += batch.length;
  }
  log(`push ${table}: ${copied}/${total}`);
}

// Returns { newWatermark, copied, total, fullSyncedTo } where fullSyncedTo is set
// when the table was full-synced (caller uses it to refresh state watermark).
async function copyIncrementalToD1(db, table, cfg, tableState) {
  const columns = getSqliteColumns(db, table);
  if (!columns.includes(cfg.col)) {
    log(`⚠ ${table}: missing watermark column "${cfg.col}", falling back to full sync`);
    await copySqliteToD1(db, table);
    const fallbackMax = db.prepare(`SELECT MAX(${quoteIdent(cfg.col)}) AS m FROM ${quoteIdent(table)}`).get();
    return { newWatermark: fallbackMax?.m ?? null, copied: -1, fullSyncedTo: fallbackMax?.m ?? null };
  }

  // Capture current max as the upper bound (point-in-time consistency).
  // Any row updated AFTER this snapshot will be picked up in the next cycle.
  const upperRow = db.prepare(`SELECT MAX(${quoteIdent(cfg.col)}) AS m FROM ${quoteIdent(table)}`).get();
  const currentMax = upperRow?.m ?? null;
  if (currentMax === null || currentMax === undefined) {
    log(`push ${table}: empty table, watermark unchanged`);
    return { newWatermark: tableState?.watermark ?? null, copied: 0 };
  }

  const lastWatermark = tableState?.watermark ?? null;
  // First sync (no saved watermark) → push everything up to currentMax.
  // Subsequent syncs → push only rows in (lastWatermark, currentMax].
  let where;
  let params;
  if (lastWatermark === null || lastWatermark === undefined) {
    where = `WHERE ${quoteIdent(cfg.col)} <= ?`;
    params = [currentMax];
  } else {
    where = `WHERE ${quoteIdent(cfg.col)} > ? AND ${quoteIdent(cfg.col)} <= ?`;
    params = [lastWatermark, currentMax];
  }

  const select = db.prepare(
    `SELECT ${columns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)} ${where}`
  );
  let batch = [];
  let copied = 0;
  for (const row of select.iterate(...params)) {
    batch.push(row);
    if (batch.length >= batchRows) {
      await insertRowsToD1(table, columns, batch);
      copied += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await insertRowsToD1(table, columns, batch);
    copied += batch.length;
  }

  const fromLabel = lastWatermark === null ? 'beginning' : String(lastWatermark);
  log(`push ${table}: +${copied} (${cfg.col} ${fromLabel} → ${currentMax})`);
  return { newWatermark: currentMax, copied };
}

async function fetchD1Rows(table, columns, offset) {
  const sql = `SELECT ${columns.map(quoteIdent).join(', ')} FROM ${quoteIdent(table)} LIMIT ${fetchRows} OFFSET ${offset}`;
  const result = await queryD1Async(sql);
  return result.results || [];
}

async function copyD1ToSqlite(db, table) {
  const columns = getSqliteColumns(db, table);
  const totalRow = await queryD1Async(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`);
  const total = Number(totalRow.results?.[0]?.n || 0);
  let copied = 0;
  for (let offset = 0; ; offset += fetchRows) {
    const rows = dryRun ? [] : await fetchD1Rows(table, columns, offset);
    if (!rows.length) break;
    insertRowsToSqlite(db, table, columns, rows);
    copied += rows.length;
  }
  log(`pull ${table}: ${copied}/${total}`);
}

function resolveDirection() {
  const envDirection = String(process.env.D1_SYNC_DIRECTION || '').toLowerCase();
  if (envDirection === 'push' || envDirection === 'sqlite-to-d1') return 'push';
  if (envDirection === 'pull' || envDirection === 'd1-to-sqlite') return 'pull';
  if (directionArg === 'push' || directionArg === 'sqlite-to-d1') return 'push';
  if (directionArg === 'pull' || directionArg === 'd1-to-sqlite') return 'pull';
  if (directionArg === 'auto') {
    const branch = currentGitBranch();
    if (branch === 'main' || branch === 'master') return 'push';
    return env.DB_PROVIDER === 'd1' ? 'pull' : 'push';
  }
  throw new Error(`Unsupported direction: ${directionArg}`);
}

function currentGitBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

async function syncOnce() {
  const direction = resolveDirection();
  log(`auto policy: branch=${currentGitBranch() || 'unknown'} DB_PROVIDER=${env.DB_PROVIDER || 'sqlite'} direction=${direction}`);
  const started = Date.now();
  if (direction === 'push') {
    const db = openSqlite(true);
    const state = loadState();
    const doFull = isFullSyncDue(state);
    try {
      const tables = getSqliteTables(db);
      const reason = forceFull ? '--full'
        : replaceTarget ? '--replace'
        : !state.last_full_sync_at ? 'no prior full sync'
        : `${fullSyncHours}h elapsed`;
      log(`sync start: SQLite -> D1 (${tables.length} tables, mode=${doFull ? `FULL (${reason})` : 'INCREMENTAL'})`);
      await ensureD1Schema(db, tables);
      if (replaceTarget) await clearD1Tables(tables);

      let totalCopied = 0;
      for (const table of tables) {
        const cfg = TABLE_CONFIG[table] || { mode: 'full' };
        if (doFull || cfg.mode === 'full') {
          await copySqliteToD1(db, table);
          // After full sync, advance watermark for incremental tables so next
          // cycle starts from the correct point.
          if (cfg.mode === 'incremental') {
            const cols = getSqliteColumns(db, table);
            if (cols.includes(cfg.col)) {
              const max = db.prepare(`SELECT MAX(${quoteIdent(cfg.col)}) AS m FROM ${quoteIdent(table)}`).get();
              state.tables[table] = { watermark: max?.m ?? null, col: cfg.col, mode: 'incremental' };
            }
          }
        } else {
          const { newWatermark, copied } = await copyIncrementalToD1(db, table, cfg, state.tables[table]);
          if (!dryRun) {
            state.tables[table] = { watermark: newWatermark, col: cfg.col, mode: 'incremental' };
          }
          if (Number.isFinite(copied)) totalCopied += copied;
        }
      }

      if (doFull) state.last_full_sync_at = new Date().toISOString();
      saveState(state);
      log(`push summary: ${doFull ? 'full sync' : `incremental, ~${totalCopied} rows pushed`}`);
    } finally {
      db.close();
    }
  } else {
    const schemaDb = openSqlite(true);
    let tmpDb = null;
    let tmpPath = '';
    try {
      const tables = getSqliteTables(schemaDb);
      const schemaRows = getSqliteSchema(schemaDb, tables);
      schemaDb.close();
      const mirror = createSqliteMirrorDb(schemaRows);
      tmpDb = mirror.tmpDb;
      tmpPath = mirror.tmpPath;
      log(`sync start: D1 -> SQLite mirror (${tables.length} tables)`);
      for (const table of tables) await copyD1ToSqlite(tmpDb, table);
      tmpDb.close();
      tmpDb = null;
      if (dryRun) log(`[dry-run] replace ${DB_PATH} with ${tmpPath}`);
      else replaceSqliteDb(tmpPath);
    } finally {
      try { schemaDb.close(); } catch {}
      try { if (tmpDb) tmpDb.close(); } catch {}
      if (dryRun && tmpPath) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
      }
    }
  }
  log(`sync complete: ${direction} in ${Date.now() - started}ms`);
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  do {
    try {
      await syncOnce();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] sync failed: ${err.stack || err.message}`);
      if (!loop) process.exitCode = 1;
    }
    if (loop) await sleep(intervalSec * 1000);
  } while (loop);
}

main();
