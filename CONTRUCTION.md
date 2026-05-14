# ASIA LAB Construction Notes

Last updated: 2026-05-14

Tai lieu nay mo ta cau truc, luong du lieu, module chinh va cach van hanh du an ASIA LAB trong workspace production:

`C:\Users\Administrator\Desktop\crap_dev`

Ten file duoc giu la `CONTRUCTION.md` theo dung yeu cau hien tai. Neu can chuan hoa ten tieng Anh, ten dung thong thuong se la `CONSTRUCTION.md`.

## 1. Tong quan du an

ASIA LAB la he thong quan ly don hang va tien do san xuat cho labo nha khoa. He thong gom ba lop chinh:

1. Node.js Express server phuc vu dashboard, API, auth, admin, upload, bao loi va thong ke.
2. SQLite `labo_data.db` lam nguon du lieu chinh cho dashboard va API.
3. Python automation de xuat file tu Keylab2022, cao tien do tu LaboAsia, lam sach Excel va import vao SQLite.

Ung dung dang duoc van hanh truc tiep trong repo nay. Can xem day la workspace production, khong phai sandbox thu nghiem.

## 2. Runtime va process production

Server Node:

- Entry point: `server.js`
- Express app: `src/app.js`
- Host listen: `127.0.0.1`
- Port mac dinh: `3000`
- PM2 app name: `asia-lab-server`
- PM2 mode: cluster, `instances: 4`
- Reverse proxy: Caddy domain `asiakanban.com` ve `127.0.0.1:3000`

Auto scrape:

- Script: `auto_scrape_headless.py`
- PM2 app name: `auto-scrape`
- Interpreter: `python`
- Chu ky: moi 10 phut
- Log chinh: `auto_scrape.log`, `logs/auto-scrape-out.log`, `logs/auto-scrape-error.log`

Caddy:

```caddy
asiakanban.com {
    reverse_proxy 127.0.0.1:3000
}
```

`src/app.js` co `app.set('trust proxy', 1)` de Express xu ly dung khi chay sau reverse proxy.

## 3. Thu muc va file quan trong

Code Node:

- `server.js`: bootstrap production, load user/session, init migration, start cleanup, listen server.
- `src/app.js`: tao Express app, gan route, middleware, static protected image, 404 va error handler.
- `src/config/env.js`: doc `.env`, normalize PORT, image config va Cloudflare R2 config.
- `src/config/paths.js`: khai bao duong dan dung chung.
- `src/db/index.js`: ket noi SQLite bang `better-sqlite3`, bat WAL va busy timeout.
- `src/db/migrations.js`: tao/migrate bang runtime, sync ghi chu Keylab, tinh stats thang/ngay.
- `src/repositories/orders.repo.js`: doc du lieu don hang, cache 60 giay, filter active Excel, stage skip rules.
- `src/repositories/users.repo.js`: load/save `users.json`, bcrypt hash, normalize cong doan user.
- `src/services/session.service.js`: session cookie `sid`, luu session trong SQLite.
- `src/services/scraper.service.js`: job state, spawn Python scraper, spawn Keylab export.
- `src/services/image.service.js`: upload anh loi qua R2, nen anh bang `sharp`, cleanup anh cu.
- `src/services/r2.service.js`: S3-compatible client cho Cloudflare R2.
- `src/utils/phucHinh.js`: phan loai phuc hinh va route sap/zirco.

Code Python:

- `auto_scrape_headless.py`: vong lap background, tim Excel moi nhat, chay scrape tien do va Keylab notes.
- `run_scrape.py`: runner cho mot file Excel, chay worker cao LaboAsia, tao JSON/XLSX trung gian, import DB.
- `laboasia_gui_scraper_tkinter.py`: scraper engine, hien da co client dung HTTP JSON API sau khi login lay token.
- `labo_cleaner.py`: lam sach workbook, tao file final co sheet don hang, tien do va tong hop.
- `db_manager.py`: tao schema, import JSON/Excel vao SQLite, sync Keylab notes, CLI stats/import.
- `keylab_exporter.py`: automation Keylab2022 de xuat Excel vao `Excel/`.
- `keylab_notes_scraper.py`: automation Keylab2022 de doc `Ghi chu SX`, ghi thang vao DB.

Frontend HTML:

- `login.html`: UI dang nhap.
- `dashboard.html`: dashboard desktop/admin chinh.
- `dashboard_mobile_terracotta.html`: dashboard mobile chinh tai `/mobile`.
- `admin.html`: quan ly user, ma loi, bao loi, stats san xuat, stats thang.
- `upload.html`: upload Excel.
- `analytics.html`: analytics admin.
- `munger.html`: dashboard metrics quan tri.
- `bao_loi.html`: UI user/QC bao loi.
- `error_reports.html`: UI admin duyet bao loi.

Data/runtime:

- `labo_data.db`: SQLite chinh.
- `Excel/`: file Excel export/upload goc.
- `Data/`: file scraped trung gian.
- `File_sach/`: file Excel final sau clean.
- `Data_thang/`: archive theo thang.
- `uploads/error-images/`: anh loi local cu hoac fallback.
- `logs/`: PM2 logs.
- `.env`: credentials/config runtime, khong dua vao tai lieu hoac commit.
- `users.json`: user runtime.
- `sessions.json`: legacy/runtime session file, hien session chinh nam trong SQLite.
- `labo_config.json`, `keylab_state.json`, `scraper_errors.json`: state automation.

## 4. Luong du lieu chinh

Luong tu Keylab den dashboard:

1. Admin bam export trong dashboard hoac process tu dong tao file Excel trong `Excel/`.
2. `keylab_exporter.py --once` thao tac Keylab2022, luu file dang `ddMMyyyy_N.xls/xlsx`.
3. `auto_scrape_headless.py` phat hien file moi nhat trong `Excel/`.
4. Voi file moi, `auto_scrape_headless.py` chay song song:
   - `run_scrape.py <excel_path>` de cao tien do tu LaboAsia va import DB.
   - `keylab_notes_scraper.py --new-file` de cao `Ghi chu SX` tu Keylab.
5. `run_scrape.py` lay danh sach ma don tu Excel, chia queue cho cac account `LABO_USER1..4`.
6. `laboasia_gui_scraper_tkinter.py` login LaboAsia, lay JWT, goi JSON API cho tung don.
7. Runner tao `Data/*_scraped.json`, `Data/*_scraped.xlsx`, chay `labo_cleaner.py`.
8. `db_manager.py` import JSON va Excel final vao `labo_data.db`.
9. Node API doc `labo_data.db` va frontend render dashboard.

Luong khi cung file:

- `auto_scrape_headless.py` van scrape lai tien do moi 10 phut.
- Keylab notes chi retry rieng khi file loi `scraper_errors.json` cho biet notes failed.
- `labo_config.json` luu `last_run_file`.

Luong upload web:

1. Admin upload Excel qua `POST /upload`.
2. File duoc luu vao `Excel/`.
3. `src/services/scraper.service.js` dua file vao queue hoac spawn `run_scrape.py`.
4. Khi scraper xong, cache orders bi reset va DB connection duoc dong lai de doc lai du lieu moi.

## 5. Database

SQLite chinh: `labo_data.db`

Connection Node:

- Thu vien: `better-sqlite3`
- PRAGMA: `journal_mode = WAL`, `busy_timeout = 5000`
- WAL checkpoint moi 30 phut trong `src/db/index.js`

Connection Python:

- Thu vien: `sqlite3`
- PRAGMA: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=30000`

Bang chinh:

- `don_hang`: master order, mot dong moi `ma_dh`.
- `tien_do`: tien do cong doan hien tai, unique theo `(ma_dh, thu_tu)`.
- `tien_do_history`: lich su tien do phuc vu stats KTV.
- `import_log`: audit file import.
- `sessions`: session login runtime.
- `error_codes`: danh muc ma loi.
- `error_reports`: bao loi cong doan.
- `feedback_types`, `feedbacks`: feedback chung.
- `analytics_daily`, `ktv_performance`: analytics cu.
- `ktv_monthly_stats`, `ktv_monthly_type_stats`: stats KTV theo ky 26-25.
- `ktv_daily_stats`, `ktv_daily_type_stats`: stats KTV theo ngay hoan thanh.

Snapshot dem tai luc doc repo:

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

Cot quan trong trong `don_hang`:

- `ma_dh`, `ma_dh_goc`, `so_phu`, `la_don_phu`
- `nhap_luc`, `yc_hoan_thanh`, `yc_giao`
- `khach_hang`, `benh_nhan`, `phuc_hinh`, `sl`
- `loai_lenh`, `ghi_chu`, `ghi_chu_sx`
- `trang_thai`, `tai_khoan_cao`, `barcode_labo`
- `routed_to`: `sap`, `zirco`, `both`, `none`
- `nguon_file`, `created_at`, `updated_at`

Cot quan trong trong `tien_do`:

- `ma_dh`
- `thu_tu`
- `cong_doan`
- `ten_ktv`
- `xac_nhan`
- `thoi_gian_hoan_thanh`
- `raw_row_text`
- `nguon_file`

## 6. Auth, user va permission

User luu trong `users.json`.

Password:

- Luu bang bcrypt hash trong field `passwordHash`.
- `users.repo.js` van co fallback `u.passwordHash || u.password` cho data cu.

Session:

- Cookie: `sid`
- HttpOnly
- SameSite Strict
- TTL: 7 ngay
- Luu trong bang SQLite `sessions`

Roles:

- `admin`: toan quyen admin, dashboard, upload/export, user management, stats, review bao loi.
- `user`: user cong doan, thay queue pending theo cong doan.
- `qc`: quyen bao loi/kiem loi theo flow rieng, khong phai admin.

Cong doan user chuan:

- rong
- `CBM`
- `sap`
- `CAD/CAM`
- `suon`
- `dap`
- `mai`

Luu y ve dau tieng Viet: source hien thi trong PowerShell co the bi mojibake, nhung y nghia la `sáp`, `sườn`, `đắp`, `mài`.

Mapping user sang DB:

- `CBM` -> `CBM`
- `sap` -> `SAP/Cadcam`
- `CAD/CAM` -> `SAP/Cadcam`
- `suon` -> `SUON`
- `dap` -> `DAP`
- `mai` -> `MAI`

Trong code that co dau, cac gia tri DB la `SÁP/Cadcam`, `SƯỜN`, `ĐẮP`, `MÀI`.

Permission `can_view_stats`:

- Luu trong `users.json`.
- Admin luon thay thong ke chip mobile.
- User chi thay summary neu `can_view_stats = true`.
- User van dung filter chip duoc du khong co quyen xem summary.

## 7. Cong doan va business rules

Thu tu cong doan chuan:

1. `CBM`
2. `SÁP/Cadcam`
3. `SƯỜN`
4. `ĐẮP`
5. `MÀI`

Stage skip rules trong `orders.repo.js`:

- `Sửa`: bo `CBM`, `SÁP/Cadcam`, `SƯỜN`; bat dau tu `ĐẮP`, sau do `MÀI`.
- `Làm tiếp`: bo `CBM`, `SÁP/Cadcam`; bat dau tu `SƯỜN`, sau do `ĐẮP`, `MÀI`.
- Thu suon: neu `ghi_chu` co `TS` hoac `thử sườn`, bo `ĐẮP`, `MÀI`.
- Cac loai `Làm mới`, `Làm lại`, `Bảo hành`, `Làm thêm` mac dinh di du 5 cong doan, tru khi ghi chu co rule dac biet.

Quan trong:

- Thu suon dang bat `TS` kha rong. Cac chuoi nhu `LTTS`, `LLTS`, `BHTS` cung co the bi xem la thu suon.
- Thu tho chua co logic chinh thuc. Neu them, nen match token `TT` ro rang de tranh bat nham.
- Logic skip dung ca cho dashboard stage progress va `/api/user/pending-orders`.

## 8. Routing sap/zirco

`src/utils/phucHinh.js` va `db_manager.py` cung co logic route phong:

- Zirconia, zolid, cercon, la va, argen -> `zirco`
- Kim loai, titanium, chrome, cobalt -> `sap`
- Cui gia zirconia -> `both`
- In mau ham -> `zirco`
- PMMA/rang tam co xu ly rieng
- Khong classify duoc nhung co phuc hinh -> mac dinh `sap`

`don_hang.routed_to` duoc backfill khi migrate/init DB.

Route API:

- `GET /api/orders/by-barcode/:code`: tim order theo barcode hoac ma don, tra ve classify va confirmed stage.
- `POST /api/orders/route`: chuyen `routed_to` sang `sap`, `zirco`, `both`.
- Khong cho route neu `SÁP/Cadcam` da confirm.

Mobile dung `routed_to` de hien mau stripe va ho tro scan/chuyen phong cho user sap/CAD-CAM.

## 9. API routes

Auth:

- `GET /login`, `GET /login.html`
- `POST /login`
- `GET /logout`
- `GET /user`

Dashboard/data:

- `GET /`: dashboard desktop hoac mobile tuy user agent.
- `GET /mobile`
- `GET /data.json`
- `GET /reload`
- `GET /status`
- `GET /files`
- `GET /upload`
- `POST /upload`

Orders:

- `GET /api/orders`
- `GET /api/orders/search`
- `GET /api/orders/by-barcode/:code`
- `POST /api/orders/route`
- `GET /api/orders/:ma_dh`
- `GET /api/user/pending-orders`

Admin/users:

- `GET /admin`
- `GET /admin/api/users`
- `POST /admin/api/users`
- `PATCH /admin/api/users/:username/cong-doan`
- `DELETE /admin/api/users/:username`
- `POST /admin/api/users/:username/reset-password`
- `PATCH /api/admin/users/:username/stats-permission`
- `GET /admin/api/production-stats`
- `GET /admin/api/monthly-stats`

Scraper/Keylab:

- `GET /scrape-status`
- `GET /api/auto-scrape/status`
- `POST /api/auto-scrape/run`
- `GET /keylab-status`
- `GET /keylab-health`
- `POST /keylab-export-now`
- `GET /keylab-export-status`

Analytics:

- `GET /analytics`
- `GET /api/analytics/ktv`
- `GET /api/analytics/daily`
- `GET /api/db/stats`
- `GET /api/analytics/trend`
- `GET /api/analytics/customers`
- `POST /api/analytics/refresh`
- `GET /api/analytics/history/ktv-performance`
- `GET /api/analytics/history/top-ktv`
- `GET /api/analytics/history/stage-stats`
- `GET /api/analytics/history/phuc-hinh-distribution`
- `GET /api/analytics/history/top-customers`
- `GET /api/analytics/history/overview`

Feedback:

- `GET /api/feedback/types`
- `POST /api/feedback/types`
- `DELETE /api/feedback/types/:id`
- `GET /api/feedbacks`
- `POST /api/feedbacks`
- `PATCH /api/feedbacks/:id`

Bao loi:

- `GET /bao-loi`
- `GET /error-reports`
- `GET /api/error-reports/allowed-stages`
- `GET /api/error-codes`
- `POST /api/error-codes`
- `PATCH /api/error-codes/:id`
- `DELETE /api/error-codes/:id`
- `POST /api/error-reports`
- `GET /api/error-reports`
- `GET /api/error-reports/stats`
- `PATCH /api/error-reports/:id/confirm`
- `PATCH /api/error-reports/:id/reject`

Munger:

- `GET /munger`
- `GET /api/munger/metrics`

## 10. Frontend behavior

Desktop dashboard `dashboard.html`:

- Doc `/data.json`.
- Admin thay nut Admin, Upload, Analytics, Munger va Keylab export.
- User thuong co the chuyen sang view pending order theo cong doan.
- Co auto refresh va poll status khi export/scrape.
- Render order card, stage pips, filter phuc hinh, pipeline, summary.

Mobile dashboard `dashboard_mobile_terracotta.html`:

- Admin hoac user khong co cong doan: doc `/data.json`.
- User co cong doan: doc `/api/user/pending-orders`.
- Filter chips: tat ca, zirconia, kim loai, mat dan.
- Summary theo `yc_ht` chi hien neu admin hoac `can_view_stats`.
- Modal hien stage progress va thoi gian hoan thanh tung cong doan.
- Co logic route color `sap`, `zirco`, `both`, `none`.

Admin `admin.html`:

- Quan ly user, role, cong doan, `can_view_stats`.
- Quan ly ma loi.
- Duyet/tuchoi bao loi.
- Xem stats san xuat 3 ngay gan nhat.
- Xem stats thang theo ky tinh luong 26 den 25.

Bao loi:

- `bao_loi.html` cho user/QC tao bao loi, co upload anh.
- `error_reports.html` cho admin xem, confirm, reject.
- Anh moi upload qua R2 neu `.env` co config day du.

## 11. Scraper va automation chi tiet

`auto_scrape_headless.py`:

- Load `.env` de co credentials LaboAsia.
- Tim file Excel moi nhat trong `Excel/`, bo qua `_scraped`, `_final`, `_cleaned`.
- Neu file moi khac `last_run_file`, chay parallel:
  - `run_scrape.py <file>`
  - `keylab_notes_scraper.py --new-file`
- Neu cung file, scrape lai progress only.
- Neu `scraper_errors.json` bao notes loi, retry notes only.
- Timeout `run_scrape.py`: 300 giay.
- Timeout Keylab notes: 30 phut.

`run_scrape.py`:

- Detect sheet/cot ma don hang.
- Lay account tu `LABO_USER1..4`, `LABO_PASS1..4`.
- Chia queue cho worker.
- Luu JSON/XLSX trung gian vao `Data/`.
- Convert `.xls` sang `.xlsx` tam neu can.
- Chay `labo_cleaner.py`.
- Import JSON va Excel final vao SQLite.
- Xoa file tam trong `Data/` va `File_sach/` sau import.

`laboasia_gui_scraper_tkinter.py`:

- Ten file con giu `tkinter`, nhung core hien co `LaboAsiaAPIClient`.
- Flow: login bang Playwright de lay JWT cookie, sau do dung `requests.Session` goi `https://laboasia.com.vn/empconnect/api_handler/`.
- Co retry/re-login khi token het han.
- Data model `ProgressRow` gom ma don, cong doan, KTV, xac nhan, thoi gian, tai khoan cao, barcode.

`keylab_exporter.py`:

- Tim window Keylab2022 theo title co `keylab`.
- Click `Tìm kiếm`, `Xuất Excel`, xu ly Save dialog.
- Ten file theo ngay va counter trong `keylab_state.json`.
- `--check` dung cho health check.
- `--once` dung khi admin trigger export.

`keylab_notes_scraper.py`:

- Doc file Excel active.
- Check DB schema va import_log, tru mode `--new-file` co the doi DB import.
- Bo qua don da co `ghi_chu_sx`.
- Bo qua don co `In mau` trong `phuc_hinh`.
- Thao tac Keylab grid: filter theo ma don, double click detail, doc `Ghi chu SX`.
- Luu batch vao `don_hang.ghi_chu_sx`.
- Neu note co `In mau ham`, update `routed_to = 'zirco'`.
- Ghi loi vao `scraper_errors.json`.
- Force exit de tranh COM thread giu process.

## 12. Bao loi, image va R2

Bao loi dung cac bang:

- `error_codes`
- `error_reports`

Role logic:

- Admin va QC duoc thay nhieu cong doan.
- User CBM chi bao loi CBM.
- User dap/mai duoc bao loi cac cong doan truoc do va dap/mai theo flow.
- User sap/CAD-CAM/suon duoc bao loi cac cong doan truoc do theo flow kim loai/zirconia.

Image upload:

- Field upload: `hinh_anh`.
- Gioi han: 10 MB.
- Chi chap nhan mimetype image.
- Nen bang `sharp`, resize trong gioi han env:
  - `IMAGE_MAX_WIDTH`
  - `IMAGE_MAX_HEIGHT`
  - `IMAGE_WEBP_QUALITY`
- Upload len Cloudflare R2 bang config:
  - `R2_ENDPOINT`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET_NAME`
  - `R2_PUBLIC_URL`

Cleanup:

- `startImageCleanupSchedule()` chay luc startup va moi 24h.
- Mac dinh xoa/clear anh cu hon `IMAGE_RETENTION_DAYS`, fallback 90 ngay.

## 13. Thong ke

Daily mobile chip stats:

- API: `GET /api/stats/daily`
- Chi admin hoac user `can_view_stats`.
- Doc active Excel ma_dh list, group theo `yc_hoan_thanh`.
- Phan loai phuc hinh: mat dan, kim loai, zirconia, cui gia, in mau ham, rang tam.

Production stats:

- API: `GET /admin/api/production-stats`
- Nguon: `tien_do` join `don_hang`
- Lay 3 ngay co completion gan nhat.
- Group theo cong doan, KTV, loai lenh, don, so luong.

Monthly stats:

- Init trong `initMonthlyStatsTables()`.
- Ky billing: ngay 26 thang truoc den ngay 25 thang hien tai.
- `billingPeriodForCompletion()` dua ngay hoan thanh vao `billing_month`.
- `refreshMonthlyStats()` dong bo `tien_do` vao `tien_do_history`, sau do tinh aggregate.

Munger metrics:

- API: `GET /api/munger/metrics`
- Admin only.
- Metrics gom bus factor, WIP ratio, first pass yield, on time rate, customer concentration, demand trend, scale countdown.

## 14. Cach chay va verify

Install Node dependencies:

```powershell
npm install
```

Install Python dependencies:

```powershell
pip install -r requirements.txt
playwright install chromium
```

Start server local:

```powershell
npm start
```

Syntax check Node:

```powershell
npm run check
node --check server.js
Get-ChildItem -Path src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Syntax check Python:

```powershell
python -m py_compile auto_scrape_headless.py run_scrape.py keylab_notes_scraper.py keylab_exporter.py db_manager.py labo_cleaner.py laboasia_gui_scraper_tkinter.py
```

DB commands:

```powershell
python db_manager.py stats
python db_manager.py init
python db_manager.py import-all
python db_manager.py import-json Data\some_scraped.json
python db_manager.py import-excel File_sach\some_final.xlsx
```

Scrape commands:

```powershell
python run_scrape.py Excel\some_file.xls
python auto_scrape_headless.py
python keylab_exporter.py --check
python keylab_exporter.py --once
python keylab_notes_scraper.py --dry-run
```

PM2 commands:

```powershell
pm2 status
pm2 describe asia-lab-server
pm2 describe auto-scrape
pm2 logs asia-lab-server --lines 80 --nostream
pm2 logs auto-scrape --lines 80 --nostream
```

Restart khi can:

```powershell
pm2 restart asia-lab-server
pm2 restart auto-scrape
```

Chi restart production khi user yeu cau hoac khi thay doi server-side can ap dung ngay.

## 15. File khong nen sua tuy tien

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

Khi can commit code/doc, chi add dung file lien quan. Repo co the dirty do runtime hoac user thao tac production.

## 16. Rủi ro ky thuat can chu y

Encoding:

- PowerShell output dang co mojibake voi tieng Viet co dau.
- Khong ket luan file hong chi vi terminal hien sai dau.
- Khi sua logic so sanh chuoi tieng Viet, nen normalize unicode hoac dung helper co san.

SQLite concurrency:

- Node va Python cung doc/ghi `labo_data.db`.
- DB dung WAL, nhung van can dong connection sau scrape de Node doc data moi.
- `scraper.service.js` co `_closeDB()` callback sau khi scraper xong.

Cache:

- `orders.repo.js` cache `/data.json` 60 giay.
- Sau import/scrape phai reset cache neu can thay ngay.

Business rules duplicate:

- Mot so logic phan loai phuc hinh va stage skip co mat o ca backend, frontend va Python.
- Khi sua rule nghiep vu, can tim va dong bo cac noi lien quan:
  - `src/repositories/orders.repo.js`
  - `src/routes/users.routes.js`
  - `src/routes/stats.routes.js`
  - `src/utils/phucHinh.js`
  - `db_manager.py`
  - `dashboard.html`
  - `dashboard_mobile_terracotta.html`

Automation Windows:

- `keylab_exporter.py` va `keylab_notes_scraper.py` phu thuoc Keylab2022 dang mo va UI dung control id.
- Focus/window state co the lam automation fail.
- Save dialog va detail form co retry/timing rieng, khong nen toi uu sleep qua manh neu chua test that.

Security:

- Khong log password, session token, R2 secret.
- Auth cookie hien chua set `Secure`, vi server listen local sau Caddy. Neu chuyen topology, can danh gia lai.
- Direct HTML bi guard sau route, nhung route dang `sendFile` tung trang co `requireAuth`.

## 17. Checklist khi sua tinh nang

Truoc khi sua:

- Doc file lien quan va `CONTEXT.md`, `DISPLAY_FILTER_RULES.md`.
- Xac dinh thay doi co dung vao runtime data khong.
- Xac dinh API/frontend/Python nao cung can dong bo rule.

Sau khi sua Node:

- Chay `npm run check`.
- Chay `node --check` cho file JS da sua.
- Neu sua route/API, test endpoint lien quan khi co the.

Sau khi sua Python:

- Chay `python -m py_compile` cho file da sua.
- Neu sua scraper, uu tien `--dry-run` truoc khi thao tac Keylab.
- Neu sua DB import, chay tren file mau nho neu co the.

Sau khi sua frontend:

- Kiem tra fetch endpoint dung role.
- Kiem tra mobile va desktop neu file la dashboard chung.
- Dam bao khong hardcode secret hoac token.

Truoc khi restart:

- Xac nhan co can restart production khong.
- Neu chi sua HTML static, browser refresh co the du.
- Neu sua server-side Node, restart `asia-lab-server`.
- Neu sua auto scraper, restart `auto-scrape`.

## 18. Quick map cho nguoi moi

Muon hieu dashboard hien don:

1. Doc `src/routes/dashboard.routes.js`.
2. Doc `src/repositories/orders.repo.js`.
3. Doc `dashboard.html` hoac `dashboard_mobile_terracotta.html`.

Muon hieu user pending:

1. Doc `src/routes/users.routes.js`.
2. Doc `src/repositories/users.repo.js`.
3. Doc `src/repositories/orders.repo.js`.

Muon hieu import DB:

1. Doc `run_scrape.py`.
2. Doc `labo_cleaner.py`.
3. Doc `db_manager.py`.

Muon hieu Keylab:

1. Doc `keylab_exporter.py`.
2. Doc `keylab_notes_scraper.py`.
3. Doc `auto_scrape_headless.py`.

Muon hieu bao loi:

1. Doc `src/routes/errorReports.routes.js`.
2. Doc `src/services/image.service.js`.
3. Doc `bao_loi.html`.
4. Doc `error_reports.html`.

Muon hieu stats:

1. Doc `src/db/migrations.js`.
2. Doc `src/routes/admin.routes.js`.
3. Doc `src/routes/stats.routes.js`.
4. Doc `admin.html`.

