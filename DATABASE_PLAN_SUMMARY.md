# Database Storage Plan — Executive Summary

---

## Current Situation

### Database Status
```
labo_data.db:        8.1 MB    ✅ Healthy
labo_data.db-wal:    4.3 MB    ⚠️  RISK (should be < 1 MB)
labo_data.db-shm:    32 KB     ✅ Normal

Total records:       27,179    ✅ Good
Data span:           7 days    ⏱️  Recent
Import frequency:    Every 10 min ✅ Active
Growth rate:         ~1.8 MB/day
```

### The Problem
**⚠️ NO BACKUP SYSTEM** — If the database gets corrupted or deleted, we lose 7 days of work data and there's no recovery path.

**Additional risk:** WAL file (4.3 MB) indicates transactions not being committed properly. A power failure could corrupt the database.

---

## What We're Building

### Three-Tier Backup System

```
┌─────────────────────────────────────────────────────────────┐
│                    TIER 1: LOCAL HOURLY                     │
│                                                              │
│  • Automated backup every hour                              │
│  • Stores last 7 days (168 hourly backups)                 │
│  • ~8 MB per backup                                         │
│  • Recovery time: 30 minutes                                │
│  • Cost: $0 (using existing disk space)                     │
│                                                              │
│  Location: ./backups/latest.db                              │
│  ✅ Recover from: accidental delete, corruption             │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   TIER 2: WEEKLY ARCHIVE                    │
│                                                              │
│  • SQL dump every Sunday at 11 PM                           │
│  • Stores 12 weeks (3 months)                               │
│  • ~3-4 MB per dump (compressed)                            │
│  • Recovery time: 2-4 hours                                 │
│  • Cost: $0 (using existing disk space)                     │
│                                                              │
│  Location: ./archive/labo_YYYY-MM-DD.sql.gz               │
│  ✅ Recover from: month-old data loss                       │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   TIER 3: CLOUD BACKUP                      │
│                                                              │
│  • Upload weekly to Cloudflare R2                           │
│  • Stores 6 months (24 weeks)                               │
│  • ~3-4 MB per backup                                       │
│  • Recovery time: 4-6 hours                                 │
│  • Cost: $0.50/month (R2 is cheap)                          │
│                                                              │
│  Location: Cloudflare R2 bucket (labo-backups)             │
│  ✅ Recover from: complete data center failure              │
└─────────────────────────────────────────────────────────────┘
```

---

## Recovery Time Objectives

| Scenario | RTO | Tier | Method |
|----------|-----|------|--------|
| **Database corrupted** | 30 min | 1 | Restore latest.db |
| **Accidental delete** | 30 min | 1 | Restore from backup |
| **1-day old data** | 30 min | 1 | Restore hourly backup |
| **1-week old data** | 2-4 hrs | 2 | Restore SQL dump |
| **1-month old data** | 4-6 hrs | 3 | Download cloud backup |
| **Complete failure** | 24 hrs | 3 | Rebuild from Excel imports |

---

## Implementation Timeline

### Week 1: Foundation (Critical)
```
MON: WAL hygiene fix (30 min)
     └─ Reduce risk of crash-related corruption

TUE: Hourly backup script (2 hours)
     └─ backups/latest.db created every hour
     └─ 7-day rolling window

WED: Testing & verification (1 hour)
     └─ Verify backups are working
     └─ Test restore procedure

TOTAL WEEK 1: ~3.5 hours
```

### Week 2: Archiving & Cloud
```
MON: Weekly archive script (2 hours)
     └─ SQL dumps every Sunday
     └─ 12-week retention

TUE: Cloud integration (2 hours)
     └─ Upload to Cloudflare R2
     └─ 6-month retention

WED: Monitoring dashboard (1.5 hours)
     └─ /admin/api/db-health endpoint
     └─ Alert system for backup failures

TOTAL WEEK 2: ~5.5 hours
```

### Week 3: Documentation & Training
```
MON: Restore procedures (1 hour)
     └─ Create runbook for each tier

TUE: Full recovery test (2 hours)
     └─ Simulate corruption, test restore
     └─ Verify recovery works

WED: Team training & documentation (1 hour)
     └─ Train support team
     └─ Document disaster recovery plan

TOTAL WEEK 3: ~4 hours
```

**Total effort: ~13 hours over 3 weeks**  
**Cost: $0.50/month + developer time**

---

## Files to Create/Modify

### New Files
- `backup_manager.js` — Hourly backup script
- `archive_manager.js` — Weekly SQL export
- `DATABASE_STORAGE_PLAN.md` — Full technical spec (you're reading it!)
- `BACKUP_IMPLEMENTATION_GUIDE.md` — Step-by-step implementation
- `RESTORE_PROCEDURES.md` — Recovery runbook

### Files to Modify
- `server.js` — Add WAL hygiene settings + health endpoint
- `ecosystem.config.js` — Add backup & archive processes
- Create `backups/` directory
- Create `archive/` directory

### Directories to Create
```
crap_dev/
├── backups/           (168 hourly backups)
├── archive/           (52 weekly archives)
└── logs/              (backup logs)
```

---

## Key Benefits

✅ **Data Safety**
- 3-layer redundancy protects against various failure modes
- Can recover from any scenario within 30 min - 6 hours

✅ **Cost Effective**
- $0.50/month for cloud storage
- Uses existing disk (31 GB available)
- No additional hardware needed

✅ **Automated**
- Fire-and-forget backups
- No manual intervention required
- PM2 handles scheduling

✅ **Compliant**
- Meets basic data retention requirements
- Supports audit logging
- Future-proof for enterprise needs

✅ **Testable**
- Regular restore drills possible
- Can verify backups work before disaster
- Confidence in recovery procedures

---

## Risks Addressed

### Before This Plan
- ❌ **No backup** — Complete data loss possible
- ❌ **WAL corruption risk** — Power failure could corrupt database
- ❌ **No recovery path** — Rebuilding from Excel takes hours
- ❌ **Single point of failure** — One bad import kills everything

### After This Plan
- ✅ **Hourly backups** — Lose < 1 hour of data
- ✅ **WAL hygiene** — Checkpoints prevent corruption
- ✅ **3-tier recovery** — Multiple restore options
- ✅ **Tested procedures** — Team knows how to recover

---

## What's NOT Included (Future Phases)

### Phase 2 (3-6 months)
- [ ] HTTPS/TLS encryption for transit
- [ ] Database encryption at rest
- [ ] Audit logging (who changed what, when)
- [ ] Two-factor authentication
- [ ] Automatic alerts via email/SMS

### Phase 3 (6-12 months)
- [ ] PostgreSQL migration (if data grows > 500 MB)
- [ ] Replication for high availability
- [ ] Point-in-time recovery
- [ ] Enterprise compliance (SOC2, ISO27001)

---

## Executive Decision Points

### Proceed with Plan?
- ✅ **Recommended**: Implement in Week 1-3
- ⏱️ **Timeline**: 13 hours of development
- 💰 **Cost**: $0.50/month + developer time
- 📊 **ROI**: High (prevents catastrophic data loss)

### Alternative: Do Nothing?
- ❌ **Risk**: Data loss in case of corruption
- ❌ **Recovery**: Manual rebuild from Excel (6-24 hours)
- ❌ **Impact**: Business interruption during outage

---

## Next Steps

1. **Approve this plan** (you're doing it now!)
2. **Week 1**: Fix WAL + implement hourly backups
3. **Week 2**: Add weekly archives + cloud backup
4. **Week 3**: Test & document recovery procedures
5. **Ongoing**: Monthly restore drills, monitor backup health

---

## Questions?

Refer to:
- **Full spec**: `DATABASE_STORAGE_PLAN.md` (detailed risk analysis, migration roadmap)
- **Implementation**: `BACKUP_IMPLEMENTATION_GUIDE.md` (step-by-step code)
- **Recovery**: `RESTORE_PROCEDURES.md` (emergency procedures)

---

**Status**: ✅ **READY TO IMPLEMENT**

**Approval**: _______________  **Date**: _______________
