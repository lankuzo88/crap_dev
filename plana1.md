# Session Context — Keylab Notes Scraper

## Mục tiêu
Tự động cào trường **"Ghi chú SX"** từ phần mềm Keylab2022 (WinForms desktop) cho từng đơn hàng trong file Excel active. Dữ liệu này dùng để xác định đơn nào cần "In mẫu hàm" hoặc chú thích đặc biệt, phục vụ routing sáp/zirco.

---

## File đã tạo

### `keylab_notes_scraper.py`
Scraper hoàn chỉnh. Chạy: `python keylab_notes_scraper.py`

**Yêu cầu trước khi chạy:** Keylab đang mở, đã click "Tìm kiếm" để load danh sách đơn.

**Logic chính:**
1. Đọc file Excel mới nhất trong `Excel/` → lấy danh sách `ma_dh`
2. Load `keylab_notes.json` → bỏ qua đơn đã có dữ liệu
3. Với mỗi đơn cần cào:
   - Gõ `ma_dh` vào Filter Row (`Mã ĐH filter row` DataItem)
   - Tìm row khớp chính xác trong Data Panel
   - Double-click để mở `FormTaoDonHang`
   - Verify `textEditMaDonHangUser` == `ma_dh`
   - Đọc tất cả DataItem tên `"Ghi chú SX row*"` trong `panelControl9 > gridControlDonHang`
   - Đóng bằng `btnDongLai.invoke()`
4. Lưu kết quả vào `keylab_notes.json` (giữ dữ liệu cũ, chỉ append)

**Output `keylab_notes.json`:**
```json
{
  "scraped_at": "2026-05-13 ...",
  "excel_active": "13052026_1.xls",
  "total": 54,
  "errors": 24,
  "orders": [{"ma_dh": "...", "ghi_chu_sx": "..."}],
  "error_list": [{"ma_dh": "...", "err": "not_visible"}]
}
```

---

## Kết quả chạy lần 1 (13/05/2026)
- File Excel: `13052026_1.xls` — 82 đơn, 78 cần cào (4 đã có sẵn)
- **OK: 54** | **SKIP: 24** | Thời gian: ~1284s (~21 phút)
- Skip lý do:
  - `not_visible` (~14): đơn không nằm trong khoảng ngày Keylab đang filter → mở rộng ngày tìm kiếm rồi chạy lại
  - `read_err` (~10): timing issue khi mở FormTaoDonHang → chạy lại sẽ lấy thêm

---

## UIA Control Tree — Keylab2022

```
FormMain (auto_id="FormMain")
├── gridControlDonHang (Table)          ← main list
│   ├── Filter Row (Custom)
│   │   └── Mã ĐH filter row (DataItem) ← gõ để filter
│   └── Data Panel (Custom)
│       └── [rows] (Custom)
│           └── [items] (DataItem)       ← cell_value() để đọc
└── FormTaoDonHang (Window)             ← detail, child của FormMain
    ├── textEditMaDonHangUser            ← verify ma_dh
    ├── btnDongLai (Button)             ← đóng, dùng .invoke()
    ├── btnSau / btnTruoc               ← next/prev
    └── panelControl9 (Pane)
        └── gridControlDonHang (Table)  ← KHÁC với main list!
            └── Data Panel (Custom)
                └── [rows]
                    └── "Ghi chú SX row0" (DataItem)  ← target
```

**Quan trọng:**
- `item.window_text()` → trả về tên element ("Ghi chú SX row0"), KHÔNG phải giá trị
- Đọc giá trị: `item.iface_value.CurrentValue` (primary) hoặc `item.legacy_properties()['Value']` (fallback)
- Button trong FormTaoDonHang nằm ngoài vùng hiển thị → dùng `.invoke()`, KHÔNG dùng `.click_input()`
- Tìm FormTaoDonHang: `spec.child_window(auto_id="FormTaoDonHang", control_type="Window")` — là child của FormMain, không phải top-level window
- Tìm gridControlDonHang trong detail: search trong `FormTaoDonHang` chứ không trong `spec` (tránh `ElementAmbiguousError`)

---

## Cách cải thiện

### Lấy thêm đơn bị skip `not_visible`
1. Trong Keylab: mở rộng khoảng ngày tìm kiếm (ví dụ từ 01/06/2026 đến 01/09/2026)
2. Click "Tìm kiếm" lại
3. Chạy lại `python keylab_notes_scraper.py` — tự động bỏ qua 54 đơn đã có

### Tăng tốc
- Giảm `time.sleep` từ 1.2s xuống 0.8s sau khi double-click (nếu Keylab load nhanh)
- Chạy theo batch theo khoảng ngày khác nhau

---

## Bước tiếp theo

### 1. Tích hợp ghi_chu_sx vào routing logic
Dùng data trong `keylab_notes.json` để tự động cập nhật `routed_to` trong DB:
- Đơn có `ghi_chu_sx` chứa "IN MẪU HÀM" → cần xử lý ở phòng sáp trước
- Đơn zirconia có note đặc biệt → routing logic riêng

File liên quan: `src/repositories/orders.repo.js`, `src/routes/orders.routes.js`

### 2. Color stripe display (đã thảo luận, chưa implement)
- Dải màu dọc bên trái card để phân biệt phòng sáp vs zirco
- Mobile: `border-left: 4px solid <color>` trên card
- Màu: sáp = vàng/cam, zirco = xanh dương

### 3. Chạy lại scraper sau khi mở rộng ngày trong Keylab
Dự kiến lấy thêm ~14 đơn đang bị `not_visible`

---

## TASK: Scraper v2 — Smart filter + DB-sync + Tăng tốc

### Mục tiêu
Viết lại `keylab_notes_scraper.py` thành v2 với các cải tiến:

1. **Chỉ chạy khi Excel mới đã vào DB** — gate check trước khi bắt đầu
2. **Loại trừ qua DB** — bỏ qua đơn đã có `ghi_chu_sx` và đơn có "In Mẫu" trong `phuc_hinh`
3. **Ghi thẳng vào DB** — không qua `keylab_notes.json` trung gian
4. **Giảm thời gian chờ** — tinh chỉnh sleep để tăng tốc

---

### Chi tiết implementation

#### Gate check — DB có file Excel mới chưa?

DB: `labo_data.db` (không phải `laboasia.db`)
Bảng: `import_log` — cột: `ten_file`, `ngay_import`, `so_don_hang`, `trang_thai`

Logic:
```python
DB_PATH = Path(__file__).parent / "labo_data.db"

def check_excel_in_db(excel_filename):
    """Trả về True nếu file Excel đã được import vào DB thành công."""
    con = sqlite3.connect(str(DB_PATH))
    # So sánh tên file (bỏ extension, so sánh stem)
    stem = Path(excel_filename).stem  # "13052026_2"
    row = con.execute(
        "SELECT ngay_import, so_don_hang FROM import_log "
        "WHERE ten_file LIKE ? AND trang_thai = 'ok' ORDER BY id DESC LIMIT 1",
        (f"%{stem}%",)
    ).fetchone()
    con.close()
    if not row:
        print(f"WARN: {excel_filename} chưa có trong import_log. Chạy db_manager.py import-all trước.")
        return False
    print(f"DB: {excel_filename} đã import lúc {row[0]} ({row[1]} đơn)")
    return True
```

Nếu check thất bại → `sys.exit(1)` với hướng dẫn rõ ràng.

---

#### Lọc todo list qua DB

Hiện tại lọc qua `keylab_notes.json`. Thay bằng query DB:

```python
def get_todo_from_db(ma_dh_list):
    con = sqlite3.connect(str(DB_PATH))
    ph = ','.join('?' * len(ma_dh_list))
    rows = con.execute(f"""
        SELECT ma_dh, ghi_chu_sx, phuc_hinh FROM don_hang
        WHERE ma_dh IN ({ph})
    """, ma_dh_list).fetchall()
    con.close()

    skip_done    = set()  # đã có ghi_chu_sx
    skip_inmau   = set()  # phuc_hinh chứa "In Mẫu" → không cần cào
    in_db        = {r[0] for r in rows}

    for ma_dh, ghi_chu_sx, phuc_hinh in rows:
        if ghi_chu_sx and ghi_chu_sx.strip():
            skip_done.add(ma_dh)
        elif phuc_hinh and 'in m' in phuc_hinh.lower():
            skip_inmau.add(ma_dh)

    # Đơn chưa vào DB (Excel mới hơn DB) → vẫn cào để có data khi sync tiếp
    todo = [m for m in ma_dh_list
            if m not in skip_done and m not in skip_inmau]

    print(f"Tong: {len(ma_dh_list)} | Da co ghi chu: {len(skip_done)} | "
          f"Co In Mau (bo qua): {len(skip_inmau)} | Can cao: {len(todo)}")
    return todo
```

**Lý do bỏ qua "In Mẫu" trong `phuc_hinh`:**  
Đây là loại đơn "in mẫu hàm" — thông tin đã rõ từ cột phục hình, không cần đọc thêm ghi chú SX từ Keylab.

---

#### Ghi thẳng vào DB thay vì JSON

```python
def save_to_db(results: dict[str, str]):
    """results = {ma_dh: ghi_chu_sx}"""
    con = sqlite3.connect(str(DB_PATH))
    con.executemany(
        "UPDATE don_hang SET ghi_chu_sx = ? WHERE ma_dh = ?",
        [(gc, ma_dh) for ma_dh, gc in results.items()]
    )
    con.commit()
    con.close()
```

Gọi sau mỗi 10 đơn (batch) hoặc khi kết thúc — tránh mất dữ liệu nếu crash giữa chừng.

---

#### Tăng tốc — giảm sleep

Benchmark lần 1: ~23.8s/đơn. Mục tiêu: ≤15s/đơn.

| Bước | Hiện tại | Mới | Ghi chú |
|------|----------|-----|---------|
| Sau gõ filter + ENTER | 0.8s | 0.5s | Grid filter nhanh |
| Sau double-click | 1.2s | 0.8s | FormTaoDonHang load nhanh |
| Sau invoke btnDongLai | 0.4s | 0.3s | |
| Sau clear filter | 0.5s | 0.3s | |
| Tổng/đơn ước tính | ~23.8s | ~15s | Tiết kiệm ~37% |

Nếu `read_err` tăng lên >15% thì tăng lại sleep double-click về 1.0s.

---

#### Kiến trúc main() mới

```python
def main():
    ma_dh_list, excel_name = get_active_ma_dh()      # đọc Excel
    if not ma_dh_list: sys.exit(1)

    if not check_excel_in_db(excel_name):             # GATE CHECK
        sys.exit(1)

    todo = get_todo_from_db(ma_dh_list)               # filter qua DB
    if not todo:
        print("Tat ca da co du lieu. Khong can chay."); return

    win = find_keylab(); focus(win.handle)
    spec = Desktop(backend="uia").window(handle=win.handle)
    close_detail(spec)
    main_grid = spec.child_window(auto_id="gridControlDonHang", control_type="Table")

    results = {}
    errors  = []
    BATCH   = 10

    for idx, ma_dh in enumerate(todo, 1):
        gc, status = scrape_one(spec, main_grid, ma_dh)
        if gc is not None:
            results[ma_dh] = gc
            print(f"[{idx}/{len(todo)}] {ma_dh} OK")
        else:
            errors.append({"ma_dh": ma_dh, "err": status})
            print(f"[{idx}/{len(todo)}] {ma_dh} SKIP ({status})")
        clear_filter(main_grid)

        if idx % BATCH == 0:          # lưu DB theo batch
            save_to_db(results)
            results.clear()

    if results:
        save_to_db(results)           # batch cuối

    print(f"\nOK: {len(todo)-len(errors)} | Skip: {len(errors)}")
    if errors:
        Path("scraper_errors.json").write_text(
            json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8")
```

---

### Các file liên quan
- `keylab_notes_scraper.py` → sửa in-place thành v2
- `labo_data.db` → bảng `don_hang` (cột `ghi_chu_sx`), bảng `import_log`
- `db_manager.py` → chạy `import-all` trước khi scrape

### Thứ tự chạy đúng
```
1. Copy file Excel mới vào Excel/
2. python db_manager.py import-all       ← đưa data vào DB
3. Mở Keylab, click Tìm kiếm
4. python keylab_notes_scraper.py        ← v2 tự gate-check DB
```
