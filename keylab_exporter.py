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
START_TIME = dtime(0, 0)   # 00:00 - chạy 24/24
END_TIME = dtime(23, 59)   # 23:59 - chạy 24/24
INTERVAL_SECONDS = 15 * 60  # 15 phút

STATE_FILE = Path(__file__).parent / "keylab_state.json"
LOG_FILE   = Path(__file__).parent / "keylab_export.log"
EXCEL_DIR  = Path(__file__).parent / "Excel"

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


def debug_save_dialog():
    """Click Xuat Excel roi in control tree cua hop thoai Save As."""
    import win32gui, win32con

    win = find_keylab_window()
    if not win:
        print("[DEBUG] Khong tim thay Keylab2022")
        return

    win32gui.ShowWindow(win.handle, win32con.SW_RESTORE)
    try:
        win32gui.SetForegroundWindow(win.handle)
    except Exception:
        import ctypes
        ctypes.windll.user32.SetForegroundWindow(win.handle)
    time.sleep(0.8)

    spec = Desktop(backend="uia").window(handle=win.handle)
    export_btn = spec.child_window(auto_id="btnXuatExcel", control_type="Button")
    export_btn.click_input()
    print("[DEBUG] Clicked Xuat Excel, waiting for Save dialog...")

    keylab_handle = win.handle
    import os
    my_pid = os.getpid()

    # Cách 1: Theo dõi foreground window thay đổi
    print("[DEBUG] Tracking foreground window changes...")
    for i in range(20):
        time.sleep(0.5)
        fg = win32gui.GetForegroundWindow()
        fg_title = win32gui.GetWindowText(fg)
        print(f"[DEBUG] {i+1}/20 fg=[{fg_title}] handle={fg}")
        if fg != keylab_handle and fg != 0:
            try:
                print(f"\n[DEBUG] Possible dialog: [{fg_title}] handle={fg}")
                Desktop(backend="uia").window(handle=fg).print_control_identifiers()
                return
            except Exception as e:
                print(f"  (error printing: {e})")

    # Cách 2: EnumWindows tìm child dialogs của Keylab
    print("\n[DEBUG] Fallback: EnumChildWindows of Keylab...")
    children = []
    win32gui.EnumChildWindows(keylab_handle, lambda h, _: children.append(h), None)
    for h in children:
        try:
            t = win32gui.GetWindowText(h)
            cls = win32gui.GetClassName(h)
            print(f"  child handle={h} class={cls} title=[{t}]")
        except Exception:
            pass


# ── Automation sequence ───────────────────────────────────────────────────────
def _bm_click(parent_hwnd: int, btn_text: str) -> bool:
    """SendMessage BM_CLICK den button theo text — khong can window visible/focused."""
    import win32gui, win32con
    found = []
    def cb(hwnd, _):
        if win32gui.GetWindowText(hwnd) == btn_text:
            found.append(hwnd)
    win32gui.EnumChildWindows(parent_hwnd, cb, None)
    if not found:
        log.error(f"Khong tim thay button: '{btn_text}'")
        return False
    win32gui.SendMessage(found[0], win32con.BM_CLICK, 0, 0)
    return True


def run_export(win, filename: str) -> bool:
    import win32gui, win32con
    try:
        # Restore + focus — WinForms yêu cầu window active để ShowDialog() hoạt động
        win32gui.ShowWindow(win.handle, win32con.SW_RESTORE)
        try:
            win32gui.SetForegroundWindow(win.handle)
        except Exception:
            import ctypes
            ctypes.windll.user32.SetForegroundWindow(win.handle)
        time.sleep(0.5)

        spec = Desktop(backend="uia").window(handle=win.handle)

        # 1. Click "Tim kiem"
        spec.child_window(auto_id="btnTimKiem", control_type="Button").click_input()
        log.info("Clicked 'Tim kiem' — cho 3 giay...")
        time.sleep(3)

        # 2. Click "Xuat Excel"
        spec.child_window(auto_id="btnXuatExcel", control_type="Button").click_input()
        log.info("Clicked 'Xuat Excel'")
        time.sleep(2)

        # 3. Chờ Save As dialog qua GetForegroundWindow
        save_dlg_handle = _wait_for_save_dialog(win.handle, timeout=15)
        if save_dlg_handle is None:
            log.error("Hop thoai Save As khong xuat hien sau 15 giay")
            return False

        save_dlg = Desktop(backend="uia").window(handle=save_dlg_handle)
        name_field = save_dlg.child_window(auto_id="1001", control_type="Edit")
        name_field.click_input()
        name_field.type_keys("^a", pause=0.1)
        name_field.type_keys(filename, with_spaces=False)
        save_dlg.child_window(auto_id="1", control_type="Button").click_input()
        log.info(f"Da luu: {filename}")
        time.sleep(1.5)

        # 4. Đóng dialog "Open with" nếu xuất hiện
        _dismiss_open_with_dialog()

        # 5. Minimize về taskbar
        win32gui.ShowWindow(win.handle, win32con.SW_MINIMIZE)
        return True

    except PWTimeoutError as e:
        log.error(f"Timeout: {e}")
        win32gui.ShowWindow(win.handle, win32con.SW_MINIMIZE)
        return False
    except Exception as e:
        log.error(f"Loi xuat: {e}")
        win32gui.ShowWindow(win.handle, win32con.SW_MINIMIZE)
        return False


def _wait_for_save_dialog(keylab_handle: int, timeout: int = 15) -> int | None:
    """Cho Save As dialog xuat hien — quet ca EnumWindows lan GetForegroundWindow."""
    import win32gui
    deadline = time.time() + timeout
    while time.time() < deadline:
        # Quet tat ca top-level windows
        found = []
        def _cb(hwnd, _):
            if hwnd == keylab_handle:
                return
            t = win32gui.GetWindowText(hwnd).lower()
            if t in ("save as", "save", "luu"):
                found.append(hwnd)
        win32gui.EnumWindows(_cb, None)
        if found:
            return found[0]
        time.sleep(0.3)
    return None


def _dismiss_open_with_dialog():
    """Dong dialog 'How do you want to open this file?' neu xuat hien."""
    import win32gui, win32con
    import ctypes

    keywords = ("how do you want", "open with", "open this file")
    deadline = time.time() + 5
    while time.time() < deadline:
        fg = win32gui.GetForegroundWindow()
        title = win32gui.GetWindowText(fg).lower()
        if any(k in title for k in keywords):
            win32gui.PostMessage(fg, win32con.WM_KEYDOWN, win32con.VK_ESCAPE, 0)
            time.sleep(0.3)
            win32gui.PostMessage(fg, win32con.WM_KEYUP, win32con.VK_ESCAPE, 0)
            log.info("Dismissed 'Open with' dialog")
            return
        # Scan tất cả top-level windows luôn (dialog có thể không phải foreground)
        def _check(hwnd, _):
            t = win32gui.GetWindowText(hwnd).lower()
            if any(k in t for k in keywords):
                win32gui.PostMessage(hwnd, win32con.WM_KEYDOWN, win32con.VK_ESCAPE, 0)
                time.sleep(0.2)
                win32gui.PostMessage(hwnd, win32con.WM_KEYUP, win32con.VK_ESCAPE, 0)
                log.info(f"Dismissed 'Open with' dialog (hwnd={hwnd})")
        win32gui.EnumWindows(_check, None)
        time.sleep(0.3)


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


def run_once():
    """Chay mot lan xuat duy nhat — dung boi server.js scheduler.
    In 'SAVED:<filepath>' ra stdout khi thanh cong, exit 0/1.
    """
    state = load_state()
    filename = next_filename(state)

    win = find_keylab_window()
    if not win:
        print("ERROR: Keylab not found", flush=True)
        sys.exit(1)

    success = run_export(win, filename)
    if not success:
        print("ERROR: Export failed", flush=True)
        sys.exit(1)

    state["export_count"] += 1
    save_state(state)

    # Tìm file vừa lưu trong EXCEL_DIR (keylab2022 có thể thêm .xls hoặc .xlsx)
    candidates = sorted(
        EXCEL_DIR.glob(f"{filename}*"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        print(f"ERROR: Saved file not found for {filename}", flush=True)
        sys.exit(1)

    saved = candidates[0]
    print(f"SAVED:{saved}", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--debug":
        debug_controls()
    elif len(sys.argv) > 1 and sys.argv[1] == "--debug-save":
        debug_save_dialog()
    elif len(sys.argv) > 1 and sys.argv[1] == "--once":
        run_once()
    else:
        main()
