# ASIA LAB — Project Context

> Tài liệu này mô tả toàn bộ cấu trúc, luồng dữ liệu và nghiệp vụ của dự án.
> Dùng để onboard AI session mới mà không cần đọc lại toàn bộ code.

---

## 1. Tổng quan

**ASIA LAB** là hệ thống quản lý đơn hàng và theo dõi tiến độ cho labo nha khoa. Hệ thống:
- Đọc dữ liệu đơn hàng từ file Excel do admin upload
- Scrape tiến độ thực tế từ portal [laboasia.com.vn](https://laboasia.com.vn)
- Merge và serve dữ liệu qua API JSON
- Hiển thị dashboard realtime cho desktop và mobile

**Stack:** Node.js (Express) + Vanilla JS + Python (Playwright scraper) + Excel (openpyxl)

**URL local:** `http://localhost:3000` — Login: `admin / 142536`

---

## 2. Cấu trúc file

```
crap_dev/
├── server.js                        # Backend Express server (entry point)
├── dashboard.html                   # Dashboard desktop + mobile responsive (101 KB)
├── dashboard_mobile_terracotta.html # Dashboard mobile riêng, theme sáng (28 KB)
├── dashboard_mobile_ref.html        # Bản tham khảo cũ (không dùng chính thức)
├── login.html                       # Trang đăng nhập
├── upload.html                      # Trang upload Excel + xem log scraper
├── labo_config.json                 # Config: last_run_file path
├── keylab_state.json                # State: daily export counter (auto-created)
├── package.json                     # Node deps: express, multer, xlsx
├── requirements.txt                 # Python deps (+ pywinauto, pywin32)
├── Caddyfile                        # Reverse proxy (optional)
│
├── run_scrape.py                    # Orchestrator scraper (entry point Python)
├── laboasia_gui_scraper_tkinter.py  # Scraper engine chính + Tkinter GUI
├── labo_cleaner.py                  # Làm sạch & format Excel output
├── backfill_data_thang.py           # Tổng hợp dữ liệu theo tháng
├── labo_gui.py                      # GUI Tkinter standalone
├── build_app.py                     # PyInstaller → dist/LaboAsia.exe
├── keylab_exporter.py               # Auto-export Excel từ Keylab2022 desktop (mỗi 10 phút, 7:30–20:00)
│
├── File_sach/                       # Excel đã clean: *_final.xlsx
├── Data/                            # JSON scraper output: *_scraped.json
├── Excel/                           # File Excel raw do admin upload + Keylab exports (DDMMYYYY_N.xls)
├── Data_thang/                      # Archive tháng: MM_YYYY_final.xlsx
└── keylab_export.log                # Keylab exporter log
```

---

## 3. Authentication hiện tại

**⚠️ Quan trọng cho session tiếp theo (thêm user/quyền):**

```javascript
// server.js — hardcoded, cần refactor
const USERS = { admin: '142536' };
const sessions = new Map();           // In-memory, mất khi restart
const SESS_TTL = 8 * 60 * 60 * 1000; // 8 giờ
```

- Session token: 32-byte hex ngẫu nhiên (`crypto.randomBytes`)
- Cookie: `sid=<token>; HttpOnly; SameSite=Strict`
- Middleware `requireAuth` bảo vệ toàn bộ route trừ `/login`, `/logout`
- **Chưa có:** phân quyền, nhiều user, user management UI

**Route auth:**
```
POST /login   → validate user/pass → tạo session → redirect /
GET  /logout  → xóa session → redirect /login
```

---

## 4. Server routes

| Route | Method | Auth | Mục đích |
|---|---|---|---|
| `/` | GET | ✅ | Serve dashboard (redirect /mobile nếu UA mobile) |
| `/mobile` | GET | ✅ | Serve dashboard_mobile_terracotta.html |
| `/data.json` | GET | ✅ | API trả về merged order data (cache 1 phút) |
| `/upload` | GET/POST | ✅ | Upload Excel + trigger scraper |
| `/reload` | GET | ✅ | Force reload data cache |
| `/status` | GET | ✅ | Thông tin server, file đang dùng |
| `/files` | GET | ✅ | Danh sách file Excel đã upload |
| `/scrape-status` | GET | ✅ | Log & trạng thái scraper đang chạy |
| `/login` | GET/POST | ❌ | Form đăng nhập |
| `/logout` | GET | ❌ | Đăng xuất |

---

## 5. Luồng dữ liệu

```
Admin upload Excel
       ↓
POST /upload → lưu vào Excel/
       ↓
spawn: python run_scrape.py
       ↓
  ┌─ detect sheet & cột mã đơn hàng
  ├─ load credentials từ env (LABO_USER1/PASS1 ... USER4/PASS4)
  ├─ scrape LaboAsia theo từng worker song song
  ├─ ghi Data/{stem}_scraped.json + Data/{stem}_scraped.xlsx
  └─ gọi labo_cleaner.py → File_sach/{stem}_final.xlsx
       ↓
GET /data.json
       ↓
  ┌─ readExcel(File_sach/*_final.xlsx)  → orders + stageMap
  ├─ readJsonScraper(Data/*_scraped.json) → scraper rows
  └─ buildOrders() merge (JSON ưu tiên hơn Excel)
       ↓
Dashboard fetch /data.json → render cards + filter
```

**Cấu trúc order object (sau merge):**
```javascript
{
  ma_dh:    "262704030",           // Mã đơn hàng
  id:       "262704030",
  ma_dh:    "262704030",
  nhan:     "2026-04-29 08:00:00", // Nhận lúc
  yc_ht:    "2026-04-29 12:00:00", // Y/c hoàn thành
  yc_giao:  "2026-04-29 14:00:00", // Y/c giao
  kh:       "LA-Nk BS Thuy",       // Khách hàng (phòng khám)
  bn:       "Trần T Ngon",         // Bệnh nhân
  ph:       "Răng sứ Zircornia (R:21-23, - SL: 3)", // Phục hình
  sl:       3,                     // Số lượng răng
  gc:       "",                    // Ghi chú
  lk:       "Làm mới",             // Loại lệnh
  tai_khoan:"lanhn",               // Tài khoản scraper
  allPh:    "...",                 // Tất cả phục hình (multi-line)
  pct:      60,                    // % hoàn thành
  done:     3,                     // Số công đoạn xong
  total:    5,                     // Tổng công đoạn active
  curKtv:   "Văn Huyến",          // KTV đang làm
  stages: [                        // Mảng 5 công đoạn
    { n:"CBM",        x:true,  k:"Minh",       t:"2026-04-29 08:30", sk:false },
    { n:"SÁP/Cadcam", x:true,  k:"Hồng Thắm",  t:"2026-04-29 09:00", sk:false },
    { n:"SƯỜN",       x:true,  k:"Văn Huyến",  t:"2026-04-29 10:30", sk:false },
    { n:"ĐẮP",        x:false, k:"",           t:"",                 sk:false },
    { n:"MÀI",        x:false, k:"",           t:"",                 sk:false },
  ]
}
```

---

## 6. Phân loại phục hình (Prosthetic Classification)

Dùng trong cả `dashboard.html` và `dashboard_mobile_terracotta.html`. Logic **phải đồng nhất**:

```javascript
function phType(ph) {
  const p = (ph || '').toLowerCase();
  if (p.includes('cùi giả zirconia') || p.includes('cui gia zirconia')) return 'hon';  // Hỗn hợp
  if (p.includes('mặt dán'))                                                            return 'vnr';  // Mặt dán
  if (p.includes('zircornia') || p.includes('zirconia') || p.includes('ziconia') ||
      p.includes('zir-') || p.includes('zolid') || p.includes('cercon') ||
      p.includes('la va') || p.includes('full zirconia'))                               return 'zirc'; // Zirconia
  return 'kl'; // Kim loại (default — bao gồm cả Titanium)
}
```

| Nhóm | Key | Màu | Keywords chính |
|---|---|---|---|
| Zirconia | `zirc` | Xanh `#5bbfff` | zircornia, zirconia, ziconia, zir-, zolid, cercon, la va |
| Mặt dán | `vnr` | Hồng `#ff8090` | mặt dán |
| Kim loại | `kl` | Xám (default) | kim loại, titan, chrome, cùi giả, vita, argen |
| Hỗn hợp | `hon` | Vàng amber | cùi giả zirconia |

**CSS classes:** `.ph-zirc`, `.ph-kl`, `.ph-vnr`, `.ph-hon` (định nghĩa trong mỗi file HTML)

---

## 7. Công đoạn sản xuất (5 stages)

| Index | Tên | Màu | Nhóm KTV |
|---|---|---|---|
| 0 | CBM | Blue `#3b82f6` | Kỹ thuật |
| 1 | SÁP/Cadcam | Purple `#a855f7` | Kim loại: Hồng Thắm/HẠNH; Zirco: Văn Huyến/Thái Sơn |
| 2 | SƯỜN | Amber `#f59e0b` | Kim loại: Bùi Tấn Đạt/Văn Trải; Zirco: Văn Huyến/Thái Sơn |
| 3 | ĐẮP | Orange `#f97316` | Nhóm Đắp |
| 4 | MÀI | Green `#10b981` | Nhóm Mài |

**Stage skip rules:**
```javascript
// "Sửa" / "Làm lại" / "Làm tiếp" → skip CBM(0), SÁP(1), SƯỜN(2)
// "Thử sườn" / "TS" trong ghi chú → skip ĐẮP(3), MÀI(4)
// "Hỗn hợp" (Cùi Giả Zirconia) → SÁP do nhóm Kim loại, SƯỜN do nhóm Zirco
```

---

## 8. Loại lệnh (Order types)

| Loại lệnh | CSS class | Ý nghĩa |
|---|---|---|
| Làm mới | `lk-moi` (blue) | Đơn mới hoàn toàn |
| Sửa | `lk-sua` (red) | Sửa lại, skip CBM/SÁP/SƯỜN |
| Làm lại | `lk-lai` (purple) | Làm lại từ đầu |
| Bảo hành | `lk-bh` (orange) | Bảo hành |
| Làm tiếp | `lk-tiep` (green) | Tiếp tục từ ĐẮP |
| Làm thêm | `lk-nb` (lavender) | Thêm số lượng |
| Thử sườn | `lk-ts` (amber) | Chỉ làm đến SƯỜN |

---

## 9. Dashboard desktop (dashboard.html)

**Responsive:** ≤768px → mobile layout; >768px → desktop layout

**Mobile layout (`#layout-mobile`):**
- Sticky header: logo, thời gian, KPI counts
- Search bar
- Filter bar (fixed, `bottom:52px`, trên nav tab): Tất cả / Hôm nay / Ngày mai / Gấp / Đang làm / Xong / Sửa / **Zirconia** / **Kim loại** / **Mặt dán**
- Danh sách card theo nhóm thời gian (SÁNG/CHIỀU/NGÀY MAI...)
- Bottom nav tab: Đơn Hàng / Pipeline / Tổng Hợp

**Desktop layout (`#layout-desktop`):**
- Sidebar: KPIs, nav menu, tiến độ công đoạn
- Main: table đơn hàng với columns: Mã đơn, Tags, Bệnh nhân, Phòng khám, **Phục hình** (chip màu), SL, V/C hoàn thành

**Key JS functions:**

| Function | Mục đích |
|---|---|
| `phType(ph)` | Phân loại phục hình → 'zirc'/'vnr'/'hon'/'kl' |
| `phShort(ph)` | Nhãn ngắn: ZIRC, ZIR-D, CERCON, TITAN, VENEER, Cr-Co, CÙI... |
| `phCls(ph)` | CSS class: `'ph-' + phType(ph)` |
| `filterOrders(f, q)` | Lọc theo flag + search query |
| `mSetF(el, f)` | Mobile: click filter chip |
| `mRender()` | Re-render mobile order list |
| `computeTimeGroups(list)` | Nhóm đơn theo thời gian (SÁNG/CHIỀU/NGÀY MAI...) |
| `renderOrderCard(o)` | Render 1 card mobile |
| `getSkipStages(lk, gc)` | Trả về array index stage cần skip |
| `openModal(id)` | Mở modal chi tiết đơn hàng |
| `getSuonOrders()` | Pipeline: đơn ở giai đoạn SƯỜN |
| `calcStats()` | Tính tổng hợp KPI, KTV, stage % |

**Bug đã fix (eee713f):** `computeTimeGroups` trả về `[]` khi filter list chỉ có PM-only orders → đã fix bằng cách merge vào `today-am` slot khi `hasPM && !hasAM`.

---

## 10. Dashboard mobile (dashboard_mobile_terracotta.html)

**Served tại:** `GET /mobile`

**Theme:** Light — sage green background (`#7a9b8a`), cream card (`#f5f3f0`), terracotta accents

**Khác với dashboard.html:**
- File riêng biệt, không dùng chung JS
- Không có modal phức tạp — tap mở detail inline
- Data: fetch `/data.json` → `adaptOrder()` → `allOrders[]`

**Filter bar** (sticky, dưới search): Tất cả / Zirconia / Kim loại / Mặt dán

**Ph badge** trên mỗi card (top-right): `ZIRC`, `KL`, `CERCON`, `ZIR-D`, `VENEER`

**Key JS functions:**

| Function | Mục đích |
|---|---|
| `phType(ph)` | Giống dashboard.html — phải sync |
| `phShort(ph)` | Nhãn ngắn cho badge |
| `setFilter(el, f)` | Click filter chip |
| `getFiltered()` | Lọc theo filterPh + filterSearch |
| `renderCard(o)` | Render card với badge |
| `renderCards()` | Render toàn bộ danh sách theo nhóm |
| `groupByCompletionTime(orders)` | Group theo yc_ht |
| `adaptOrder(o)` | Normalize raw JSON → order object |
| `showOrderDetail(o)` | Modal chi tiết |

---

## 11. Biến môi trường (scraper credentials)

```bash
LABO_USER1=<username1>   LABO_PASS1=<password1>
LABO_USER2=<username2>   LABO_PASS2=<password2>
LABO_USER3=<username3>   LABO_PASS3=<password3>
LABO_USER4=<username4>   LABO_PASS4=<password4>
PYTHONIOENCODING=utf-8
PLAYWRIGHT_BROWSERS_PATH=C:\Users\Administrator\AppData\Local\ms-playwright
```

Credentials được truyền qua `env` khi server.js spawn Python scraper.

---

## 12. Git history gần đây

```
50ab8f6  feat: auto-restart keylab exporter + /keylab-status endpoint
7668b5b  feat: merge keylab-exporter — Keylab2022 desktop automation
37113f9  refactor: extract _wait_for_save_dialog, minimize on error
0f735b4  feat: dismiss 'Open with' dialog and minimize Keylab after export
9eba7d8  fix: use foreground window detection for Save As dialog
fb1235d  feat: add Keylab2022 desktop automation script (pywinauto)
5279cb4  chore: ignore sessions.json (live session tokens)
110149e  fix: persist sessions to file + orange pip for in-progress stage
a38e965  merge: feat/multi-user-system → main
```

---

## 13. Task tiếp theo: Thêm user & phân quyền

**Yêu cầu nghiệp vụ:** Tạo nhiều tài khoản với các mức quyền khác nhau.

**Điểm bắt đầu trong server.js:**
```javascript
// Hiện tại — cần thay bằng hệ thống linh hoạt hơn:
const USERS = { admin: '142536' };
```

**Gợi ý thiết kế (để session tiếp theo quyết định):**

```javascript
// Ví dụ cấu trúc user có phân quyền:
const USERS = {
  admin:    { password: '...', role: 'admin'  }, // Full access
  ktv:      { password: '...', role: 'viewer' }, // Chỉ xem dashboard
  manager:  { password: '...', role: 'manager'}, // Xem + upload
};

// Roles gợi ý:
// 'admin'   → toàn quyền (upload, reload, xem logs, manage users)
// 'manager' → upload Excel, xem dashboard
// 'viewer'  → chỉ xem dashboard, không upload
```

**Files cần sửa khi thêm user system:**
- `server.js` — USERS object, requireAuth middleware, thêm route `/admin/users`
- `login.html` — không cần sửa nhiều
- Tùy chọn: tạo `users.json` để lưu users thay vì hardcode

---

## 14. Keylab2022 Desktop Automation

**File:** `keylab_exporter.py` (commit fb1235d+)

**Tính năng:**
- Auto-export Excel từ ứng dụng Keylab2022 desktop
- Lịch: mỗi 10 phút (7:30–20:00), ngoài giờ ngủ chế độ
- Tên file: `{DDMMYYYY}_{n}` (ngày + số thứ tự trong ngày)
- Ví dụ: `29042026_1`, `29042026_2`, ...

**Quy trình xuất:**
1. Click nút "Tìm kiếm" (refresh dữ liệu)
2. Chờ 3 giây
3. Click nút "Xuất Excel"
4. Điền tên file vào hộp thoại Save As
5. Click Save
6. Đóng dialog "Open with" nếu xuất hiện
7. Minimize Keylab xuống taskbar

**Trạng thái & logs:**
- Log: `keylab_export.log` (append mode)
- State: `keylab_state.json` (`{"date": "DD/MM/YYYY", "export_count": N}`)
- Reset counter mỗi ngày

**Integration với server.js:**
- `startKeylabExporter()` spawn khi server khởi động
- Auto-restart sau 30s nếu process crash
- GET `/keylab-status` (auth required) trả pid, startedAt, exitCode
- File watcher tự động scrape Keylab exports (debounce 60s)

**File watcher logic:**
- Phát hiện file pattern `^\d{8}_\d+\.(xls|xlsx|xlsm)` từ Keylab
- Debounce 60s (tránh scrape khi file vẫn đang viết)
- Auto-queue cho scraper

**Debug:**
```bash
python keylab_exporter.py --debug           # In control tree cửa sổ Keylab
python keylab_exporter.py --debug-save      # Trace Save As dialog
python keylab_exporter.py                   # Chạy bình thường (infinite loop)
```

---

## 15. Chạy dự án

```bash
# Install
npm install
pip install -r requirements.txt

# Chạy server (tự spawn keylab_exporter + file watcher)
node server.js
# → http://localhost:3000
# → Login: admin / 142536

# Mobile dashboard
# → http://localhost:3000/mobile

# Force reload data
# → http://localhost:3000/reload

# Xem status
# → http://localhost:3000/status

# Xem Keylab exporter status
# → http://localhost:3000/keylab-status (phải auth)
```
