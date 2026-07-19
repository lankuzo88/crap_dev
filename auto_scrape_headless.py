"""
Headless Auto-Scrape.

Production PM2 daemon:
- Watches the newest Excel file every 10 minutes.
- Imports progress directly from KeyLab SQL by default.
- Keeps run_scrape.py available as an explicit web rollback mode.
- Does not scrape KeyLab notes via UI.
"""

import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except Exception:
    ZoneInfo = None

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

INTERVAL_MINUTES = 10
KEYLAB_EXPORT_INTERVAL_MINUTES = 15
EXCEL_RETENTION_DAYS = 60  # Excel/ cleanup: xoá file cũ hơn N ngày mỗi cycle

BASE_DIR = Path(__file__).parent
EXCEL_DIR = BASE_DIR / "Excel"
CONFIG_PATH = BASE_DIR / "labo_config.json"
KEYLAB_STATE_PATH = BASE_DIR / "keylab_state.json"
KEYLAB_SQL_EXPORTER = BASE_DIR / "keylab_sql_exporter.ps1"
LOG_FILE = BASE_DIR / "auto_scrape.log"
SCRAPE_LOCK_PATH = BASE_DIR / "scrape_pipeline.lock"
SCRAPE_LOCK_STALE_SECONDS = 45 * 60
VIETNAM_TZ = ZoneInfo("Asia/Ho_Chi_Minh") if ZoneInfo else timezone(timedelta(hours=7))


def vietnam_now():
    return datetime.now(VIETNAM_TZ)


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
PROGRESS_SOURCE = os.environ.get("PROGRESS_SOURCE", "keylab_sql").strip().lower().replace("-", "_")

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


def read_pipeline_lock():
    try:
        return json.loads(SCRAPE_LOCK_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def clear_stale_pipeline_lock():
    lock = read_pipeline_lock()
    started_at = lock.get("startedAt") if isinstance(lock, dict) else None
    if not started_at:
        return False
    try:
        started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        if started.tzinfo is not None:
            age = (datetime.now(started.tzinfo) - started).total_seconds()
        else:
            age = (datetime.now() - started).total_seconds()
    except Exception:
        age = 0
    if age <= SCRAPE_LOCK_STALE_SECONDS:
        return False
    try:
        SCRAPE_LOCK_PATH.unlink()
        log.warning(f"Removed stale scrape lock: {lock.get('owner', 'unknown')} {lock.get('file', '')}")
        return True
    except Exception:
        return False


def acquire_pipeline_lock(owner: str, file_name: str = ""):
    payload = {
        "token": f"{os.getpid()}-{int(time.time() * 1000)}",
        "owner": owner,
        "file": file_name,
        "pid": os.getpid(),
        "startedAt": datetime.now().isoformat(timespec="seconds"),
    }
    data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    for _ in range(2):
        try:
            fd = os.open(str(SCRAPE_LOCK_PATH), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            return payload
        except FileExistsError:
            if not clear_stale_pipeline_lock():
                return None
    return None


def release_pipeline_lock(lock):
    if not lock:
        return
    current = read_pipeline_lock()
    if not isinstance(current, dict) or current.get("token") != lock.get("token"):
        return
    try:
        SCRAPE_LOCK_PATH.unlink()
    except Exception:
        pass


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


def load_config():
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _atomic_write_json(path: Path, payload: dict):
    """Write JSON atomically: tmp file + rename. Avoids half-written corrupt files
    if process is killed mid-write (Windows: rename is atomic on same volume)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def save_config(cfg: dict):
    _atomic_write_json(CONFIG_PATH, cfg)


def get_last_run_file():
    path = load_config().get("last_run_file")
    return Path(path) if path else None


def update_last_run_file(file_path: Path):
    try:
        cfg = load_config()
        cfg["last_run_file"] = str(file_path)
        save_config(cfg)
        log.info(f"Updated last_run_file: {file_path.name}")
    except Exception as exc:
        log.error(f"Failed to update config: {exc}")


def get_last_keylab_export_at():
    raw = load_config().get("last_keylab_sql_export_at")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def update_last_keylab_export(file_path: Path):
    try:
        cfg = load_config()
        cfg["last_keylab_sql_export_at"] = vietnam_now().isoformat(timespec="seconds")
        cfg["last_keylab_sql_export_file"] = str(file_path)
        save_config(cfg)
    except Exception as exc:
        log.error(f"Failed to update KeyLab export state in config: {exc}")


def is_keylab_export_due() -> bool:
    if os.environ.get("KEYLAB_SQL_EXPORT_DISABLED", "").strip() == "1":
        return False
    last_export = get_last_keylab_export_at()
    if last_export is None:
        return True
    now = vietnam_now() if last_export.tzinfo is not None else datetime.now()
    elapsed = (now - last_export).total_seconds()
    return elapsed >= KEYLAB_EXPORT_INTERVAL_MINUTES * 60


def load_keylab_export_state():
    today = vietnam_now().strftime("%d/%m/%Y")
    try:
        state = json.loads(KEYLAB_STATE_PATH.read_text(encoding="utf-8"))
        count = int(state.get("export_count", 1))
        if state.get("date") == today and count >= 1:
            return {"date": today, "export_count": count}
    except Exception:
        pass
    return {"date": today, "export_count": 1}


def save_keylab_export_state(state: dict):
    _atomic_write_json(KEYLAB_STATE_PATH, state)


def next_keylab_export_path(state: dict):
    EXCEL_DIR.mkdir(parents=True, exist_ok=True)
    prefix = vietnam_now().strftime("%d%m%Y_%H%M%S")
    count = int(state.get("export_count", 1))
    out_file = EXCEL_DIR / f"{prefix}.xlsx"
    if not out_file.exists():
        state["export_count"] = count
        return out_file
    while True:
        out_file = EXCEL_DIR / f"{prefix}_{count}.xlsx"
        if not out_file.exists():
            state["export_count"] = count
            return out_file
        count += 1


def export_keylab_sql_if_due():
    if not is_keylab_export_due():
        return None
    if sys.platform != "win32":
        log.error("KeyLab SQL export requires Windows PowerShell; skip hourly export.")
        return None
    if not KEYLAB_SQL_EXPORTER.exists():
        log.error(f"KeyLab SQL exporter not found: {KEYLAB_SQL_EXPORTER}")
        return None

    state = load_keylab_export_state()
    out_file = next_keylab_export_path(state)
    log.info(f"KeyLab SQL export due ({KEYLAB_EXPORT_INTERVAL_MINUTES} min); exporting to {out_file.name}")

    try:
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(KEYLAB_SQL_EXPORTER),
                "-OutFile",
                str(out_file),
            ],
            cwd=BASE_DIR,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=900,
            creationflags=_NO_WINDOW,
        )
        output = ((result.stdout or "") + (result.stderr or "")).strip()
        if result.returncode != 0:
            log.error(f"KeyLab SQL export failed (exit {result.returncode}): {output[-1200:] or 'No output'}")
            return None

        saved_file = None
        for line in output.splitlines():
            if line.startswith("SAVED:"):
                saved_file = Path(line.split("SAVED:", 1)[1].strip())
                break
        if saved_file is None:
            log.error(f"KeyLab SQL export did not report SAVED path: {output[-1200:] or 'No output'}")
            return None
        if not saved_file.exists():
            log.error(f"KeyLab SQL export reported missing file: {saved_file}")
            return None

        state["export_count"] = int(state["export_count"]) + 1
        save_keylab_export_state(state)
        update_last_keylab_export(saved_file)
        log.info(f"KeyLab SQL export successful: {saved_file.name}")
        return saved_file
    except subprocess.TimeoutExpired:
        log.error(f"KeyLab SQL export timeout (900s): {out_file.name}")
    except Exception as exc:
        log.error(f"KeyLab SQL export error: {exc}")
    return None


def scrape_excel(file_path: Path) -> bool:
    source = PROGRESS_SOURCE
    if source == "web":
        runner = "run_scrape.py"
        label = "LaboAsia web rollback"
    elif source == "keylab_sql":
        runner = "run_keylab_sync.py"
        label = "KeyLab SQL"
    else:
        log.error(f"Unsupported PROGRESS_SOURCE={source!r}; expected 'keylab_sql' or 'web'")
        return False

    log.info(f"Starting {label} progress sync: {file_path.name}")
    try:
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        result = subprocess.run(
            [sys.executable, runner, str(file_path)],
            cwd=BASE_DIR,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=1200,
            creationflags=_NO_WINDOW,
        )
        output_tail = ((result.stdout or "") + (result.stderr or ""))[-1200:]
        if result.returncode == 0:
            log.info(f"{label} progress sync successful: {file_path.name}")
            update_last_run_file(file_path)
            return True
        log.error(f"{label} progress sync failed (exit {result.returncode}): {output_tail or 'No output'}")
        return False
    except subprocess.TimeoutExpired:
        log.error(f"{label} progress sync timeout (1200s): {file_path.name}")
        return False
    except Exception as exc:
        log.error(f"{label} progress sync error: {exc}")
        return False


def cleanup_old_excel_files():
    """Xoá file Excel/ cũ hơn EXCEL_RETENTION_DAYS. Giữ last_run_file để khỏi mất state."""
    try:
        if not EXCEL_DIR.exists():
            return
        cutoff = time.time() - EXCEL_RETENTION_DAYS * 86400
        keep = set()
        last_run = get_last_run_file()
        if last_run:
            keep.add(last_run.resolve())
        deleted = 0
        for f in EXCEL_DIR.iterdir():
            if not f.is_file():
                continue
            if f.suffix.lower() not in (".xlsx", ".xls", ".xlsm"):
                continue
            try:
                if f.resolve() in keep:
                    continue
                if f.stat().st_mtime >= cutoff:
                    continue
                f.unlink()
                deleted += 1
            except Exception as exc:
                log.warning(f"cleanup_old_excel: cannot delete {f.name}: {exc}")
        if deleted:
            log.info(f"Excel cleanup: removed {deleted} files older than {EXCEL_RETENTION_DAYS} days")
    except Exception as exc:
        log.error(f"cleanup_old_excel failed: {exc}")


def main():
    log.info("=== Auto-Scrape Headless start ===")
    log.info(
        f"Schedule: progress={PROGRESS_SOURCE} every {INTERVAL_MINUTES} min, "
        f"KeyLab SQL export every {KEYLAB_EXPORT_INTERVAL_MINUTES} min, 24/7"
    )
    cleanup_old_excel_files()
    log.info("KeyLab UI notes scraping is disabled; KeyLab SQL notes sync runs inside the selected progress runner.")

    while True:
        lock = acquire_pipeline_lock("auto-exporter")
        if not lock:
            active = read_pipeline_lock() or {}
            log.info(
                "Scrape pipeline busy: "
                f"{active.get('owner', 'unknown')} {active.get('file', '')}. "
                f"Checking again in {INTERVAL_MINUTES} min..."
            )
            time.sleep(INTERVAL_MINUTES * 60)
            continue

        try:
            exported_file = export_keylab_sql_if_due()
            newest = exported_file or find_newest_excel()
            if not newest:
                log.info(f"No Excel files found in {EXCEL_DIR}. Checking again in {INTERVAL_MINUTES} min...")
            else:
                last_run = get_last_run_file()
                log.info(f"Newest: {newest.name} | Last: {last_run.name if last_run else 'None'}")

                is_new_file = last_run is None or newest.resolve() != last_run.resolve()
                if exported_file:
                    log.info("KeyLab SQL export completed; syncing progress and SQL notes.")
                elif is_new_file:
                    log.info("New file detected; syncing progress.")
                else:
                    log.info("Same file; refreshing progress.")

                if not scrape_excel(newest):
                    log.error(
                        f"Progress sync failed for {newest.name}; will retry next cycle "
                        "without clearing existing data."
                    )
        finally:
            release_pipeline_lock(lock)

        log.info(f"Checking again in {INTERVAL_MINUTES} min...")
        time.sleep(INTERVAL_MINUTES * 60)


if __name__ == "__main__":
    main()
