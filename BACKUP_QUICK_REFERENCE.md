# Database Backup — Quick Reference Card

**Print this or bookmark for emergencies**

---

## Database Location
```
C:\Users\Administrator\Desktop\crap_dev\labo_data.db
```

## Critical Files
```
labo_data.db       Main database (8.1 MB)
labo_data.db-wal   Write-ahead log (< 1 MB normally)
labo_data.db-shm   Shared memory (32 KB)
```

---

## Backup Locations

| Tier | What | Where | How Old | Recovery Time |
|------|------|-------|---------|----------------|
| **1** | Hourly snapshots | `./backups/latest.db` | < 1 hour | 30 min |
| **2** | Weekly SQL dumps | `./archive/labo_*.sql.gz` | < 1 week | 2-4 hrs |
| **3** | Cloud offsite | Cloudflare R2 | < 1 month | 4-6 hrs |

---

## Emergency: 30-Second Recovery

```bash
# STOP
pm2 stop asia-lab-server auto-scrape

# RESTORE
cp backups/latest.db labo_data.db
rm labo_data.db-wal labo_data.db-shm 2>/dev/null

# RESTART
pm2 restart asia-lab-server auto-scrape

# VERIFY
curl http://localhost:3000/admin/api/db-health
```

---

## System Health Check

```bash
# Check backup status
ls -lh backups/ | tail -5

# Check database
curl http://localhost:3000/admin/api/db-health | jq .

# Check PM2 processes
pm2 status

# Check disk space
df -h /c/Users/Administrator/Desktop
```

---

## What Gets Backed Up

| Table | Records | Backed Up |
|-------|---------|-----------|
| don_hang | 2,183 | ✅ |
| tien_do | 10,699 | ✅ |
| tien_do_history | 14,289 | ✅ |
| import_log | 1,378 | ✅ |
| error_reports | 9 | ✅ |
| feedbacks | 4 | ✅ |
| Other tables | - | ✅ |

**Total:** 27,179 records backed up

---

## Common Scenarios

### Scenario: "Database won't start"
```bash
# 1. Stop everything
pm2 stop all

# 2. Restore latest
cp backups/latest.db labo_data.db && rm labo_data.db-wal labo_data.db-shm 2>/dev/null

# 3. Restart
pm2 restart asia-lab-server

# 4. Check logs
pm2 logs asia-lab-server
```

### Scenario: "I deleted data by mistake 3 days ago"
```bash
# 1. Choose archive from 3 days ago
ls -l archive/ | grep "2026-05-04"

# 2. Follow TIER 2 restore procedure
# (See RESTORE_PROCEDURES.md)
```

### Scenario: "Server crashed and won't recover"
```bash
# 1. Restore from latest
cp backups/latest.db labo_data.db

# 2. If still failing, try older backup
cp backups/labo_2026-05-07_18.db labo_data.db

# 3. If all local backups fail, restore from cloud (TIER 3)
# (See RESTORE_PROCEDURES.md)
```

---

## System Status Indicators

| Indicator | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| **WAL size** | < 1 MB | 1-2 MB | > 2 MB |
| **Last backup** | < 1 hour | 1-3 hours | > 3 hours |
| **DB size** | < 100 MB | 100-500 MB | > 500 MB |
| **Free disk** | > 10 GB | 5-10 GB | < 5 GB |
| **Auto-scrape** | Running | Warning | Stopped |

---

## Backup Processes (PM2)

```bash
# View all backup processes
pm2 status

# Check last backup ran
pm2 logs db-backup | tail -20

# Check archives being created
pm2 logs db-archive | tail -20

# Force manual backup now
node backup_manager.js

# Force manual archive now
node archive_manager.js
```

---

## Contact Information

**Database issue?**
1. Check this card
2. Follow procedure
3. If stuck: Contact developer
   - Include: error message, which tier attempted, timestamp
   - Attach: corrupted DB file (if < 10 MB)

---

## Testing Restore (Monthly)

**1st of each month, test:**
```bash
# 1. Copy test database
cp labo_data.db labo_data_test.db

# 2. Copy backup on top
cp backups/latest.db labo_data_test.db

# 3. Verify readable
node -e "const db = require('better-sqlite3')('./labo_data_test.db'); console.log('✅ OK');"

# 4. Delete test
rm labo_data_test.db

# 5. Log result
echo "Restore test: OK - $(date)" >> restore_test.log
```

---

## Monitoring Checklist

- [ ] Backup process runs every hour (check PM2)
- [ ] Latest backup updated in last hour
- [ ] No errors in backup logs
- [ ] Archive created every Sunday
- [ ] WAL file < 1 MB (check file size)
- [ ] Disk has > 10 GB free
- [ ] Database responds to health check

---

## Performance Stats

| Operation | Time | Notes |
|-----------|------|-------|
| **Backup** | 30 sec | Hourly, automated |
| **Restore Tier 1** | 30 min | Full recovery, no data loss |
| **Restore Tier 2** | 2-4 hrs | SQL import, all data recovered |
| **Restore Tier 3** | 4-6 hrs | Download + import |
| **Full rebuild** | 6-24 hrs | From Excel imports only |

---

## Files to Keep Safe

```
✅ Keep forever:
   - backups/latest.db (overwritten hourly)
   - archive/ (weekly archives)

🗑️  Can delete:
   - Old backups > 7 days (automatic)
   - Old archives > 12 weeks (automatic)

🔒 Protect:
   - .env (R2 credentials)
   - ecosystem.config.js
```

---

## One-Page Disaster Recovery

**IF DATABASE IS DOWN:**

1. **Assess**: Is it corrupted? Deleted? Won't start?
2. **Stop**: `pm2 stop asia-lab-server auto-scrape`
3. **Restore**: `cp backups/latest.db labo_data.db && rm *.wal *.shm`
4. **Verify**: `node -e "const db = require('better-sqlite3')('./labo_data.db'); console.log('OK')"`
5. **Restart**: `pm2 restart asia-lab-server`
6. **Check**: `curl http://localhost:3000/admin/api/db-health`

**If that fails:**
- Try older backup: `cp backups/labo_2026-05-07_18.db labo_data.db`
- Or restore from archive (TIER 2): See `RESTORE_PROCEDURES.md`

---

## Automated Alerts

You'll receive alerts if:
- ⚠️ Backup fails to create
- ⚠️ WAL file grows too large
- ⚠️ Disk space gets low
- ⚠️ Archive can't be uploaded

**Action**: Check logs and contact developer

---

## Key Numbers

```
Database size:         8.1 MB
Records:              27,179
Growth rate:          1.8 MB/day
Backup frequency:     Every hour
Archive frequency:    Every Sunday
Cloud retention:      6 months
Local retention:      7 days (backups) + 12 weeks (archives)
Disk available:       31 GB (plenty)
RTO (worst case):     6 hours
```

---

## Last Updated
- Plan created: 2026-05-07
- Last backup test: ___________
- Last restore drill: ___________
- Last incidents: ___________

---

**KEEP THIS CARD ACCESSIBLE**
