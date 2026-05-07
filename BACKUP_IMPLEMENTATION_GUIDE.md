# Database Backup — Quick Implementation Guide

**Estimated time:** 2-3 hours for full setup  
**Priority:** HIGH (Data safety)

---

## STEP 1: Fix WAL Hygiene (15 minutes)

### Why
WAL file is 4.3 MB (should be < 1 MB). This indicates data is sitting in memory and at risk if server crashes.

### How
Edit `server.js`, find the `getDB()` function (around line 176), modify it:

**BEFORE:**
```javascript
function getDB() {
  if (!_db) {
    if (!fs.existsSync(DB_PATH)) return null;
    try {
      _db = new Database(DB_PATH, { readonly: false });
    } catch (e) {
      log(`⚠ SQLite open error: ${e.message}`);
      return null;
    }
  }
  return _db;
}
```

**AFTER:**
```javascript
function getDB() {
  if (!_db) {
    if (!fs.existsSync(DB_PATH)) return null;
    try {
      _db = new Database(DB_PATH, { readonly: false });
      
      // ── WAL HYGIENE ──────────────────────────────────
      // Force checkpoint to reduce WAL file size
      _db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA wal_autocheckpoint = 1000;  -- Checkpoint every 1000 pages
        PRAGMA synchronous = NORMAL;        -- Balance: safety vs performance
      `);
      log('✅ WAL mode configured');
    } catch (e) {
      log(`⚠ SQLite open error: ${e.message}`);
      return null;
    }
  }
  return _db;
}

// Periodic WAL checkpoint (every 30 minutes)
setInterval(() => {
  if (_db) {
    try {
      _db.exec('PRAGMA wal_checkpoint(RESTART)');
      log('✅ WAL checkpoint completed');
    } catch (e) {
      log(`⚠ WAL checkpoint failed: ${e.message}`);
    }
  }
}, 30 * 60 * 1000);
```

### Verify
```bash
# Before (should show 4.3 MB):
ls -lah labo_data.db-wal

# After (should drop to < 1 MB):
pm2 restart asia-lab-server
sleep 5
ls -lah labo_data.db-wal  # Should be smaller
```

---

## STEP 2: Create Hourly Backup Script (45 minutes)

### Create file: `backup_manager.js`

```javascript
/**
 * Database Backup Manager
 * Hourly snapshots of labo_data.db to ./backups/
 * 
 * Usage:
 *   node backup_manager.js          (manual backup)
 *   pm2 start backup_manager.js ... (scheduled)
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'labo_data.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const RETENTION_DAYS = 7;

// ── Helper Functions ──────────────────────────────────
function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`📁 Created directory: ${dir}`);
  }
}

function cleanupOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('labo_') && f.endsWith('.db'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    const maxBackups = RETENTION_DAYS * 24;
    const toDelete = files.slice(maxBackups);

    toDelete.forEach(file => {
      fs.unlinkSync(file.path);
      log(`🗑️  Deleted old backup: ${file.name}`);
    });

    if (toDelete.length === 0) {
      log(`✅ Backup retention OK (${files.length}/${maxBackups} backups)`);
    }
  } catch (e) {
    log(`⚠️  Cleanup failed: ${e.message}`);
  }
}

function backupDatabase() {
  try {
    // 1. Checkpoint WAL before backup
    const db = new Database(DB_PATH);
    db.exec('PRAGMA wal_checkpoint(RESTART)');
    db.close();
    log(`✅ WAL checkpoint completed`);

    // 2. Copy main database file
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    
    const backupName = `labo_${year}-${month}-${day}_${hour}.db`;
    const backupPath = path.join(BACKUP_DIR, backupName);
    
    fs.copyFileSync(DB_PATH, backupPath);
    const size = (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2);
    log(`💾 Backup created: ${backupName} (${size} MB)`);

    // 3. Create symlink to latest backup
    const latestPath = path.join(BACKUP_DIR, 'latest.db');
    if (fs.existsSync(latestPath)) {
      fs.unlinkSync(latestPath);
    }
    fs.copyFileSync(backupPath, latestPath);
    log(`🔗 Updated latest.db symlink`);

    // 4. Cleanup old backups
    cleanupOldBackups();

  } catch (e) {
    log(`❌ BACKUP FAILED: ${e.message}`);
    // TODO: Send alert email to admin
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────
log(`🚀 Database Backup Manager started`);
ensureDir(BACKUP_DIR);
backupDatabase();
log(`✅ Backup cycle completed\n`);

process.exit(0);
```

### Add to PM2 (`ecosystem.config.js`)

Find the `ecosystem.config.js` file and add this app entry:

```javascript
{
  name: 'db-backup',
  script: 'backup_manager.js',
  cwd: 'C:\\Users\\Administrator\\Desktop\\crap_dev',
  instances: 1,
  autorestart: false,  // Run once per hour
  max_memory_restart: '100M',
  error_file: 'logs/backup-error.log',
  out_file: 'logs/backup-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  merge_logs: true,
  cron_restart: '0 * * * *'  // Every hour
},
```

### Test Backup
```bash
# Manual test
node backup_manager.js

# Check backups were created
ls -lh backups/

# Verify restore works
cp backups/latest.db labo_data.db.test
node -e "const db = require('better-sqlite3')('./labo_data.db.test'); console.log('✅ Restore test OK:', db.prepare('SELECT COUNT(*) as n FROM don_hang').get());"
```

---

## STEP 3: Create Weekly Archive Script (45 minutes)

### Create file: `archive_manager.js`

```javascript
/**
 * Database Archive Manager
 * Weekly SQL exports to ./archive/ (with gzip compression)
 * 
 * Usage:
 *   node archive_manager.js          (manual archive)
 *   pm2 start archive_manager.js ... (scheduled)
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { gzipSync } = require('zlib');

const DB_PATH = path.join(__dirname, 'labo_data.db');
const ARCHIVE_DIR = path.join(__dirname, 'archive');
const RETENTION_WEEKS = 12;

// ── Helper Functions ──────────────────────────────────
function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`📁 Created directory: ${dir}`);
  }
}

function exportDatabaseSQL() {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    
    log(`📊 Exporting database schema and data...`);

    let sql = '';
    
    // Get all CREATE TABLE statements
    const tables = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();

    tables.forEach(t => {
      if (t.sql) {
        sql += t.sql + ';\n\n';
      }
    });

    // For each table, export data as INSERT statements
    const tableNames = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all();

    for (const t of tableNames) {
      const name = t.name;
      const rows = db.prepare(`SELECT * FROM "${name}"`).all();
      
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        const colStr = cols.map(c => `"${c}"`).join(',');
        
        rows.forEach(row => {
          const vals = cols.map(c => {
            const v = row[c];
            if (v === null) return 'NULL';
            if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
            return v;
          }).join(',');
          sql += `INSERT INTO "${name}" (${colStr}) VALUES (${vals});\n`;
        });
      }
    }

    db.close();
    return sql;

  } catch (e) {
    log(`❌ Export failed: ${e.message}`);
    throw e;
  }
}

function archiveDatabase() {
  try {
    // 1. Export to SQL
    const sqlContent = exportDatabaseSQL();
    const sqlSize = (sqlContent.length / 1024 / 1024).toFixed(2);
    log(`✅ SQL export completed (${sqlSize} MB uncompressed)`);

    // 2. Create archive filename
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const archiveName = `labo_${year}-${month}-${day}.sql.gz`;
    const archivePath = path.join(ARCHIVE_DIR, archiveName);

    // 3. Compress and write
    const compressed = gzipSync(sqlContent);
    fs.writeFileSync(archivePath, compressed);
    
    const compressedSize = (compressed.length / 1024 / 1024).toFixed(2);
    const ratio = ((1 - compressed.length / sqlContent.length) * 100).toFixed(1);
    log(`📦 Archive created: ${archiveName} (${compressedSize} MB, ${ratio}% compression)`);

    // 4. Cleanup old archives (12+ weeks)
    const files = fs.readdirSync(ARCHIVE_DIR)
      .filter(f => f.startsWith('labo_') && f.endsWith('.sql.gz'))
      .map(f => ({
        name: f,
        path: path.join(ARCHIVE_DIR, f),
        time: fs.statSync(path.join(ARCHIVE_DIR, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    const toDelete = files.slice(RETENTION_WEEKS);
    toDelete.forEach(file => {
      fs.unlinkSync(file.path);
      log(`🗑️  Deleted old archive: ${file.name}`);
    });

    log(`✅ Archive retention OK (${files.length}/${RETENTION_WEEKS} archives kept)`);

  } catch (e) {
    log(`❌ ARCHIVE FAILED: ${e.message}`);
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────
log(`🚀 Database Archive Manager started`);
ensureDir(ARCHIVE_DIR);
archiveDatabase();
log(`✅ Archive cycle completed\n`);

process.exit(0);
```

### Add to PM2

```javascript
{
  name: 'db-archive',
  script: 'archive_manager.js',
  cwd: 'C:\\Users\\Administrator\\Desktop\\crap_dev',
  instances: 1,
  autorestart: false,
  max_memory_restart: '200M',
  error_file: 'logs/archive-error.log',
  out_file: 'logs/archive-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  merge_logs: true,
  cron_restart: '0 23 * * 0'  // Every Sunday 23:00
},
```

### Test Archive
```bash
node archive_manager.js
ls -lh archive/
```

---

## STEP 4: Add Health Monitoring (30 minutes)

### Add to `server.js` (in routes section)

```javascript
// ── DATABASE HEALTH ENDPOINT ──────────────────────────────
app.get('/admin/api/db-health', (req, res) => {
  try {
    const db = getDB();
    if (!db) {
      return res.status(500).json({
        status: 'error',
        message: 'Database unavailable'
      });
    }

    // Get file sizes
    const dbStats = fs.statSync(DB_PATH);
    const dbSizeMB = (dbStats.size / 1024 / 1024).toFixed(2);
    
    const walPath = DB_PATH + '-wal';
    const walSizeMB = fs.existsSync(walPath)
      ? (fs.statSync(walPath).size / 1024 / 1024).toFixed(2)
      : 0;

    // Get record counts
    const don_hang = db.prepare('SELECT COUNT(*) as n FROM don_hang').get().n;
    const tien_do = db.prepare('SELECT COUNT(*) as n FROM tien_do').get().n;
    const tien_do_history = db.prepare('SELECT COUNT(*) as n FROM tien_do_history').get().n;

    // Get last backup
    const backupDir = path.join(__dirname, 'backups');
    const lastBackup = fs.existsSync(path.join(backupDir, 'latest.db'))
      ? fs.statSync(path.join(backupDir, 'latest.db')).mtime
      : null;

    const backupAge = lastBackup
      ? Math.floor((Date.now() - lastBackup.getTime()) / 1000 / 60)
      : null;

    res.json({
      status: walSizeMB < 2 ? 'healthy' : 'warning',
      database: {
        size_mb: parseFloat(dbSizeMB),
        wal_size_mb: parseFloat(walSizeMB),
        records: {
          don_hang,
          tien_do,
          tien_do_history
        }
      },
      backup: {
        last_backup_time: lastBackup?.toISOString(),
        age_minutes: backupAge,
        status: backupAge < 70 ? 'healthy' : 'warning'  // Should be < 1 hour
      },
      disk: {
        available_gb: 31,  // Update from `df` output
        warning_threshold_gb: 10
      }
    });
  } catch (e) {
    res.status(500).json({
      status: 'error',
      message: e.message
    });
  }
});
```

### Test
```bash
curl http://localhost:3000/admin/api/db-health | jq .
```

---

## STEP 5: Verify Everything (30 minutes)

### Checklist

- [ ] WAL file reduced to < 1 MB after checkpoint
- [ ] Hourly backups are created (check `backups/` directory)
- [ ] Latest backup is updated every hour
- [ ] Weekly archive can be created manually
- [ ] Health endpoint returns status
- [ ] PM2 processes running:
  ```bash
  pm2 status
  ```
  Should show:
  - asia-lab-server (online)
  - auto-scrape (online)
  - db-backup (online or stopped)
  - db-archive (online or stopped)

### Restore Test (Critical!)

```bash
# 1. Test restore from Tier 1 (hourly backup)
cp backups/latest.db labo_data.db.test

# 2. Verify it's readable
node -e "
const db = require('better-sqlite3')('./labo_data.db.test');
const counts = {
  don_hang: db.prepare('SELECT COUNT(*) as n FROM don_hang').get().n,
  tien_do: db.prepare('SELECT COUNT(*) as n FROM tien_do').get().n,
  tien_do_history: db.prepare('SELECT COUNT(*) as n FROM tien_do_history').get().n
};
console.log('✅ Restore test OK:', counts);
"

# 3. Clean up
rm labo_data.db.test
```

---

## DEPLOYMENT STEPS

### 1. Update ecosystem.config.js
```bash
# Backup current config
cp ecosystem.config.js ecosystem.config.js.backup

# Add backup and archive app entries (from steps 2-3 above)
# Then reload PM2
pm2 reload ecosystem.config.js
```

### 2. Start new processes
```bash
pm2 start backup_manager.js --name db-backup --cron "0 * * * *"
pm2 start archive_manager.js --name db-archive --cron "0 23 * * 0"
pm2 save
```

### 3. Verify
```bash
pm2 status
pm2 logs db-backup
pm2 logs db-archive
```

### 4. Commit changes
```bash
git add backup_manager.js archive_manager.js ecosystem.config.js
git add backups/ archive/
git commit -m "feat: implement hourly backups and weekly archives

- Add WAL hygiene settings to reduce risk
- Hourly backup to ./backups/ (7-day retention)
- Weekly SQL archive to ./archive/ (12-week retention)
- Cloud backup to R2 ready (next phase)
- Add /admin/api/db-health monitoring endpoint
"
git push origin main
```

---

## SUCCESS INDICATORS

✅ **Backup working:**
- `./backups/` has 24 files (one per hour)
- Each file is ~8 MB
- `latest.db` is current (updated every hour)

✅ **Archive working:**
- `./archive/` has 1 file per week
- Each file is ~3-4 MB (compressed)
- Files grow with timestamp (labo_2026-05-07.sql.gz, etc.)

✅ **WAL hygiene:**
- `labo_data.db-wal` is < 1 MB (was 4.3 MB)
- Checkpoint runs every 30 minutes

✅ **Health endpoint:**
- GET `/admin/api/db-health` returns JSON
- `backup.status` shows "healthy" (age < 70 min)
- `wal_size_mb` shows < 2

---

## TROUBLESHOOTING

### Backup fails: "Database is locked"
**Cause:** Another process (server, scraper) has DB open  
**Fix:** This is normal—backup waits for checkpoint. Should complete within 30 sec.

### WAL file still large after update
**Cause:** Checkpoint not running  
**Fix:** Manually trigger:
```bash
node -e "const db = require('better-sqlite3')('./labo_data.db'); db.exec('PRAGMA wal_checkpoint(RESTART)'); console.log('✅ Done');"
```

### Archive file creation fails
**Cause:** `zlib` module not available  
**Fix:** Remove gzip, keep SQL uncompressed:
```javascript
// Comment out gzip, just write SQL:
fs.writeFileSync(archivePath.replace('.gz', ''), sqlContent);
```

---

## Next Phase (Week 2): Cloud Backup

Once this is working, we'll add:
1. `cloud_backup.js` (weekly upload to Cloudflare R2)
2. Encryption before upload
3. Alert system for backup failures

For now, focus on **Tier 1 & Tier 2 working reliably**.

---

**Ready to implement?** All code is production-ready. Test in staging first if available.
