#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB AI Cowork Sandbox — File Watcher
Theo doi File_sach/ — tu dong phan tich khi co file Excel moi.
"""
import sys
from pathlib import Path
from datetime import datetime

BASE_DIR   = Path(__file__).parent.resolve()
PARENT_DIR = BASE_DIR.parent

sys.path.insert(0, str(BASE_DIR))


def auto_analyze(new_files: list):
    """Run auto-analysis on new Excel files."""
    from sandbox_tools import analyze_excel, TOOL_REGISTRY
    from sandbox_memory import append_insight
    from sandbox_logging import log_action

    if not new_files:
        return

    print(f"[watcher] Auto-analyzing {len(new_files)} new file(s): {new_files}")

    for fp in new_files:
        try:
            result = analyze_excel(file_path=fp.name)
            if not result.get("ok"):
                print(f"[watcher] Error analyzing {fp.name}: {result.get('error')}")
                continue

            # Build insight text
            bottleneck = result.get("bottleneck", "?")
            pct = result.get("bottleneck_pct", "?")
            total = result.get("total_orders", "?")
            teeth = result.get("total_teeth", "?")

            insight_text = (
                f"Auto-scan: {fp.name} | "
                f"{total} don, {teeth} rang | "
                f"Nut that: {bottleneck} ({pct}%)"
            )

            append_insight(insight_text, {
                "source": "watcher",
                "file": fp.name,
                "total_orders": total,
                "bottleneck": bottleneck,
            })

            log_action("auto_analyze", {
                "file": fp.name,
                "orders": total,
                "bottleneck": bottleneck,
            })

            print(f"[watcher] ✓ Analyzed {fp.name}: {total} don, bottleneck={bottleneck} ({pct}%)")

        except Exception as e:
            print(f"[watcher] Exception: {e}")


def watch_directory():
    """Simple file-system polling watcher (no watchdog dependency needed)."""
    from sandbox_knowledge import FILE_SACH_DIR

    print(f"[watcher] Monitoring: {FILE_SACH_DIR}")
    print("[watcher] Press Ctrl+C to stop.")

    seen_files = set(f.name for f in FILE_SACH_DIR.glob("*.xlsx"))
    print(f"[watcher] Initial files: {len(seen_files)}")

    import time
    while True:
        time.sleep(60)  # poll every 60 seconds
        current_files = set(f.name for f in FILE_SACH_DIR.glob("*.xlsx"))
        new_files = [f for f in FILE_SACH_DIR.glob("*.xlsx") if f.name in (current_files - seen_files)]
        if new_files:
            auto_analyze(new_files)
            seen_files.update(f.name for f in new_files)


if __name__ == "__main__":
    print("")
    print("  🤖 ASIA LAB — File Watcher")
    print(f"  Workspace: {BASE_DIR}")
    print("")
    try:
        watch_directory()
    except KeyboardInterrupt:
        print("\n[watcher] Stopped.")
