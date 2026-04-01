#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB AI Cowork Sandbox — Main Server
Port 3001 — Flask app
Entry point: python ai_workspace/server.py
"""
import os, sys, json
from datetime import datetime
from pathlib import Path

BASE_DIR   = Path(__file__).parent.resolve()
PARENT_DIR = BASE_DIR.parent
PORT       = int(os.environ.get("SANDBOX_PORT", 3001))

# ── Module path ──────────────────────────────────────────────────────────────
sys.path.insert(0, str(BASE_DIR))

from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS

_start_time = datetime.now()

app = Flask(__name__, static_folder=str(BASE_DIR))
CORS(app)

# ── Lazy load lab knowledge at startup ───────────────────────────────────────
lab_state = {}


def _load_lab():
    global lab_state
    try:
        from sandbox_knowledge import refresh_knowledge
        lab_state = refresh_knowledge({})
    except Exception as e:
        lab_state = {"error": str(e)}


_load_lab()

# ── Register blueprints ───────────────────────────────────────────────────────
try:
    from routes import chat_bp, tools_bp, memory_bp, analyze_bp
    app.register_blueprint(chat_bp, url_prefix="")
    app.register_blueprint(tools_bp, url_prefix="")
    app.register_blueprint(memory_bp, url_prefix="")
    app.register_blueprint(analyze_bp, url_prefix="")
    routes_ok = True
except Exception as e:
    routes_ok = False
    _load_error = str(e)

# ── Status & health ───────────────────────────────────────────────────────────
@app.route("/status")
def status():
    from sandbox_memory import list_sessions, count_pending_tasks
    from sandbox_tools import TOOL_REGISTRY
    sessions = list_sessions()
    pending  = count_pending_tasks()
    return jsonify({
        "status":       "online",
        "port":         PORT,
        "workspace":    str(BASE_DIR.name),
        "parent":       str(PARENT_DIR.name),
        "uptime_s":     int((datetime.now() - _start_time).total_seconds()),
        "routes_ok":    routes_ok,
        "lab_loaded":   bool(lab_state.get("knowledge")),
        "tools_count":  len(TOOL_REGISTRY) if routes_ok else 0,
        "sessions":     len(sessions),
        "active_chats": len([s for s in sessions if s["msg_count"] > 0]),
        "pending_tasks": pending["pending"],
        "done_tasks":   pending["done"],
        "loaded_at":    lab_state.get("loaded_at", ""),
        "latest_excel": lab_state.get("latest_excel", ""),
    })


@app.route("/reload")
def reload():
    global lab_state
    _load_lab()
    try:
        from sandbox_logging import log_action
        log_action("reload", {"user": "system"})
    except Exception:
        pass
    return jsonify({
        "ok": True,
        "lab_loaded": bool(lab_state.get("knowledge")),
        "loaded_at":  lab_state.get("loaded_at"),
    })


@app.route("/")
def index():
    """Serve sandbox web UI."""
    return send_from_directory(BASE_DIR, "sandbox_web.html")


# ── Startup banner ────────────────────────────────────────────────────────────
def _safe_print(msg):
    try:
        print(msg)
    except Exception:
        pass  # UnicodeEncodeError on Windows CMD

def _banner():
    _safe_print("")
    _safe_print("  ASIA LAB AI Cowork Sandbox")
    _safe_print("  " + ("=" * 50))
    _safe_print(f"  Workspace   : {BASE_DIR}")
    _safe_print(f"  Parent dir  : {PARENT_DIR}")
    _safe_print(f"  Port        : {PORT}")
    _safe_print(f"  URL         : http://localhost:{PORT}")
    _safe_print(f"  Web UI      : http://localhost:{PORT}/")
    _safe_print(f"  Status      : http://localhost:{PORT}/status")
    _safe_print(f"  Reload      : http://localhost:{PORT}/reload")
    _safe_print("  " + ("-" * 50))

    if routes_ok:
        from sandbox_tools import TOOL_REGISTRY
        _safe_print(f"  Tools       : {len(TOOL_REGISTRY)} registered")
        _safe_print(f"  Routes      : /chat /tool/* /memory/* /analyze/*")
    else:
        _safe_print(f"  Routes error: {_load_error}")

    _safe_print(f"  Lab data    : {lab_state.get('latest_excel','?')}")
    _safe_print(f"  Memory JSON : sandbox_*.json active")
    _safe_print("  " + ("-" * 50))
    _safe_print("  Nhan Ctrl+C de dung")
    _safe_print("")


if __name__ == "__main__":
    _banner()

    try:
        from sandbox_logging import log_action
        log_action("server_start", {
            "port": PORT,
            "workspace": str(BASE_DIR.name),
            "tools": len(TOOL_REGISTRY) if routes_ok else 0,
        })
    except Exception:
        pass

    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
