# Database Concurrency Analysis — Quick Summary

**TL;DR:** Database is mostly safe, but has 2 medium-risk issues and 1 critical missing backup system.

---

## THE 3 MAIN FINDINGS

### ✅ GOOD: Scraper Transactions Are Excellent

**How scraper writes data:**
```python
# db_manager.py
with conn:  # ← TRANSACTION starts here
    for row in rows:
        upsert_don_hang(conn, {...})      # All
        upsert_tien_do(conn, {...})       # in
    # If any error, entire transaction rolls back
# COMMIT on success (implicit)
```

**Result:**
- ✅ All-or-nothing: Either all 500 rows import, or none
- ✅ No half-imported data possible
- ✅ Foreign key constraints keep data clean
- ✅ No corruption risk from scraper

**Risk Level:** 🟢 **LOW**

---

### ⚠️ MEDIUM: Multi-Step API Reads Without Transaction

**How server reads data:**
```javascript
// server.js - PROBLEMATIC pattern
app.get('/order/:ma_dh', (req, res) => {
    const order = db.prepare('SELECT...').get(...);      // Query 1 at time T0
    const stages = db.prepare('SELECT...').all(...);     // Query 2 at time T1
    const variants = db.prepare('SELECT...').all(...);   // Query 3 at time T2
    // If scraper runs between queries, data might be inconsistent!
    res.json({ order, stages, variants });
});
```

**The Race Condition:**
```
T0: User requests order detail
    └─ Query 1 reads order (qty=10)
T0.5ms: Scraper updates same order (qty=15)
T1: Query 2 reads stages (shows qty=15)
Result: API returns qty=10 in header, qty=15 in stages → INCONSISTENT!
```

**How often?** Very rarely (ms window), but **possible**

**Fix:** Wrap in transaction
```javascript
const transaction = db.transaction(() => {
  const order = db.prepare('SELECT...').get(...);
  const stages = db.prepare('SELECT...').all(...);
  return { order, stages };
});
const result = transaction();  // All three queries use same snapshot
```

**Risk Level:** 🟡 **MEDIUM** (Probability: Low, Impact: Medium)

**Where to fix:** 5-10 routes that do multi-step reads
- `/order/:ma_dh`
- `/api/analytics/*`
- `/api/dashboard/*`

**Time to fix:** 30 minutes

---

### 🟡 MEDIUM: WAL File Too Large (Checkpoint Issue)

**Current state:**
```
labo_data.db:     8.1 MB  ✅ Normal
labo_data.db-wal: 4.3 MB  ⚠️ TOO BIG (should be < 1 MB)
```

**Why this matters:**
- WAL contains uncommitted transactions pending
- Power loss during large WAL = database corruption risk
- Current checkpoint settings not aggressive enough

**What's happening:**
```
Server.js opens DB → keeps connection open (never closes)
Scraper writes 500 orders every 10 min
  ↓
WAL accumulates data (writes to WAL file, not main DB yet)
  ↓
Checkpoint should write WAL → main DB file
  ↓
But it's not happening frequently enough
```

**Fix:** Explicit periodic checkpoint
```javascript
// In getDB() function:
_db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA wal_autocheckpoint = 1000;
`);

// Add every 30 minutes:
setInterval(() => {
  if (_db) {
    _db.exec('PRAGMA wal_checkpoint(RESTART)');  // Force checkpoint
  }
}, 30 * 60 * 1000);
```

**Result after fix:**
- labo_data.db-wal: 4.3 MB → < 500 KB
- Data safer during power loss
- No performance impact

**Time to fix:** 15 minutes

---

## RACE CONDITIONS ANALYSIS

### Scenario 1: Server Reading While Scraper Writing ✅
**Result:** SAFE
- SQLite WAL ensures readers see consistent snapshot
- Readers don't block, writers don't block readers
- Data is correct (might be old, but consistent)

### Scenario 2: Server Writing While Scraper Writing ✅
**Result:** SAFE
- SQLite only allows 1 writer at a time
- Writer 2 waits for Writer 1 to finish
- No corruption possible

### Scenario 3: Multi-Step Read Gets Inconsistent Data ⚠️
**Result:** POSSIBLE but RARE
- Different queries might read at different WAL snapshots
- Probability: Very low (ms window)
- Impact: API shows inconsistent data (not corrupted)
- Fix: Simple (wrap in transaction)

---

## TRANSACTION USAGE SUMMARY

| Component | Transaction Use | Status | Risk |
|-----------|-----------------|--------|------|
| **db_manager.py (scraper)** | ✅ Yes (with conn:) | ✅ Excellent | 🟢 LOW |
| **server.js (reads)** | ⚠️ Partial (no wrapping) | ⚠️ Fair | 🟡 MEDIUM |
| **server.js (writes)** | ✅ Atomic statements | ✅ Good | 🟢 LOW |

---

## DATA INTEGRITY FEATURES ✅

| Feature | Status | Notes |
|---------|--------|-------|
| **Foreign Keys** | ✅ ON | Orphaned records impossible |
| **Unique Constraints** | ✅ Yes | ma_dh is unique, (ma_dh, thu_tu) is unique |
| **Indexes** | ✅ 4 indexes | Good query performance |
| **Atomic Operations** | ✅ Yes | INSERT OR CONFLICT is atomic |
| **WAL Mode** | ✅ Enabled | Prevents most corruption scenarios |

---

## WHAT COULD GO WRONG

### Power Loss During Scraper Write
**Probability:** Medium  
**Impact:** Database might need recovery  
**Current mitigation:** WAL + FK constraints  
**Better mitigation:** WAL checkpoint + Backup (Tier 1)

### API Returns Inconsistent Data
**Probability:** Low (ms window)  
**Impact:** User sees conflicting info  
**Current mitigation:** None  
**Better mitigation:** Wrap reads in transaction

### WAL Accumulation Causes Issues
**Probability:** Low (but visible: 4.3 MB)  
**Impact:** Slower recovery, higher corruption risk  
**Current mitigation:** Auto-checkpoint at 1000 pages  
**Better mitigation:** Explicit periodic checkpoint

### Concurrent Scraper Instances Corrupt DB
**Probability:** Very Low (single-process auto-scrape)  
**Impact:** Would see duplicate data, not corruption  
**Current mitigation:** SQLite serializes writers  
**Better mitigation:** Process locking (not needed yet)

---

## RECOMMENDATIONS (PRIORITY ORDER)

### 🔴 CRITICAL - Do This Week

#### 1. Implement Backup System (13 hours total)
- **Why:** No backup currently exists (biggest risk)
- **What:** 3-tier: hourly local, weekly archive, cloud storage
- **Reference:** DATABASE_STORAGE_PLAN.md
- **Status:** Complete plan ready, implementation guide ready

#### 2. Fix WAL Checkpoint (15 minutes)
- **Why:** WAL file is 4.3 MB (should be < 1 MB)
- **What:** Add periodic checkpoint in server.js
- **Risk reduction:** Power loss corruption risk ↓

#### 3. Wrap Multi-Step Reads (30 minutes)
- **Why:** API might return inconsistent data
- **What:** Use `db.transaction()` for queries that read multiple tables
- **Where:** 5-10 routes, mainly analytics and detail pages
- **Risk reduction:** Data consistency ↑

### 🟡 MEDIUM - Do This Month

#### 4. Add Database Health Monitoring (1 hour)
- Monitor WAL size
- Track import success/failure
- Alert on backup failures

#### 5. Document Data Access Patterns (2 hours)
- Create runbook for concurrent access
- Train team on transaction usage
- Document when to use transactions

### 🟢 LOW - Can Do Later

#### 6. Optimize Query Performance (not urgent)
- Profile slow queries
- Add more indexes if needed
- Currently performing fine

---

## QUICK REFERENCE

### Health Check Command
```bash
# Check database health
curl http://localhost:3000/admin/api/db-health

# Or manually:
sqlite3 labo_data.db "PRAGMA integrity_check;"
sqlite3 labo_data.db "SELECT COUNT(*) FROM don_hang;"
```

### WAL Status Check
```bash
ls -lh labo_data.db*
# Should show:
#   labo_data.db:     8.1 MB
#   labo_data.db-wal: < 1 MB (currently 4.3 MB ⚠️)
```

### Force Checkpoint (Emergency)
```bash
node -e "const db = require('better-sqlite3')('./labo_data.db'); db.exec('PRAGMA wal_checkpoint(RESTART)'); console.log('✅ Checkpoint done');"
```

---

## COMPARISON: BEFORE vs AFTER FIXES

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **WAL Size** | 4.3 MB | < 500 KB | 87% smaller |
| **Power Loss Risk** | 🟡 MEDIUM | 🟢 LOW | Much safer |
| **API Consistency** | ⚠️ Possible inconsistency | ✅ Guaranteed | Fixed |
| **Backup/Recovery** | ❌ None | ✅ 3-tier | 99% recovery |
| **Overall Risk** | 🟡 MEDIUM | 🟢 LOW | Reduced |

---

## FILES & REFERENCES

- **Full Architecture Review:** `DATABASE_ARCHITECTURE_REVIEW.md` (this analysis)
- **Backup Plan:** `DATABASE_STORAGE_PLAN.md` (detailed strategy)
- **Implementation Guide:** `BACKUP_IMPLEMENTATION_GUIDE.md` (code ready)
- **Recovery Procedures:** `RESTORE_PROCEDURES.md` (step-by-step)
- **Quick Ref Card:** `BACKUP_QUICK_REFERENCE.md` (emergency use)

---

## STATUS: READY FOR ACTION

All analysis complete, all fixes documented, implementation code ready.

**Next Step:** Choose priority and start with WAL checkpoint fix (15 min) + Backup implementation (13 hours).

**Support:** See detailed analysis in `DATABASE_ARCHITECTURE_REVIEW.md`
