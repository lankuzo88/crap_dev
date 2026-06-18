#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB AI Cowork Sandbox — Activity Logger
Ghi log hành động ra logs/activity.log
"""
import os
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent.resolve()
LOG_FILE = BASE_DIR / "logs" / "activity.log"


def _ensure_dir():
    (BASE_DIR / "logs").mkdir(exist_ok=True)


def log_action(action: str, detail: dict = None, user: str = "system"):
    """
    Ghi 1 dòng log vao activity.log.
    Format: [ISO timestamp] [user] action | detail_json
    """
    _ensure_dir()
    now = datetime.now().isoformat(timespec="seconds")
    detail_str = ""
    if detail:
        import json
        try:
            # Shorten long strings
            d = {}
            for k, v in detail.items():
                s = str(v)
                d[k] = s[:200] + "..." if len(s) > 200 else s
            detail_str = " | " + json.dumps(d, ensure_ascii=False)
        except Exception:
            detail_str = f" | {detail}"

    line = f"[{now}] [{user}] {action}{detail_str}\n"
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line)


def search_logs(query: str = "", limit: int = 50) -> list:
    """Tim kiem logs theo query string."""
    if not os.path.exists(LOG_FILE):
        return []
    results = []
    with open(LOG_FILE, "r", encoding="utf-8") as f:
        lines = f.readlines()
    for line in reversed(lines):
        if query.lower() in line.lower():
            results.append(line.strip())
        if len(results) >= limit:
            break
    return results


def get_recent_logs(limit: int = 20) -> list:
    return search_logs("", limit)
