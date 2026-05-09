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
import logging
from pathlib import Path

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0

# ── Config ──────────────────────────────────────────────────────────────────
INTERVAL_MINUTES = 10          # Kiểm tra mỗi 10 phút, chạy 24/7


BASE_DIR   = Path(__file__).parent
EXCEL_DIR  = BASE_DIR / "Excel"
CONFIG_PATH = BASE_DIR / "labo_config.json"


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


def scrape_excel(file_path: Path) -> bool:
    """Chạy run_scrape.py với file Excel."""
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
            update_last_run_file(file_path)
            return True
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

        if last_run is None or newest.resolve() != last_run.resolve():
            log.info(f"New file detected → scraping...")
        else:
            log.info(f"Same file, re-scraping to capture updates...")
        scrape_excel(newest)

        # Chờ INTERVAL_MINUTES trước lần kiểm tra tiếp
        log.info(f"Checking again in {INTERVAL_MINUTES} min...")
        time.sleep(INTERVAL_MINUTES * 60)


if __name__ == "__main__":
    main()
