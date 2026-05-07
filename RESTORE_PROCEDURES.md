# Database Restore Procedures

**Quick reference for emergency data recovery**

---

## TIER 1: Restore from Hourly Backup (Latest 7 Days)

**When to use:** Database corrupted, accidental delete, recent data issue  
**RTO:** 30 minutes  
**Data loss:** Up to 1 hour

### Procedure

```bash
# 1. STOP the application server
pm2 stop asia-lab-server
pm2 stop auto-scrape

# 2. BACKUP current corrupted database
cp labo_data.db labo_data.db.corrupted
cp labo_data.db-wal labo_data.db-wal.corrupted
cp labo_data.db-shm labo_data.db-shm.corrupted

# 3. RESTORE from latest backup
cp backups/latest.db labo_data.db

# 4. DELETE WAL files (they're now invalid)
rm labo_data.db-wal
rm labo_data.db-shm

# 5. VERIFY restore worked
node -e "
const db = require('better-sqlite3')('./labo_data.db');
const counts = {
  don_hang: db.prepare('SELECT COUNT(*) as n FROM don_hang').get().n,
  tien_do: db.prepare('SELECT COUNT(*) as n FROM tien_do').get().n,
  tien_do_history: db.prepare('SELECT COUNT(*) as n FROM tien_do_history').get().n
};
console.log('✅ Verify success. Records:', counts);
"

# 6. RESTART application
pm2 restart asia-lab-server auto-scrape

# 7. MONITOR logs
pm2 logs asia-lab-server
```

### Verify Restore Successful

```bash
# Check application is responsive
curl http://localhost:3000/api/stats

# Check database health
curl http://localhost:3000/admin/api/db-health | jq .

# Manually count records
node -e "
const db = require('better-sqlite3')('./labo_data.db');
console.log('don_hang:', db.prepare('SELECT COUNT(*) FROM don_hang').get());
console.log('tien_do:', db.prepare('SELECT COUNT(*) FROM tien_do').get());
console.log('tien_do_history:', db.prepare('SELECT COUNT(*) FROM tien_do_history').get());
"
```

---

## TIER 2: Restore from Weekly SQL Archive (Last 12 Weeks)

**When to use:** Need data from 2+ weeks ago, Tier 1 backups all deleted  
**RTO:** 2-4 hours  
**Data loss:** Up to 1 week

### Procedure

```bash
# 1. STOP application
pm2 stop asia-lab-server auto-scrape

# 2. FIND which archive to restore
ls -lh archive/
# Look for file like: labo_2026-04-20.sql.gz

# 3. DECOMPRESS the SQL archive
gunzip -c archive/labo_2026-04-20.sql.gz > restore.sql

# 4. BACKUP current database
cp labo_data.db labo_data.db.old
rm labo_data.db-wal labo_data.db-shm

# 5. DELETE current database
rm labo_data.db

# 6. RECREATE database from SQL dump
node << 'EOF'
const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('./labo_data.db');
const sql = fs.readFileSync('./restore.sql', 'utf8');

// Execute all statements in the SQL file
const statements = sql.split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0);

console.log(`Executing ${statements.length} SQL statements...`);

statements.forEach((stmt, idx) => {
  if (idx % 100 === 0) {
    console.log(`Progress: ${idx}/${statements.length}...`);
  }
  try {
    db.exec(stmt);
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn(`Statement ${idx}: ${e.message}`);
    }
  }
});

db.close();
console.log('✅ Restore completed');
EOF

# 7. VERIFY
node -e "
const db = require('better-sqlite3')('./labo_data.db');
console.log('don_hang:', db.prepare('SELECT COUNT(*) FROM don_hang').get());
console.log('tien_do:', db.prepare('SELECT COUNT(*) FROM tien_do').get());
"

# 8. CLEAN UP
rm restore.sql

# 9. RESTART
pm2 restart asia-lab-server auto-scrape
```

---

## TIER 3: Restore from Cloud Backup (Last 6 Months)

**When to use:** Complete data center failure, all local backups lost  
**RTO:** 4-6 hours  
**Data loss:** Up to 1 week

### Prerequisites

- Cloudflare R2 credentials in `.env`
- AWS SDK installed

### Procedure

```bash
# 1. LIST available cloud backups
node << 'EOF'
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

(async () => {
  try {
    const result = await r2Client.send(new ListObjectsV2Command({
      Bucket: 'labo-backups'
    }));
    
    console.log('Available backups:');
    result.Contents.forEach(obj => {
      const size = (obj.Size / 1024 / 1024).toFixed(2);
      console.log(`  ${obj.Key} (${size} MB) - ${obj.LastModified}`);
    });
  } catch (e) {
    console.error('Error listing backups:', e.message);
  }
})();
EOF

# 2. DOWNLOAD specific backup
# Example: download labo_2026-05-06.sql.gz

node << 'EOF'
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

(async () => {
  try {
    const result = await r2Client.send(new GetObjectCommand({
      Bucket: 'labo-backups',
      Key: 'labo_2026-05-06.sql.gz'  // Change date as needed
    }));
    
    const stream = result.Body;
    const file = fs.createWriteStream('./cloud_restore.sql.gz');
    
    stream.pipe(file);
    
    file.on('close', () => {
      console.log('✅ Downloaded: cloud_restore.sql.gz');
    });
  } catch (e) {
    console.error('Error downloading:', e.message);
  }
})();
EOF

# 3. DECOMPRESS
gunzip cloud_restore.sql.gz

# 4. FOLLOW TIER 2 PROCEDURE (steps 1, 4-9 above)
pm2 stop asia-lab-server auto-scrape
cp labo_data.db labo_data.db.old
rm labo_data.db labo_data.db-wal labo_data.db-shm

# Execute SQL to recreate (see TIER 2, step 6)
# ... then restart

# 5. VERIFY & CLEANUP
rm cloud_restore.sql
```

---

## ROLLBACK GUIDE

If restore causes new problems, rollback to previous state:

```bash
# 1. STOP application
pm2 stop asia-lab-server auto-scrape

# 2. RESTORE old database
rm labo_data.db labo_data.db-wal labo_data.db-shm
cp labo_data.db.old labo_data.db

# 3. RESTART
pm2 restart asia-lab-server auto-scrape

# 4. MONITOR
pm2 logs asia-lab-server
```

---

## EMERGENCY: Complete Data Loss Recovery

**Scenario:** Both labo_data.db and all backups are gone  
**Recovery time:** 6-24 hours  
**Data recovery:** 100% from Excel sources

### Procedure

```bash
# 1. If Tier 3 cloud backup exists, use it (TIER 3 procedure above)

# 2. If no backups exist, rebuild from Excel:
#    a. Run auto_scrape_headless.py to re-import from Keylab
#    b. Process will recreate database from Excel/ files
#    c. Wait 2-4 hours for full import cycle
#    d. Database will be complete but no history (tien_do_history)

# To trigger rebuild:
pm2 restart auto-scrape

# Monitor progress:
pm2 logs auto-scrape
```

---

## VERIFICATION CHECKLIST

After ANY restore:

- [ ] Application starts without errors
- [ ] Database is readable (no corruption)
- [ ] All tables have expected row counts:
  - don_hang: 2000+
  - tien_do: 10000+
  - tien_do_history: 14000+
- [ ] Health endpoint returns healthy status
- [ ] UI loads and displays data correctly
- [ ] Last import shows recent timestamp
- [ ] No error logs in PM2 console

---

## COMMON ISSUES & FIXES

### "Database is corrupted"

```bash
# Try to repair with PRAGMA
node -e "
const db = require('better-sqlite3')('./labo_data.db');
try {
  db.exec('PRAGMA integrity_check');
  console.log('✅ Database integrity OK');
} catch (e) {
  console.log('❌ Corrupted:', e.message);
  console.log('→ Use TIER 1 restore procedure');
}
"
```

### "SQLITE_CORRUPT: database disk image is malformed"

**Solution:** Restore from Tier 1 (latest.db)
```bash
cp backups/latest.db labo_data.db
pm2 restart asia-lab-server
```

### "SQLITE_IOERR: disk I/O error"

**Solution:** Check disk space
```bash
df -h /c/Users/Administrator/Desktop/crap_dev
# If < 5 GB free, clean up and retry restore
```

### "Table doesn't exist"

**Solution:** Restore is incomplete, try next tier
```bash
pm2 stop asia-lab-server
# Use TIER 2 or TIER 3 procedure
```

---

## TESTING RESTORE MONTHLY

**Every 1st of month, practice restore:**

```bash
# 1. Make a test copy
cp labo_data.db labo_data.db.test

# 2. Test restore process
cp backups/latest.db labo_data.db.test.restored
node -e "const db = require('better-sqlite3')('./labo_data.db.test.restored'); console.log('✅ Restore test OK');"

# 3. Document any issues
# 4. Clean up
rm labo_data.db.test*
```

---

## SUPPORT CONTACT

If restore fails:
1. Stop application (`pm2 stop asia-lab-server`)
2. Preserve corrupted file (`cp labo_data.db labo_data.db.corrupted.20260507`)
3. Contact developer with:
   - Error message
   - Which tier was attempted
   - Time when issue started
   - Corrupted database file (if small)

---

**Last tested:** [Update after each restore drill]  
**Restore time actual vs RTO:** [Document for improvement]
