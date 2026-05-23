"""Check don_hang.updated_at freshness. Exit non-zero if stale > 6h."""
import sqlite3, sys, datetime as dt

DB = 'labo_data.db'
MAX_AGE_HOURS = 6

try:
    con = sqlite3.connect(DB)
    c = con.cursor()
    c.execute('SELECT MAX(updated_at) FROM don_hang')
    m = c.fetchone()[0]
finally:
    try: con.close()
    except: pass

if not m:
    sys.exit('no updated_at rows in don_hang')

last = dt.datetime.strptime(m, '%Y-%m-%d %H:%M:%S')
age_h = (dt.datetime.now() - last).total_seconds() / 3600
print(f'{age_h:.1f}h since last update_at')
if age_h > MAX_AGE_HOURS:
    sys.exit(f'STALE: {age_h:.1f}h > {MAX_AGE_HOURS}h')
