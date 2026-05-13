"""
Headless Auto-Scrape — Chạy background, kiểm tra file mới nhất mỗi 10 phút.
Usage: python auto_scrape_headless.py
PM2: pm2 start auto_scrape_headless.py --name auto-scrape --interpreter python
"""

import os
import sys
import json
import time
import subprocess
import threading
import logging
from pathlib import Path

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0

# ── Config ──────────────────────────────────────────────────────────────────
INTERVAL_MINUTES = 10          # Kiểm tra mỗi 10 phút, chạy 24/7
NOTES_TIMEOUT_SECONDS = 30 * 60


BASE_DIR   = Path(__file__).parent
EXCEL_DIR  = BASE_DIR / "Excel"
CONFIG_PATH = BASE_DIR / "labo_config.json"
ERROR_FILE = BASE_DIR / "scraper_errors.json"


def load_env_file(path: Path):
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(BASE_DIR / ".env")

# ── Logging ──────────────────────────────────────────────────────────────────
LOG_FILE = BASE_DIR / "auto_scrape.log"

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger("auto-scrape")


# ── Helpers ──────────────────────────────────────────────────────────────────

def find_newest_excel():
    """Tìm file Excel mới nhất trong Excel/ (exclude _scraped, _final, _cleaned)."""
    if not EXCEL_DIR.is_dir():
        return None
    candidates = [
        f for f in EXCEL_DIR.iterdir()
        if f.suffix.lower() in (".xls", ".xlsx", ".xlsm")
        and not any(tag in f.stem for tag in ("_scraped", "_final", "_cleaned"))
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda f: f.stat().st_mtime)


def get_last_run_file():
    """Lấy đường dẫn file đã scrape lần cuối từ labo_config.json."""
    if not CONFIG_PATH.exists():
        return None
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        path = cfg.get("last_run_file")
        return Path(path) if path else None
    except Exception:
        return None


def update_last_run_file(file_path: Path):
    """Cập nhật last_run_file trong labo_config.json."""
    try:
        cfg = {}
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        cfg["last_run_file"] = str(file_path)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        log.info(f"Updated last_run_file: {file_path.name}")
    except Exception as e:
        log.error(f"Failed to update config: {e}")


def should_retry_failed_notes(file_path: Path) -> bool:
    if not ERROR_FILE.exists():
        return False
    try:
        payload = json.loads(ERROR_FILE.read_text(encoding="utf-8"))
    except Exception:
        return False
    if payload.get("excel_active") != file_path.name:
        return False
    errors = payload.get("errors") or []
    ok_count = payload.get("ok_count")
    return bool(errors) and (ok_count is None or int(ok_count or 0) == 0)


def scrape_keylab_notes(file_path: Path) -> bool:
    """Chạy keylab_notes_scraper.py sau khi run_scrape.py đã import DB."""
    log.info(f"Starting Keylab notes scrape: {file_path.name}")
    try:
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        result = subprocess.run(
            [sys.executable, "keylab_notes_scraper.py"],
            cwd=BASE_DIR,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=NOTES_TIMEOUT_SECONDS,
            creationflags=_NO_WINDOW,
        )
        stdout_tail = result.stdout[-1200:] if result.stdout else ""
        stderr_tail = result.stderr[-1200:] if result.stderr else ""
        if stdout_tail:
            for line in stdout_tail.splitlines():
                if line.strip():
                    log.info(f"[notes] {line}")
        if result.returncode == 0:
            log.info(f"Keylab notes scrape successful: {file_path.name}")
            return True
        log.error(f"Keylab notes scrape failed (exit {result.returncode}): {stderr_tail or stdout_tail or 'No output'}")
        return False
    except subprocess.TimeoutExpired:
        log.error(f"Keylab notes scrape timeout ({NOTES_TIMEOUT_SECONDS}s): {file_path.name}")
        return False
    except Exception as e:
        log.error(f"Keylab notes scrape error: {e}")
        return False


def scrape_excel(file_path: Path, run_notes: bool = False) -> bool:
    """Chạy run_scrape.py; chỉ chạy keylab_notes_scraper.py khi có Excel mới."""
    log.info(f"Starting scrape: {file_path.name}")
    try:
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        result = subprocess.run(
            [sys.executable, "run_scrape.py", str(file_path)],
            cwd=BASE_DIR,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,  # 5 phút timeout
            creationflags=_NO_WINDOW,
        )
        if result.returncode == 0:
            log.info(f"Scrape successful: {file_path.name}")
            notes_ok = True
            if run_notes:
                notes_ok = scrape_keylab_notes(file_path)
            else:
                log.info(f"Skip Keylab notes scrape for same file: {file_path.name}")
            # Luôn cập nhật last_run_file sau khi run_scrape.py thành công,
            # kể cả khi Keylab fail — để retry_notes hoạt động đúng lần sau.
            update_last_run_file(file_path)
            if not notes_ok:
                log.error(f"Keylab notes failed for {file_path.name} — will retry notes-only next cycle.")
            return notes_ok
        else:
            stderr_tail = result.stderr[-500:] if result.stderr else "No output"
            log.error(f"Scrape failed (exit {result.returncode}): {stderr_tail}")
            return False
    except subprocess.TimeoutExpired:
        log.error(f"Scrape timeout (5 min): {file_path.name}")
        return False
    except Exception as e:
        log.error(f"Scrape error: {e}")
        return False


# ── Parallel new-file pipeline ───────────────────────────────────────────────

def run_new_file(file_path: Path) -> tuple[bool, bool]:
    """Chạy run_scrape.py và keylab_notes_scraper.py song song cho file mới.
    Returns (run_ok, notes_ok).
    """
    log.info(f"Parallel pipeline start: {file_path.name}")
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    run_result   = {"ok": False, "output": ""}
    notes_result = {"ok": False, "output": ""}

    def _run_scrape():
        try:
            r = subprocess.run(
                [sys.executable, "run_scrape.py", str(file_path)],
                cwd=BASE_DIR, env=env,
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=300, creationflags=_NO_WINDOW,
            )
            run_result["output"] = (r.stdout + r.stderr)[-1200:]
            run_result["ok"] = r.returncode == 0
        except subprocess.TimeoutExpired:
            run_result["output"] = "TIMEOUT (300s)"
        except Exception as exc:
            run_result["output"] = str(exc)

    def _run_notes():
        try:
            r = subprocess.run(
                [sys.executable, "keylab_notes_scraper.py", "--new-file"],
                cwd=BASE_DIR, env=env,
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=NOTES_TIMEOUT_SECONDS, creationflags=_NO_WINDOW,
            )
            notes_result["output"] = (r.stdout + r.stderr)[-1200:]
            notes_result["ok"] = r.returncode == 0
        except subprocess.TimeoutExpired:
            notes_result["output"] = f"TIMEOUT ({NOTES_TIMEOUT_SECONDS}s)"
        except Exception as exc:
            notes_result["output"] = str(exc)

    t_scrape = threading.Thread(target=_run_scrape, daemon=True)
    t_notes  = threading.Thread(target=_run_notes,  daemon=True)
    t_scrape.start()
    t_notes.start()
    t_scrape.join(timeout=310)
    t_notes.join(timeout=NOTES_TIMEOUT_SECONDS + 10)

    for line in run_result["output"].splitlines():
        if line.strip():
            log.info(f"[scrape] {line}")
    if run_result["ok"]:
        log.info(f"run_scrape OK: {file_path.name}")
    else:
        log.error(f"run_scrape FAILED: {run_result['output'][-200:]}")

    for line in notes_result["output"].splitlines():
        if line.strip():
            log.info(f"[notes]  {line}")
    if notes_result["ok"]:
        log.info(f"Keylab notes OK: {file_path.name}")
    else:
        log.error(f"Keylab notes FAILED: {notes_result['output'][-200:]}")

    return run_result["ok"], notes_result["ok"]


# ── Main Loop ────────────────────────────────────────────────────────────────

def main():
    log.info("=== Auto-Scrape Headless start ===")
    log.info(f"Schedule: Every {INTERVAL_MINUTES} min, 24/7")

    while True:
        newest = find_newest_excel()
        if not newest:
            log.info(f"No Excel files found in {EXCEL_DIR}. Checking again in {INTERVAL_MINUTES} min...")
            time.sleep(INTERVAL_MINUTES * 60)
            continue

        last_run = get_last_run_file()
        log.info(f"Newest: {newest.name} | Last: {last_run.name if last_run else 'None'}")

        is_new_file = last_run is None or newest.resolve() != last_run.resolve()
        retry_notes = (not is_new_file) and should_retry_failed_notes(newest)

        if is_new_file:
            log.info("New file detected → parallel scrape + Keylab notes...")
            run_ok, notes_ok = run_new_file(newest)
            if run_ok:
                update_last_run_file(newest)
            if not run_ok:
                log.error(f"run_scrape failed for {newest.name} — will retry next cycle.")
            if not notes_ok:
                log.error(f"Keylab notes failed for {newest.name} — will retry notes-only next cycle.")
        elif retry_notes:
            log.info("Same file, retrying Keylab notes only...")
            scrape_keylab_notes(newest)
        else:
            log.info("Same file, re-scraping progress only...")
            scrape_excel(newest, run_notes=False)

        log.info(f"Checking again in {INTERVAL_MINUTES} min...")
        time.sleep(INTERVAL_MINUTES * 60)


if __name__ == "__main__":
    main()
