"""Check DB freshness using OS-native signals (TZ-immune).

Stored timestamps (don_hang.updated_at, import_log.ngay_import) are written by
the auto-scrape PM2 fork whose SQLite localtime view drifts from wall clock
(PM2 env TZ doesn't propagate cleanly to SQLite). Comparing those values to
Python wall-clock gives false STALE alarms.

Instead we use two TZ-immune signals:
  1. OS mtime of newest Excel in Excel/ — proves SQL export is producing files.
  2. import_log latest filename — proves DB import succeeded for that Excel.

Exit non-zero if either is stale or out of sync.
"""
import os, sys, time, json, glob, sqlite3

DB = 'labo_data.db'
EXCEL_DIR = 'Excel'
MAX_AGE_HOURS = 6  # auto-scrape cycles every 10-15 min during active hours

# 1. Newest Excel mtime
candidates = (
    glob.glob(os.path.join(EXCEL_DIR, '*.xlsx'))
    + glob.glob(os.path.join(EXCEL_DIR, '*.xls'))
    + glob.glob(os.path.join(EXCEL_DIR, '*.xlsm'))
)
if not candidates:
    sys.exit(f'no Excel files in {EXCEL_DIR}/')
newest_excel = max(candidates, key=os.path.getmtime)
excel_age_h = (time.time() - os.path.getmtime(newest_excel)) / 3600
newest_name = os.path.basename(newest_excel)
print(f'{excel_age_h:.1f}h since newest Excel: {newest_name}')

# 2. Latest import_log row — must reference the newest Excel (or its _final variant)
try:
    con = sqlite3.connect(DB)
    row = con.execute(
        "SELECT ten_file, trang_thai FROM import_log ORDER BY id DESC LIMIT 1"
    ).fetchone()
finally:
    try: con.close()
    except: pass

if not row:
    sys.exit('no import_log rows')

latest_imported, status = row
print(f'latest import_log: {latest_imported} ({status})')

newest_stem = os.path.splitext(newest_name)[0]  # e.g. '03062026_101554'
if newest_stem not in (latest_imported or '') or status != 'ok':
    sys.exit(f'import_log out of sync with newest Excel {newest_stem}')

if excel_age_h > MAX_AGE_HOURS:
    sys.exit(f'STALE: newest Excel {excel_age_h:.1f}h > {MAX_AGE_HOURS}h')
