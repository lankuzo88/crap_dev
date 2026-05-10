# ASIA LAB - Project Context

Tài liệu này là bản context hiện hành của dự án, dùng để onboard nhanh cho các phiên làm việc sau.

Last updated: 2026-05-11.

## 0. Quy ước làm việc với Codex trong dự án này

Khi user bảo "đọc CONTEXT.md", Codex phải hiểu vai trò mặc định trong dự án này là **kiến trúc sư / tech lead / prompt writer**, không phải junior trực tiếp code.

Nhiệm vụ chính của Codex:

- Nghiên cứu codebase, dữ liệu, route, UI, scraper, DB và business rule trước khi kết luận.
- Đề xuất phương án triển khai thực tế, nêu trade-off và rủi ro nếu có.
- Chia task thành phạm vi nhỏ, rõ ràng để một junior có thể sửa code an toàn.
- Viết prompt hoàn chỉnh để user copy sang **Claude Haiku 4.5** làm junior implement.
- Khi user dán lại code/diff/lỗi từ Haiku, Codex review theo góc nhìn code review: ưu tiên bug, regression, thiếu test, rủi ro production.

Mặc định Codex **không trực tiếp sửa code production** trừ khi user yêu cầu rõ. Ngoại lệ: user có thể yêu cầu Codex cập nhật tài liệu/context như file này.

Format câu trả lời mong muốn cho mỗi task kiến trúc:

1. Tóm tắt vấn đề và phần hệ thống liên quan.
2. Phương án nên chọn, kèm lý do ngắn.
3. File/module có khả năng cần sửa.
4. Prompt chi tiết cho Claude Haiku 4.5, viết như giao việc cho junior.
5. Checklist verify sau khi Haiku sửa xong.

Prompt cho Haiku 4.5 nên cụ thể và có ràng buộc:

- Yêu cầu Haiku đọc `CONTEXT.md` và các file liên quan trước khi sửa.
- Chỉ sửa đúng phạm vi file được giao; không refactor lan rộng.
- Không động vào runtime data như `users.json`, `sessions.json`, `labo_data.db`, `*.db-wal`, `*.db-shm`, log, cache, Excel trừ khi task yêu cầu rõ.
- Giữ nguyên behavior production ngoài phần được giao.
- Sau khi sửa phải chạy syntax/check phù hợp và báo lại file đã sửa, command đã chạy, kết quả.

Khi cần kiểm tra repo, ưu tiên các lệnh an toàn:

```powershell
rg --files
rg "keyword" src *.html *.py
node --check server.js
Get-ChildItem -Path src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
npm run check
git diff --check
```

Lưu ý vận hành: đây là workspace production trực tiếp tại `C:\Users\Administrator\Desktop\crap_dev`, nên mọi prompt giao cho Haiku phải nhắc kiểm soát phạm vi sửa, không tự ý restart PM2, không tự ý commit, không tự ý xóa hoặc restore file nếu chưa được user yêu cầu.

## 1. Tổng quan

ASIA LAB là hệ thống quản lý đơn hàng và tiến độ sản xuất cho labo nha khoa.

Hệ thống đang chạy production trực tiếp trong thư mục:

`C:\Users\Administrator\Desktop\crap_dev`

Nhánh Git production hiện dùng:

`main`

Các phần chính:

- Express server phục vụ dashboard, API, auth, admin, upload/export.
- SQLite `labo_data.db` là nguồn dữ liệu chính.
- Python scraper lấy tiến độ từ LaboAsia và import vào SQLite.
- Keylab exporter tạo file Excel vào `Excel/`.
- PM2 quản lý server và auto-scrape trên VPS Windows.
- Caddy reverse proxy domain về `localhost:3000`.

## 2. Runtime production

PM2 đang dùng 2 process chính:

- `asia-lab-server`
  - Script: `server.js`
  - CWD: `C:\Users\Administrator\Desktop\crap_dev`
  - Port: `127.0.0.1:3000`
- `auto-scrape`
  - Script: `auto_scrape_headless.py`
  - Interpreter: `python`
  - CWD: `C:\Users\Administrator\Desktop\crap_dev`
  - Chạy mỗi 10 phút, 24/7

Caddyfile:

```caddy
asiakanban.com {
  reverse_proxy localhost:3000
}
```

Trong `src/app.js` có `app.set('trust proxy', 1)` để chạy đúng sau Caddy.

## 3. File quan trọng

- `server.js`: entrypoint production; load users/sessions, init DB tables, start image cleanup, listen port, start WAL checkpoint.
- `src/app.js`: wiring Express app, body parser, route modules, static/error middleware.
- `src/config/env.js`: load `.env` and normalize runtime config.
- `src/config/paths.js`: shared filesystem paths.
- `src/db/index.js`: SQLite connection, PRAGMA settings, WAL checkpoint.
- `src/db/migrations.js`: init/migrate runtime tables.
- `src/middleware/auth.js`: `requireAuth`, `requireAdmin`.
- `src/middleware/security.js`: login rate limiter, direct HTML guard, protected error image static serving.
- `src/repositories/orders.repo.js`: order data access/cache, Excel/SQLite merge-facing reads.
- `src/repositories/users.repo.js`: load/save users and bcrypt verification.
- `src/routes/*.routes.js`: API/page routes split by feature (`auth`, `dashboard`, `orders`, `stats`, `admin`, `users`, `scraper`, `analytics`, `feedback`, `errorReports`, `munger`).
- `src/services/image.service.js`: R2 image upload/compression/deletion/retention cleanup.
- `src/services/r2.service.js`: Cloudflare R2 client wiring.
- `src/services/scraper.service.js`: scraper/keylab job state, queue, process spawning.
- `src/services/session.service.js`: session token storage and persistence.
- `dashboard.html`: dashboard desktop/admin chính.
- `dashboard_mobile_terracotta.html`: mobile dashboard chính tại `/mobile`.
- `admin.html`: admin dashboard, quản lý user/công đoạn/quyền thống kê.
- `login.html`: login UI.
- `upload.html`: upload Excel.
- `analytics.html`: analytics UI.
- `munger.html`: Munger dashboard.
- `bao_loi.html`, `error_reports.html`: hệ thống báo lỗi công đoạn.
- `auto_scrape_headless.py`: auto-scrape loop qua PM2.
- `run_scrape.py`: chạy scraper cho một file Excel.
- `laboasia_gui_scraper_tkinter.py`: scraper engine.
- `db_manager.py`: import/merge dữ liệu vào SQLite.
- `keylab_exporter.py`: tự động xuất file Excel từ Keylab.
- `ecosystem.config.js`: PM2 config.
- `DISPLAY_FILTER_RULES.md`: tài liệu rule hiển thị/lọc/công đoạn mới nhất.

Thư mục dữ liệu:

- `Excel/`: file Excel raw/export từ Keylab, ví dụ `08052026_1.xls`.
- `Data/`: JSON scraper output.
- `File_sach/`: file Excel cleaned/final.
- `Data_thang/`: archive theo tháng.
- `logs/`: PM2 logs.

Runtime/gitignored files:

- `sessions.json`
- `labo_config.json`
- `keylab_state.json`
- `labo_data.db-wal`
- `labo_data.db-shm`
- `.claude/`

## 4. Dependencies

Node dependencies hiện có:

- `express`
- `better-sqlite3`
- `bcrypt`
- `express-rate-limit`
- `multer`
- `sharp`
- `xlsx`
- `dotenv`
- `@aws-sdk/client-s3`

Python scripts dùng Playwright/openpyxl và một số thư viện Windows automation cho Keylab.

## 5. Auth và user

User được lưu trong `users.json`.

Mật khẩu đang lưu dạng hash bcrypt qua field `passwordHash`; không còn là plain text.

Session:

- Cookie name: `sid`
- HttpOnly
- SameSite Strict
- TTL 7 ngày
- Persist trong `sessions.json`

`/user` trả về:

```json
{
  "username": "...",
  "role": "admin|user|qc",
  "cong_doan": "...",
  "can_view_stats": true
}
```

Tình trạng gần nhất:

- 21 users
- 1 admin
- 19 user
- 1 qc

Role `qc` đang được dùng cho user có quyền báo lỗi/kiểm lỗi theo flow riêng, không phải admin.

## 6. Công đoạn user

User được gán công đoạn trong tab User của admin.

Giá trị chuẩn trong user/admin:

- `CBM`
- `sáp`
- `CAD/CAM`
- `sườn`
- `đắp`
- `mài`

Mapping sang DB:

- `CBM` -> `CBM`
- `sáp` -> `SÁP/Cadcam`
- `CAD/CAM` -> `SÁP/Cadcam`
- `sườn` -> `SƯỜN`
- `đắp` -> `ĐẮP`
- `mài` -> `MÀI`

Lưu ý: `sáp` và `CAD/CAM` hiện cùng đọc công đoạn DB `SÁP/Cadcam`.

Các mapping user đã chốt gần đây:

- `thihanh` -> `sáp`
- `thaison` -> `CAD/CAM`
- `vanvan` -> `CBM`
- `chitoan` -> `CBM`

## 7. Dữ liệu và database

SQLite `labo_data.db` là nguồn chính.

Các bảng quan trọng:

- `don_hang`
- `tien_do`
- `tien_do_history`
- `import_log`
- `error_codes`
- `error_reports`
- `feedback_types`
- `feedbacks`
- `analytics_daily`
- `ktv_performance`

Số liệu kiểm tra gần nhất:

- `don_hang`: 2248
- `tien_do`: 11024
- `tien_do_history`: 14289
- Import mới nhất: `08052026_1_final.xlsx`, `ok`, 67 đơn, 371 công đoạn.

`don_hang.ghi_chu` lấy từ cột Excel `Ghi chú điều phối`.

Nếu Excel có nhiều cột chứa chữ `Ghi chú`, importer hiện lấy cột đầu tiên match `Ghi chú`.

## 8. Auto-scrape

Auto-scrape hiện chạy bằng `auto_scrape_headless.py` qua PM2 process `auto-scrape`.

Logic hiện tại:

1. Mỗi 10 phút tìm file Excel mới nhất trong `Excel/`.
2. So với `labo_config.json`.
3. Nếu file mới khác file trước: scrape.
4. Nếu cùng file: vẫn scrape lại để cập nhật tiến độ mới.
5. Gọi `run_scrape.py <file>`.
6. Import JSON scraper và file final vào SQLite.
7. Cập nhật `labo_config.json`.

Server-side file watcher và auto-scrape timer trong `server.js` đang disabled. Nguồn auto-scrape production là PM2 `auto-scrape`.

Log chính:

- `auto_scrape.log`
- `logs/auto-scrape-out.log`
- `logs/auto-scrape-error.log`

Tình trạng gần nhất:

- PM2 `auto-scrape` online.
- 0 restart.
- Scrape thành công đều khoảng mỗi 10 phút.
- Có một lỗi `MemoryError` cũ lúc 00:03:58 ngày 2026-05-08, nhưng vòng sau tự chạy lại thành công và không lặp lại.

## 9. Keylab export

Admin có thể trigger export bằng:

`POST /keylab-export-now`

Trạng thái xem bằng:

- `/keylab-export-status`
- `/keylab-status`
- `/keylab-health`

State export lưu trong `keylab_state.json`.

File export được lưu vào `Excel/`, sau đó auto-scrape sẽ đọc file mới nhất.

## 10. Routes chính

Public/auth routes:

- `GET /login`
- `POST /login`
- `GET /logout`

Dashboard:

- `GET /`: dashboard desktop, mobile UA có thể redirect `/mobile`.
- `GET /mobile`: mobile dashboard.
- `GET /data.json`: data merged từ SQLite, có active Excel filter.
- `GET /reload`: force reload cache.
- `GET /status`: server/db status.
- `GET /user`: current user.

User/mobile:

- `GET /api/user/pending-orders`: đơn pending theo công đoạn user.
- `GET /api/stats/daily`: thống kê daily, admin hoặc user có quyền `can_view_stats`.

Admin:

- `GET /admin`
- `GET /admin/api/users`
- `POST /admin/api/users`
- `PATCH /admin/api/users/:username/cong-doan`
- `DELETE /admin/api/users/:username`
- `POST /admin/api/users/:username/reset-password`
- `PATCH /api/admin/users/:username/stats-permission`

Upload/export:

- `GET /upload`
- `POST /upload`
- `GET /scrape-status`
- `GET /api/auto-scrape/status`
- `POST /api/auto-scrape/run`
- `POST /keylab-export-now`
- `GET /keylab-export-status`

Analytics/Munger:

- `GET /analytics`
- `GET /api/analytics/*`
- `GET /munger`
- `GET /api/munger/metrics`

Feedback/báo lỗi:

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

## 11. User pending orders

Mobile user không dùng toàn bộ `/data.json` nếu là role `user` có `cong_doan`; thay vào đó gọi:

`/api/user/pending-orders`

Một đơn hiện với user khi:

- Mã đơn nằm trong Excel active mới nhất.
- Có dòng `tien_do` cho công đoạn user.
- Dòng công đoạn đó chưa xác nhận.
- Công đoạn đó không bị skip bởi loại lệnh/ghi chú.

User không thấy đơn mà công đoạn của họ đã xác nhận xong.

Hiện chưa lọc theo tên KTV, nên các user cùng công đoạn nhìn chung một queue.

## 12. Rule loại lệnh và công đoạn

Thứ tự công đoạn chuẩn:

1. `CBM`
2. `SÁP/Cadcam`
3. `SƯỜN`
4. `ĐẮP`
5. `MÀI`

Rule hiện tại:

- `Sửa`: bỏ `CBM`, `SÁP/Cadcam`, `SƯỜN`; bắt đầu từ `ĐẮP`, rồi `MÀI`.
- `Làm tiếp`: bỏ `CBM`, `SÁP/Cadcam`; bắt đầu từ `SƯỜN`, rồi `ĐẮP`, `MÀI`.
- `Làm mới`: đủ 5 công đoạn.
- `Làm lại`: như `Làm mới`.
- `Bảo hành`: như `Làm mới`.
- `Làm thêm`: như `Làm mới`, trừ khi ghi chú có rule đặc biệt.

Thử sườn:

- Nhận diện từ `Ghi chú điều phối` (`don_hang.ghi_chu`) có `TS` hoặc `thử sườn`.
- Chỉ tính đến `CBM`, `SÁP/Cadcam`, `SƯỜN`.
- Bỏ `ĐẮP`, `MÀI`.
- User `ĐẮP` và `MÀI` không thấy đơn thử sườn trong mobile pending.
- User `SƯỜN` vẫn thấy nếu stage `SƯỜN` chưa xác nhận.

Thử thô:

- Chưa có logic chính thức.
- Nghiệp vụ có thể ghi `Thử thô`, `TT`, hoặc biến thể gần giống trong `Ghi chú điều phối`.
- Khi thêm rule, cần nhận diện `TT` theo token để tránh bắt nhầm.

Chi tiết rule xem thêm `DISPLAY_FILTER_RULES.md`.

## 13. Mobile dashboard

File: `dashboard_mobile_terracotta.html`

Route: `/mobile`

Mobile user behavior:

- Admin hoặc user không có công đoạn: load `/data.json`.
- User có công đoạn: load `/api/user/pending-orders`.

Filter chips:

- `Tất cả`
- `Zirconia`
- `Kim loại`
- `Mặt dán`

Summary dưới chips:

- Nhóm theo `yc_ht` / `yc_hoan_thanh`.
- Đếm số đơn.
- Tổng `sl` răng.
- Chỉ phụ thuộc chip đang chọn, không phụ thuộc search.

Quyền xem summary:

- Admin luôn thấy.
- User chỉ thấy nếu `can_view_stats = true`.
- User vẫn dùng được filter chips dù không có quyền xem summary.

Modal mobile:

- Hiển thị stage progress.
- Với stage đã xác nhận, hiển thị thời gian hoàn thành lấy từ scraper/DB `thoi_gian_hoan_thanh`.
- Các stage skip không được tính là stage đang chờ.

## 14. Admin dashboard

File: `admin.html`

Tab User quản lý:

- Username
- Role: `admin`, `user`, `qc`
- Công đoạn
- `TK chips`: quyền xem thống kê filter chips trên mobile
- Reset password
- Delete user

`TK chips` map vào field `can_view_stats` trong `users.json`.

## 15. Desktop dashboard

File: `dashboard.html`

Dùng cho admin/desktop chính:

- Danh sách đơn hàng.
- Pipeline.
- Tổng hợp.
- Analytics link cho admin.
- Munger link cho admin.
- Feedback/báo lỗi link tùy role/UI.
- Upload/export buttons chỉ admin.

Desktop có logic stage skip riêng nhưng đã được cập nhật đồng bộ với server cho `Sửa` và `Làm tiếp`.

## 16. Báo lỗi và QC

Các file liên quan:

- `bao_loi.html`
- `error_reports.html`

API chính:

- `/api/error-reports/allowed-stages`
- `/api/error-codes`
- `/api/error-reports`

Allowed stages phụ thuộc role và công đoạn user.

Role `qc` có logic quyền riêng trong `getAllowedStages()`.

## 17. Git và dirty worktree

Repo có thể có runtime file thay đổi không nên commit bừa.

Hiện `users.json` thường thay đổi khi admin bật/tắt quyền hoặc sửa user trong UI. Nếu đang làm code/doc, chỉ add đúng file liên quan, tránh commit nhầm `users.json` nếu thay đổi đó là thao tác runtime của user.

Các runtime/state file đã được ignore:

- `sessions.json`
- `labo_config.json`
- `keylab_state.json`
- `*.db-wal`
- `*.db-shm`
- `.claude/`

## 18. Recent important commits

- `b44f242 fix: wire refactored server entrypoint`
- `1e48b20 refactor: tách server.js thành src/ modules`
- `297561d docs: document display and filter rules`
- `4c2781b fix: hide try-in orders from dap mai users`
- `a9ac0bc fix: split repair and continuation stage flow`
- `896158c fix: gate mobile chip stats permission`
- `aec0b42 fix: normalize user stage assignments`
- `3be89d7 feat: summarize mobile filter totals by completion date`
- `6189349 fix: show mobile filter chips for users`
- `c9d58bf fix: trust reverse proxy headers`
- `62e4a0d chore: commit production updates and ignore runtime files`
- `3866c1a fix: show mobile stage completion times`

## 19. Verification commands

Common checks:

```powershell
npm run check
node --check server.js
Get-ChildItem -Path src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
C:\Users\Administrator\AppData\Local\Python\bin\python.exe -m py_compile auto_scrape_headless.py run_scrape.py
node test_login.js
node -e "const fs=require('fs'); for (const f of ['admin.html','dashboard.html','dashboard_mobile_terracotta.html']) { const html=fs.readFileSync(f,'utf8'); const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]); scripts.forEach(s=>new Function(s)); console.log(f, 'scripts ok', scripts.length); }"
git diff --check
pm2 status
pm2 describe asia-lab-server
pm2 describe auto-scrape
pm2 logs asia-lab-server --lines 80 --nostream
pm2 logs auto-scrape --lines 80 --nostream
```

Restart production server after server-side code changes:

```powershell
pm2 restart asia-lab-server
```

Restart scraper only if needed:

```powershell
pm2 restart auto-scrape
```

## 20. Notes for future agents

- Read this file first, then `DISPLAY_FILTER_RULES.md` for business rules.
- Do not expose password hashes or session tokens in final answers.
- Do not commit runtime `users.json` changes unless the user explicitly wants those user/permission changes committed.
- Production code is edited directly in this workspace. Test before commit/push.
- PowerShell output may show Vietnamese mojibake; files are UTF-8 and usually fine.
