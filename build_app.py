#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_app.py - Build script to package LaboAsia app into a single .exe
Bundles:
  - laboasia_gui_scraper_tkinter.py  (main GUI + scraper + auto-clean)
  - labo_cleaner.py                   (data cleaning)
  - server.js                         (dashboard JSON server)
  - dashboard.html                     (dashboard frontend)

Output: dist/LaboAsia.exe

Usage:
    pip install pyinstaller
    python build_app.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# Paths
BASE_DIR    = Path(__file__).parent.resolve()
SRC_DIR     = BASE_DIR
DIST_DIR    = BASE_DIR / "dist"
BUILD_DIR   = BASE_DIR / "build_temp"

MAIN_SCRIPT = SRC_DIR / "laboasia_gui_scraper_tkinter.py"
SERVER_JS   = SRC_DIR / "server.js"
DASHBOARD   = SRC_DIR / "dashboard.html"
DASH_MOBILE = SRC_DIR / "dashboard_mobile_ref.html"
CLEANER     = SRC_DIR / "labo_cleaner.py"

APP_NAME = "LaboAsia"
EXE_NAME = f"{APP_NAME}.exe"


def run_cmd(cmd, **kwargs):
    """Run a command."""
    print(f"\n{'='*50}")
    print(f"CMD: {' '.join(str(c) for c in cmd)}")
    kwargs.setdefault("shell", True)
    kwargs.setdefault("capture_output", True)
    result = subprocess.run(cmd, **kwargs)
    if result.returncode != 0:
        print(f"[!] Command failed with code {result.returncode}")
    return result.returncode == 0


def ensure_dir(path):
    path.mkdir(parents=True, exist_ok=True)


def step_check_files():
    print("\n[1/5] Checking source files...")
    missing = []
    for f in [MAIN_SCRIPT, SERVER_JS, DASHBOARD, CLEANER]:
        if not f.exists():
            missing.append(str(f))
            print(f"  [!] MISSING: {f.name}")
        else:
            print(f"  [OK] {f.name}")
    if missing:
        print("\n[!] Aborted - missing required files.")
        sys.exit(1)


def step_install_deps():
    print("\n[2/5] Installing Python dependencies...")
    req = SRC_DIR / "requirements.txt"
    if req.exists():
        run_cmd([sys.executable, "-m", "pip", "install", "-r", str(req)])
    else:
        run_cmd([sys.executable, "-m", "pip", "install",
             "pandas", "openpyxl", "xlrd", "requests", "playwright"])

    try:
        import PyInstaller
        print("  [OK] PyInstaller already installed")
    except ImportError:
        print("  Installing PyInstaller...")
        run_cmd([sys.executable, "-m", "pip", "install", "pyinstaller"])


def step_bundle_server():
    print("\n[3/5] Bundling server.js into standalone .exe...")

    pkg_json = SRC_DIR / "package.json"
    if not pkg_json.exists():
        print("  Creating minimal package.json...")
        pkg_json.write_text(
            '{"name":"laboasia-server","version":"1.0.0","dependencies":{"express":"^4.18.2","xlsx":"^0.18.5"}}',
            encoding="utf-8",
        )

    if not (SRC_DIR / "node_modules" / "express" / "package.json").exists():
        print("  Installing Node dependencies (express, xlsx)...")
        run_cmd(["npm", "install"], cwd=str(SRC_DIR))

    try:
        result = subprocess.run(["pkg", "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"  [OK] pkg version: {result.stdout.strip()}")
    except FileNotFoundError:
        print("  Installing pkg...")
        run_cmd(["npm", "install", "-g", "pkg"])

    server_exe_out = DIST_DIR / f"{APP_NAME}_Server.exe"
    ensure_dir(DIST_DIR)

    cmd = [
        "pkg", str(SERVER_JS),
        "--targets", "node18-win-x64",
        "--output", str(server_exe_out),
    ]
    ok = run_cmd(cmd)
    if ok and server_exe_out.exists():
        sz = server_exe_out.stat().st_size // 1024 // 1024
        print(f"  [OK] Server bundled: {server_exe_out.name} ({sz} MB)")
        return True
    else:
        print("[!] pkg build failed - server.js will run via 'node' at runtime")
        return False


def step_build_exe(server_bundled):
    print("\n[4/5] Building main .exe with PyInstaller...")

    ensure_dir(DIST_DIR)
    ensure_dir(BUILD_DIR)

    spec_path = BUILD_DIR / f"{APP_NAME}.spec"

    datas = [
        (str(SERVER_JS),   "."),
        (str(DASHBOARD),   "."),
        (str(DASH_MOBILE), "."),
        (str(CLEANER),     "."),
    ]

    server_exe = DIST_DIR / f"{APP_NAME}_Server.exe"
    if server_bundled and server_exe.exists():
        datas.append((str(server_exe), "."))

    # Build datas arg: use repr() to get escaped path strings valid in spec
    datas_parts = []
    for src, dst in datas:
        escaped = repr(str(src))  # e.g. 'C:\\Users\\...' instead of C:\Users\...
        datas_parts.append(f"    ({escaped}, \"{dst}\")")
    datas_str = ",\n".join(datas_parts)

    spec_content = f'''
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_all

a = Analysis(
    [{repr(str(MAIN_SCRIPT.resolve()))}],
    pathex=[{repr(str(SRC_DIR.resolve()))}],
    binaries=[],
    datas=[
    {datas_str}
    ],
    hiddenimports=[
        'pandas',
        'openpyxl',
        'xlrd',
        'requests',
        'playwright.sync_api',
        'playwright._impl._sync_base',
        'dataclasses',
        'tkinter',
        'json',
        'queue',
        'threading',
        'pathlib',
        'collections',
        'PIL._tkinter_finder',
    ],
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=[
        'matplotlib',
        'scipy',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='{APP_NAME}',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx_exclude=[],
    upx=True,
    name='{APP_NAME}',
)
'''

    spec_path.write_text(spec_content, encoding="utf-8")
    print(f"  [OK] Spec file written: {spec_path.name}")

    ok = run_cmd([
        sys.executable, "-m", "PyInstaller",
        str(spec_path),
        "--noconfirm",
        "--distpath", str(DIST_DIR),
        "--workpath", str(BUILD_DIR),
    ])
    if not ok:
        print("[!] PyInstaller build failed.")
        sys.exit(1)

    final_exe = DIST_DIR / APP_NAME / EXE_NAME
    if final_exe.exists():
        sz = final_exe.stat().st_size // 1024
        print(f"  [OK] Main exe built: {final_exe} ({sz} KB)")
    else:
        candidates = list(DIST_DIR.glob(f"{APP_NAME}*.exe"))
        if candidates:
            print(f"  [OK] Found: {candidates[0]}")
        else:
            print("[!] Exe not found after build!")
            sys.exit(1)
    return True


def step_post_build(server_bundled):
    print("\n[5/5] Post-build cleanup...")

    if BUILD_DIR.exists():
        print(f"  Removing temp: {BUILD_DIR.name}")
        shutil.rmtree(BUILD_DIR, ignore_errors=True)

    print(f"\n  Output contents ({DIST_DIR}):")
    for f in sorted(DIST_DIR.rglob("*")):
        if f.is_file():
            sz = f.stat().st_size
            print(f"    {f.relative_to(DIST_DIR)} - {sz // 1024} KB")

    readme = DIST_DIR / "README.txt"
    readme.write_text(
        f"""LaboAsia - Package README
=========================

Main exe: {EXE_NAME}
Dashboard server: {APP_NAME}_Server.exe (if present, else use 'node server.js')

Folders created at runtime next to {EXE_NAME}:
  Excel/       - Drop raw .xls/.xlsx files here (auto-detected)
  Data/        - Scraped intermediate files + JSON
  File_sach/   - Cleaned Excel output (after labo_cleaner)
  Data_thang/  - Monthly accumulated data

Dashboard: Run {APP_NAME}_Server.exe, then open http://localhost:3000
         Or double-click {EXE_NAME} - it starts the server automatically.

Requirements to run on a fresh machine:
  - Windows 10/11 x64
  - Python NOT required (bundled in exe)
  - Node.js NOT required if {APP_NAME}_Server.exe is present
  - Otherwise: Node.js 18+ required for dashboard server.

Note: playwright (browser) may require first-run initialization.
Run once as admin on first launch if browser errors occur.
""",
        encoding="utf-8",
    )
    print(f"  [OK] README: {readme.name}")


def main():
    print("=" * 50)
    print(f"LaboAsia Build Script")
    print(f"Python: {sys.version.split()[0]}")
    print(f"Base dir: {BASE_DIR}")
    print("=" * 50)

    ensure_dir(DIST_DIR)
    ensure_dir(BUILD_DIR)

    step_check_files()
    step_install_deps()
    server_bundled = step_bundle_server()
    step_build_exe(server_bundled)
    step_post_build(server_bundled)

    print("\n" + "=" * 50)
    print("BUILD COMPLETE!")
    print(f"Output: {DIST_DIR / EXE_NAME}")
    print("=" * 50)


if __name__ == "__main__":
    main()
