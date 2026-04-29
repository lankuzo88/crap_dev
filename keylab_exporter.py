"""
Keylab2022 Desktop Automation
Tự động xuất Excel từ ứng dụng Keylab2022 mỗi 10 phút (7:30 - 20:00).
"""

import io
import json
import logging
import os
import sys
import time
from datetime import datetime, time as dtime
from pathlib import Path

# Fix console encoding trên Windows
if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    from pywinauto import Desktop
    from pywinauto.timings import TimeoutError as PWTimeoutError
except ImportError:
    print("[ERROR] pywinauto chưa được cài. Chạy: pip install pywinauto pywin32")
    sys.exit(1)

# ── Config ──────────────────────────────────────────────────────────────────
START_TIME = dtime(7, 30)
END_TIME = dtime(20, 0)
INTERVAL_SECONDS = 10 * 60  # 10 phút

STATE_FILE = Path(__file__).parent / "keylab_state.json"
LOG_FILE = Path(__file__).parent / "keylab_export.log"

# Title bar: "LAB ASIA - KEYLAB VERSION 2022 - SUPPORT 24/7 : ..."
KEYLAB_TITLE_CONTAINS = "keylab"

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger("keylab")


# ── State ────────────────────────────────────────────────────────────────────
def load_state() -> dict:
    today = datetime.now().strftime("%d/%m/%Y")
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            if state.get("date") == today:
                return state
        except (json.JSONDecodeError, KeyError):
            pass
    return {"date": today, "export_count": 1}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def next_filename(state: dict) -> str:
    date_str = datetime.now().strftime("%d%m%Y")
    return f"{date_str}_{state['export_count']}"


# ── Window detection ─────────────────────────────────────────────────────────
def find_keylab_window():
    desktop = Desktop(backend="uia")
    for w in desktop.windows():
        try:
            if KEYLAB_TITLE_CONTAINS in w.window_text().lower():
                return w
        except Exception:
            continue
    return None


def debug_controls():
    """Chạy lần đầu để tìm auto_id của các control trong Keylab2022."""
    import win32gui, win32con
    win = find_keylab_window()
    if not win:
        print("[DEBUG] Không tìm thấy cửa sổ Keylab2022.")
        return
    print(f"[DEBUG] Window title: '{win.window_text()}'")
    print(f"[DEBUG] Handle: {win.handle}")

    # Restore window nếu đang minimized
    win32gui.ShowWindow(win.handle, win32con.SW_RESTORE)
    win32gui.SetForegroundWindow(win.handle)
    time.sleep(1)

    print("[DEBUG] === Control Tree ===")
    try:
        Desktop(backend="uia").window(handle=win.handle).print_control_identifiers()
    except Exception as e:
        print(f"[DEBUG] Fallback to manual dump: {e}")
        _dump_children(win, indent=0)


def _dump_children(ctrl, indent=0):
    prefix = "  " * indent
    try:
        title = ctrl.window_text()
        ctype = ctrl.element_info.control_type
        auto_id = ctrl.element_info.automation_id
        print(f"{prefix}[{ctype}] '{title}' auto_id='{auto_id}'")
    except Exception:
        pass
    try:
        for child in ctrl.children():
            _dump_children(child, indent + 1)
    except Exception:
        pass


# ── Automation sequence ───────────────────────────────────────────────────────
def run_export(win, filename: str) -> bool:
    try:
        import win32gui, win32con

        # 1. Restore + focus cửa sổ Keylab2022
        win32gui.ShowWindow(win.handle, win32con.SW_RESTORE)
        win32gui.SetForegroundWindow(win.handle)
        time.sleep(0.5)

        # Dùng WindowSpecification để truy cập child controls
        spec = Desktop(backend="uia").window(handle=win.handle)

        # 2. Click nút "Tìm kiếm" (auto_id=btnTimKiem) để refresh dữ liệu
        search_btn = spec.child_window(auto_id="btnTimKiem", control_type="Button")
        search_btn.click_input()
        log.info("Clicked 'Tìm kiếm' — chờ 3 giây để tải dữ liệu...")
        time.sleep(3)

        # 3. Click nút "Xuất Excel" (auto_id=btnXuatExcel)
        export_btn = spec.child_window(auto_id="btnXuatExcel", control_type="Button")
        export_btn.click_input()
        log.info("Clicked 'Xuất Excel'")
        time.sleep(2)

        # 4. Hộp thoại Save As (Windows dialog)
        save_dlg = None
        deadline = time.time() + 15
        while time.time() < deadline:
            for title_pat in [r"Save As", r"Lưu", r"Save", r"Export"]:
                try:
                    dlg = Desktop(backend="uia").window(title_re=title_pat)
                    dlg.wait("visible", timeout=1)
                    save_dlg = dlg
                    break
                except Exception:
                    pass
            if save_dlg:
                break
            time.sleep(0.5)

        if save_dlg is None:
            log.error("Hộp thoại lưu file không xuất hiện sau 15 giây")
            return False

        # Xóa tên cũ, nhập tên mới và Enter
        name_field = save_dlg.child_window(auto_id="1001", control_type="Edit")
        name_field.set_edit_text(filename)
        name_field.type_keys("{ENTER}")
        log.info(f"Đã nhập tên file và lưu: {filename}")
        time.sleep(1.5)
        return True

    except PWTimeoutError as e:
        log.error(f"Timeout khi tìm control: {e}")
        return False
    except Exception as e:
        log.error(f"Lỗi khi xuất: {e}")
        return False


# ── Scheduler ────────────────────────────────────────────────────────────────
def should_run_now() -> bool:
    now = datetime.now().time()
    return START_TIME <= now <= END_TIME


def seconds_until_start() -> int:
    now = datetime.now()
    start_today = now.replace(hour=START_TIME.hour, minute=START_TIME.minute, second=0, microsecond=0)
    if now >= start_today:
        return 0
    return int((start_today - now).total_seconds())


def main():
    log.info("=== Keylab Exporter start ===")
    log.info(f"Schedule: {START_TIME.strftime('%H:%M')} - {END_TIME.strftime('%H:%M')}, every {INTERVAL_SECONDS // 60} min")

    win = find_keylab_window()
    if not win:
        log.warning(f"Warning: window '{KEYLAB_TITLE_CONTAINS}' not found. Will retry each cycle.")
    else:
        log.info(f"Found Keylab2022: '{win.window_text()}'")

    while True:
        now = datetime.now()

        if not should_run_now():
            wait = seconds_until_start()
            if wait > 0:
                log.info(f"Ngoai gio lam viec. Cho den {START_TIME.strftime('%H:%M')} ({wait // 60} phut nua)...")
                time.sleep(min(wait, 60))
            else:
                log.info(f"Da qua {END_TIME.strftime('%H:%M')}. Cho den ngay mai...")
                time.sleep(60)
            continue

        # Trong giờ làm việc → xuất Excel
        state = load_state()
        filename = next_filename(state)

        win = find_keylab_window()
        if not win:
            log.error("Khong tim thay cua so Keylab2022. Bo qua luot nay.")
        else:
            log.info(f"Bat dau xuat: {filename}")
            success = run_export(win, filename)
            if success:
                state["export_count"] += 1
                save_state(state)
                log.info(f"[OK] Xuat thanh cong: {filename} (luot {state['export_count'] - 1} hom nay)")
            else:
                log.warning(f"[FAIL] Xuat that bai luot nay, giu nguyen counter={state['export_count']}")

        log.info(f"Cho {INTERVAL_SECONDS // 60} phut den luot tiep theo...")
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    # Thêm --debug để in control tree
    if len(sys.argv) > 1 and sys.argv[1] == "--debug":
        debug_controls()
    else:
        main()
