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
├── dashboard.html                   # Dashboard desktop + mobile responsive (104 KB)
├── dashboard_mobile_terracotta.html # Dashboard mobile riêng, theme sáng (31 KB)
├── dashboard_mobile_ref.html        # Bản tham khảo cũ (không dùng chính thức)
├── login.html                       # Trang đăng nhập
├── upload.html                      # Trang upload Excel + xem log scraper
├── analytics.html                   # Analytics dashboard (admin-only)
├── feedback.html                    # Feedback system UI
├── admin.html                       # Admin panel UI
├── munger.html                      # Munger Dashboard - 7 metrics vận hành (21 KB, admin-only)
├── labo_config.json                 # Config: last_run_file path
├── keylab_state.json                # State: daily export counter (auto-created)
├── users.json                       # User database (username, password, role)
├── sessions.json                    # Active sessions (gitignored)
├── labo_data.db                     # SQLite database (don_hang, tien_do, feedback_types, feedbacks)
├── package.json                     # Node deps: express, multer, xlsx, better-sqlite3
├── requirements.txt                 # Python deps (+ pywinauto, pywin32)
├── Caddyfile                        # Reverse proxy (optional)
│
├── run_scrape.py                    # Orchestrator scraper (entry point Python)
├── laboasia_gui_scraper_tkinter.py  # Scraper engine chính + Tkinter GUI
├── labo_cleaner.py                  # Làm sạch & format Excel output
├── backfill_data_thang.py           # Tổng hợp dữ liệu theo tháng
├── labo_gui.py                      # GUI Tkinter standalone
├── build_app.py                     # PyInstaller → dist/LaboAsia.exe
├── keylab_exporter.py               # Auto-export Excel từ Keylab2022 desktop (manual trigger)
├── demo_metadata.js                 # Demo hybrid metadata approach (reference)
│
├── File_sach/                       # Excel đã clean: *_final.xlsx
├── Data/                            # JSON scraper output: *_scraped.json
├── Excel/                           # File Excel raw do admin upload + Keylab exports (DDMMYYYY_N.xls)
├── Data_thang/                      # Archive tháng: MM_YYYY_final.xlsx
└── keylab_export.log                # Keylab exporter log
```

---

## 3. Authentication hiện tại

**✅ ĐÃ HOÀN THÀNH: Multi-user system với phân quyền**

```javascript
// server.js — users.json based
const USERS_JSON_PATH = path.join(__dirname, 'users.json');
let USERS = {};  // { username: { password, role } }

const sessions = new Map();           // Persist to sessions.json
const SESS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const SESS_COOKIE_AGE = 7 * 24 * 60 * 60;  // 7 ngày (giây)
```

**Cấu trúc users.json:**
```json
{
  "users": [
    { "username": "admin", "password": "142536", "role": "admin" },
    { "username": "minhtuan", "password": "123456789", "role": "user" }
  ]
}
```

**Tính năng:**
- ✅ Session token: 32-byte hex ngẫu nhiên (`crypto.randomBytes`)
- ✅ Cookie: `sid=<token>; HttpOnly; SameSite=Strict; Max-Age=7days`
- ✅ Session persist to `sessions.json` (survive restart)
- ✅ Middleware `requireAuth` bảo vệ toàn bộ route trừ `/login`, `/logout`
- ✅ Middleware `requireAuth` attach session: `req.session = sess` (quan trọng!)
- ✅ Middleware `requireAdmin` bảo vệ admin-only routes
- ✅ Admin panel UI tại `/admin` (admin.html)
- ✅ User management API: GET/POST/DELETE `/admin/api/users`
- ✅ Password reset API: POST `/admin/api/users/:username/reset-password`
- ✅ **Admin-only features**: Analytics, Feedback, Export button, Upload button
- ✅ User thường chỉ thấy: Đơn Hàng, Pipeline, Tổng Hợp

**Route auth:**
```
POST /login   → validate user/pass → tạo session → redirect /
GET  /logout  → xóa session → redirect /login
GET  /user    → trả về { username, role } của user hiện tại
```

---

## 4. Server routes

| Route | Method | Auth | Admin? | Mục đích |
|---|---|---|---|---|
| `/` | GET | ✅ | — | Serve dashboard (redirect /mobile nếu UA mobile) |
| `/mobile` | GET | ✅ | — | Serve dashboard_mobile_terracotta.html |
| `/data.json` | GET | ✅ | — | API trả về merged order data (cache 1 phút) |
| `/upload` | GET/POST | ✅ | ✅ | Upload Excel + trigger scraper (admin-only) |
| `/reload` | GET | ✅ | — | Force reload data cache |
| `/status` | GET | ✅ | — | Thông tin server, file đang dùng, DB stats |
| `/user` | GET | ✅ | — | Thông tin user hiện tại (username, role) |
| `/files` | GET | ✅ | — | Danh sách file Excel đã upload |
| `/scrape-status` | GET | ✅ | — | Log & trạng thái scraper đang chạy |
| `/keylab-status` | GET | ✅ | — | Trạng thái Keylab export job |
| `/keylab-export-now` | POST | ✅ | ✅ | Kích hoạt Keylab export thủ công (admin-only) |
| `/keylab-export-status` | GET | ✅ | — | Trạng thái Keylab export job chi tiết |
| `/keylab-health` | GET | ✅ | — | Health check Keylab2022 desktop app |
| `/admin` | GET | ✅ | ✅ | Admin panel UI (admin.html) |
| `/admin/api/users` | GET | ✅ | ✅ | Danh sách users (không trả về password) |
| `/admin/api/users` | POST | ✅ | ✅ | Tạo user mới (username, password, role) |
| `/admin/api/users/:username` | DELETE | ✅ | ✅ | Xóa user (không thể xóa chính mình) |
| `/admin/api/users/:username/reset-password` | POST | ✅ | ✅ | Reset password user |
| `/analytics.html` | GET | ✅ | ✅ | Analytics dashboard (admin-only) |
| `/feedback.html` | GET | ✅ | — | Feedback system UI |
| `/api/feedback/types` | GET | ✅ | — | Danh sách loại lỗi feedback |
| `/api/feedback/types` | POST | ✅ | ✅ | Tạo loại lỗi mới (admin-only) |
| `/api/feedback/types/:id` | DELETE | ✅ | ✅ | Xóa loại lỗi (admin-only) |
| `/api/feedbacks` | GET | ✅ | — | Danh sách phản ánh (filter: ma_dh, status) |
| `/api/feedbacks` | POST | ✅ | — | Tạo phản ánh mới |
| `/api/feedbacks/:id` | PATCH | ✅ | — | Cập nhật trạng thái phản ánh |
| `/api/orders` | GET | ✅ | — | Danh sách đơn hàng (limit, offset) |
| `/api/auto-scrape/status` | GET | ✅ | — | Trạng thái auto-scrape 24/7 |
| `/api/auto-scrape/run` | POST | ✅ | ✅ | Kích hoạt auto-scrape ngay (admin-only) |
| `/munger` | GET | ✅ | ✅ | Munger Dashboard - 7 metrics vận hành (admin-only) |
| `/api/munger/metrics` | GET | ✅ | ✅ | API trả về 7 metrics (query: days=7/30/60) |
| `/api/analytics/history/overview` | GET | ✅ | ✅ | Historical analytics data (admin-only) |
| `/login` | GET/POST | ❌ | — | Form đăng nhập |
| `/logout` | GET | ❌ | — | Đăng xuất |

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
  ├─ ghi vào SQLite: labo_data.db (tables: don_hang, tien_do)
  └─ (legacy: Data/{stem}_scraped.json + File_sach/{stem}_final.xlsx)
       ↓
GET /data.json
       ↓
  ┌─ Nguồn chính: SQLite labo_data.db
  ├─ getActiveMaDhList() → đọc file Excel mới nhất để lấy danh sách mã đơn active
  ├─ getDataFromDB() → query SQLite với filter theo active list
  └─ buildOrders() → format thành order objects
       ↓
Dashboard fetch /data.json → render cards + filter
```

**Nguồn dữ liệu ưu tiên:**
1. **SQLite** (`labo_data.db`) — nguồn chính, được scraper ghi vào
2. **Active filter** — chỉ hiển thị đơn hàng có trong file Excel export mới nhất (Keylab)
3. **Fallback** — nếu không tìm được file active, hiển thị toàn bộ DB

**Cấu trúc order object (sau merge):**
```javascript
{
  ma_dh:      "262704030",         // Mã đơn hàng (gốc, không có suffix)
  ma_dh_goc:  "262704030",         // Mã đơn gốc (nếu là đơn phụ: 262704030-1, -2...)
  id:         "262704030",
  nhan:       "2026-04-29 08:00:00", // Nhận lúc
  yc_ht:      "2026-04-29 12:00:00", // Y/c hoàn thành
  yc_giao:    "2026-04-29 14:00:00", // Y/c giao
  kh:         "LA-Nk BS Thuy",      // Khách hàng (phòng khám)
  bn:         "Trần T Ngon",        // Bệnh nhân
  ph:         "Răng sứ Zircornia (R:21-23, - SL: 3)", // Phục hình
  sl:         3,                    // Số lượng răng
  gc:         "",                   // Ghi chú
  lk:         "Làm mới",            // Loại lệnh
  tai_khoan:  "lanhn",              // Tài khoản scraper
  allPh:      "...",                // Tất cả phục hình (multi-line)
  pct:        60,                   // % hoàn thành
  done:       3,                    // Số công đoạn xong
  total:      5,                    // Tổng công đoạn active
  curKtv:     "Văn Huyến",          // KTV đang làm
  stages_raw: "0|CBM|Minh|Có|2026-04-29 08:30;;1|SÁP/Cadcam|Hồng Thắm|Có|2026-04-29 09:00;;...", // GROUP_CONCAT từ SQLite
  stages: [                         // Mảng 5 công đoạn (parsed từ stages_raw)
    { n:"CBM",        x:true,  k:"Minh",       t:"2026-04-29 08:30", sk:false },
    { n:"SÁP/Cadcam", x:true,  k:"Hồng Thắm",  t:"2026-04-29 09:00", sk:false },
    { n:"SƯỜN",       x:true,  k:"Văn Huyến",  t:"2026-04-29 10:30", sk:false },
    { n:"ĐẮP",        x:false, k:"",           t:"",                 sk:false },
    { n:"MÀI",        x:false, k:"",           t:"",                 sk:false },
  ]
}
```

**Feedback object:**
```javascript
{
  id: 1,
  ma_dh: "262704030",
  feedback_type_id: 1,
  type_name: "Màu sắc không đúng",
  description: "Răng sứ màu sáng hơn yêu cầu",
  severity: "medium",  // low, medium, high
  status: "open",      // open, in_progress, resolved, closed
  reported_by: "admin",
  assigned_to: null,
  created_at: "2026-05-01 10:32:03",
  updated_at: "2026-05-01 10:32:03",
  resolved_at: null
}
```

**Feedback type object:**
```javascript
{
  id: 1,
  name: "Màu sắc không đúng",
  category: "mau_sac",  // mau_sac, hinh_the, don_hang, nha_khoa, khac
  description: "Màu răng không khớp với mẫu yêu cầu",
  active: 1,
  created_at: "2026-05-01 10:32:03"
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

---

## 11. Munger Dashboard (munger.html) — ADDED 2026-05-02

**Served tại:** `GET /munger` (admin-only)

**Purpose:** 7 metrics vận hành & khách hàng theo tư duy Charlie Munger — "Inversion, always invert."

**Theme:** Dark theme (`#0f172a` background), color-coded metrics (green/yellow/red)

**7 Metrics Implemented:**

| Metric | Purpose | Good | Bad | Status Colors |
|---|---|---|---|---|
| Bus Factor | Dependency risk per stage | <40% | >60% | 🟢🟡🔴 |
| WIP Ratio | Pipeline balance | 0.7-0.9 | >1.1 | 🟢🟡🔴 |
| First-pass Yield | Quality (% done right first time) | ≥90% | <85% | 🟢🟡🔴 |
| On-time Rate | Delivery reliability | ≥90% | <80% | 🟢🟡🔴 |
| Customer Concentration | Revenue risk from top 5 | <35% | >50% | 🟢🟡🔴 |
| Demand Trend | Month-over-month growth | Positive | Negative | 🟢🟡🔴 |
| Scale Countdown | Progress to 10K răng/month | On track | No path | 🟢🟡🔴 |

**Billing Period Logic:**
- Kỳ tháng: 26 tháng trước → 25 tháng này (ví dụ: 26/3–25/4 = Tháng 4)
- So sánh công bằng: N ngày đầu kỳ hiện tại vs N ngày đầu kỳ trước
- Tránh so sánh kỳ chưa xong với kỳ đã xong

**API Response Structure:**
```javascript
{
  ok: true,
  updated_at: "2026-05-02T16:16:22.336Z",
  days: 30,
  billing_period: { curr: { start, end, label }, prev: { start, end, label } },
  data: {
    bus_factor: { worst_stage, worst_pct, stages: [{ stage, total, top1_ktv, top1_pct, top3 }] },
    wip_ratio: { head, tail, ratio, by_stage: { CBM: n, SÁP/Cadcam: n, ĐẮP: n, MÀI: n }, status },
    first_pass_yield: { value, total, rework, target: 90, status },
    on_time_rate: { value, on_time, total, target: 90, status },
    customer_concentration: { top5_pct, total_rang, top5_rang, top5: [{ name, rang, pct }], status },
    demand_trend: { curr_rang, prev_rang, change_pct, prev_full, trend_label, prev_label, sparkline, status },
    scale_countdown: { target: 10000, current_rate, pct_of_target, days_until, status }
  }
}
```

**Time Windows:**
- `days=7` → 7 ngày gần nhất vs 7 ngày trước đó
- `days=30` → Kỳ tháng hiện tại vs kỳ tháng trước (default)
- `days=60` → 60 ngày gần nhất vs 60 ngày trước đó

**Frontend Features:**
- Responsive grid: 4 cols → 2 cols → 1 col
- Real-time refresh button
- Time window selector (7/30/60 ngày)
- Sparkline charts cho demand trend (inline SVG)
- Progress bars cho scale countdown
- Color-coded cards with animated status bars

**Access Control:**
- Route `/munger` protected by `requireAuth` + `requireAdmin`
- Sidebar link only shown for admin role
- API endpoint admin-only

---

## 12. Analytics Dashboard (analytics.html) — ADDED 2026-05-02

**Served tại:** `GET /analytics.html` (admin-only)

**Purpose:** Historical analytics với biểu đồ xu hướng

**Features:**
- Historical order data visualization
- Time-based charts
- Trend analysis
- KPI tracking over time

---

## 13. Key System State (2026-05-02)

**Current Data:**
- Total Orders: ~2,650 (Tháng 3-4)
- Total Teeth: ~14,000 răng
- Active Technicians: 23 KTV
- Dental Clinics: 88 nha khoa
- Database Records: 14,000+ rows
- Export Count: 5 (keylab_state.json)
- Latest Export File: `02052026_4.xls`

**System Architecture:**
```
Keylab2022 Desktop App
         ↓ (auto-export)
      Excel/
         ↓ (cleaner)
    File_sach/*_final.xlsx
         ↓ (scraper)
  labo_data.db (SQLite)
         ↓ (API)
   server.js (Express)
         ↓ (render)
   dashboard.html / mobile / munger / analytics / feedback / admin
```

**Deployment:**
- PM2 managed (process: `server`)
- Port: 3000
- Node.js v24.14.0
- Windows 11 Pro
- Virtual Display: parsec-vdd (VPS)

---

## 14. File watcher & Auto-scrape

**Status:** DISABLED (2026-05-02, commit 7012270)

**Reason:** File watcher was causing issues with data consistency. Auto-scrape timer also disabled to prevent race conditions with manual operations.

**Manual Trigger:** Admin can still trigger scrape via `/upload` page or API `/api/auto-scrape/run`

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
3b89f6f  docs: update CONTEXT.md with manual Keylab export + UI enhancements (d091b6a)
d091b6a  feat: Manual Keylab export + on-demand scraper
6606f2d  feat: SQLite storage + cleanup Data/ File_sach/ redundant files
c4b7ef9  feat: PM2 integration + 24/7 keylab export (15min interval)
80b2470  docs: update CONTEXT.md with Keylab2022 automation section
50ab8f6  feat: auto-restart keylab exporter + /keylab-status endpoint
7668b5b  feat: merge keylab-exporter — Keylab2022 desktop automation
37113f9  refactor: extract _wait_for_save_dialog, minimize on error
0f735b4  feat: dismiss 'Open with' dialog and minimize Keylab after export
9eba7d8  fix: use foreground window detection for Save As dialog
```

**Thay đổi quan trọng:**
- **6606f2d**: Chuyển sang SQLite làm nguồn dữ liệu chính (thay vì Excel + JSON)
- **d091b6a**: Keylab export chuyển sang manual trigger (POST /keylab-export-now)
- **3b89f6f**: Cập nhật CONTEXT.md với multi-user system

---

## 13. Multi-user system & Admin panel

**✅ ĐÃ HOÀN THÀNH** (commit a38e965, 110149e, 5279cb4)

**Tính năng:**
- ✅ File-based user storage: `users.json`
- ✅ Session persistence: `sessions.json` (survive server restart)
- ✅ Role-based access control: `admin` và `user`
- ✅ Admin panel UI: `/admin` (admin.html)
- ✅ User management: create, delete, reset password
- ✅ Self-protection: admin không thể xóa chính mình
- ✅ Session TTL: 7 ngày (thay vì 8 giờ cũ)

**Admin panel features:**
- Danh sách users với role badge
- Tạo user mới (username, password, role)
- Xóa user (có confirm dialog)
- Reset password user
- Link quay về dashboard

**Security:**
- Password lưu plain text trong `users.json` (⚠️ chưa hash)
- Session token: 32-byte hex random
- HttpOnly cookie, SameSite=Strict
- Admin-only routes protected by `requireAdmin` middleware

**Files liên quan:**
- `server.js`: Auth logic, user management API
- `admin.html`: Admin panel UI
- `users.json`: User database
- `sessions.json`: Active sessions (gitignored)
- `dashboard.html`, `dashboard_mobile_terracotta.html`: Hide upload button for non-admin

---

## 14. SQLite Database Schema

**Database:** `labo_data.db` (created by scraper commit 6606f2d)

**Tables:**

### `don_hang` (Đơn hàng)
```sql
CREATE TABLE don_hang (
  ma_dh TEXT PRIMARY KEY,
  nhap_luc TEXT,           -- Thời gian nhập (ISO format)
  yc_hoan_thanh TEXT,      -- Yêu cầu hoàn thành
  yc_giao TEXT,            -- Yêu cầu giao
  khach_hang TEXT,         -- Tên phòng khám
  benh_nhan TEXT,          -- Tên bệnh nhân
  phuc_hinh TEXT,          -- Mô tả phục hình
  sl INTEGER,              -- Số lượng răng
  loai_lenh TEXT,          -- Làm mới/Sửa/Làm lại/...
  ghi_chu TEXT,            -- Ghi chú
  trang_thai TEXT,         -- Trạng thái đơn
  tai_khoan_cao TEXT       -- Tài khoản scraper
);
```

### `tien_do` (Tiến độ công đoạn)
```sql
CREATE TABLE tien_do (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ma_dh TEXT,
  thu_tu INTEGER,          -- 0-4 (CBM, SÁP, SƯỜN, ĐẮP, MÀI)
  cong_doan TEXT,          -- Tên công đoạn
  ten_ktv TEXT,            -- Tên KTV
  xac_nhan TEXT,           -- 'Đã xác nhận' / 'Chưa'
  thoi_gian_hoan_thanh TEXT, -- Thời gian hoàn thành
  FOREIGN KEY (ma_dh) REFERENCES don_hang(ma_dh)
);
```

**Query pattern trong server.js:**
```javascript
// Lấy đơn hàng + stages với GROUP_CONCAT
SELECT d.*, 
       GROUP_CONCAT(
         t.thu_tu||'|'||t.cong_doan||'|'||COALESCE(t.ten_ktv,'')||'|'||
         COALESCE(t.xac_nhan,'Chưa')||'|'||COALESCE(t.thoi_gian_hoan_thanh,''),
         ';;'
       ) AS stages_raw
FROM don_hang d
LEFT JOIN tien_do t ON t.ma_dh = d.ma_dh
WHERE d.ma_dh IN (...)  -- Filter by active list
GROUP BY d.ma_dh
```

**Active filter logic:**
- Đọc file Excel mới nhất trong `Excel/` (Keylab export)
- Extract danh sách `ma_dh` từ cột "Mã ĐH"
- Chỉ query đơn hàng có trong danh sách này
- Fallback: nếu không tìm được file → hiển thị toàn bộ DB

---

## 15. Keylab2022 Desktop Automation

**Files:**
- `keylab_exporter.py` — Python automation dùng pywinauto
- `AutoExportKeyLab.ahk` — AutoHotkey script, dùng cho reference (không dùng chính thức)

**⚠️ QUAN TRỌNG: Auto-loop đã TẮT**

Keylab exporter có 2 modes:
1. **Manual mode (`--once`):** ✅ ĐANG DÙNG
   - Trigger: Admin click 🔄 trên dashboard
   - Command: `python keylab_exporter.py --once`
   - Tần suất: On-demand (khi cần)

2. **Auto-loop mode (`main()`):** ❌ ĐÃ TẮT
   - Xuất Excel tự động mỗi 15 phút, 24/7
   - Command: `python keylab_exporter.py` (không có flag)
   - Lý do tắt: Tránh conflict với manual export, file naming issues

**Để bật lại auto-loop (không khuyến nghị):**
```bash
# Add vào PM2:
pm2 start keylab_exporter.py --name keylab-auto --interpreter python
```

### 15.1 Quy trình xuất Excel thủ công (Manual mode)

**Flow khi admin click nút 🔄 "Xuất Excel KeyLab":**

```
Admin click 🔄
     ↓
POST /keylab-export-now (requireAuth, requireAdmin)
     ↓
spawn: python keylab_exporter.py --once
     ↓
  ┌─ Open Keylab desktop app (headless browser Playwright)
  ├─ Đăng nhập LaboAsia (login fallback: auth_token → jwt/token variants → session)
  ├─ Click "Tìm kiếm" + "Xuất Excel"
  ├─ Điền tên file {DDMMYYYY}_{n} vào Save As dialog
  ├─ Click Save → lưu vào Excel/
  └─ Đóng browser
     ↓
stdout: SAVED:<filepath>
     ↓
server.js parse → keylabExportJob.savedFile
     ↓
Mark filename vào manualKeyLabExports set
     ↓
File watcher detect → check manualKeyLabExports → OK, scrape!
     ↓
spawn: python run_scrape.py
```

### 14.2 Credential handling

**Cookie fallback logic (khi login LaboAsia):**
1. Thử tìm `auth_token` cookie
2. Fallback: Tìm cookie có tên chứa "token" hoặc "jwt"
3. Fallback: Tìm session cookies (session, sessionid, PHPSESSID)
4. Nếu không có → in ra danh sách cookies để debug

Giải quyết vấn đề cũ: "Đang nhập thành công nhưng không tìm thấy cookie auth_token"

### 14.3 File watcher logic (mới: d091b6a)

**Skip auto-export Keylab files:**
- File pattern `^\d{8}_\d+\.(xls|xlsx|xlsm)` từ Keylab được phát hiện
- **Nếu không từ manual export** → `log("Skip auto-export")` + return
- **Nếu từ manual export** → `manualKeyLabExports.has(filename)` check → OK, scrape

**Lợi ích:** Tránh scraper chạy định kỳ khi Keylab desktop app tự xuất (nếu có).

### 14.4 Debug & status

```bash
# Check export status
GET /keylab-export-status
# → { running: false, startedAt: "...", exitCode: 0, savedFile: "..." }

# Xem logs
tail -f ~/.pm2/logs/asia-lab-out.log
# → [keylab] Dang nhap OK: lanhn
# → [keylab] OK 262704030: 7 công đoạn
# → [keylab] done (exit=0)
```

---

## 16. UI Enhancements (commit d091b6a)

### 15.1 Export button trên dashboard

**Desktop (`dashboard.html`):**
- Nút `🔄 Xuất Excel KeyLab` trong sidebar (dưới nav menu)
- Ẩn mặc định, chỉ hiện khi `role === 'admin'`
- Click → POST `/keylab-export-now` → icon: `⏳` → `✅`/`⚠️`/`❌` → reset sau 3.5s

**Mobile (`dashboard_mobile_terracotta.html`):**
- Nút `🔄` trong search bar (giữa nút upload và logout)
- Ẩn mặc định, chỉ hiện khi `role === 'admin'`
- Cùng behavior như desktop

**Shared JS (`initAdminUI()`):**
```javascript
async function initAdminUI() {
  const r = await fetch('/user');
  const u = await r.json();
  if (u.role === 'admin') {
    // Hiện upload button
    document.getElementById('[id]').style.display = '';
    // Hiện export button (desktop)
    document.getElementById('d-export-section').style.display = '';
    // Hiện export button (mobile)
    document.getElementById('m-export-btn').classList.add('admin-visible');
  }
}
```

### 15.2 Upload button (ẩn với non-admin)

**Trước:** Link `📤 Upload` hiện cho tất cả user đăng nhập
**Sau:** Chỉ hiện cho admin (dùng `initAdminUI()`)

**ID elements:**
- Desktop: `#d-upload-btn`
- Mobile: `#m-upload-btn`

---

## 17. Chạy dự án

```bash
# Install
npm install
pip install -r requirements.txt

# Chạy server (file watcher hoạt động, no auto-loop keylab_exporter)
node server.js
# hoặc qua PM2:
pm2 start ecosystem.config.js
# → http://localhost:3000
# → Login: admin / 142536

# Mobile dashboard
# → http://localhost:3000/mobile

# Force reload data
# → http://localhost:3000/reload

# Xem status
# → http://localhost:3000/status

# Xem user info (cần auth)
# → http://localhost:3000/user

# Kích hoạt Keylab export thủ công (POST, admin-only)
# → curl -X POST http://localhost:3000/keylab-export-now -b sid=<token>

# Xem Keylab export status
# → http://localhost:3000/keylab-export-status (phải auth)
```

---

## 18. Git history (latest)

```
54b2cfb  feat: Feedback system + Auto-scrape 24/7 + Admin-only features (2026-05-01)
├─ Feedback system: create/list/update feedbacks with types
├─ Auto-scrape: every 10 minutes, 24/7 (no working hours limit)
├─ Session fix: attach req.session in requireAuth middleware
├─ Admin-only: Analytics & Feedback links hidden for regular users
├─ Feedback UI: collapsible sections, autocomplete with related orders + KTV info
└─ Search: expanded fields (ma_dh, khach_hang, benh_nhan, phuc_hinh, loai_lenh, ghi_chu)

3b89f6f  docs: update CONTEXT.md with manual Keylab export + UI enhancements (d091b6a)
d091b6a  feat: Manual Keylab export + on-demand scraper
├─ Remove auto-loop keylab_exporter
├─ Add POST /keylab-export-now endpoint (admin-only)
├─ Add fallback cookie lookup (auth_token → jwt → session)
├─ Hide upload button from non-admin users
├─ Add export button to admin dashboard (🔄) on desktop + mobile
└─ Skip auto-export Keylab files in file watcher

6606f2d  feat: SQLite storage + cleanup Data/ File_sach/ redundant files
├─ Migrate from Excel/JSON to SQLite (labo_data.db)
├─ Tables: don_hang, tien_do
├─ Active filter: only show orders in latest Keylab export
└─ Cleanup redundant Data/ and File_sach/ files

c4b7ef9  feat: PM2 integration + 24/7 keylab export (15min interval)
80b2470  docs: update CONTEXT.md with Keylab2022 automation section
50ab8f6  feat: auto-restart keylab exporter + /keylab-status endpoint
a38e965  merge: feat/multi-user-system → main
110149e  fix: persist sessions to file + orange pip for in-progress stage
5279cb4  chore: ignore sessions.json (live session tokens)
```

---

## 19. Package Dependencies

**Node.js (`package.json`):**
```json
{
  "dependencies": {
    "better-sqlite3": "^12.9.0",  // SQLite database
    "express": "^5.2.1",           // Web server
    "multer": "^2.1.1",            // File upload
    "xlsx": "^0.18.5"              // Excel parsing
  }
}
```

**Python (`requirements.txt`):**
- `playwright` — Browser automation for scraper
- `openpyxl` — Excel read/write
- `pywinauto` — Windows desktop automation (Keylab export)
- `pywin32` — Windows API access

---

## 20. Current State Summary (2026-05-02)

**✅ Hoàn thành:**
- Multi-user authentication với role-based access control
- Admin panel UI với user management
- SQLite database làm nguồn dữ liệu chính
- Keylab2022 desktop automation (manual trigger)
- Session persistence (survive restart)
- Mobile + desktop responsive dashboard
- Active order filtering (chỉ hiện đơn trong file export mới nhất)
- **Munger Dashboard với 7 metrics vận hành** (2026-05-02)
- **Analytics Dashboard với historical data** (2026-05-02)
- **Feedback System** (2026-05-01)
- **Auto-scrape 24/7 headless** (2026-05-02)

**⚠️ Known limitations:**
- Password lưu plain text (chưa hash)
- SQLite database file (`labo_data.db`) tồn tại nhưng có thể chưa có data
- Keylab export phụ thuộc vào desktop app Keylab2022 đang chạy
- Scraper credentials hardcoded trong env vars
- File watcher & auto-scrape timer trong server.js đã DISABLED (2026-05-02)

**📁 Files quan trọng:**
- `server.js` — Backend chính (75.5 KB, ~1400+ lines)
- `dashboard.html` — Dashboard desktop/mobile responsive (104 KB)
- `dashboard_mobile_terracotta.html` — Mobile theme sáng (31 KB)
- `munger.html` — Munger Dashboard 7 metrics (21 KB, admin-only)
- `analytics.html` — Analytics dashboard (10 KB, admin-only)
- `feedback.html` — Feedback system UI (24 KB)
- `admin.html` — Admin panel UI (17 KB)
- `users.json` — User database (2 users: admin, minhtuan)
- `sessions.json` — Active sessions (gitignored)
- `labo_data.db` — SQLite database (+ .db-shm, .db-wal)
- `keylab_state.json` — Keylab export counter (date: 02/05/2026, export_count: 5)
- `labo_config.json` — Last run file: `02052026_4.xls`

**🔄 Auto-processes:**
- ~~File watcher (server.js)~~ — **DISABLED** (2026-05-02, commit 7012270)
- ~~Auto-scrape timer (server.js)~~ — **DISABLED** (2026-05-02, commit 7012270)
- **Auto-scrape headless (auto_scrape_headless.py)**: chạy 24/7 qua PM2, mỗi 10 phút, không hiện CMD
- Keylab export: manual trigger only (POST /keylab-export-now)
- **PM2 server**: process `server` đang chạy (port 3000)

---

## 21. Headless Auto-Scrape (2026-05-02 UPDATE)

**File:** `auto_scrape_headless.py`

**Mục đích:** Tự động scrape file Excel mới nhất mỗi 10 phút, 24/7, không hiện cửa sổ CMD.

**⚠️ QUAN TRỌNG: Đây là nguồn auto-scrape DUY NHẤT**
- File watcher trong `server.js` đã **TẮT** (2026-05-02)
- Auto-scrape timer trong `server.js` đã **TẮT** (2026-05-02)
- Chỉ dùng `auto_scrape_headless.py` qua PM2

**Logic:**
```
Mỗi 10 phút (24/7):
  ├─ Tìm file Excel mới nhất trong Excel/
  ├─ So sánh với last_run_file (từ labo_config.json)
  ├─ Nếu khác → chạy run_scrape.py (với CREATE_NO_WINDOW flag)
  ├─ Nếu giống → skip (không scrape trùng)
  └─ Chờ 10 phút → lặp lại
```

**Thay đổi từ phiên bản cũ:**
- ❌ Bỏ check giờ làm việc (7:00-20:30) → chạy 24/7
- ✅ Dùng `CREATE_NO_WINDOW` flag → không hiện CMD
- ✅ Chạy qua PM2 → auto-restart, persistent

**Managed by PM2:**
```bash
pm2 start ecosystem.config.js  # Chạy cả server.js + auto-scrape
pm2 status                     # Xem trạng thái
pm2 logs auto-scrape           # Xem log
pm2 restart auto-scrape        # Restart
```

**Logs:**
```
[18:02:51] INFO Newest: 02052026_3.xls | Last: 02052026_3.xls
[18:02:51] INFO File unchanged → skipping scrape
[18:02:51] INFO Checking again in 10 min...
[18:12:51] INFO Newest: 02052026_3.xls | Last: 02052026_3.xls
[18:12:51] INFO File unchanged → skipping scrape
```

---

**Last updated:** 2026-05-01 by Claude Opus 4.7

---

## 22. Feedback System (2026-05-01)

**Mục đích:** Hệ thống quản lý phản ánh lỗi từ nha khoa về chất lượng đơn hàng.

**Files:**
- `feedback.html` — UI feedback system
- Database tables: `feedback_types`, `feedbacks`

**Tính năng:**
- ✅ Admin tạo/xóa loại lỗi (Màu sắc, Hình thể, Đơn hàng, Nha khoa, Khác)
- ✅ User nhập phản ánh: chọn đơn hàng, loại lỗi, mức độ (low/medium/high), mô tả
- ✅ Autocomplete đơn hàng: tìm theo mã đơn, tên nha khoa, bệnh nhân, phục hình, loại lệnh, ghi chú
- ✅ Hiển thị đơn liên quan (cùng ma_dh_goc) + KTV đã làm
- ✅ Filter phản ánh: Tất cả / Mở / Đang xử lý / Đã giải quyết / Đóng
- ✅ Update trạng thái phản ánh
- ✅ Collapsible sections: Quản lý loại lỗi, Danh sách phản ánh (mặc định ẩn)

**Admin-only:**
- Link "📝 Feedback" trong dashboard (ẩn với user thường)
- Tạo/xóa loại lỗi

**API endpoints:** (xem section 4)

---

## 23. Auto-Scrape 24/7 (2026-05-01)

**Mục đích:** Tự động cào file Excel mới nhất mỗi 10 phút, liên tục 24/7.

**Logic:**
```
Mỗi 10 phút (setInterval):
  ├─ Kiểm tra scrapeJob.running → skip nếu đang chạy
  ├─ Tìm file Excel mới nhất trong Excel/
  ├─ Nếu không tìm thấy → log warning
  └─ spawn: python run_scrape.py <filepath>
```

**Khác với auto_scrape_headless.py (đã loại bỏ):**
- Không check giờ làm việc → chạy 24/7
- Không check last_run_file → luôn scrape file mới nhất
- Lý do: Tiến độ trong file luôn thay đổi, cần cập nhật liên tục

**Khởi động:**
```javascript
// server.js
startAutoScrapeTimer();  // Chạy ngay khi server start
```

**API endpoints:**
- `GET /api/auto-scrape/status` — Trạng thái auto-scrape
- `POST /api/auto-scrape/run` — Admin kích hoạt scrape ngay (admin-only)

**Logs:**
```
[21:14:13] ⏰ Auto-scrape 24/7: chạy ngay, sau đó mỗi 10 phút
[21:14:13] 🔄 Auto-scrape: 01052026_49.xls
[21:14:13] 🚀 Bắt đầu cào: 01052026_49.xls
[21:14:38] 🏁 Scraper done: 01052026_49.xls, exit=0
```

---

## 24. Analytics Dashboard (Admin-only)

**File:** `analytics.html`

**Tính năng:**
- 📈 Xu hướng đơn hàng (line chart): Tổng đơn, Hoàn thành (7/30 ngày)
- 🍩 Phân bố loại phục hình (doughnut chart): Zirconia, Kim loại, Mặt dán, Hỗn hợp
- 📊 Hiệu suất KTV (bar chart): Top 10 KTV theo số đơn hoàn thành
- 🏥 Top 10 phòng khám (bar chart): Theo tổng đơn

**API endpoints:**
- `GET /api/analytics/trend?days=7|30` — Xu hướng đơn hàng
- `GET /api/analytics/ktv?days=7` — Hiệu suất KTV
- `GET /api/analytics/customers?limit=10` — Top khách hàng

**Chart library:** Chart.js 4.4.0 (CDN)

**Admin-only:** Link "📈 Analytics" ẩn với user thường

---

## 25. Admin-only Features Summary

**Ẩn với user thường (`role !== 'admin'`):**
- 📈 Analytics link
- 📊 Munger Dashboard link
- 📝 Feedback link (view all)
- 🔄 Xuất Excel KeyLab button
- 📤 Upload button
- ⚙️ Admin panel (`/admin`)
- 🔧 User management
- 📊 Historical analytics

**Hiển thị cho tất cả user:**
- 📋 Đơn Hàng
- ⚙️ Pipeline
- 📊 Tổng Hợp
- 📝 Feedback form (nhập phản ánh của chính mình)

**Implementation:**
```javascript
// dashboard.html
async function initAdminUI() {
  const u = await fetch('/user').then(r => r.json());
  if (u.role === 'admin') {
    document.getElementById('d-nl-analytics').style.display = '';
    document.getElementById('d-nl-munger').style.display = '';
    document.getElementById('d-nl-feedback').style.display = '';
    document.getElementById('d-export-section').style.display = '';
    document.getElementById('d-upload-btn').style.display = '';
  }
}
```

---

## 26. Munger Dashboard Details (2026-05-02)

**Philosophy:** Áp dụng Charlie Munger mental models vào quản lý labo

**7 Core Metrics:**

1. **Bus Factor** — Dependency Risk
   - Tracks: % công việc của KTV top 1 mỗi công đoạn
   - Purpose: Phát hiện single point of failure
   - Action: Cross-train khi >60%

2. **WIP Ratio** — Pipeline Balance
   - Formula: (ĐẮP + MÀI) / (CBM + SÁP)
   - Purpose: Phát hiện bottleneck cuối pipeline
   - Action: Rebalance capacity khi >1.1

3. **First-pass Yield** — Quality
   - Formula: % đơn không phải Sửa/Làm lại/Bảo hành
   - Target: 90%
   - Action: Quality review khi <85%

4. **On-time Rate** — Delivery
   - Formula: % đơn hoàn thành MÀI trước yc_hoan_thanh
   - Target: 90%
   - Action: Expedite khi <80%

5. **Customer Concentration** — Revenue Risk
   - Formula: % răng từ top 5 nha khoa
   - Purpose: Phát hiện dependency risk
   - Action: Diversify khi >50%

6. **Demand Trend** — Growth
   - Compares: Kỳ hiện tại vs kỳ trước (fair comparison)
   - Purpose: Track growth trajectory
   - Action: Sales intervention khi negative

7. **Scale Countdown** — Progress to 10K
   - Target: 10,000 răng/kỳ
   - Current: ~2,650 răng/kỳ (13% of target)
   - Purpose: Track scaling progress
   - Action: Accelerate hiring khi off-track

**Billing Period Logic:**
```javascript
// Kỳ tháng: 26 tháng trước → 25 tháng này
// Ví dụ: 26/3 → 25/4 = Tháng 4
// So sánh công bằng: N ngày đầu kỳ này vs N ngày đầu kỳ trước
```

**Color Coding:**
- 🟢 Green: Healthy, no action needed
- 🟡 Yellow: Caution, monitor closely
- 🔴 Red: Danger, immediate action required

**Documentation:** See `munger.md` for full details, playbooks, and scaling strategy

---

## 27. Recent Commits (2026-05-02)

```
6786c98  feat: add Munger Dashboard với 7 metrics vận hành và khách hàng
├─ 7 metrics: Bus Factor, WIP Ratio, FPY, On-time, Customer Concentration, Demand Trend, Scale Countdown
├─ Billing period logic (26-25 cycle)
├─ Fair comparison: N ngày đầu kỳ này vs N ngày đầu kỳ trước
├─ Admin-only route /munger + API /api/munger/metrics
├─ Sidebar integration (desktop + mobile)
└─ Documentation: munger.md (860 lines)

adf3297  feat: add analytics dashboard with historical data
├─ Historical order trends
├─ Time-based charts
└─ Admin-only access

7012270  fix: disable file watcher and auto-scrape timer in server.js
├─ Prevent race conditions
└─ Use auto_scrape_headless.py only

71845b7  chore: remove unused scripts

3320ed1  fix: switch virtual display from usbmmidd to parsec-vdd (GitHub)
```

---

## 28. System Health (2026-05-02 16:20)

**Server Status:**
- ✅ PM2 process `server` running (port 3000)
- ✅ 97 restarts (stabilized after initial issues)
- ✅ Uptime: 2 seconds (recent restart)
- ✅ Memory: 93.5 MB
- ✅ CPU: 0%

**Database:**
- ✅ labo_data.db: 65 đơn hàng
- ✅ 2 users loaded
- ✅ 43 sessions restored

**Latest Data:**
- Export file: `02052026_4.xls`
- Export count today: 5
- Date: 02/05/2026

**Modified Files (uncommitted):**
- `.claude/settings.local.json` — Permission updates
- `keylab_state.json` — Export counter
- `labo_config.json` — Last run file
- `munger.md` — Documentation updates

---

