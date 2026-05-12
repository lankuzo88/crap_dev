"""
keylab_notes_scraper.py

Scrape "Ghi chu SX" tu Keylab2022 cho file Excel active.
V2:
- Chi chay khi Excel moi da duoc import vao labo_data.db.
- Loc todo qua DB, bo qua don da co ghi_chu_sx va don da co "In mau" trong phuc_hinh.
- Ghi thang vao DB theo batch, khong dung keylab_notes.json lam trung gian.

Yeu cau: Keylab dang mo, da click "Tim kiem" de load danh sach don.
"""

import io
import json
import sqlite3
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import win32con
import win32gui
from pywinauto import Desktop
import pywinauto.keyboard as kb

if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = Path(__file__).parent
EXCEL_DIR = BASE_DIR / "Excel"
DB_PATH = BASE_DIR / "labo_data.db"
ERROR_FILE = BASE_DIR / "scraper_errors.json"

BATCH_SIZE = 10
FILTER_WAIT_SEC = 0.5
DETAIL_WAIT_SEC = 0.8
CLOSE_WAIT_SEC = 0.3
CLEAR_WAIT_SEC = 0.3


def normalize_ascii(value) -> str:
    return (
        unicodedata.normalize("NFD", str(value or "").lower())
        .encode("ascii", "ignore")
        .decode("ascii")
    )


def has_in_mau_ham(value) -> bool:
    n = normalize_ascii(value)
    return "in mau ham" in n or ("in mau" in n and "ham" in n)


def has_in_mau(value) -> bool:
    return "in m" in normalize_ascii(value)


def get_conn() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB_PATH), timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=30000")
    return con


# Excel active ---------------------------------------------------------------

def find_active_excel() -> Path | None:
    if not EXCEL_DIR.is_dir():
        return None
    candidates = [
        p for p in EXCEL_DIR.iterdir()
        if p.suffix.lower() in (".xls", ".xlsx", ".xlsm")
        and not any(tag in p.stem for tag in ("_scraped", "_final", "_cleaned"))
    ]
    return max(candidates, key=lambda p: p.stat().st_mtime) if candidates else None


def pick_sheet_name(sheet_names):
    for name in sheet_names:
        n = normalize_ascii(name).replace(" ", "")
        if any(k in n for k in ("donhang", "order", "sheet")):
            return name
    return sheet_names[0]


def pick_ma_dh_col(headers) -> int:
    for i, header in enumerate(headers):
        n = normalize_ascii(header).replace(" ", "").replace("_", "")
        if "ma" in n and any(k in n for k in ("dh", "don", "order")):
            return i
    for i, header in enumerate(headers):
        if "ma" in normalize_ascii(header):
            return i
    return 0


def clean_ma_dh(value) -> str:
    text = str(value or "").strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text


def get_active_ma_dh():
    f = find_active_excel()
    if not f:
        print("ERR: Khong co file Excel trong Excel/")
        return [], ""

    print(f"Excel: {f.name}")
    ids = []
    try:
        if f.suffix.lower() == ".xls":
            import xlrd

            wb = xlrd.open_workbook(str(f))
            ws = wb.sheet_by_name(pick_sheet_name(wb.sheet_names()))
            headers = [str(ws.cell_value(0, c)).strip() for c in range(ws.ncols)]
            col = pick_ma_dh_col(headers)
            for r in range(1, ws.nrows):
                value = clean_ma_dh(ws.cell_value(r, col))
                if value and normalize_ascii(value) not in ("tong", "ma dh"):
                    ids.append(value)
        else:
            import openpyxl

            wb = openpyxl.load_workbook(str(f), read_only=True, data_only=True)
            ws = wb[pick_sheet_name(wb.sheetnames)]
            rows = ws.iter_rows(values_only=True)
            headers = [str(c or "").strip() for c in next(rows)]
            col = pick_ma_dh_col(headers)
            for row in rows:
                value = clean_ma_dh(row[col] if col < len(row) else "")
                if value and normalize_ascii(value) not in ("tong", "ma dh", "none"):
                    ids.append(value)
    except Exception as exc:
        print(f"ERR doc Excel: {exc}")

    return list(dict.fromkeys(ids)), f.name


# DB gate/filter/save --------------------------------------------------------

def ensure_db_schema():
    if not DB_PATH.exists():
        print(f"ERR: Khong thay DB {DB_PATH}. Hay chay python db_manager.py import-all truoc.")
        sys.exit(1)
    with get_conn() as con:
        cols = {row["name"] for row in con.execute("PRAGMA table_info(don_hang)").fetchall()}
        if "ghi_chu_sx" not in cols:
            con.execute("ALTER TABLE don_hang ADD COLUMN ghi_chu_sx TEXT DEFAULT ''")
        if "routed_to" not in cols:
            con.execute("ALTER TABLE don_hang ADD COLUMN routed_to TEXT DEFAULT NULL")
        con.commit()


def check_excel_in_db(excel_filename) -> bool:
    stem = Path(excel_filename).stem
    with get_conn() as con:
        row = con.execute(
            """
            SELECT ngay_import, so_don_hang
            FROM import_log
            WHERE ten_file LIKE ? AND trang_thai = 'ok'
            ORDER BY id DESC
            LIMIT 1
            """,
            (f"%{stem}%",),
        ).fetchone()

    if not row:
        print(f"WARN: {excel_filename} chua co trong import_log.")
        print("Hay chay: python db_manager.py import-all")
        return False

    print(f"DB: {excel_filename} da import luc {row['ngay_import']} ({row['so_don_hang']} don)")
    return True


def get_todo_from_db(ma_dh_list):
    if not ma_dh_list:
        return []

    with get_conn() as con:
        placeholders = ",".join("?" for _ in ma_dh_list)
        rows = con.execute(
            f"""
            SELECT ma_dh, COALESCE(ghi_chu_sx, '') AS ghi_chu_sx, COALESCE(phuc_hinh, '') AS phuc_hinh
            FROM don_hang
            WHERE ma_dh IN ({placeholders})
            """,
            ma_dh_list,
        ).fetchall()

    by_ma = {row["ma_dh"]: row for row in rows}
    skip_done = set()
    skip_inmau = set()
    missing_db = set()

    for ma_dh in ma_dh_list:
        row = by_ma.get(ma_dh)
        if row is None:
            missing_db.add(ma_dh)
            continue
        if str(row["ghi_chu_sx"] or "").strip():
            skip_done.add(ma_dh)
        elif has_in_mau(row["phuc_hinh"]):
            skip_inmau.add(ma_dh)

    todo = [
        ma_dh for ma_dh in ma_dh_list
        if ma_dh not in skip_done and ma_dh not in skip_inmau
    ]

    print(
        f"Tong: {len(ma_dh_list)} | Da co ghi chu: {len(skip_done)} | "
        f"Co In Mau trong phuc_hinh: {len(skip_inmau)} | Chua co DB: {len(missing_db)} | "
        f"Can cao: {len(todo)}"
    )
    return todo


def save_to_db(results: dict[str, str]) -> int:
    if not results:
        return 0

    with get_conn() as con:
        for ma_dh, note in results.items():
            note = str(note or "").strip()
            if has_in_mau_ham(note):
                con.execute(
                    """
                    UPDATE don_hang
                    SET ghi_chu_sx = ?, routed_to = 'zirco', updated_at = datetime('now','localtime')
                    WHERE ma_dh = ?
                    """,
                    (note, ma_dh),
                )
            else:
                con.execute(
                    """
                    UPDATE don_hang
                    SET ghi_chu_sx = ?, updated_at = datetime('now','localtime')
                    WHERE ma_dh = ?
                    """,
                    (note, ma_dh),
                )
        con.commit()
    return len(results)


# Pywinauto helpers ----------------------------------------------------------

def find_keylab():
    for w in Desktop(backend="uia").windows():
        try:
            if "keylab" in w.window_text().lower():
                return w
        except Exception:
            pass
    return None


def focus(hwnd):
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        import ctypes

        ctypes.windll.user32.SetForegroundWindow(hwnd)
    time.sleep(0.2)


def cell_value(item):
    try:
        return item.iface_value.CurrentValue or ""
    except Exception:
        try:
            return item.legacy_properties().get("Value", "") or ""
        except Exception:
            return ""


def close_detail(spec):
    try:
        detail = spec.child_window(auto_id="FormTaoDonHang", control_type="Window")
        detail.child_window(auto_id="btnDongLai", control_type="Button").invoke()
        time.sleep(CLOSE_WAIT_SEC)
    except Exception:
        pass


def read_ghi_chu_sx(detail):
    values = []
    try:
        panel9 = detail.child_window(auto_id="panelControl9", control_type="Pane")
        grid = panel9.child_window(auto_id="gridControlDonHang", control_type="Table")
        dp = grid.child_window(title="Data Panel", control_type="Custom")
        for row in dp.children():
            for item in row.children():
                if item.element_info.name.startswith("Ghi ch\u00fa SX row"):
                    value = cell_value(item).strip()
                    if value:
                        values.append(value)
    except Exception as exc:
        values.append(f"[ERR:{exc}]")
    return values


def wait_for_detail(spec, ma_dh, timeout=DETAIL_WAIT_SEC):
    deadline = time.time() + timeout
    last_err = ""
    while time.time() < deadline:
        try:
            detail = spec.child_window(auto_id="FormTaoDonHang", control_type="Window")
            actual = detail.child_window(auto_id="textEditMaDonHangUser").window_text().strip()
            if actual == ma_dh:
                return detail, ""
            if actual:
                last_err = f"wrong_order:{actual}"
        except Exception as exc:
            last_err = str(exc)
        time.sleep(0.08)
    return None, last_err or "detail_timeout"


def apply_filter(main_grid, ma_dh):
    fr = main_grid.child_window(title="Filter Row", control_type="Custom")
    fi = fr.child_window(title="M\u00e3 \u0110H filter row", control_type="DataItem")
    fi.click_input()
    time.sleep(0.12)
    kb.send_keys("^a{DELETE}", pause=0.03)
    kb.send_keys(ma_dh, pause=0.02)
    kb.send_keys("{ENTER}", pause=0.05)
    time.sleep(FILTER_WAIT_SEC)


def find_visible_row(main_grid, ma_dh):
    dp = main_grid.child_window(title="Data Panel", control_type="Custom")
    for row in dp.children():
        for item in row.children():
            if "M\u00e3 \u0110H row" in item.element_info.name:
                if cell_value(item).strip() == ma_dh:
                    return row
    return None


def scrape_one(spec, main_grid, ma_dh):
    """Filter grid theo ma_dh, double-click, doc Ghi chu SX. Returns (note, status)."""
    try:
        apply_filter(main_grid, ma_dh)
    except Exception as exc:
        return None, f"filter_err:{exc}"

    try:
        target = find_visible_row(main_grid, ma_dh)
    except Exception as exc:
        return None, f"no_dp:{exc}"

    if target is None:
        return None, "not_visible"

    try:
        target.double_click_input()
    except Exception as exc:
        return None, f"dblclick_err:{exc}"

    detail, err = wait_for_detail(spec, ma_dh)
    if not detail:
        close_detail(spec)
        return None, f"read_err:{err}"

    try:
        values = read_ghi_chu_sx(detail)
        if any(str(value).startswith("[ERR:") for value in values):
            close_detail(spec)
            return None, values[0]
        note = " | ".join(values)
        close_detail(spec)
        return note, "ok"
    except Exception as exc:
        close_detail(spec)
        return None, f"read_err:{exc}"


def clear_filter(main_grid):
    try:
        fr = main_grid.child_window(title="Filter Row", control_type="Custom")
        fi = fr.child_window(title="M\u00e3 \u0110H filter row", control_type="DataItem")
        fi.click_input()
        time.sleep(0.1)
        kb.send_keys("^a{DELETE}{ENTER}", pause=0.03)
        time.sleep(CLEAR_WAIT_SEC)
    except Exception:
        pass


# Main -----------------------------------------------------------------------

def main():
    dry_run = "--dry-run" in sys.argv

    ensure_db_schema()

    ma_dh_list, excel_name = get_active_ma_dh()
    if not ma_dh_list:
        sys.exit(1)

    if not check_excel_in_db(excel_name):
        sys.exit(1)

    todo = get_todo_from_db(ma_dh_list)
    if dry_run:
        print("Dry-run: chi kiem tra DB/filter, khong thao tac Keylab.")
        return

    if not todo:
        print("Tat ca da co du lieu. Khong can chay.")
        return

    win = find_keylab()
    if not win:
        print("ERR: Keylab khong mo.")
        sys.exit(1)

    focus(win.handle)
    spec = Desktop(backend="uia").window(handle=win.handle)
    close_detail(spec)
    main_grid = spec.child_window(auto_id="gridControlDonHang", control_type="Table")

    pending_results = {}
    errors = []
    ok_count = 0
    t0 = time.time()

    for idx, ma_dh in enumerate(todo, 1):
        print(f"[{idx:>3}/{len(todo)}] {ma_dh} ...", end=" ", flush=True)
        note, status = scrape_one(spec, main_grid, ma_dh)
        if note is not None:
            pending_results[ma_dh] = note
            ok_count += 1
            print(f"OK  {repr(note[:70])}")
        else:
            errors.append({"ma_dh": ma_dh, "err": status})
            print(f"SKIP ({status})")

        if len(pending_results) >= BATCH_SIZE:
            saved = save_to_db(pending_results)
            print(f"Saved DB batch: {saved}")
            pending_results.clear()

    if pending_results:
        saved = save_to_db(pending_results)
        print(f"Saved DB batch: {saved}")

    clear_filter(main_grid)

    if errors:
        payload = {
            "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "excel_active": excel_name,
            "errors": errors,
        }
        ERROR_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Errors saved: {ERROR_FILE}")

    elapsed = time.time() - t0
    per_order = elapsed / len(todo) if todo else 0
    print(f"\nOK: {ok_count} | Skip: {len(errors)} | {elapsed:.0f}s | {per_order:.1f}s/don")


if __name__ == "__main__":
    main()
