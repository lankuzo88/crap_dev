# ASIA LAB AI Cowork Sandbox — Hướng Dẫn Sử Dụng

> Phiên bản: tháng 4/2026  
> Server: Flask trên port **3001** | UI: `http://localhost:3001`

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Khởi động server](#2-khởi-động-server)
3. [Giao diện Web UI](#3-giao-diện-web-ui)
4. [Chat với AI](#4-chat-với-ai)
5. [Quick Actions](#5-quick-actions)
6. [Danh sách Tools (22 tools)](#6-danh-sách-tools)
7. [Hệ thống Memory](#7-hệ-thống-memory)
8. [Quản lý Tasks & Projects](#8-quản-lý-tasks--projects)
9. [Reports](#9-reports)
10. [Activity Log](#10-activity-log)
11. [API Endpoints](#11-api-endpoints)
12. [Workflow thực tế](#12-workflow-thực-tế)
13. [Lưu ý & Hạn chế](#13-lưu-ý--hạn-chế)

---

## 1. Tổng quan

Sandbox là một **AI coworker** riêng biệt cho ASIA LAB, chạy song song với dashboard chính (port 3000).

| Tính năng | AI widget (dashboard) | AI Sandbox |
|-----------|----------------------|------------|
| Trả lời câu hỏi | ✓ | ✓ |
| Gọi tools / phân tích Excel | ✗ | ✓ |
| Nhớ hội thoại dài hạn | ✗ | ✓ (30 tin/session) |
| Tạo báo cáo tự động | ✗ | ✓ |
| Lưu facts / insights học được | ✗ | ✓ |
| Quản lý tasks & projects | ✗ | ✓ |
| Activity log | ✗ | ✓ |

**Luồng hoạt động:**

```
Bạn nhập câu hỏi
        ↓
AI đọc system prompt (SANDBOX.md + context xưởng)
        ↓
AI quyết định: cần tool không?
    ├── Có → gọi tool → nhận kết quả → trả lời
    └── Không → trả lời trực tiếp
        ↓
Lưu vào session history (sandbox_sessions.json)
```

---

## 2. Khởi động server

### Windows

Chạy file batch:
```
ai_workspace\start_sandbox.bat
```

Hoặc mở CMD, `cd` vào thư mục gốc:
```cmd
python ai_workspace/server.py
```

### Linux / Mac

```bash
cd /path/to/crap_dev
python ai_workspace/server.py
```

### Xác nhận khởi động thành công

Console sẽ hiển thị:

```
  ASIA LAB AI Cowork Sandbox
  ==================================================
  Workspace   : .../crap_dev/ai_workspace
  Port        : 3001
  URL         : http://localhost:3001
  Tools       : 22 registered
  Routes      : /chat /tool/* /memory/* /analyze/*
  Lab data    : Thang_04_2026.xlsx
  Memory JSON : sandbox_*.json active
  --------------------------------------------------
  Nhấn Ctrl+C để dừng
```

Kiểm tra trạng thái tại: `http://localhost:3001/status`

---

## 3. Giao diện Web UI

Mở trình duyệt: **`http://localhost:3001`**

### Layout

```
┌─────────────────────────────────────────────────────┐
│  ASIA LAB AI  [Chat][Tasks][Reports][Logs]          │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│  SIDEBAR     │         MAIN CONTENT                 │
│  (Desktop)   │                                      │
│  ─────────   │                                      │
│  Quick       │                                      │
│  Actions:    │                                      │
│  📊 Phân tích│                                      │
│  🏆 KTV      │                                      │
│  👥 Khách    │                                      │
│  📝 Daily    │                                      │
│  🔍 Patterns │                                      │
│              │                                      │
└──────────────┴──────────────────────────────────────┘
```

### 4 Tab chính

| Tab | Nội dung |
|-----|----------|
| **Chat** | Hộp thoại chat, lịch sử hội thoại |
| **Tasks** | Danh sách tasks, tạo task mới, đánh dấu done |
| **Reports** | Xem báo cáo đã sinh, tải về |
| **Logs** | Activity log: mọi hành động AI đã làm |

### Mobile

Trên điện thoại, sidebar ẩn. Navigation nằm ở bottom bar (4 icon tương ứng với 4 tab).

---

## 4. Chat với AI

### Cách chat

1. Click vào tab **Chat**
2. Nhập câu hỏi vào ô input ở dưới
3. Nhấn Enter hoặc nút Gửi

### AI sẽ làm gì?

AI đọc context thực tế từ file Excel trước khi trả lời:

```
Bạn hỏi: "Tháng này có bao nhiêu đơn?"
    → AI gọi analyze_excel() tự động
    → Đọc file Thang_04_2026.xlsx
    → Trả lời: "59 đơn, 200 răng, bottleneck tại công đoạn MÀI..."
```

### Bộ nhớ session

Mỗi lần mở tab Chat tạo ra một `sessionId` mới. AI nhớ **30 tin nhắn gần nhất** trong session đó. Nếu bạn refresh trình duyệt, session cũ vẫn được lưu — nhưng session mới sẽ bắt đầu.

### Lịch sử hội thoại

AI đọc tối đa 8 tin nhắn gần nhất từ session history khi trả lời, giúp duy trì ngữ cảnh trong cuộc trò chuyện dài.

---

## 5. Quick Actions

Sidebar trái (Desktop) hoặc bên trong Chat có 5 nút Quick Action:

| Nút | Câu hỏi gửi đến AI | Mục đích |
|-----|-------------------|----------|
| 📊 **Phân tích** | "Phân tích tổng quan đơn hàng tháng này" | Xem overview nhanh |
| 🏆 **KTV** | "Xếp hạng hiệu suất KTV tháng này" | Xem top KTV |
| 👥 **Khách** | "Phân tích khách hàng theo số đơn" | Xem top phòng khám |
| 📝 **Daily** | "Tạo báo cáo tổng hợp hôm nay" | Sinh daily report |
| 🔍 **Patterns** | "Tìm các pattern bất thường trong dữ liệu" | Phát hiện điểm lạ |

---

## 6. Danh sách Tools

AI có **22 tools** trong TOOL_REGISTRY, được gọi tự động khi cần. Bạn không cần biết tên tool — chỉ cần hỏi bằng ngôn ngữ tự nhiên.

### 6.1 Analysis Tools (4 tools)

| Tool | Mô tả | Ví dụ trigger |
|------|--------|---------------|
| `analyze_excel` | Phân tích tổng hợp file Excel: tổng đơn, top KTV, top khách, bottleneck | "Tháng này có bao nhiêu đơn?" |
| `analyze_ktv` | Xếp hạng KTV theo số đơn đã xác nhận | "KTV nào làm nhiều nhất?" |
| `analyze_customers` | Xếp hạng phòng khám theo số đơn | "Khách hàng lớn nhất là ai?" |
| `analyze_lead_times` | Lead time trung bình từng công đoạn | "Công đoạn nào mất nhiều thời gian nhất?" |

**Ví dụ kết quả `analyze_excel`:**
```json
{
  "total_orders": 59,
  "total_teeth": 200,
  "bottleneck": "MÀI",
  "bottleneck_pct": 32.5,
  "top_ktv": [{"name": "Ngọc Lân", "count": 12}, ...],
  "top_customers": [{"name": "BS Tăng Suy Nghĩ", "count": 40}, ...]
}
```

### 6.2 File Tools (6 tools)

| Tool | Mô tả |
|------|--------|
| `read_file` | Đọc file text trong ai_workspace/ |
| `write_file` | Ghi file text vào ai_workspace/ (mode: overwrite/append) |
| `list_dir` | Liệt kê files trong một thư mục |
| `find_files` | Tìm files theo glob pattern |
| `read_json` | Đọc + parse file JSON |
| `read_excel` | Đọc raw Excel từ File_sach/ (20 dòng đầu mỗi sheet) |

> **Bảo mật:** `write_file` chỉ cho phép ghi vào `ai_workspace/`. Mọi path traversal (`../`) bị chặn tự động.

### 6.3 Report Tools (2 tools)

| Tool | Mô tả |
|------|--------|
| `generate_report` | Sinh báo cáo text, lưu vào `analysis/reports/` |
| `export_orders_csv` | Export danh sách đơn ra CSV, lưu vào `analysis/exports/` |

**Các loại báo cáo (`report_type`):**

| Giá trị | Nội dung |
|---------|----------|
| `daily_summary` | Tổng hợp ngày: đơn, răng, KTV, khách |
| `ktv_report` | Xếp hạng KTV đầy đủ |
| `customer_report` | Xếp hạng phòng khám |
| `lead_time_report` | Lead time từng công đoạn |

### 6.4 Memory & Workspace Tools (6 tools)

| Tool | Mô tả |
|------|--------|
| `get_lab_state` | Trạng thái tổng quan: file mới nhất, số đơn, context xưởng |
| `add_learned_fact` | Lưu một fact AI học được vào sandbox_facts.json |
| `save_task` | Tạo task mới trong sandbox_tasks.json |
| `list_tasks` | Xem danh sách tasks (lọc theo project/status) |
| `save_project` | Tạo project mới |
| `list_projects` | Xem danh sách projects |

### 6.5 System Tools (4 tools)

| Tool | Mô tả |
|------|--------|
| `get_status` | Trạng thái sandbox: uptime, sessions, tasks pending |
| `log_activity` | Ghi một hành động vào activity log |
| `get_logs` | Lấy N log entries gần nhất |
| `search_logs` | Tìm kiếm trong logs theo keyword |

---

## 7. Hệ thống Memory

Sandbox có **3 lớp memory** độc lập nhau:

### Layer 1 — Session Memory (`sandbox_sessions.json`)

- Lưu lịch sử chat của từng session
- Giới hạn: 30 tin/session, 10 session gần nhất
- AI đọc lại 8 tin gần nhất khi trả lời
- Format: `[{role: "user", content: "..."}, {role: "assistant", content: "..."}]`

### Layer 2 — Facts (`sandbox_facts.json`)

AI tự động lưu facts khi phát hiện pattern:

```
Ví dụ fact: "BS Tăng Suy Nghĩ dẫn đầu với 40 đơn/tháng"
  source: "sandbox"
  confidence: "high"
  verified: false (cho đến khi bạn xác nhận)
```

- Giới hạn: 100 facts
- Facts được đưa vào prompt tự động khi chat
- AI hỏi bạn xác nhận trước khi đánh `verified: true`

### Layer 3 — Insights (`sandbox_insights.json`)

Insights là các phát hiện tổng hợp theo timeline:

```
2026-04-01: Bottleneck liên tục ở MÀI trong 3 tháng qua
2026-03-28: Khách mới (BS Hoàng Văn A) tăng 30% so với tháng trước
```

- Giới hạn: 50 entries
- Tự động xuất hiện trong prompt khi chat

---

## 8. Quản lý Tasks & Projects

### Tạo task bằng chat

```
Bạn: "Nhắc tôi theo dõi tỷ lệ remake của BS Tăng Suy Nghĩ"
AI: → gọi save_task() tự động
    → Task được lưu vào sandbox_tasks.json
```

Hoặc vào tab **Tasks** → nút **+ Tạo task**.

### Cấu trúc task

```json
{
  "id": "abc12345",
  "project_id": "default",
  "description": "Theo dõi remake rate BS Tăng Suy Nghĩ",
  "priority": "low",
  "status": "pending",
  "created": "2026-04-01T10:00:00"
}
```

### Priority

| Mức | Ý nghĩa |
|-----|---------|
| `high` | Quan trọng, làm ngay |
| `medium` | Bình thường (mặc định) |
| `low` | Tham khảo, theo dõi lâu dài |

### Projects

Mỗi task thuộc về một project. Project mặc định là `"default"`. Tạo project riêng cho từng chủ đề lớn (vd: "Cải thiện lead time", "Theo dõi KTV mới").

---

## 9. Reports

### Sinh báo cáo bằng chat

```
Bạn: "Tạo báo cáo tổng hợp hôm nay"
AI:  → gọi generate_report("daily_summary")
     → Lưu vào ai_workspace/analysis/reports/daily_summary_20260401_120000.txt
     → Trả về preview 500 ký tự đầu
```

### Xem báo cáo

Vào tab **Reports** để xem danh sách tất cả báo cáo đã sinh, click để xem nội dung.

### Thư mục lưu trữ

```
ai_workspace/
  analysis/
    reports/          ← Báo cáo text (.txt)
    exports/          ← Export CSV (.csv)
```

---

## 10. Activity Log

AI tự động ghi log mọi hành động quan trọng:

```
2026-04-01 12:00:00 | server_start  | tools=22
2026-04-01 12:05:30 | chat          | session=abc12345, msg_len=25, answer_len=340
2026-04-01 12:06:00 | reload        | user=system
```

Xem log:
- Tab **Logs** trong UI
- Hỏi AI: "Cho tôi xem activity log gần đây"
- API: `GET http://localhost:3001/status`

---

## 11. API Endpoints

### Hệ thống

| Endpoint | Method | Mô tả |
|----------|--------|-------|
| `/` | GET | Web UI (sandbox_web.html) |
| `/status` | GET | Trạng thái server đầy đủ |
| `/reload` | GET | Reload lab data từ Excel |

### Chat

| Endpoint | Method | Body | Mô tả |
|----------|--------|------|-------|
| `/chat` | POST | `{message, sessionId}` | Gửi tin nhắn, nhận câu trả lời |

**Request:**
```json
{
  "message": "Phân tích KTV tháng này",
  "sessionId": "abc12345"   // optional, tự sinh nếu không có
}
```

**Response:**
```json
{
  "answer": "...",
  "sessionId": "abc12345",
  "ok": true
}
```

### Memory

| Endpoint | Method | Mô tả |
|----------|--------|-------|
| `/memory/sessions` | GET | Danh sách sessions |
| `/memory/facts` | GET | Danh sách facts |
| `/memory/insights` | GET | Danh sách insights |

### Tools

| Endpoint | Method | Mô tả |
|----------|--------|-------|
| `/tool/list` | GET | Danh sách 22 tools có sẵn |
| `/tool/call` | POST | Gọi tool trực tiếp (không qua AI) |

### Analyze

| Endpoint | Method | Mô tả |
|----------|--------|-------|
| `/analyze/excel` | GET | Chạy analyze_excel() trực tiếp |
| `/analyze/ktv` | GET | Chạy analyze_ktv() |
| `/analyze/customers` | GET | Chạy analyze_customers() |

---

## 12. Workflow thực tế

### Workflow 1: Buổi sáng — xem tổng quan

1. Mở `http://localhost:3001`
2. Click **📊 Phân tích**
3. AI trả về: tổng đơn, bottleneck hôm nay, top KTV
4. Click **📝 Daily** để sinh báo cáo lưu lại

### Workflow 2: Phát hiện vấn đề

```
Bạn: "KTV nào có dấu hiệu chậm gần đây?"
AI:  → analyze_ktv() → thấy Trường chỉ xác nhận 3 đơn vs TB 12 đơn
     → add_learned_fact("Trường chậm hơn TB 75% trong tháng 4")
     → save_task("default", "Kiểm tra tình trạng KTV Trường", priority="high")
     → Trả lời + đề xuất hành động
```

### Workflow 3: Theo dõi khách hàng

```
Bạn: "Khách nào gửi nhiều đơn nhất 3 tháng qua?"
AI:  → analyze_customers(all_files=True)
     → Top: BS Tăng Suy Nghĩ 40 đơn/tháng
     → Đề xuất: "Nên tạo SLA riêng cho khách VIP này không?"
```

### Workflow 4: Sinh báo cáo theo yêu cầu

```
Bạn: "Tạo báo cáo lead time tháng 4"
AI:  → analyze_lead_times(file_path="Thang_04_2026.xlsx")
     → generate_report("lead_time_report")
     → Lưu: analysis/reports/lead_time_report_20260401_153000.txt
     → Trả về preview
```

---

## 13. Lưu ý & Hạn chế

### Giới hạn kỹ thuật

| Mục | Giới hạn |
|-----|---------|
| Tool iterations / tin nhắn | Tối đa 5 vòng gọi tool |
| Kết quả tool | Cắt bớt tại 8.000 ký tự |
| Lịch sử session | 30 tin/session, 10 sessions |
| Facts | 100 entries |
| Insights | 50 entries |
| Excel đọc | 20 dòng đầu / sheet (raw read), toàn bộ qua analyze |
| max_tokens | 4096 tokens / lần trả lời |

### Bảo mật

- AI **không được ghi ra ngoài** `ai_workspace/`
- AI **không được sửa** `dashboard.html`, `server.js`, `ai_memory.json`, `ai_knowledge.json`
- Path traversal (`../`) bị chặn tự động bởi `safe_path()`

### API Key & Proxy

- API key và base URL được cấu hình trong `ai_workspace/routes/chat.py`
- Nếu proxy không kết nối được, mọi câu chat sẽ trả về `"Lỗi AI: ..."`
- Kiểm tra kết nối: gửi tin nhắn đơn giản và xem response

### Reload dữ liệu

Khi có file Excel mới trong `File_sach/`, truy cập:
```
http://localhost:3001/reload
```
Hoặc hỏi AI: "Reload lab data"

### Không có realtime sync

Sandbox đọc Excel lúc khởi động và lúc gọi `/reload`. Nếu Excel thay đổi trong lúc server đang chạy, cần `/reload` để cập nhật.

---

*Tài liệu này mô tả trạng thái sandbox tháng 4/2026. Nếu có thêm tools hoặc tính năng mới, cập nhật lại tài liệu này.*
