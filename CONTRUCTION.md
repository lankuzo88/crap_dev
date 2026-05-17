# ASIA LAB Construction Notes

Last updated: 2026-05-18

Tai lieu nay mo ta day du cau truc, luong du lieu, module chinh va cach van hanh du an ASIA LAB trong workspace production:

`C:\Users\Administrator\Desktop\crap_dev`

Tai lieu duoc thiet ke de doc xong la hieu 100% du an, khong can mo code ra tra cuu nua.

---

## 1. Tong quan du an

ASIA LAB la he thong quan ly don hang va tien do san xuat cho labo nha khoa. He thong gom ba lop chinh chay tren cung mot Windows server:

1. **Node.js Express server** phuc vu dashboard, API, auth, admin, upload, bao loi, thong ke.
2. **SQLite `labo_data.db`** lam nguon du lieu chinh.
3. **Python automation** export tu Keylab2022 (UI automation), cao tien do tu LaboAsia (HTTP API), lam sach Excel va import vao SQLite.

Production workspace. Khong phai sandbox.

### Stack chi tiet

- Node 18+ voi `express` v5.2, `better-sqlite3` v12.9, `bcrypt` v6, `multer`, `sharp`, `xlsx`, `dotenv`, `@aws-sdk/client-s3`, `express-rate-limit`.
- Python 3.x voi `pandas`, `openpyxl`, `xlrd`, `requests`, `playwright`, `pywinauto`, `pywin32`.
- SQLite voi WAL mode.
- Cloudflare R2 (S3-compatible) cho luu anh bao loi ky thuat va bao tre tien do.
- PM2 cluster mode 4 instance cho Node + 1 instance cho auto-scrape Python.
- Caddy reverse proxy `asiakanban.com` ve `127.0.0.1:3000`.

### Cac actor trong he thong

- **Admin**: full quyen — quan ly user, upload Excel, trigger Keylab export, duyet bao loi, xem stats, route don.
- **User (cong doan)**: nhin queue pending theo cong doan cua minh, scan barcode, route don, bao loi cong doan minh.
- **QC**: bao loi va kiem loi theo flow rieng (chua admin).

---

## 2. Runtime va process production

### Node server

- Entry point: `server.js` (~46 dong)
- Express app factory: `src/app.js`
- Host listen: `127.0.0.1`
- Port mac dinh: `3000` (env `PORT` override)
- PM2 app name: `asia-lab-server`
- PM2 mode: cluster, `instances: 4`
- `max_memory_restart`: 500M
- `min_uptime`: 10s, `max_restarts`: 10, `restart_delay`: 5000ms
- Logs: `logs/pm2-out.log`, `logs/pm2-error.log`
- Reverse proxy: Caddy domain `asiakanban.com` ve `127.0.0.1:3000`
- `src/app.js` co `app.set('trust proxy', 1)` (implicit qua express 5) de xu ly XFF.

### Auto scrape

- Script: `auto_scrape_headless.py`
- PM2 app name: `auto-scrape`
- Interpreter: `python` (cwd = project root)
- Chu ky: moi `INTERVAL_MINUTES = 10` phut
- `max_memory_restart`: 300M, `min_uptime`: 30s, `max_restarts`: 5, `restart_delay`: 10000ms
- Env bo sung trong ecosystem.config.js:
  - `PYTHONIOENCODING=utf-8`
  - `PLAYWRIGHT_BROWSERS_PATH=C:\Users\Administrator\AppData\Local\ms-playwright`
- Log chinh: `auto_scrape.log` (logger Python), `logs/auto-scrape-out.log`, `logs/auto-scrape-error.log` (PM2).

### Caddyfile

```caddy
asiakanban.com {
    reverse_proxy 127.0.0.1:3000
}
```

TLS tu dong qua Caddy auto-renew. Khoi dong: `caddy run --config Caddyfile` hoac `caddy start --config Caddyfile`.

### PM2 ecosystem.config.js (rut gon)

```javascript
module.exports = {
  apps: [
    {
      name: 'asia-lab-server',
      script: 'server.js',
      instances: 4,
      exec_mode: 'cluster',
      autorestart: true,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'production', PORT: 3000 },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'auto-scrape',
      script: 'auto_scrape_headless.py',
      interpreter: 'python',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        PYTHONIOENCODING: 'utf-8',
        PLAYWRIGHT_BROWSERS_PATH: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright',
      },
      error_file: 'logs/auto-scrape-error.log',
      out_file: 'logs/auto-scrape-out.log',
      merge_logs: true,
    },
  ],
};
```

---

## 3. Thu muc va file quan trong

### Node source (`src/`)

#### Entry
- `server.js` — bootstrap production: load env, load users, load sessions, init DB tables theo thu tu, start image cleanup, start WAL checkpoint, listen, preload `getData()`.
- `src/app.js` — Express app factory, mount 11 router theo thu tu, gan blockDirectHtml middleware, static `/uploads/error-images` co auth, 404 + error handler.

#### Config (`src/config/`)
- `env.js` (~21 dong) — doc `.env`, normalize toan bo env (PORT, NODE_ENV, IMAGE_*, R2_*).
- `paths.js` (~20 dong) — path constants (BASE_DIR, FILE_SACH_DIR, DATA_DIR, EXCEL_DIR, DB_PATH, KEYLAB_NOTES_PATH, SESSIONS_PATH, USERS_JSON_PATH, DASHBOARD, DASHBOARD_MOBILE, ERROR_IMAGE_DIR).

#### Database (`src/db/`)
- `index.js` (~67 dong) — singleton `getDB()`, WAL + 5s busy_timeout, `closeDB()`, `dbHasData()`, `startWALCheckpoint()` (30 phut interval), `stopWALCheckpoint()`.
- `migrations.js` (~572 dong) — init tat ca bang, backfill cot moi them, refresh monthly stats, helper billing period 26-25.

#### Middleware (`src/middleware/`)
- `auth.js` (~30 dong) — `requireAuth`, `requireAdmin`.
- `security.js` (~45 dong) — `loginLimiter` (5 attempt / 15 min, 429), `blockDirectHtml`, `serveErrorImages`.

#### Repositories (`src/repositories/`)
- `users.repo.js` (~101 dong) — `USERS` in-memory dict + load/save `users.json`, bcrypt hash, normalize cong_doan.
- `orders.repo.js` (~414 dong) — doc Excel/JSON, build orders, cache 60s (SQLite path priority), stage skip rules, `getData(forceReload?)`, `resetCache()`.

#### Services (`src/services/`)
- `session.service.js` (~101 dong) — `genToken()` (crypto 32 bytes hex), `createSession/getSession/deleteSession`, TTL 7 ngay, cleanup moi 1h.
- `scraper.service.js` (~277 dong) — spawn `run_scrape.py`, queue management, file watcher debounce 3s, spawn `keylab_exporter.py --once` va `--check`, callback `setResetCallback`/`setCloseDBCallback`.
- `image.service.js` (~189 dong) — multer R2Storage custom, `sharp` compress (rotate, resize fit-inside 1600x1600, webp 75%), upload nhieu anh toi da `REPORT_IMAGE_LIMIT`, helper JSON image refs, `uploadImage`, `deleteErrorImage` (R2 truoc, fallback local), `cleanupExpiredErrorImages` (90 ngay), schedule 24h.
- `r2.service.js` (~15 dong) — S3Client factory (region 'auto'), export `PutObjectCommand`, `DeleteObjectCommand`.

#### Routes (`src/routes/`)
- `auth.routes.js` (~49 dong) — login/logout.
- `dashboard.routes.js` (~145 dong) — `/`, `/mobile`, `/analytics`, `/data.json`, `/reload`, `/status`, `/files`, `/upload` (GET+POST).
- `orders.routes.js` (~156 dong) — `/api/orders*`.
- `admin.routes.js` — admin panel + user CRUD + production stats + monthly stats + delay-risk orders API.
- `scraper.routes.js` (~79 dong) — scrape-status, auto-scrape, keylab-*.
- `analytics.routes.js` (~211 dong) — KTV stats, daily, db stats, trend, customers, history endpoints.
- `errorReports.routes.js` — bao loi ky thuat, multi-image upload, monthly stats.
- `feedback.routes.js` (~90 dong) — feedback types va feedbacks CRUD.
- `users.routes.js` (~135 dong) — `/user`, `/api/user/pending-orders`.
- `stats.routes.js` (~155 dong) — `/api/stats/daily` (chip mobile).
- `munger.routes.js` (~159 dong) — `/munger`, `/api/munger/metrics`.

#### Utilities (`src/utils/`)
- `phucHinh.js` (~108 dong) — classify zirc/kl/vnr/hon/inmau/tam, room routing, `hasInMauHam`, `getRoomWithProductionNote`.
- `reportStats.js` — build thong ke thang cho bao loi ky thuat va bao tre, dung ky 26 thang truoc den 25 thang hien thi.

### Python script (root)
- `auto_scrape_headless.py` — daemon 24/7 quet Excel moi, spawn parallel scrape + notes.
- `run_scrape.py` — runner cho 1 file Excel, 1-4 worker scrape song song.
- `laboasia_gui_scraper_tkinter.py` — core scraper, login Playwright lay JWT, goi JSON API.
- `labo_cleaner.py` — clean Excel raw thanh workbook 3-sheet co styling.
- `db_manager.py` — schema init, import JSON/Excel, stats, sync keylab notes.
- `keylab_exporter.py` — pywinauto UIA automation Keylab2022 de Xuat Excel.
- `keylab_notes_scraper.py` — pywinauto cao "Ghi chu SX" tu Keylab2022 vao DB.
- `import_history_data.py` (neu co) — bulk import lich su vao `tien_do_history`.

### Frontend HTML (root)
- `login.html`, `dashboard.html`, `dashboard_mobile_terracotta.html`, `admin.html`, `upload.html`, `analytics.html`, `munger.html`, `bao_loi.html`, `error_reports.html`, `bao_tre.html`, `delay_reports.html`.

### Data va runtime
- `labo_data.db` — SQLite chinh + `labo_data.db-wal` + `labo_data.db-shm`.
- `Excel/` — Excel goc tu Keylab/upload (file pattern `DDMMYYYY_N.xls(x)`).
- `Data/` — file scraped trung gian (`*_scraped.json`, `*_scraped.xlsx`, temp `.xlsx` khi convert .xls).
- `File_sach/` — Excel final sau `labo_cleaner.py` (`*_final.xlsx`).
- `Data_thang/` — archive theo thang.
- `uploads/error-images/` — anh loi local cu/fallback va file legacy; anh moi cua bao loi ky thuat/bao tre uu tien R2.
- `logs/` — PM2 logs.
- `.env` — credentials runtime (R2, LABO_USER*, IMAGE_*).
- `users.json` — user accounts (passwordHash bcrypt, role, cong_doan, can_view_stats).
- `sessions.json` — legacy file, session chinh hien nam trong SQLite bang `sessions`.
- `labo_config.json` — `{last_run_file: "..."}`.
- `keylab_state.json` — `{date: "DD/MM/YYYY", export_count: N}` cho file naming Keylab export.
- `scraper_errors.json` — luu loi keylab_notes_scraper de retry notes-only.
- `keylab_notes.json` (optional) — cache notes goc, sync vao `don_hang.ghi_chu_sx`.

### Config files
- `package.json` — dependencies, scripts.
- `requirements.txt` — Python deps.
- `ecosystem.config.js` — PM2 process config.
- `Caddyfile` — reverse proxy config.

---

## 4. Luong du lieu chinh

### Luong tu Keylab den dashboard (file moi)

1. Admin bam "Xuat Excel KeyLab" trong dashboard hoac auto-process tao file Excel trong `Excel/`.
2. `keylab_exporter.py --once`:
   - `find_keylab_window()` quet UIA tim window co title chua "keylab" + ("version" or "lab asia").
   - Click `btnTimKiem` (auto_id) → wait 3s.
   - Click `btnXuatExcel` → wait 2s.
   - Poll Save As dialog (0.3s interval, 5s timeout).
   - Ctrl+A + type filename `DDMMYYYY_N` (state tu `keylab_state.json`).
   - Click Save button (auto_id="1").
   - Dismiss "Open with" dialog (Escape).
   - Retry toi da 2 lan (3 attempt total), delay 2s.
   - Print `SAVED:<filepath>` va exit.
3. `auto_scrape_headless.py` (daemon 10 phut/lan):
   - `find_newest_excel()` quet `Excel/` bo `_scraped`, `_final`, `_cleaned`.
   - So sanh voi `labo_config.json.last_run_file`.
   - **File moi** → `run_new_file()` chay 2 thread song song:
     - Thread 1: `run_scrape.py <excel_path>` (timeout 300s).
     - Thread 2: `keylab_notes_scraper.py --new-file` (timeout 1800s).
   - **File cu + co loi notes truoc** → chi chay `keylab_notes_scraper.py` (retry notes-only).
   - **File cu OK** → chay `run_scrape.py` (progress-only, khong chay notes).
4. `run_scrape.py <excel_path>`:
   - `detect_sheet_col()` — auto-detect sheet (`Đơn hàng`/`Don hang`/`Sheet1`) va column ma_dh (fuzzy match `ma_dh`, `mã ĐH`, `Mã đơn`...).
   - Load 1-4 account tu env `LABO_USER1..4` + `LABO_PASS1..4`.
   - Tao `queue.Queue` cua tat ca ma_dh.
   - Spawn N thread `LaboAsiaAPIClient.scrape_order_queue()`:
     - Each worker: login Playwright headless → lay JWT cookie `auth_token`.
     - POST `https://laboasia.com.vn/empconnect/api_handler/` voi `Authorization: Bearer <jwt>`.
     - Parse response → `ProgressRow(ma_dh, thu_tu, cong_doan, ten_ktv, xac_nhan, thoi_gian_hoan_thanh, raw_row_text, tai_khoan_cao, barcode_labo)`.
     - Post event vao event queue: `("order_done", ...)`.
   - Main thread tieu thu event, gom result.
   - `build_progress_df()` → JSON + Excel merged → `Data/*_scraped.{json,xlsx}`.
   - Neu input `.xls` → convert temp `.xlsx` trong `Data/`.
   - `subprocess.run(labo_cleaner.py)` → `File_sach/*_final.xlsx`.
   - `db_manager.py init_db()` + `import_json()` + `import_excel_final()` vao SQLite.
   - Cleanup file trung gian `Data/*` va `File_sach/*` sau import.
   - Exit 0 neu co result, 1 neu khong.
5. `keylab_notes_scraper.py --new-file`:
   - Quet Excel active, load list ma_dh.
   - `wait_for_db_import()` poll `import_log` toi 7 phut (lau hon run_scrape 5 phut).
   - Sau khi DB co data, filter:
     - Skip neu `ghi_chu_sx IS NOT NULL AND != ''` (da co notes).
     - Skip neu `phuc_hinh` co "in mau" (`has_in_mau()`).
   - Cho moi ma_dh todo:
     - Filter Row → input ma_dh → Enter (wait 0.5s).
     - Double-click row → mo detail form (wait 0.8s).
     - Doc cell "Ghi chu SX row N" tu `gridControlDonHang`.
     - Click `btnDongLai` close detail (wait 0.3s).
     - Clear filter (wait 0.3s).
   - Batch save moi 10 don: `UPDATE don_hang SET ghi_chu_sx = ?` (chi neu ghi_chu_sx hien tai rong).
   - Neu note co "in mau ham" → `UPDATE routed_to = 'zirco'`.
   - Ghi loi vao `scraper_errors.json` neu fail. Xoa file neu success va co loi truoc.
   - **`os._exit(0 or 2)`** de tranh COM thread hang.
6. Node API doc SQLite, frontend render dashboard.

### Luong khi cung file (re-poll)
- `auto_scrape_headless.py` chay lai `run_scrape.py` cho progress moi.
- Notes chi retry khi `scraper_errors.json` bao co loi.

### Luong upload web
1. Admin upload Excel qua form `POST /upload` (multer single('excel'), max 20MB, mime `.xlsx/.xls/.xlsm`).
2. File luu vao `Excel/`.
3. `scraper.service.js` queue file hoac spawn `run_scrape.py` ngay.
4. Khi scraper xong: `resetCache()` cho orders + `closeDB()` de connection moi.
5. Front-end poll `/scrape-status` moi ~1.5 phut.

---

## 5. Database — schema chi tiet

DB: `labo_data.db` SQLite.

PRAGMA settings:

| PRAGMA | Node | Python |
|---|---|---|
| journal_mode | WAL | WAL |
| busy_timeout | 5000 ms | 30000 ms |
| foreign_keys | (not set) | ON |

WAL checkpoint: `PRAGMA wal_checkpoint(TRUNCATE)` moi 30 phut tu `src/db/index.js`.

### Bang `don_hang` — master order

Mot dong per `ma_dh`. Writer: `db_manager.py.upsert_don_hang()`, `keylab_notes_scraper.py`. Reader: Node `orders.routes.js`, frontend `data.json`.

| Cot | Kieu | Default | Y nghia |
|---|---|---|---|
| id | INTEGER | AUTOINCREMENT | PK |
| ma_dh | TEXT UNIQUE NOT NULL | — | Ma don hang duy nhat |
| ma_dh_goc | TEXT | — | Ma goc (truoc dau `-N`) |
| so_phu | INTEGER | NULL | So phu (N trong `ma_dh-N`) |
| la_don_phu | INTEGER | 0 | 1 neu la don phu |
| nhap_luc | TEXT | '' | DD/MM/YYYY HH:MM:SS |
| yc_hoan_thanh | TEXT | '' | Deadline KTV |
| yc_giao | TEXT | '' | Deadline giao hang |
| khach_hang | TEXT | '' | Ten nha khoa |
| benh_nhan | TEXT | '' | Ten benh nhan |
| phuc_hinh | TEXT | '' | Mo ta phuc hinh (semicolon separated) |
| sl | INTEGER | 0 | Tong so rang (parse SL:X) |
| loai_lenh | TEXT | '' | Lam moi/Lam lai/Sua/Bao hanh/Lam tiep/Lam them |
| ghi_chu | TEXT | '' | Ghi chu dieu phoi |
| ghi_chu_sx | TEXT | '' | Ghi chu SX (tu Keylab) |
| trang_thai | TEXT | '' | Trang thai don |
| tai_khoan_cao | TEXT | '' | Account code (hyct, kythuat, sonnt, lanhn) |
| barcode_labo | TEXT | '' | Barcode dan tren don |
| routed_to | TEXT | NULL | 'sap' / 'zirco' / 'both' / 'none' |
| nguon_file | TEXT | '' | File nguon import |
| created_at | TEXT | datetime('now','localtime') | |
| updated_at | TEXT | datetime('now','localtime') | |

Indexes: `idx_don_hang_goc(ma_dh_goc)`, `idx_don_hang_giao(yc_giao)`, `idx_don_hang_barcode_labo(barcode_labo)`, `idx_don_hang_routed_to(routed_to)`.

### Bang `tien_do` — current progress

5 dong per `ma_dh` (1 per cong doan). UNIQUE(ma_dh, thu_tu). FK `ma_dh REFERENCES don_hang(ma_dh) ON DELETE CASCADE`.

| Cot | Kieu | Default | Y nghia |
|---|---|---|---|
| id | INTEGER | AUTOINCREMENT | PK |
| ma_dh | TEXT NOT NULL | — | FK |
| thu_tu | INTEGER NOT NULL | — | 1-5 |
| cong_doan | TEXT NOT NULL | — | CBM, SÁP/Cadcam, SƯỜN, ĐẮP, MÀI |
| ten_ktv | TEXT | '' | KTV xu ly |
| xac_nhan | TEXT | 'Chưa' | 'Có' / 'Chưa' |
| thoi_gian_hoan_thanh | TEXT | '' | DD/MM/YYYY HH:MM:SS |
| raw_row_text | TEXT | '' | Audit trail |
| nguon_file | TEXT | '' | |
| created_at | TEXT | datetime('now','localtime') | |
| updated_at | TEXT | datetime('now','localtime') | |

Indexes: `idx_tien_do_ma(ma_dh)`, `idx_tien_do_cd(cong_doan)`, `idx_tien_do_ktv(ten_ktv)`.

### Bang `tien_do_history` — historical snapshot

Immutable, append-only. Source for monthly/daily stats. Co them context don hang (so_luong, loai_lenh, nha khoa).

| Cot | Kieu | Y nghia |
|---|---|---|
| id | INTEGER | PK |
| ma_dh | TEXT | |
| thu_tu | INTEGER | |
| cong_doan | TEXT | |
| ten_ktv | TEXT | |
| xac_nhan | TEXT | |
| thoi_gian_hoan_thanh | TEXT | |
| ngay_nhan | TEXT | |
| ma_kh | TEXT | |
| ten_nha_khoa | TEXT | |
| bac_si | TEXT | |
| benh_nhan | TEXT | |
| phuc_hinh | TEXT | |
| so_luong | INTEGER | |
| loai_lenh | TEXT | |
| loai_phuc_hinh | TEXT | zirc/kl/vnr/hon... |
| tai_khoan_cao | TEXT | |
| raw_row_text | TEXT | |
| billing_month | TEXT | YYYY-MM |
| billing_start | TEXT | YYYY-MM-26 |
| billing_end | TEXT | YYYY-MM-25 |
| completion_date | TEXT | YYYY-MM-DD |
| imported_at | DATETIME | CURRENT_TIMESTAMP |

UNIQUE(ma_dh, thu_tu, cong_doan, thoi_gian_hoan_thanh). Index `idx_tdh_billing_month(billing_month)`.

### Bang `sessions` — auth

| Cot | Kieu | Y nghia |
|---|---|---|
| token | TEXT PK | crypto.randomBytes(32).hex |
| username | TEXT NOT NULL | |
| role | TEXT NOT NULL | admin/user/qc |
| expires | INTEGER NOT NULL | Unix ms |

Index `idx_sessions_expires(expires)`. Cleanup moi 1h.

### Bang `import_log` — audit

| Cot | Kieu | Y nghia |
|---|---|---|
| id | INTEGER | PK |
| ten_file | TEXT | |
| loai_file | TEXT | 'json' / 'excel' |
| ngay_import | TEXT | |
| so_don_hang | INTEGER | |
| so_cong_doan | INTEGER | |
| trang_thai | TEXT | 'ok' / 'error' |
| chi_tiet | TEXT | error message |

### Bang `error_codes` — reference

| Cot | Kieu | Y nghia |
|---|---|---|
| id | INTEGER | PK |
| ma_loi | TEXT NOT NULL | Code (CB001, SA002...) |
| ten_loi | TEXT NOT NULL | |
| cong_doan | TEXT NOT NULL | |
| mo_ta | TEXT | |
| active | INTEGER DEFAULT 1 | |
| created_at | TEXT | |

### Bang `error_reports` — QA

| Cot | Kieu | Y nghia |
|---|---|---|
| id | INTEGER | PK |
| ma_dh | TEXT | |
| error_code_id | INTEGER | FK error_codes.id |
| ma_loi_text | TEXT | Free text fallback |
| cong_doan | TEXT | |
| hinh_anh | TEXT | JSON array image refs; legacy single URL/path van duoc parse |
| mo_ta | TEXT | |
| trang_thai | TEXT DEFAULT 'pending' | pending/confirmed/rejected |
| submitted_by | TEXT | |
| submitted_at | TEXT | datetime('now','localtime') |
| reviewed_by | TEXT | |
| reviewed_at | TEXT | |
| ghi_chu_admin | TEXT | |

Image refs:
- Backend moi ghi `hinh_anh` bang JSON array de ho tro nhieu anh.
- Frontend va API van parse duoc du lieu cu dang single URL/path.
- Anh moi upload qua R2 bang `uploadImage`; neu validation sau upload fail thi server xoa cac anh vua upload.

### Bang `feedback_types` va `feedbacks`

Generic feedback system, hien khong co UI rieng. Cau truc:
- `feedback_types(id, name, category, description, active, created_at)`.
- `feedbacks(id, ma_dh, feedback_type_id, description, severity, status, assigned_to, created_at, updated_at, resolved_at)`.

### Bang `ktv_monthly_stats` — aggregate billing 26-25

| Cot | Kieu | Y nghia |
|---|---|---|
| id | INTEGER | PK |
| billing_month | TEXT NOT NULL | YYYY-MM |
| billing_start | TEXT NOT NULL | YYYY-MM-26 (thang truoc) |
| billing_end | TEXT NOT NULL | YYYY-MM-25 (thang hien tai) |
| cong_doan | TEXT NOT NULL | |
| ten_ktv | TEXT NOT NULL | |
| orders_completed | INTEGER DEFAULT 0 | unique ma_dh count |
| total_sl | INTEGER DEFAULT 0 | tong so rang |
| source_rows | INTEGER DEFAULT 0 | row count |
| type_breakdown | TEXT DEFAULT '{}' | JSON {loai_lenh: {qty, orders, rows}} |
| updated_at | TEXT | |

UNIQUE(billing_month, cong_doan, ten_ktv). Indexes tren billing_month, ten_ktv, cong_doan.

### Bang `ktv_monthly_type_stats`

Tuong tu `ktv_monthly_stats` + cot `loai_lenh`. UNIQUE(billing_month, cong_doan, ten_ktv, loai_lenh).

### Bang `ktv_daily_stats` va `ktv_daily_type_stats`

Tuong tu monthly nhung dung `completion_date` (YYYY-MM-DD) thay vi billing month. Phuc vu daily tracking khong dung billing cycle.

### Billing period (chu ky 26-25)

`billingPeriodForCompletion(date)` trong `src/db/migrations.js`:

```javascript
function billingPeriodForCompletion(value) {
  const parsed = parseCompletionDate(value);  // DD/MM/YYYY
  const billing = parsed.day >= 26
    ? addMonths(parsed.year, parsed.month, 1)
    : { year: parsed.year, month: parsed.month };
  const prev = addMonths(billing.year, billing.month, -1);
  return {
    completionDate: parsed.iso,
    billingMonth: `${billing.year}-${billing.month}`,
    billingStart: `${prev.year}-${prev.month}-26`,
    billingEnd: `${billing.year}-${billing.month}-25`,
  };
}
```

Cong viec hoan thanh ngay 26 tro len → vao billing thang sau.

### `refreshMonthlyStats()` chi tiet

1. SELECT tu `tien_do_history` (fallback `tien_do` JOIN `don_hang` neu chua co history).
2. Filter `ten_ktv NOT IN ('', '-') AND thoi_gian_hoan_thanh NOT IN ('', '-')`.
3. Dedup by (ma_dh, thu_tu, cong_doan) — giu row co `imported_at` moi nhat.
4. Loop rows:
   - Tinh `billingPeriodForCompletion(thoi_gian_hoan_thanh)`.
   - Bucket monthly: `[billing_month, cong_doan, ten_ktv]`.
   - Bucket daily: `[completion_date, cong_doan, ten_ktv]`.
   - Tich luy `total_sl`, `orders` (Set unique ma_dh), `source_rows`.
   - `addTypeBreakdown()` tach JSON theo `loai_lenh` (normalize qua `normalizeOrderType()`).
5. DELETE 4 bang stats (rebuild toan bo).
6. INSERT batch vao 4 bang.

JSON `type_breakdown` shape:
```json
{
  "Lam moi": { "qty": 15, "orders": 3, "rows": 5 },
  "Sua":     { "qty":  8, "orders": 2, "rows": 2 }
}
```

`normalizeOrderType()` map loai_lenh → canonical set: `Làm mới`, `Làm thêm`, `Làm lại`, `Bảo hành`, `Sửa`, `Làm tiếp`, `Khác`.

### Volume snapshot

- `don_hang`: 2723
- `tien_do`: 13207
- `tien_do_history`: 28160
- `import_log`: 3304
- `error_codes`: 7
- `error_reports`: 15
- `feedback_types`: 10
- `feedbacks`: 4
- `sessions`: 33
- `ktv_monthly_stats`: 96
- `ktv_daily_stats`: 1593

---

## 6. Auth, user va permission

### users.json structure

```json
{
  "admin": {
    "passwordHash": "$2b$10$...",
    "role": "admin",
    "cong_doan": "",
    "can_view_stats": true
  },
  "ktv_dap_1": {
    "passwordHash": "$2b$10$...",
    "role": "user",
    "cong_doan": "đắp",
    "can_view_stats": false
  }
}
```

22 user dang co trong production: 1 admin + 21 user/qc.

### Password
- Luu bcrypt `passwordHash` (saltRounds=10).
- Fallback doc `u.password` cho legacy data trong `users.repo.js`.
- `hashPassword(pwd)`, `verifyPassword(pwd, hash)` helper.

### Session
- Cookie: `sid`
- HttpOnly, SameSite=Strict
- TTL: 7 ngay (`SESS_TTL = 7 * 24 * 3600 * 1000`)
- Cookie age: 604800 sec
- Token: `crypto.randomBytes(32).toString('hex')`
- Storage: SQLite bang `sessions`
- Cleanup: setInterval moi 1h chay `cleanExpiredSessions()`.
- Cookie `Secure` flag KHONG set vi server listen local sau Caddy. Neu doi topology, danh gia lai.

### Roles
- `admin`: full quyen — dashboard, upload, export, user management, stats, duyet bao loi.
- `user`: theo cong doan, thay queue pending.
- `qc`: bao loi/kiem loi theo flow rieng, khong phai admin.

### Cong doan user (canonical)

`USER_CONG_DOAN_VALUES` trong `users.repo.js`:
- `''` (rong)
- `CBM`
- `sáp`
- `CAD/CAM`
- `sườn`
- `đắp`
- `mài`

`USER_CONG_DOAN_LEGACY_MAP` chuyen legacy names → canonical (vi du `sap` → `sáp`, `suon` → `sườn`).

### Mapping user cong_doan → DB cong_doan

Trong `users.routes.js` va `orders.repo.js`:
- `CBM` → `CBM`
- `sáp` → `SÁP/Cadcam`
- `CAD/CAM` → `SÁP/Cadcam`
- `sườn` → `SƯỜN`
- `đắp` → `ĐẮP`
- `mài` → `MÀI`

Mapping user cong_doan → room (`users.routes.js`):
- `sáp` → `sap`
- `CAD/CAM` → `zirco`
- (khac) → null (khong filter room)

### Permission `can_view_stats`

- Luu trong `users.json`.
- Admin luon thay summary stats chip mobile (bypass).
- User chi thay summary `/api/stats/daily` neu `can_view_stats = true`.
- User van dung filter chip ngay ca khi khong co quyen xem summary.
- Toggle via `PATCH /api/admin/users/:username/stats-permission`.

### Middleware

- `requireAuth(req, res, next)` — doc cookie `sid` qua `getSessionToken()`, `getSession(token)` check expiry, attach `req.session = {username, role, cong_doan}` hoac redirect `/login` (browser) hoac 401 JSON (API).
- `requireAdmin(req, res, next)` — `requireAuth` + check `role === 'admin'`, else 403 JSON.
- `loginLimiter` — `express-rate-limit`, 5 attempt / 15 phut, return 429 sau khi vuot quota.
- `blockDirectHtml` — chan request `.html` (tru `login.html`) chua auth.
- `serveErrorImages` — static `/uploads/error-images` co auth check.

---

## 7. Cong doan va business rules

### Thu tu cong doan chuan
1. `CBM`
2. `SÁP/Cadcam`
3. `SƯỜN`
4. `ĐẮP`
5. `MÀI`

`STAGE_NAMES` constant trong `orders.repo.js`.

### Stage colors (frontend)
```javascript
STAGE_COLORS = {
  'CBM':          '#3b82f6',  // xanh duong
  'SÁP/Cadcam':   '#a855f7',  // tim
  'SƯỜN':         '#f59e0b',  // vang
  'ĐẮP':          '#f97316',  // cam
  'MÀI':          '#10b981',  // xanh la
}
```

### Stage skip rules

Logic trong `getSkipStages(loai_lenh, ghi_chu)` (`orders.repo.js`) — ap dung ca cho dashboard stage progress va `/api/user/pending-orders`:

- `Sửa`: bo `CBM`, `SÁP/Cadcam`, `SƯỜN`; chi can 2 cong doan cuoi `ĐẮP` → `MÀI`.
- `Làm tiếp`: bo `CBM`, `SÁP/Cadcam`, `SƯỜN`; chi can 2 cong doan cuoi `ĐẮP` → `MÀI`.
- **Thu suon** (ghi_chu/loai_lenh co token `TS` hoac `thử sườn`): bo `ĐẮP`, `MÀI`; chi can 3 cong doan dau `CBM` → `SÁP/Cadcam` → `SƯỜN`.
- `Làm mới`, `Làm lại`, `Bảo hành`, `Làm thêm`: mac dinh di du 5 cong doan tru khi ghi_chu co rule khac.

### Quan trong / luu y

- Pattern `TS` hien match theo token ro rang (`\bts\b`) sau khi normalize bo dau, tranh bat nham chuoi nhu `LTTS`, `LLTS`, `BHTS`.
- "Thu tho" chua co logic chinh thuc. Neu them, nen match token `TT` ro rang de tranh bat nham (`LTTT`, `LLTT`).
- Logic skip dung **ca cho stage progress hien thi** va **`/api/user/pending-orders`**. Sua phai dong bo ca 2 cho.

### Loai lenh (loai_lenh enum)

`normalizeOrderType()` map ve:
- `Làm mới` (fresh)
- `Làm thêm` (add)
- `Làm lại` (rework)
- `Bảo hành` (warranty)
- `Sửa` (repair)
- `Làm tiếp` (continue)
- `Khác` (others)

---

## 8. Routing sap/zirco

Logic chinh trong `src/utils/phucHinh.js` va `db_manager.py.default_room_for()` — phai dong bo Python va JS.

### classifyPhucHinh(text) → loai

Returns one of: `'zirc'`, `'kl'`, `'vnr'`, `'hon'`, `'inmau'`, `'tam'`, `'unknown'`.

Match keywords (normalize NFD lowercase remove diacritics):
- **zirc** (zirconia): `zirconia`, `zolid`, `cercon`, `la va` (lava), `argen` → room `zirco`
- **kl** (kim loai): `kim loai`, `titanium`, `chrome`, `cobalt` → room `sap`
- **vnr** (veneer/mat dan): `veneer`, `mat dan` → room ?
- **hon** (cui gia): `cui gia` zirconia → room `both`
- **inmau** (in mau): `in mau ham` → room `zirco`
- **tam** (rang tam): `rang tam`, `pmma` → xu ly rieng

### Routing rules
- Zirconia, zolid, cercon, lava, argen → `zirco`
- Kim loai, titanium, chrome, cobalt → `sap`
- Cui gia zirconia → `both`
- In mau ham → `zirco`
- PMMA / rang tam → xu ly rieng (khong route mac dinh)
- Khong classify duoc nhung co phuc_hinh → mac dinh `sap`

`don_hang.routed_to` duoc backfill khi:
- Migrate `initRoutedToColumn()` (run boot).
- Import don hang moi (`db_manager.upsert_don_hang()` → `default_room_for(phuc_hinh)`).
- Sync notes Keylab: neu note co "in mau ham" → override `routed_to = 'zirco'`.

### `hasInMauHam(text)`

Check `'in mau ham'` hoac (`'in mau'` + `'ham'`) trong `phuc_hinh` OR `ghi_chu_sx`. Neu match → override room sang `zirco`.

### Route API

- `GET /api/orders/by-barcode/:code`: tim order theo `barcode_labo` truoc, fallback `ma_dh`. Tra ve `{order, classify, sap_cadcam_confirmed}`.
- `POST /api/orders/route`: body `{ma_dh, target_room}` (target ∈ `sap`/`zirco`/`both`).
  - Validate target.
  - Khong cho route neu `SÁP/Cadcam` da `xac_nhan = 'Có'` (don da qua stage 2).
  - Update `routed_to` trong DB.
  - Reset cache.

Mobile dung `routed_to` de hien mau stripe:
```javascript
ROOM_COLORS = {
  sap:   '#f59e0b',  // cam (vang nau)
  zirco: '#2563eb',  // xanh duong
  both:  '#0891b2',  // teal
  none:  '#9ca3af',  // xam
}
```

User sap (cong_doan `sáp`) co button "Quet chuyen sang Zirco", va nguoc lai.

---

## 9. API routes — day du request/response

### Auth

| Method | Path | Auth | Body / Query | Response |
|---|---|---|---|---|
| GET | `/login`, `/login.html` | none | — | Serve `login.html` (redirect `/` neu da login) |
| POST | `/login` | loginLimiter | `username`, `password` | Redirect `/` (success) hoac `/login?error=...` (fail), 429 neu rate-limited |
| GET | `/logout` | session | — | Delete session, clear cookie, redirect `/login` |

### Dashboard & core data

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/` | requireAuth | Serve `dashboard.html` hoac `dashboard_mobile_terracotta.html` (UA-based) |
| GET | `/mobile` | requireAuth | Serve mobile dashboard |
| GET | `/analytics` (& `.html`) | requireAdmin | Serve `analytics.html` |
| GET | `/data.json` | requireAuth | `{source: {db, active}, orders: [...]}` cached 60s |
| GET | `/reload` | requireAuth | `resetCache()` + `closeDB()` + `initKeylabNotesRouting()` + return fresh data |
| GET | `/status` | requireAuth | `{status, time, excel_dir, latest_export, db: {don_hang, tien_do}}` |
| GET | `/files` | requireAuth | `[{name, size, mtime}]` cua `Excel/` |
| GET | `/upload` | requireAuth | Serve `upload.html` |
| POST | `/upload` | requireAdmin | Multer `excel` field (max 20MB). Response `{ok, filename, size}`. Queue scraper. |

### Orders

| Method | Path | Auth | Query/Body | Response |
|---|---|---|---|---|
| GET | `/api/orders` | requireAuth | `ma_dh_goc?, loai_lenh?, tai_khoan?, limit?, offset?` | `{ok, count, orders: []}` |
| GET | `/api/orders/search` | requireAuth | `q` (>=2 chars) | `{ok, results: []}` (max 20) — LIKE `ma_dh`, `barcode_labo`, `khach_hang`, `benh_nhan` |
| GET | `/api/orders/by-barcode/:code` | requireAuth | — | `{order, classify, sap_cadcam_confirmed}` (tim barcode → fallback ma_dh) |
| POST | `/api/orders/route` | requireAuth | `{ma_dh, target_room}` (target ∈ sap/zirco/both) | `{ok}` hoac `{error}` neu sap_cadcam da confirm |
| GET | `/api/orders/:ma_dh` | requireAuth | — | `{order, stages: [], variants: []}` (variants la cac don phu cua ma_dh_goc) |

### User profile

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/user` | requireAuth | `{username, role, cong_doan, can_view_stats}` |
| GET | `/api/user/pending-orders` | requireAuth | `{ok, orders: []}` — orders cua cong_doan user, ap skip rules |

### Admin

| Method | Path | Auth | Body/Query | Response |
|---|---|---|---|---|
| GET | `/admin` | requireAdmin | — | Serve `admin.html` |
| GET | `/admin/api/users` | requireAdmin | — | `{users: [{username, role, cong_doan, can_view_stats}]}` |
| POST | `/admin/api/users` | requireAdmin | `{username, password, role, cong_doan}` | `{ok}` |
| PATCH | `/admin/api/users/:username/cong-doan` | requireAdmin | `{cong_doan}` | `{ok}` |
| DELETE | `/admin/api/users/:username` | requireAdmin | — | `{ok}` (chan xoa chinh minh) |
| POST | `/admin/api/users/:username/reset-password` | requireAdmin | `{newPassword}` | `{ok}` |
| PATCH | `/api/admin/users/:username/stats-permission` | requireAdmin | `{can_view_stats}` | `{ok}` |
| GET | `/admin/api/production-stats` | requireAdmin | — | `{days, totals: {qty, orders, employees}, stages: [{stage, employees: [{ktv, totalQty, byDay}]}]}` (3 ngay completion gan nhat) |
| GET | `/admin/api/monthly-stats` | requireAdmin | `?month=YYYY-MM` | `{month, months, period, data: [{cong_doan, ten_ktv, orders_completed, total_sl, type_breakdown, entries}]}` |
| GET | `/admin/api/delay-risk-orders` | `stats.view_production` | `?limit=80` | `{ok, count, counts, source, sampleOrders, data: [{ma_dh, severity, due_at, current_stage, benchmark, reasons}]}` |

### Scraper

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/scrape-status` | requireAuth | `{job, queue: [filenames]}` |
| GET | `/api/auto-scrape/status` | requireAuth | `{enabled, running, currentFile, nextRun, mode, queue}` |
| POST | `/api/auto-scrape/run` | requireAdmin | Spawn latest Excel. Error 409 neu running. |
| GET | `/keylab-status` | requireAuth | `{running, startedAt, exitCode, savedFile, log: []}` |
| GET | `/keylab-health` | requireAuth | `{ok, message}` (spawn `keylab_exporter.py --check`) |
| POST | `/keylab-export-now` | requireAdmin | Pre-flight health check. Spawn `keylab_exporter.py --once`. Return `{ok, message}` |
| GET | `/keylab-export-status` | requireAuth | (alias `/keylab-status`) |

### Analytics

Simple (legacy `analytics.html`):

| Method | Path | Auth | Query | Response |
|---|---|---|---|---|
| GET | `/api/analytics/ktv` | requireAuth | — | `[{ten_ktv, cong_doan, tong, da_xong}]` |
| GET | `/api/analytics/daily` | requireAuth | — | `[{ngay, cong_doan, so_cong_doan}]` |
| GET | `/api/db/stats` | requireAuth | — | `{don_hang, don_phu, tien_do, files_imported, last_import}` |
| GET | `/api/analytics/trend` | requireAuth | `?days=7` | Daily trend tu `analytics_daily` |
| GET | `/api/analytics/customers` | requireAuth | `?limit=10` | Top customers |
| POST | `/api/analytics/refresh` | requireAuth | — | Stub (chua implement) |

Historical (cho `analytics.html`):

| Path | Query | Response |
|---|---|---|
| `/api/analytics/history/ktv-performance` | `?days=30&cong_doan=` | `[{ten_ktv, cong_doan, total_done, avg_hours}]` |
| `/api/analytics/history/top-ktv` | `?days=30&limit=10` | `[{ten_ktv, total_stages, completed, completion_rate}]` |
| `/api/analytics/history/stage-stats` | `?days=30` | `[{cong_doan, total, completed}]` |
| `/api/analytics/history/phuc-hinh-distribution` | `?days=30` | Group by type (zirc/kl/vnr/hon) |
| `/api/analytics/history/top-customers` | `?days=30&limit=10` | `[{ten_nha_khoa, total_orders, total_rang}]` |
| `/api/analytics/history/overview` | `?days=30` | `{total_records, unique_orders, unique_ktv, unique_customers, completed_stages}` |

### Daily stats (chip mobile)

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/stats/daily` | requireAuth + `can_view_stats` | `{ok, data: [{ngay, ngay_sort, mat_dan, kim_loai, zirconia, cui_gia, in_mau_ham, rang_tam, tong}]}` group theo `yc_hoan_thanh` |

### Feedback

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/feedback/types` | requireAuth | List active types |
| POST | `/api/feedback/types` | requireAdmin | Create type |
| DELETE | `/api/feedback/types/:id` | requireAdmin | Soft delete (active=0) |
| GET | `/api/feedbacks` | requireAuth | `?ma_dh=&status=` (max 100) |
| POST | `/api/feedbacks` | requireAuth | `{ma_dh, feedback_type_id, description, severity}` |
| PATCH | `/api/feedbacks/:id` | requireAuth | `{status, assigned_to}` (set resolved_at neu closed/resolved) |

### Bao loi

| Method | Path | Auth | Body/Query | Response |
|---|---|---|---|---|
| GET | `/bao-loi` | requireAuth | — | Serve `bao_loi.html` |
| GET | `/error-reports` | requireAdmin | — | Serve `error_reports.html` |
| GET | `/api/error-reports/allowed-stages` | requireAuth | — | `[stage]` allowed cho role/cong_doan |
| GET | `/api/error-codes` | requireAuth | `?cong_doan=` | List active codes |
| POST | `/api/error-codes` | requireAdmin | `{ma_loi, ten_loi, cong_doan, mo_ta}` | `{ok}` |
| PATCH | `/api/error-codes/:id` | requireAdmin | partial update | `{ok}` |
| DELETE | `/api/error-codes/:id` | requireAdmin | — | `{ok}` (active=0) |
| POST | `/api/error-reports` | requireAuth | FormData `ma_dh, error_code_id, mo_ta, hinh_anh` | `{ok}` (uploads anh sang R2) |
| GET | `/api/error-reports` | requireAuth | `?trang_thai=&cong_doan=` | List reports (non-admin auto filter `submitted_by`) |
| GET | `/api/error-reports/stats` | requireAuth | — | Aggregate by trang_thai/cong_doan/submitted_by/ma_loi_text |
| GET | `/api/error-reports/monthly-stats` | `error_reports.review` | `?month=YYYY-MM` | Ky 26-25, summary/by_stage/top_errors/by_user |
| PATCH | `/api/error-reports/:id/confirm` | requireAdmin | — | `{ok}` |
| PATCH | `/api/error-reports/:id/reject` | requireAdmin | `{ghi_chu_admin}` | `{ok}` |

### Munger (KPI dashboard)

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/munger` | requireAdmin | Serve `munger.html` |
| GET | `/api/munger/metrics` | requireAdmin | `?days=7\|30\|60` (default 30 = kỳ 26-25). Response: `{ok, billing_period, data: {bus_factor, wip_ratio, first_pass_yield, on_time_rate, customer_concentration, demand_trend, scale_countdown}}` |

KPI shapes:
- `bus_factor`: `{stages, worst_stage, worst_pct, status}` (top KTV % per stage)
- `wip_ratio`: `{head, tail, ratio, by_stage, status}` (head = CBM+SÁP vs tail = ĐẮP+MÀI)
- `first_pass_yield`: `{value, total, rework, target: 90, status}`
- `on_time_rate`: `{value, on_time, total, target: 90, status}`
- `customer_concentration`: `{top5_pct, total_rang, top5_rang, top5: [], status}`
- `demand_trend`: `{curr_rang, prev_rang, change_pct, daily_avg, sparkline, status}`
- `scale_countdown`: `{target: 10000, current_rate, pct_of_target, days_until, status}`

---

## 10. Frontend behavior chi tiet

### login.html
- Form POST `/login` voi `username`, `password`.
- Hien error neu URL co `?error`.
- Dark theme terracotta. Logo 🦷.
- Responsive breakpoint 420px.

### dashboard.html (desktop)
- Doc `/data.json`.
- Auto refresh moi **5 phut**.
- Admin thay button: "Admin Dashboard", "Upload Excel", "Xuat Excel KeyLab" (POST `/keylab-export-now` + poll), "Munger Dashboard".
- User thuong: chuyen sang view pending order theo cong doan.
- Render: order card, stage pips ngang (5 cong doan), filter phuc hinh (`zirc/kl/vnr/tam/inmau/hon/all`), pipeline view (group by `yc_giao` time window: sang 08-11, trua 11-14, chieu 14-18, toi 18-23), summary stats.
- Stage pips: `.done` = filled glow, `.current` = 50% fill, `.skip` = pattern xach.

### dashboard_mobile_terracotta.html
- Auto detect cong_doan:
  - Admin hoac user khong cong_doan: doc `/data.json`.
  - User co cong_doan: doc `/api/user/pending-orders`.
- Filter chips horizontal scroll: tat ca, zirconia, kim loai, mat dan, cui gia, in mau, rang tam.
- Summary chip pills theo `yc_ht` chi hien neu admin OR `can_view_stats`.
- Modal stage progress: hien thu tu CBM/SÁP/SƯỜN/ĐẮP/MÀI + thoi gian hoan thanh + KTV.
- Route color stripe trai card: ROOM_COLORS theo `routed_to`.
- Auto refresh: **30 phut** neu user, **60 phut** neu admin.
- Keylab export polling: moi **2 phut** poll `/keylab-export-status` + `/scrape-status` khi co job.
- Barcode scanner: ZXing UMD CDN `@zxing/library@0.19.2`, `facingMode: 'environment'`, scan → `searchOrders(value, {autoSelectExact: true})`.
- FAB button "Quet chuyen qua [room khac]" cho user co cong_doan (sap/CAD-CAM): scan barcode → POST `/api/orders/route` target = `getTransferTargetRoom(myRoom)`.

Mobile WIP:
- Menu admin co tab/button `WIP cong doan`: mo panel full-screen rieng tren mobile, dung `allOrders` hien co.
- WIP mobile bam theo desktop pipeline: `Tat ca WIP` = don con bat ky cong doan chua xong; tung cong doan = don co stage do chua `x` va khong skip. Card WIP click mo modal chi tiet don.

### admin.html
- Tab Users:
  - Liet ke + create + delete + set cong_doan + reset password + toggle `can_view_stats`.
- Tab Error Codes:
  - Grouped by stage, mau theo `STAGE_COLORS`.
  - CRUD: mã lỗi, tên lỗi, công đoạn, mô tả.
- Tab Error Reports:
  - Filter: all / pending / confirmed / rejected.
  - Thong ke thang bao loi ky thuat theo ky 26-25: tong, confirmed rate, so voi ky truoc, gio duyet TB, by_stage/top_errors/by_user.
  - Card: ma_dh + stage badge + error code + status badge + meta + multi-photo thumbnails + mo ta + reviewed info.
  - Approve: PATCH `/confirm`. Reject: modal note → PATCH `/reject`.
  - Lightbox: click photo → fullscreen, click outside → close.
- Tab Production Stats (3 ngay):
  - Bang dates (rows) × stages (cols), cell `{qty, orders}`.
  - Click cell → drill-down KTV list.
- Tab Monthly Stats:
  - Period selector "Ky 26-25 (DD/MM - DD/MM)".
  - Aggregate by stage + KTV.
- Tab Delay Risk:
  - Goi `GET /admin/api/delay-risk-orders?limit=80`.
  - Tach rieng khoi tab thong ke de dashboard admin khong bi dai.
  - Desktop hien table rong de so sanh nhieu cot; mobile an table va hien card list 2 cot thong tin de de thao tac.
  - Card/table co ma don, muc canh bao, tien do active, han, du kien hoan thanh, ti le ca tuong tu dung/trễ, benchmark p50/p75 va nut `Xem don`.

### upload.html
- Drag-drop hoac file input `.xlsx/.xls/.xlsm`, max 20MB.
- POST `/upload` FormData voi XHR progress tracking.
- Sau upload: `loadFileList()` + `pollScrapeStatus()` moi 1.5 phut.
- Log box highlight ERROR (do), OK (xanh), DONE (cam).

### analytics.html
- Charts: Chart.js v4.4.0 CDN.
- Doughnut: phuc_hinh distribution (kl/zirc/vnr/hon).
- Bar: stage stats (completed vs total).
- Table top 10 KTV + top 10 customers.

### munger.html
- 7 metric cards trong 2 row (4 + 3).
- Auto refresh moi 5 phut.
- Status bar: green dot (loaded), orange (loading), red (error).
- Default range: 30 ngay (billing 26-25). Options: 7, 30, 60.

### bao_loi.html
- Tieu de/hien thi la "Bao loi ky thuat".
- Field: ma_dh (autocomplete + barcode scan), cong_doan (dropdown allowed stages), error_code (dropdown filtered by cong_doan), hinh_anh (file input multiple + thumbnail preview), ghi_chu.
- Order autocomplete: input >=2 chars → debounce 200ms → `GET /api/orders/search` → dropdown.
- Submit FormData → POST `/api/error-reports`. Success → toast, reset form.

### error_reports.html
- Stats cards: Total / Pending / Confirmed / Rejected.
- Monthly stats theo ky 26-25.
- Stage breakdown chips.
- Filter buttons: All / Pending / Confirmed / Rejected.
- Cards: grid thumbnail tat ca anh, lightbox.
- Approve / Reject buttons (chi hien khi pending).

### Shared technical patterns

| Aspect | Pattern |
|---|---|
| Auth check | `/user` endpoint, redirect `/login` neu 401 |
| Polling | `setInterval` 30-60s, hoac event-driven |
| Forms | FormData + XHR (upload) hoac Fetch (data) |
| Search | Debounce + `/api/.../search?q=` |
| Barcode | ZXing UMD CDN + environment camera |
| Mobile | CSS `@media (max-width:768px)` + `100dvh` + tap-highlight disabled |
| Charts | Chart.js CDN |
| Images | Lightbox overlay click-to-close |
| State | Global JS variables + re-render on update |
| Modals | `display:none` ↔ `classList.toggle('show'/'open')` |

Theme: dark + terracotta accent `#a85a4f`. Mobile-first.

---

## 11. Scraper va automation chi tiet

### auto_scrape_headless.py

- Entry: `main()` vong lap vo tan, khong CLI flag.
- Config: `INTERVAL_MINUTES = 10`, `NOTES_TIMEOUT_SECONDS = 30*60 = 1800s`, `run_scrape timeout = 300s`.
- Function chinh:
  - `find_newest_excel()` — quet `Excel/`, bo file `_scraped/_final/_cleaned`.
  - `get_last_run_file()` — doc `labo_config.json.last_run_file`.
  - `should_retry_failed_notes()` — kiem tra `scraper_errors.json`.
  - `scrape_excel(file, run_notes)` — subprocess `run_scrape.py`.
  - `scrape_keylab_notes(file)` — subprocess `keylab_notes_scraper.py`.
  - `run_new_file(file)` — `threading` chay song song 2 thread (run_scrape + keylab_notes_scraper).
- Flow:
  1. Lap moi 10 phut.
  2. Tim Excel moi nhat.
  3. Compare voi `last_run_file`:
     - File moi → `run_new_file()` (parallel).
     - File cu + notes loi → notes-only retry.
     - File cu OK → progress-only.
  4. Cap nhat `last_run_file` neu run_scrape thanh cong.
  5. Log vao `auto_scrape.log` + stdout.
- Error handling: subprocess timeout → log error, tiep tuc cycle. Thread join: 310s run_scrape, 1800s+ notes.

### run_scrape.py

- Entry: `python run_scrape.py <excel_path>`.
- Env: `LABO_USER1..4`, `LABO_PASS1..4` (toi da 4 worker).
- Config: BASE_URL `https://laboasia.com.vn/scan`, `page_timeout_ms=30_000`, `max_retry_per_order=2`.
- Flow:
  1. `detect_sheet_col()` — auto detect sheet + column ma_dh (normalize lowercase, remove diacritics, fuzzy match "ma" + "dh"/"don"/"order").
  2. Validate env (it nhat USER1+PASS1).
  3. Tao `queue.Queue` cua ma_dh list.
  4. Spawn N thread `LaboAsiaAPIClient.scrape_order_queue(queue, event_queue, worker_name)`.
  5. Event types qua event_queue:
     - `("log", msg)`
     - `("order_done", worker_name, ma_dh, rows_count, error)`
     - `("worker_finished", worker_name, results, failed, ...)`
  6. `build_progress_df()` → DataFrame.
  7. Output: `Data/<stem>_scraped.json` + `Data/<stem>_scraped.xlsx`.
  8. Neu input `.xls` → convert temp `.xlsx` trong `Data/`.
  9. `subprocess.run(labo_cleaner.py <scraped.xlsx>)` → `File_sach/<stem>_final.xlsx`.
  10. `db_manager.init_db()` + `import_json()` + `import_excel_final()`.
  11. Cleanup: xoa `json_out`, `scraped_xlsx`, `clean_out`, temp xlsx.
  12. Exit 0 neu co result, 1 neu khong.

### laboasia_gui_scraper_tkinter.py

- Ten file legacy (con tu thoi tkinter), nhung core hien la `LaboAsiaAPIClient`.
- Data model `ProgressRow`:
  ```python
  @dataclass
  class ProgressRow:
      ma_dh: str
      thu_tu: int           # 1-5
      cong_doan: str        # CBM, SÁP/Cadcam, SƯỜN, ĐẮP, MÀI
      ten_ktv: str
      xac_nhan: str         # "Có" / "Chưa"
      thoi_gian_hoan_thanh: str  # DD/MM/YYYY HH:MM:SS
      raw_row_text: str = ""
      tai_khoan_cao: str = ""
      barcode_labo: str = ""
  ```
- API endpoint: `POST https://laboasia.com.vn/empconnect/api_handler/` voi `Authorization: Bearer <jwt>`.
- Flow login:
  1. Playwright launch Chromium headless.
  2. Navigate BASE_URL.
  3. Fill username + password (multi-selector fallback).
  4. Click login.
  5. Wait networkidle.
  6. Extract cookie `auth_token` → JWT string.
  7. Close browser.
  8. Tao `requests.Session()` + header `Authorization: Bearer <token>`.
- HTTP 401 → re-login (auto).
- Timeout `page_timeout_ms = 12000` (12s), `max_retry_per_order = 3`.
- `scrape_order_queue()`: pull tu queue → POST API → parse → post event → loop.

### labo_cleaner.py

- Entry: `python labo_cleaner.py <input.xls(x)> [output.xlsx]`. Default output `<stem>_cleaned.xlsx`.
- Input: 2 sheet (Don hang + Tien do).
- Output: 3 sheet:
  - **Sheet 1 "Đơn hàng"** (10 cot): Ma DH, Nhan luc, Y/c hoan thanh, Y/c giao, Khach hang, Benh nhan, Phuc hinh, SL, Ghi chu DP, Trang thai. Styling: header blue #1F4E79, alt row #F2F7FC, SL>=5 do tren vang, TONG row cuoi.
  - **Sheet 2 "Tiến độ công đoạn"** (10 cot): Ma DH, TT, Cong doan, KTV, Xac nhan, Thoi gian HT, Phuc hinh, SL, Loai lenh, Tai khoan. Xac nhan "Có" green #C6EFCE, "Chưa" yellow #FFEB9C. Loai lenh color map. Alt row toggle per ma_dh.
  - **Sheet 3 "Tổng hợp"** (3 sections):
    1. Tien do cong doan: Da XN / Chua XN / % / Tong SL per stage.
    2. Khoi luong KTV: Top KTV → So lan XN, Tong SL, Cong doan chinh.
    3. Tong SL theo loai phuc hinh sorted desc.
- Constants:
  - `ACCOUNTS = ["hyct", "kythuat", "sonnt", "lanhn"]`
  - `LOAI_LENH = ["Làm mới", "Làm lại", "Bảo hành", "Làm tiếp", "Làm thêm", "Sửa"]`
  - `CONG_DOAN = ["CBM", "SÁP/Cadcam", "SƯỜN", "ĐẮP", "MÀI"]`
- Helper: `extract_sl(text)` regex `SL:(\d+)`, `extract_account()`, `extract_loai_lenh()`, `clean_noise()`, `fill_sl_from_orders()`.

### db_manager.py

- CLI:
  - `python db_manager.py init` — create/migrate schema, recalc routed_to, sync keylab_notes.
  - `python db_manager.py stats` — print stats dashboard.
  - `python db_manager.py import-json <file.json>` — import 1 JSON.
  - `python db_manager.py import-excel <file_final.xlsx>` — import 1 Excel.
  - `python db_manager.py import-all` — scan `File_sach/*_final.xlsx` + `Data/*_scraped.json`, skip da import (check `import_log`).
- Helper:
  - `parse_ma_dh(ma_dh)` → `(ma_dh_goc, so_phu)` tuple.
  - `default_room_for(phuc_hinh)` → `"sap"|"zirco"|"both"|"none"`.
  - `normalize_ascii(value)` → NFD lowercase remove diacritics.
  - `has_in_mau_ham(value)` → check keyword.
  - `norm_date(val)` → `DD/MM/YYYY HH:MM:SS`.
  - `upsert_don_hang(conn, row)` — INSERT ON CONFLICT DO UPDATE (prefer non-empty fields).
  - `upsert_tien_do(conn, row)` — INSERT ON CONFLICT DO UPDATE.
  - `sync_keylab_notes(conn)` — read `keylab_notes.json` → UPDATE `don_hang.ghi_chu_sx`.
- PRAGMA: WAL, foreign_keys=ON, busy_timeout=30000.

### keylab_exporter.py

- CLI flags:
  - `--debug` — print control tree (find auto_id).
  - `--debug-save` — debug Save As dialog detection.
  - `--check` — health check (exit 0 neu Keylab running).
  - `--once` — export 1 lan.
- Config: `MAX_EXPORT_RETRIES=2` (3 attempt total), `SAVE_DIALOG_TIMEOUT=5s`, `RETRY_DELAY=2s`.
- State file: `keylab_state.json` `{date: "DD/MM/YYYY", export_count: N}`. Reset count per day.
- Window detection: UIA backend, title chua "keylab" + ("version" or "lab asia"), exclude terminal.
- Flow:
  1. Find window → restore + focus.
  2. Click `btnTimKiem` (auto_id) → wait 3s.
  3. Click `btnXuatExcel` → wait 2s.
  4. Poll Save As dialog (0.3s interval, 5s).
  5. UIA: Edit auto_id="1001" → Ctrl+A + type filename `DDMMYYYY_N`.
  6. Click button auto_id="1" (Save) → wait 1.5s.
  7. Dismiss "Open with" dialog (Escape).
- Output: `Excel/DDMMYYYY_N.xlsx`. Print `SAVED:<path>` cho stdout.
- Logs: `keylab_export.log`.

### keylab_notes_scraper.py

- CLI flags:
  - (no flag) — normal mode, require DB co data.
  - `--dry-run` — test filter, khong click.
  - `--new-file` — parallel voi run_scrape, wait DB import.
- Config: `BATCH_SIZE=10`, `FILTER_WAIT_SEC=0.5`, `DETAIL_WAIT_SEC=0.8`, `CLOSE_WAIT_SEC=0.3`, `CLEAR_WAIT_SEC=0.3`, `WAIT_FOR_DB_SEC=420` (7 phut).
- Filter logic `get_todo_from_db()`:
  1. Load tat ca ma_dh tu Excel active.
  2. Query DB `ghi_chu_sx`, `phuc_hinh` cho moi ma_dh.
  3. Skip neu `ghi_chu_sx IS NOT NULL AND != ''`.
  4. Skip neu `has_in_mau(phuc_hinh)`.
  5. Don khong trong DB → van them vao todo (scrape va save sau khi DB co data).
  6. Stats: Tong / Da co / Co InMau / Chua DB / Can cao.
- Flow per ma_dh:
  1. Filter Row → input ma_dh → Enter (wait 0.5s).
  2. Find visible row in Data Panel.
  3. Double-click → mo detail `FormTaoDonHang` (wait 0.8s).
  4. Doc cell `Ghi chú SX row N` tu `gridControlDonHang` (multi-method fallback).
  5. Click `btnDongLai` (wait 0.3s).
  6. Clear filter (wait 0.3s).
- Batch save moi 10 don: `UPDATE don_hang SET ghi_chu_sx = ?` (chi neu ghi_chu_sx hien tai rong).
- Neu `has_in_mau_ham(note)` → `UPDATE routed_to = 'zirco'`.
- Error → ghi `scraper_errors.json`. Success + had errors → delete file.
- **`os._exit(0 or 2)`** — tranh COM thread giu process hang.

---

## 12. Bao loi ky thuat, bao tre, image va R2

### Bao loi ky thuat schema
- `error_codes`: danh muc (id, ma_loi, ten_loi, cong_doan, mo_ta, active).
- `error_reports`: bao loi ky thuat (ma_dh, error_code_id, cong_doan, hinh_anh, mo_ta, trang_thai, submitted_by/at, reviewed_by/at, ghi_chu_admin).
- `hinh_anh` moi la JSON array image refs; code van doc duoc legacy single URL/path.

### Role logic (`getAllowedStages(username, role, cong_doan)`)
- Admin + QC: thay tat ca cong_doan.
- User `CBM`: chi bao CBM.
- User `dap`/`mai`: thay cong doan truoc do + dap/mai theo flow chuoi kim loai/zirconia.
- User `sap`/`CAD/CAM`/`suon`: thay cong doan truoc do theo flow kim loai/zirconia.

### Bao tre cong doan
- `delay_reports.cong_doan_bao_tre` la cong doan user muon bao tre, khong nhat thiet bang cong doan dang lam.
- API `/api/delay-reports/allowed-stages` tra danh sach cong doan duoc bao theo user.
- Rule: user chi bao cong doan truoc hoac song song voi cong doan cua minh. `sap` song song `CAD/CAM`; `dap` song song `mai`.
- Anh bao tre cung dung R2 va JSON array refs nhu bao loi ky thuat.

### Image upload
- Form field: `hinh_anh`.
- Multer array, gioi han **10 MB/file**, toi da `REPORT_IMAGE_LIMIT` anh/report.
- Mime check: chi chap nhan `image/*`.
- `sharp` xu ly:
  - Auto rotate (EXIF).
  - Resize fit-inside `IMAGE_MAX_WIDTH` × `IMAGE_MAX_HEIGHT` (default 1600×1600).
  - WebP encode `IMAGE_WEBP_QUALITY` (default 75).
- Upload R2 via `R2_*` env config.
- R2 URL pattern: `${R2_PUBLIC_URL}/<filename>.webp`.
- Route cleanup se xoa anh da upload neu validation sau upload bi fail.

### R2 client (`src/services/r2.service.js`)
- AWS SDK v3 `S3Client` voi `region: 'auto'`.
- Endpoint: `R2_ENDPOINT`.
- Credentials: `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`.
- Operations: `PutObjectCommand` (custom multer storage stream), `DeleteObjectCommand`.

### Image cleanup
- `startImageCleanupSchedule()` chay luc startup + setInterval 24h.
- `cleanupExpiredErrorImages()` query ca `error_reports` va `delay_reports` voi `submitted_at < now - IMAGE_RETENTION_DAYS`.
- Default retention 90 ngay.
- Delete: try R2 truoc, fallback `fs.unlink` local.
- Clear `hinh_anh` field trong DB.

### ENV vars R2
- `R2_ENDPOINT` (vd `https://<account>.r2.cloudflarestorage.com`)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME` (vd `labo-error-images`)
- `R2_PUBLIC_URL` (vd `https://pub-<id>.r2.dev`)
- `IMAGE_RETENTION_DAYS` (default 90)
- `IMAGE_MAX_WIDTH` (default 1600)
- `IMAGE_MAX_HEIGHT` (default 1600)
- `IMAGE_WEBP_QUALITY` (default 75)

---

## 13. Thong ke

### Daily mobile chip stats
- API: `GET /api/stats/daily`
- Auth: requireAuth + (admin OR `can_view_stats`).
- Source: read active Excel `ma_dh` list, group theo `yc_hoan_thanh`.
- Phan loai phuc hinh: `mat_dan`, `kim_loai`, `zirconia`, `cui_gia`, `in_mau_ham`, `rang_tam` (qua `classifyPhucHinhPart()`).
- Response: `{ok, data: [{ngay, ngay_sort, mat_dan, kim_loai, ..., tong}]}`.

### Production stats (3 ngay)
- API: `GET /admin/api/production-stats`
- Nguon: `tien_do JOIN don_hang`.
- Lay 3 ngay co `thoi_gian_hoan_thanh` gan nhat (xac_nhan='Có').
- Group theo cong_doan + KTV + loai_lenh.
- Response: `{days, totals: {qty, orders, employees}, stages: [{stage, employees: [{ktv, totalQty, byDay}]}]}`.

### Delay-risk orders
- API: `GET /admin/api/delay-risk-orders?limit=80`.
- Auth: `stats.view_production`.
- Nguon don hien tai: `getActiveMaDhList()` doc Excel active, sau do query `don_hang` + `tien_do`.
- Nguon benchmark: `tien_do_history`, lay completion moi nhat theo `ma_dh/thu_tu/cong_doan`, gom theo state `total_active_stages:done_active_stages`.
- Ap dung `getSkipStages(loai_lenh, ghi_chu)` truoc khi tinh tien do:
  - `Sửa` va `Làm tiếp`: chi tinh 2 cong doan cuoi `ĐẮP`, `MÀI`.
  - `Thử sườn`/token `TS`: chi tinh 3 cong doan dau `CBM`, `SÁP/Cadcam`, `SƯỜN`.
- Bo qua don da hoan tat, don khong co han hop le, va han `yc_hoan_thanh/yc_giao` som hon `nhap_luc`.
- Chi giu don co bang chung nguy co: da qua han, p75 lich su vuot han, ti le ca tuong tu dung han thap, hoac thoi gian con lai qua sat so voi p90.
- Response gom `count`, `counts.{critical,high,watch}`, `source`, `sampleOrders`, `generatedAt`, va list da sort theo muc do nguy co.

### Monthly stats (kỳ 26-25)
- API: `GET /admin/api/monthly-stats?month=YYYY-MM`.
- Auto chay `refreshMonthlyStats()` truoc khi query.
- Source: `tien_do_history` (fallback `tien_do`+`don_hang`).
- Group: billing_month + cong_doan + ten_ktv.
- Response: `{month, months, period, data: [{cong_doan, ten_ktv, orders_completed, total_sl, type_breakdown, entries}]}`.

### Report monthly stats (ky 26-25)
- Utility: `src/utils/reportStats.js`.
- Technical errors: `GET /api/error-reports/monthly-stats?month=YYYY-MM`, permission `error_reports.review`.
- Delay reports: `GET /api/delay-reports/monthly-stats?month=YYYY-MM`, permission `delay_reports.review`.
- Billing month label `YYYY-MM` la thang ket thuc ky; vi du `2026-05` = tu `2026-04-26` den `2026-05-25`.
- Bao loi ky thuat response gom `summary`, `by_stage`, `top_errors`, `by_user`, `months`, `period`, `previous_period`.
- Bao tre response gom `summary`, `by_stage`, `top_reasons`, `by_user`, `months`, `period`, `previous_period`.
- UI hien o `error_reports.html`, `delay_reports.html`, va tab Bao loi ky thuat trong `admin.html`.

### Munger metrics
- API: `GET /api/munger/metrics?days=30`.
- Admin only.
- 7 KPI: bus_factor, wip_ratio, first_pass_yield, on_time_rate, customer_concentration, demand_trend, scale_countdown.
- Default 30 ngay = 1 ky billing 26-25.

### Historical analytics
- 6 endpoint `/api/analytics/history/*`:
  - `ktv-performance`, `top-ktv`, `stage-stats`, `phuc-hinh-distribution`, `top-customers`, `overview`.
- Source: `tien_do_history`.
- Tat ca filter `?days=` (default 30).

---

## 14. Cach chay va verify

### Install Node deps
```powershell
npm install
```

### Install Python deps
```powershell
pip install -r requirements.txt
python -m playwright install chromium
```

### Start server local (dev)
```powershell
npm start
# = node server.js
```

### Start production (PM2)
```powershell
pm2 start ecosystem.config.js
pm2 startup
pm2 save
pm2 monit
```

### Start Caddy reverse proxy
```powershell
caddy run --config Caddyfile
# hoac
caddy start --config Caddyfile
```

### Syntax check Node
```powershell
npm run check
# = node --check server.js (chi check server.js)

# Check toan bo src/ thu cong:
Get-ChildItem -Path src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

### Syntax check Python
```powershell
python -m py_compile auto_scrape_headless.py run_scrape.py keylab_notes_scraper.py keylab_exporter.py db_manager.py labo_cleaner.py laboasia_gui_scraper_tkinter.py
```

### DB commands
```powershell
python db_manager.py stats
python db_manager.py init
python db_manager.py import-all
python db_manager.py import-json Data\some_scraped.json
python db_manager.py import-excel File_sach\some_final.xlsx
```

### Scrape commands
```powershell
python run_scrape.py Excel\some_file.xls
python auto_scrape_headless.py
python keylab_exporter.py --check
python keylab_exporter.py --once
python keylab_notes_scraper.py --dry-run
python keylab_notes_scraper.py --new-file
```

### PM2 commands
```powershell
pm2 status
pm2 describe asia-lab-server
pm2 describe auto-scrape
pm2 logs asia-lab-server --lines 80 --nostream
pm2 logs auto-scrape --lines 80 --nostream
pm2 restart asia-lab-server
pm2 restart auto-scrape
```

Chi restart production khi user yeu cau hoac khi can ap dung thay doi server-side ngay.

### Health check endpoints
- `http://localhost:3000/status` — server status snapshot.
- `http://localhost:3000/reload` — force refresh cache.
- `http://localhost:3000/keylab-health` — kiem tra Keylab2022 dang chay.

### Log files
- `logs/pm2-out.log`, `logs/pm2-error.log` — Node server.
- `logs/auto-scrape-out.log`, `logs/auto-scrape-error.log` — Python auto-scrape.
- `auto_scrape.log` — Python logger trong code.
- `keylab_export.log` — Keylab exporter.

---

## 15. ENV setup checklist

Truoc deploy, setup `.env`:

```bash
# Cloudflare R2 (BAT BUOC neu dung bao loi)
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=labo-error-images
R2_PUBLIC_URL=https://pub-<id>.r2.dev

# Image settings (co default)
IMAGE_RETENTION_DAYS=90
IMAGE_MAX_WIDTH=1600
IMAGE_MAX_HEIGHT=1600
IMAGE_WEBP_QUALITY=75

# Scraper credentials (BAT BUOC it nhat USER1+PASS1)
LABO_USER1=lanhn
LABO_PASS1=...
LABO_USER2=kythuat
LABO_PASS2=...
LABO_USER3=...   # optional
LABO_PASS3=...
LABO_USER4=...   # optional
LABO_PASS4=...

# Node (co default trong ecosystem.config.js)
PORT=3000
NODE_ENV=production
```

---

## 16. File khong nen sua tuy tien

Khong tu y sua, xoa, reset hoac commit cac file runtime sau neu task khong yeu cau ro:

- `.env`
- `users.json`
- `sessions.json`
- `labo_config.json`
- `keylab_state.json`
- `scraper_errors.json`
- `labo_data.db`
- `labo_data.db-wal`
- `labo_data.db-shm`
- `*.log`
- `logs/*`
- `Excel/*`
- `Data/*`
- `File_sach/*`
- `Data_thang/*`
- `uploads/error-images/*`
- `.claude/*`
- `node_modules/*`
- `__pycache__/*`

Khi can commit code/doc, chi add file lien quan. Repo co the dirty do runtime hoac user thao tac production.

---

## 17. Rui ro ky thuat can chu y

### Encoding
- PowerShell output co the mojibake voi tieng Viet co dau.
- KHONG ket luan file hong chi vi terminal hien sai dau.
- Khi sua so sanh chuoi tieng Viet → normalize unicode (NFD remove diacritics) hoac dung helper `normalize_ascii()` co san.
- Cong doan canonical co dau: `SÁP/Cadcam`, `SƯỜN`, `ĐẮP`, `MÀI`.

### SQLite concurrency
- Node va Python cung doc/ghi `labo_data.db`.
- DB WAL nhung Node van can `closeDB()` sau scrape de doc data moi.
- `scraper.service.js` co callback `_closeDB()` sau khi scraper xong.
- Python `busy_timeout=30000ms` lau hon Node `5000ms` vi import nang.
- Python `foreign_keys=ON` enforce CASCADE; Node khong (nhung code khong delete).

### Cache
- `orders.repo.js` cache `/data.json` 60 giay.
- Sau import/scrape phai goi `resetCache()` neu can data moi (scraper.service.js da goi qua callback).

### Business rules duplicate
Logic phan loai phuc hinh + stage skip nam o:
- `src/repositories/orders.repo.js` (skip rules)
- `src/routes/users.routes.js` (pending orders filter)
- `src/routes/stats.routes.js` (chip stats classify)
- `src/utils/phucHinh.js` (room routing)
- `db_manager.py` (Python equivalent route + classify)
- `dashboard.html` (frontend filter chip)
- `dashboard_mobile_terracotta.html` (frontend filter chip + phBreakdown)

**Sua rule nghiep vu phai dong bo tat ca cho tren.**

### Automation Windows
- `keylab_exporter.py` va `keylab_notes_scraper.py` phu thuoc Keylab2022 dang mo + UI control id co dinh.
- Focus / window state co the lam automation fail.
- `keylab_notes_scraper.py` dung `os._exit()` de tranh COM thread giu process hang.
- Save dialog + detail form co retry / timing rieng, KHONG nen toi uu sleep neu chua test that.

### Security
- KHONG log password, session token, R2 secret.
- Auth cookie chua set `Secure` (vi listen local sau Caddy). Neu chuyen topology → danh gia lai.
- Direct HTML access bi chan boi `blockDirectHtml` middleware (tru `login.html`).
- Route HTML deu co `requireAuth` / `requireAdmin`.
- `loginLimiter` 5 attempt / 15 phut chong brute force.

### File output cleanup
- `run_scrape.py` xoa `Data/*` va `File_sach/*` sau khi import thanh cong.
- Neu can dieu tra → DUNG xoa thu cong cho den khi check import_log.

---

## 18. Checklist khi sua tinh nang

### Truoc khi sua
- Doc file lien quan + `CONTEXT.md` (neu co) + `DISPLAY_FILTER_RULES.md` (neu co).
- Xac dinh thay doi co dung vao runtime data khong.
- Xac dinh API/frontend/Python nao cung can dong bo rule (xem section 17 "Business rules duplicate").

### Sau khi sua Node
- `npm run check` (chi check server.js).
- `node --check` thu cong cho file da sua.
- Test endpoint qua curl / browser neu co.

### Sau khi sua Python
- `python -m py_compile <file>` cho file da sua.
- Scraper → uu tien `--dry-run` truoc khi thao tac Keylab.
- DB import → chay tren file mau nho neu co the.

### Sau khi sua frontend
- Kiem tra fetch endpoint dung role.
- Mobile va desktop neu file la dashboard chung.
- Khong hardcode secret hoac token.

### Truoc khi restart
- Xac nhan can restart production khong.
- HTML static only → browser refresh du.
- Server-side Node → `pm2 restart asia-lab-server`.
- Auto scraper Python → `pm2 restart auto-scrape`.

---

## 19. Quick map cho nguoi moi

### Hieu dashboard hien don
1. `src/routes/dashboard.routes.js`
2. `src/repositories/orders.repo.js`
3. `dashboard.html` hoac `dashboard_mobile_terracotta.html`

### Hieu user pending
1. `src/routes/users.routes.js`
2. `src/repositories/users.repo.js`
3. `src/repositories/orders.repo.js` (skip rules)

### Hieu import DB
1. `run_scrape.py`
2. `labo_cleaner.py`
3. `db_manager.py`

### Hieu Keylab
1. `keylab_exporter.py` (export Excel)
2. `keylab_notes_scraper.py` (cao ghi chu SX)
3. `auto_scrape_headless.py` (orchestration)

### Hieu bao loi
1. `src/routes/errorReports.routes.js`
2. `src/services/image.service.js`
3. `src/services/r2.service.js`
4. `bao_loi.html`
5. `error_reports.html`

### Hieu bao tre tien do
1. `src/routes/delayReports.routes.js`
2. `bao_tre.html` — user co quyen quet barcode, nhap nguyen nhan, upload hinh.
3. `delay_reports.html` — man hinh duyet/tuy choi bao tre.
4. `src/services/image.service.js` — anh bao tre luu local WebP da nen.
5. `dashboard.html`, `dashboard_mobile_terracotta.html` — banner admin va card nhap nhay.

### Hieu stats
1. `src/db/migrations.js` (refreshMonthlyStats, billing 26-25)
2. `src/routes/admin.routes.js` (production-stats, monthly-stats, delay-risk orders)
3. `src/routes/stats.routes.js` (chip daily)
4. `src/routes/analytics.routes.js` (history endpoints)
5. `admin.html`, `analytics.html`, `munger.html`

### Hieu auth
1. `src/middleware/auth.js`
2. `src/middleware/security.js`
3. `src/services/session.service.js`
4. `src/repositories/users.repo.js`
5. `src/routes/auth.routes.js`

### Hieu routing sap/zirco
1. `src/utils/phucHinh.js` (JS canonical)
2. `db_manager.py` (Python equivalent, must sync)
3. `src/routes/orders.routes.js` (by-barcode, route POST)
4. `dashboard_mobile_terracotta.html` (room color + transfer scanner)

---

## 20. Troubleshooting nhanh

| Trieu chung | Kiem tra |
|---|---|
| Server khong start | `npm run check`, port 3000 free, `.env` ton tai, `node server.js` thu manual |
| Auto-scrape fail | `pm2 logs auto-scrape`, `LABO_USER1/PASS1` trong `.env`, `PLAYWRIGHT_BROWSERS_PATH` |
| Image upload fail | R2 credentials trong `.env`, network tu server → R2 endpoint |
| Bao tre upload fail | Kiem tra `uploads/error-images/`, quyen ghi local, `sharp`, va size anh <= 10MB |
| Caddy TLS fail | `caddy validate --config Caddyfile`, DNS `asiakanban.com` → server IP |
| PM2 crash loop | `pm2 logs`, `max_memory_restart` (500M / 300M) |
| Database lock | `pm2 restart asia-lab-server`, kiem tra Python scraper co dang ghi |
| Keylab export hang | `python keylab_exporter.py --check`, ensure Keylab2022 window not minimized |
| Notes scraper hang | Khong co — `os._exit()` luc finish; neu hang → kiem tra COM thread |
| Dashboard data cu | `/reload` endpoint, hoac wait 60s cache expire |
| Mobile filter sai | Check `routed_to` trong DB, sync logic Python vs JS (`phucHinh.js` vs `db_manager.py`) |
| Stats sai | `refreshMonthlyStats()` auto chay khi goi `/admin/api/monthly-stats`; kiem tra `tien_do_history` co data |
| Nguy co tre sai | Kiem tra `getSkipStages()` cho `Làm tiếp`/`Sửa`/`TS`, `tien_do_history` co sample, va han khong som hon `nhap_luc` |

---

## 21. Cap nhat phien 2026-05-15 — permission linh dong va bao tre tien do

### Muc tieu

Phien nay them flow **Bao tre tien do** va refactor phan quyen tu role cung sang permission linh dong theo user.

Nguyen tac moi:
- `role` van ton tai de lam template/mau nhanh: `admin`, `user`, `qc`, `delay_qc`.
- Quyen that su dung de check API nam trong `permissions` cua tung user.
- Admin co `permissions: ["*"]`.
- User co the co mot hoac nhieu quyen doc lap; vi du vua xem thong ke, vua bao tre, vua bao loi.

### Permission model

File chinh: `src/repositories/users.repo.js`.

Danh sach quyen hien co:

| Permission | Y nghia |
|---|---|
| `*` | Toan quyen |
| `orders.view_pending` | Xem don pending theo cong doan |
| `orders.view_all` | Du phong cho xem toan bo don |
| `orders.route` | Du phong cho chuyen phong |
| `stats.view_daily` | Xem chip thong ke ngay |
| `stats.view_production` | Xem thong ke san luong production |
| `stats.view_monthly` | Xem thong ke thang |
| `error_reports.submit` | Gui bao loi |
| `error_reports.view_own` | Xem bao loi cua minh |
| `error_reports.review` | Duyet/tuy choi bao loi |
| `error_codes.manage` | CRUD ma loi |
| `delay_reports.submit` | Gui bao tre tien do |
| `delay_reports.view_active` | Thay don dang bi bao tre active tren dashboard |
| `delay_reports.review` | Duyet/tuy choi bao tre |
| `admin.users.manage` | Quan ly user/role/permissions |
| `admin.upload_excel` | Upload Excel va chay auto-scrape manual |
| `admin.keylab_export` | Xuat Excel KeyLab |
| `analytics.view` | Xem analytics endpoints/page |
| `munger.view` | Xem Munger dashboard |

Role default permissions:
- `admin`: `["*"]`.
- `user`: `orders.view_pending`, `error_reports.submit`, `error_reports.view_own`, `delay_reports.view_active`.
- `qc`: `orders.view_pending`, `error_reports.submit`, `error_reports.view_own`, `delay_reports.view_active`.
- `delay_qc`: `orders.view_pending`, `delay_reports.submit`, `delay_reports.view_active`.

Helper moi:
- `normalizePermissions(value, role, canViewStats)` — normalize/backfill permissions.
- `hasPermission(userOrUsername, permission)` — check `*` hoac permission cu the.
- `requirePermission(permission)` trong `src/middleware/auth.js` — middleware route-level.

Luu y session:
- `requireAuth`/`requirePermission` doc role hien tai tu `users.json` thong qua `USERS`, nen doi role/quyen trong admin co hieu luc ngay khi frontend goi lai `/user`.
- `sessions.role` van giu de tuong thich, nhung khong con la nguon quyen chinh.

### Admin UI permission

File: `admin.html`.

Tab Users co them:
- Dropdown role: dung nhu template nhanh.
- Details/checkbox list `permissions`: tick nhieu quyen cho moi user.
- Endpoint moi:
  - `PATCH /admin/api/users/:username/permissions` body `{permissions: []}`.
  - `PATCH /admin/api/users/:username/role` khi doi role se reset permissions ve default cua role.

`can_view_stats` van duoc giu de tuong thich, nhung khi bat/tat se dong bo voi permission `stats.view_daily`.

### Bao tre tien do — schema

Migration trong `src/db/migrations.js`, init bang qua `initDelayReportTables()` trong `server.js`.

Bang `delay_reports`:

| Cot | Kieu | Y nghia |
|---|---|---|
| id | INTEGER PK | |
| ma_dh | TEXT NOT NULL | Ma don bi bao tre |
| yc_hoan_thanh | TEXT | Snapshot deadline tai luc bao |
| cong_doan_bao_tre | TEXT | Cong doan muon bao tre |
| nguyen_nhan | TEXT | Nguyen nhan user nhap |
| hinh_anh | TEXT | JSON array image refs R2; legacy local file van parse duoc |
| trang_thai | TEXT DEFAULT `pending` | `pending` / `confirmed` / `rejected` |
| submitted_by | TEXT | User gui |
| submitted_at | TEXT | datetime local |
| reviewed_by | TEXT | Admin/nguoi duyet |
| reviewed_at | TEXT | datetime local |
| ghi_chu_admin | TEXT | Ghi chu luc confirm/reject |

Indexes:
- `idx_delay_reports_ma_dh(ma_dh)`
- `idx_delay_reports_status(trang_thai)`
- `idx_delay_reports_submitted_at(submitted_at)`
- `idx_delay_reports_stage(cong_doan_bao_tre)`

Duplicate rule:
- Khong cho tao bao tre moi neu cung `ma_dh` da co `pending` hoac `confirmed`.
- Neu admin `reject`, don do co the duoc bao lai.

### Bao tre tien do — API

File: `src/routes/delayReports.routes.js`.

| Method | Path | Permission | Ghi chu |
|---|---|---|---|
| GET | `/bao-tre` | `delay_reports.submit` | Serve `bao_tre.html` |
| GET | `/api/delay-reports/allowed-stages` | `delay_reports.submit` | Tra danh sach cong doan user duoc bao |
| POST | `/api/delay-reports` | `delay_reports.submit` | FormData `ma_dh`, `cong_doan_bao_tre`, `nguyen_nhan`, `hinh_anh[]`; lookup barcode/ma_dh |
| GET | `/api/delay-reports/active` | `delay_reports.view_active` hoac `delay_reports.review` | User thuong chi nhan `{ma_dh, trang_thai}`; reviewer nhan full data |
| GET | `/delay-reports` | `delay_reports.review` | Serve `delay_reports.html` |
| GET | `/api/delay-reports` | `delay_reports.review` | List full, filter `?trang_thai=` |
| GET | `/api/delay-reports/stats` | `delay_reports.review` | Aggregate + active recent |
| GET | `/api/delay-reports/monthly-stats` | `delay_reports.review` | Ky 26-25, summary/by_stage/top_reasons/by_user |
| PATCH | `/api/delay-reports/:id/confirm` | `delay_reports.review` | Confirm |
| PATCH | `/api/delay-reports/:id/reject` | `delay_reports.review` | Reject + `ghi_chu_admin` |

### Bao tre tien do — frontend

File `bao_tre.html`:
- Trang gui bao tre cho user co `delay_reports.submit`.
- Co quet barcode bang ZXing.
- Sau khi scan/manual input, goi `/api/orders/by-barcode/:code`.
- Hien ma don, khach hang, benh nhan, phuc hinh, `yc_hoan_thanh`.
- Hien them dropdown `cong_doan_bao_tre`.
- Dieu kien cong doan: user chi bao duoc cong doan truoc hoac song song voi cong doan cua minh; rieng cap song song `sáp`/`CAD/CAM` va `đắp`/`mài` duoc chon qua lai.
- Bat buoc nhap `nguyen_nhan` va upload hinh; ho tro nhieu anh, hien thumbnail truoc khi gui.
- Submit FormData len `/api/delay-reports`.

File `delay_reports.html`:
- Trang reviewer cho user co `delay_reports.review`.
- Stats: total/pending/confirmed/rejected.
- Thong ke thang theo ky 26-25: tong bao tre, active, so voi ky truoc, top cong doan, top ly do, top nguoi bao.
- Filter theo trang thai.
- Card hien anh, nguyen nhan, submitter, deadline snapshot.
- Hien tat ca thumbnail anh da upload, click de xem lightbox.
- Action: confirm/reject.

Dashboard:
- `dashboard.html` va `dashboard_mobile_terracotta.html` goi `/api/delay-reports/active`.
- User co `delay_reports.view_active` thay card don bi bao tre active bang thanh doc do nhap nhay.
- User co `delay_reports.review` thay banner so don dang bi bao tre; click vao `/delay-reports`.
- User co `delay_reports.submit` thay menu/link gui bao tre `/bao-tre`.

### Anh bao loi ky thuat va bao tre

Hai flow bao loi ky thuat va bao tre deu dung chung pipeline `uploadImage`:
- `multer` memoryStorage + custom R2 storage.
- Anh duoc rotate theo EXIF, resize theo `.env` `IMAGE_MAX_WIDTH/HEIGHT`, convert WebP voi `IMAGE_WEBP_QUALITY`.
- Upload len Cloudflare R2, DB luu JSON array refs trong `hinh_anh`.
- `REPORT_IMAGE_LIMIT` gioi han so anh moi report; UI hien thumbnail cua tat ca anh da chon/da upload.
- Neu validate fail sau khi da upload, route goi `deleteErrorImage()` de don R2 objects vua tao.
- Du lieu cu dang single URL/path hoac local filename van duoc parse de hien thi.

Static serve:
- `/uploads/error-images/:file` van duoc protect bang `requireAuth` trong `src/middleware/security.js` cho file legacy/fallback.

Cleanup:
- `cleanupExpiredErrorImages()` quet ca `error_reports` va `delay_reports`, xoa ref sau `IMAGE_RETENTION_DAYS`.

### Route permission changes

Da chuyen nhieu route tu role hardcode sang permission:
- `admin.routes.js`
  - user management: `admin.users.manage`
  - production stats: `stats.view_production`
  - monthly stats: `stats.view_monthly`
- `dashboard.routes.js`
  - analytics page: `analytics.view`
  - upload page/post: `admin.upload_excel`
- `scraper.routes.js`
  - manual scrape: `admin.upload_excel`
  - KeyLab export: `admin.keylab_export`
- `analytics.routes.js`
  - all analytics APIs: `analytics.view`
- `munger.routes.js`
  - page/API: `munger.view`
- `stats.routes.js`
  - daily chip: `stats.view_daily`
- `errorReports.routes.js`
  - submit: `error_reports.submit`
  - review/stats/confirm/reject: `error_reports.review`
  - own list: `error_reports.view_own`
  - error code CRUD: `error_codes.manage`
- `delayReports.routes.js`
  - submit/view/review as listed above.

### Orders barcode API update

`GET /api/orders/by-barcode/:code` tra them context de dung cho bao tre:
- `nhap_luc`
- `yc_hoan_thanh`
- `yc_giao`
- `khach_hang`
- `benh_nhan`
- `sl`
- `ghi_chu`

### Files them/sua trong phien

Cap nhat 2026-05-17:
- `src/utils/reportStats.js` them moi: shared monthly stats cho bao loi ky thuat/bao tre theo ky 26-25.
- `src/routes/errorReports.routes.js`: multi-image R2 upload, JSON image refs, monthly-stats endpoint.
- `src/routes/delayReports.routes.js`: multi-image R2 upload, dropdown cong doan muon bao, allowed-stages endpoint, monthly-stats endpoint.
- `src/services/image.service.js`: parse/stringify image refs, `REPORT_IMAGE_LIMIT`, cleanup refs nhieu anh.
- `src/db/migrations.js`: index phuc vu thong ke thang cho `error_reports` va `delay_reports`.
- `bao_loi.html`, `bao_tre.html`, `error_reports.html`, `delay_reports.html`, `admin.html`: nhan "bao loi ky thuat", multi-image thumbnails, monthly stats UI.
- `dashboard_mobile_terracotta.html`: menu admin `WIP cong doan` va panel WIP mobile.

Them moi:
- `bao_tre.html`
- `delay_reports.html`
- `src/routes/delayReports.routes.js`

Sua chinh:
- `server.js`
- `src/app.js`
- `src/db/migrations.js`
- `src/middleware/auth.js`
- `src/repositories/users.repo.js`
- `src/routes/admin.routes.js`
- `src/routes/analytics.routes.js`
- `src/routes/dashboard.routes.js`
- `src/routes/errorReports.routes.js`
- `src/routes/munger.routes.js`
- `src/routes/orders.routes.js`
- `src/routes/scraper.routes.js`
- `src/routes/stats.routes.js`
- `src/routes/users.routes.js`
- `src/services/image.service.js`
- `admin.html`
- `dashboard.html`
- `dashboard_mobile_terracotta.html`
- `users.json` (role thuc te hien co: `hongtham`, `thihanh` dang la `delay_qc`)

### Verify da chay

Commands da verify:
- `Get-ChildItem src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }`
- `node -e "require('./src/app'); console.log('app require ok')"`
- Check permission load:
  - admin co `*`.
  - `hongtham`, `thihanh` co `delay_reports.submit`.
  - user thuong co `delay_reports.view_active` nhung khong co `delay_reports.submit`.
- `pm2 restart asia-lab-server`

### Luu y van hanh

- Neu admin doi permissions, frontend can refresh hoac cho lan poll `/user` tiep theo.
- Neu user khong thay menu, kiem tra `/user` co tra `permissions` dung khong.
- Neu card khong nhap nhay, kiem tra `/api/delay-reports/active` co tra `ma_dh` active va don do co nam trong danh sach hien tai khong.
- Khi debug banner/card, can co it nhat mot record `delay_reports.trang_thai IN ('pending','confirmed')`.

---

## 22. Cap nhat phien 2026-05-18 — tab Nguy co tre trong admin

### Muc tieu

Them tab rieng trong admin dashboard de tim cac don co nguy co tre dua tren tien do hien tai va benchmark lich su, tranh chen vao tab thong ke san luong lam giao dien dai kho thao tac.

### Files sua chinh

- `src/routes/admin.routes.js`: them endpoint `/admin/api/delay-risk-orders`, tinh benchmark tu `tien_do_history`, loc deadline sai, sort theo muc nguy co.
- `src/repositories/orders.repo.js`: chinh rule skip stage cho `Làm tiếp`/`Sửa`/`Thử sườn` va match token `TS` ro rang.
- `admin.html`: them tab `Nguy cơ trễ`, table desktop, card list mobile, KPI summary va nut reload.
- `CONTRUCTION.md`: cap nhat API, UI, rule nghiep vu va runbook troubleshooting.

### Rule nghiep vu quan trong

- `Làm tiếp` va `Sửa` chi can hoan thanh `ĐẮP` va `MÀI`.
- `Thử sườn` chi can `CBM`, `SÁP/Cadcam`, `SƯỜN`.
- Cac rule nay ap dung ca dashboard tien do, pending orders va delay-risk; khi sua phai dong bo qua `getSkipStages()`.

### Verify da chay

- `node --check src\repositories\orders.repo.js`
- `node --check src\routes\admin.routes.js`
- Parse inline script trong `admin.html` bang `new Function`.
- `node -e "require('./src/app'); console.log('app require ok')"`
- Smoke API `/admin/api/delay-risk-orders?limit=100` sau khi restart PM2.
