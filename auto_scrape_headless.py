"""
Headless Auto-Scrape.

Production PM2 daemon:
- Watches the newest Excel file every 10 minutes.
- Runs run_scrape.py to scrape LaboAsia progress and import SQLite.
- Does not scrape Keylab notes via UI. Keylab Excel export remains handled by
  keylab_exporter.py through the Node service/routes.
"""

import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

INTERVAL_MINUTES = 10

BASE_DIR = Path(__file__).parent
EXCEL_DIR = BASE_DIR / "Excel"
CONFIG_PATH = BASE_DIR / "labo_config.json"
LOG_FILE = BASE_DIR / "auto_scrape.log"


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


def find_newest_excel():
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
    if not CONFIG_PATH.exists():
        return None
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        path = cfg.get("last_run_file")
        return Path(path) if path else None
    except Exception:
        return None


def update_last_run_file(file_path: Path):
    try:
        cfg = {}
        if CONFIG_PATH.exists():
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        cfg["last_run_file"] = str(file_path)
        CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        log.info(f"Updated last_run_file: {file_path.name}")
    except Exception as exc:
        log.error(f"Failed to update config: {exc}")


def scrape_excel(file_path: Path) -> bool:
    log.info(f"Starting web scrape: {file_path.name}")
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
            timeout=300,
            creationflags=_NO_WINDOW,
        )
        output_tail = ((result.stdout or "") + (result.stderr or ""))[-1200:]
        if result.returncode == 0:
            log.info(f"Web scrape successful: {file_path.name}")
            update_last_run_file(file_path)
            return True
        log.error(f"Web scrape failed (exit {result.returncode}): {output_tail or 'No output'}")
        return False
    except subprocess.TimeoutExpired:
        log.error(f"Web scrape timeout (300s): {file_path.name}")
        return False
    except Exception as exc:
        log.error(f"Web scrape error: {exc}")
        return False


def main():
    log.info("=== Auto-Scrape Headless start ===")
    log.info(f"Schedule: Every {INTERVAL_MINUTES} min, 24/7")
    log.info("Keylab UI notes scraping is disabled.")

    while True:
        newest = find_newest_excel()
        if not newest:
            log.info(f"No Excel files found in {EXCEL_DIR}. Checking again in {INTERVAL_MINUTES} min...")
            time.sleep(INTERVAL_MINUTES * 60)
            continue

        last_run = get_last_run_file()
        log.info(f"Newest: {newest.name} | Last: {last_run.name if last_run else 'None'}")

        is_new_file = last_run is None or newest.resolve() != last_run.resolve()
        if is_new_file:
            log.info("New file detected; scraping web progress.")
        else:
            log.info("Same file; re-scraping web progress.")

        if not scrape_excel(newest):
            log.error(f"run_scrape failed for {newest.name}; will retry next cycle.")

        log.info(f"Checking again in {INTERVAL_MINUTES} min...")
        time.sleep(INTERVAL_MINUTES * 60)


if __name__ == "__main__":
    main()
