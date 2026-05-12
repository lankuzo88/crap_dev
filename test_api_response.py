"""
Inspect raw LaboAsia get_order_info API response for one order.

Usage:
    python test_api_response.py [ma_dh]
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from pathlib import Path

from laboasia_gui_scraper_tkinter import (
    API_ENDPOINT,
    BASE_DIR,
    DEFAULT_SELECTORS,
    LaboAsiaAPIClient,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


DB_PATH = BASE_DIR / "labo_data.db"
BASE_URL = "https://laboasia.com.vn/scan"


def load_env_file(path: Path) -> None:
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


def get_account() -> tuple[str, str]:
    load_env_file(BASE_DIR / ".env")
    for i in range(1, 5):
        user = os.environ.get(f"LABO_USER{i}", "").strip()
        password = os.environ.get(f"LABO_PASS{i}", "").strip()
        if user and password:
            return user, password
    raise RuntimeError("Missing LABO_USER*/LABO_PASS* credentials")


def pick_order_id() -> str:
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute(
            """
            SELECT ma_dh
            FROM don_hang
            WHERE TRIM(COALESCE(ma_dh, '')) != ''
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise RuntimeError(f"No order found in {DB_PATH}")
    return str(row[0]).strip()


def find_12_digit_values(value, path: str = "$") -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            hits.extend(find_12_digit_values(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            hits.extend(find_12_digit_values(child, f"{path}[{idx}]"))
    else:
        text = str(value).strip()
        if re.fullmatch(r"\d{12}", text):
            hits.append((path, text))
    return hits


def main() -> int:
    ma_dh = sys.argv[1].strip() if len(sys.argv) > 1 else pick_order_id()
    username, password = get_account()

    client = LaboAsiaAPIClient(
        base_url=BASE_URL,
        username=username,
        password=password,
        selectors=DEFAULT_SELECTORS,
        page_timeout_ms=30_000,
        max_retry_per_order=1,
    )
    token = client._playwright_login()
    client._session = client._build_session(token)
    data = client._get_order_info(ma_dh)

    print(f"API endpoint: {API_ENDPOINT}")
    print(f"Order: {ma_dh}")
    print("Top-level keys:", list(data.keys()) if isinstance(data, dict) else type(data).__name__)
    print("12-digit numeric values:")
    for path, text in find_12_digit_values(data):
        print(f"  {path}: {text}")
    print("\nRAW JSON:")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
