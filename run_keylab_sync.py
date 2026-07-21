"""Import order progress directly from KeyLab SQL without LaboAsia web scraping."""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

sys.path.insert(0, str(Path(__file__).parent))
from keylab_sync_helpers import (  # noqa: E402
    BASE_DIR,
    CLEAN_DIR,
    DATA_DIR,
    detect_sheet_col,
    load_order_ids,
    merge_back_to_workbook,
    sync_keylab_sql_notes,
)

PROGRESS_EXPORTER = BASE_DIR / "keylab_sql_progress_exporter.ps1"


def log(message):
    print(message, flush=True)


def atomic_write_json(path: Path, payload):
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temp_path.replace(path)


def export_keylab_progress(order_ids, stem: str, json_out: Path):
    if sys.platform != "win32":
        raise RuntimeError("KeyLab SQL progress sync requires Windows PowerShell")
    if not PROGRESS_EXPORTER.exists():
        raise RuntimeError(f"KeyLab SQL progress exporter not found: {PROGRESS_EXPORTER.name}")

    order_ids_path = DATA_DIR / f"{stem}_keylab_progress_order_ids_{os.getpid()}.json"
    atomic_write_json(order_ids_path, list(order_ids))
    try:
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(PROGRESS_EXPORTER),
                "-OrderIdsFile",
                str(order_ids_path),
                "-OutFile",
                str(json_out),
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
            raise RuntimeError(f"KeyLab SQL progress failed (exit {result.returncode}): {output[-1200:]}")
        if not json_out.exists():
            raise RuntimeError("KeyLab SQL progress did not create its output file")
        rows = json.loads(json_out.read_text(encoding="utf-8"))
        if not isinstance(rows, list) or not rows:
            raise RuntimeError("KeyLab SQL progress returned no stage rows")
        log(f"[keylab] SQL progress OK: {len(order_ids)} ca, {len(rows)} công đoạn")
        return rows
    finally:
        order_ids_path.unlink(missing_ok=True)


def clean_workbook(source_xlsx: Path, progress_df: pd.DataFrame, stem: str):
    scraped_xlsx = DATA_DIR / f"{stem}_scraped.xlsx"
    merge_input = source_xlsx
    converted_xlsx = None
    if source_xlsx.suffix.lower() == ".xls":
        converted_xlsx = DATA_DIR / f"{stem}.xlsx"
        workbook = pd.ExcelFile(str(source_xlsx))
        with pd.ExcelWriter(str(converted_xlsx), engine="openpyxl") as writer:
            for sheet_name in workbook.sheet_names:
                workbook.parse(sheet_name=sheet_name).to_excel(writer, sheet_name=sheet_name, index=False)
        merge_input = converted_xlsx

    merge_back_to_workbook(str(merge_input), str(scraped_xlsx), progress_df)

    cleaner = BASE_DIR / "labo_cleaner.py"
    clean_out = CLEAN_DIR / f"{stem}_final.xlsx"
    if not cleaner.exists():
        raise RuntimeError("labo_cleaner.py not found")
    result = subprocess.run(
        [sys.executable, str(cleaner), str(scraped_xlsx), str(clean_out)],
        cwd=BASE_DIR,
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=180,
        creationflags=_NO_WINDOW,
    )
    if result.returncode != 0 or not clean_out.exists():
        detail = ((result.stdout or "") + (result.stderr or ""))[-800:]
        raise RuntimeError(f"labo_cleaner failed (exit {result.returncode}): {detail}")
    return scraped_xlsx, clean_out, converted_xlsx


def import_outputs(json_out: Path, clean_out: Path, order_ids, stem: str):
    from db_manager import import_excel_final, import_json, init_db

    init_db()
    json_result = import_json(str(json_out))
    if not json_result.get("ok"):
        raise RuntimeError(f"SQLite progress import failed: {json_result.get('error', 'unknown error')}")
    excel_result = import_excel_final(str(clean_out))
    if not excel_result.get("ok"):
        raise RuntimeError(f"SQLite order import failed: {excel_result.get('error', 'unknown error')}")
    log(f"[keylab] DB progress import: {json_result}")
    log(f"[keylab] DB order import: {excel_result}")

    if sync_keylab_sql_notes(order_ids, stem):
        init_db()
        log("[keylab] SQL notes sync: OK")


def _parse_progress_time(value):
    try:
        return datetime.strptime(str(value or "").strip(), "%d/%m/%Y %H:%M:%S")
    except ValueError:
        return None


def compare_with_sqlite(rows, order_ids):
    db_path = Path(os.environ.get("LABO_DB_PATH", str(BASE_DIR / "labo_data.db")))
    if not db_path.is_file():
        raise RuntimeError(f"SQLite database not found: {db_path}")

    current = {}
    with sqlite3.connect(str(db_path)) as conn:
        for start in range(0, len(order_ids), 500):
            chunk = list(order_ids[start:start + 500])
            placeholders = ",".join("?" for _ in chunk)
            query = (
                "SELECT ma_dh, thu_tu, cong_doan, ten_ktv, thoi_gian_hoan_thanh "
                f"FROM tien_do WHERE ma_dh IN ({placeholders})"
            )
            for row in conn.execute(query, chunk):
                current[(str(row[0]).strip(), int(row[1]))] = {
                    "cong_doan": str(row[2] or "").strip(),
                    "ten_ktv": str(row[3] or "").strip(),
                    "thoi_gian_hoan_thanh": str(row[4] or "").strip(),
                }

    summary = {
        "source": "keylab_sql",
        "orders": len(order_ids),
        "stages": len(rows),
        "exact": 0,
        "keylab_newer": 0,
        "different": 0,
        "missing_in_sqlite": 0,
        "samples": [],
    }
    fields = ("cong_doan", "ten_ktv", "thoi_gian_hoan_thanh")
    for keylab in rows:
        key = (str(keylab.get("ma_dh", "")).strip(), int(keylab.get("thu_tu") or 0))
        sqlite_row = current.get(key)
        if sqlite_row is None:
            category = "missing_in_sqlite"
        elif all(str(keylab.get(field, "")).strip() == sqlite_row[field] for field in fields):
            category = "exact"
        else:
            keylab_time = _parse_progress_time(keylab.get("thoi_gian_hoan_thanh"))
            sqlite_time = _parse_progress_time(sqlite_row.get("thoi_gian_hoan_thanh"))
            if keylab_time and (not sqlite_time or keylab_time > sqlite_time):
                category = "keylab_newer"
            else:
                category = "different"
        summary[category] += 1
        if category != "exact" and len(summary["samples"]) < 20:
            summary["samples"].append({
                "ma_dh": key[0],
                "thu_tu": key[1],
                "category": category,
                "keylab": {field: str(keylab.get(field, "")).strip() for field in fields},
                "sqlite": sqlite_row,
            })
    return summary


def run(excel_path: str, shadow: bool = False):
    source_xlsx = Path(excel_path).resolve()
    if not source_xlsx.is_file():
        raise RuntimeError(f"Excel source not found: {source_xlsx}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    stem = source_xlsx.stem
    sheet, column = detect_sheet_col(str(source_xlsx))
    order_ids = load_order_ids(str(source_xlsx), sheet, column)
    if not order_ids:
        raise RuntimeError("Excel source contains no order IDs")

    log(f"[keylab] Bắt đầu đồng bộ SQL: {source_xlsx.name} ({len(order_ids)} ca)")
    json_out = (
        DATA_DIR / f"{stem}_keylab_shadow_{os.getpid()}.json"
        if shadow else DATA_DIR / f"{stem}_scraped.json"
    )
    generated = [json_out]
    success = False
    try:
        rows = export_keylab_progress(order_ids, stem, json_out)
        if shadow:
            summary = compare_with_sqlite(rows, order_ids)
            log(json.dumps(summary, ensure_ascii=False, indent=2))
            success = True
            return summary
        progress_df = pd.DataFrame(rows)
        scraped_xlsx, clean_out, converted_xlsx = clean_workbook(source_xlsx, progress_df, stem)
        generated.extend([scraped_xlsx, clean_out])
        if converted_xlsx:
            generated.append(converted_xlsx)
        import_outputs(json_out, clean_out, order_ids, stem)
        success = True
        log(f"[keylab] HOÀN THÀNH: {len(order_ids)} ca, {len(rows)} công đoạn")
    finally:
        if success:
            for path in generated:
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync progress directly from KeyLab SQL")
    parser.add_argument("excel_path")
    parser.add_argument("--shadow", action="store_true", help="compare with SQLite without importing")
    args = parser.parse_args()
    try:
        run(args.excel_path, shadow=args.shadow)
    except Exception as exc:
        log(f"[keylab] ERROR: {exc}")
        sys.exit(1)
