#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""POST /tool/<name> — tool execution endpoint."""
from flask import Blueprint, request, jsonify
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()

tools_bp = Blueprint("tools", __name__)


@tools_bp.route("/tool/<tool_name>", methods=["POST"])
def call_tool(tool_name: str):
    from sandbox_tools import TOOL_REGISTRY

    if tool_name not in TOOL_REGISTRY:
        return jsonify({"error": f"Unknown tool: {tool_name}", "available": list(TOOL_REGISTRY.keys())}), 400

    tool_fn = TOOL_REGISTRY[tool_name]
    params = (request.get_json() or {}).get("params", {})

    try:
        result = tool_fn(**params)
        # Log tool call
        try:
            from sandbox_logging import log_action
            log_action("tool", {"tool": tool_name, "params": {k: str(v)[:100] for k, v in params.items()}})
        except Exception:
            pass
        return jsonify({"result": result, "ok": True})
    except PermissionError as e:
        return jsonify({"error": str(e), "ok": False}), 403
    except TypeError as e:
        return jsonify({"error": f"Sai tham so: {e}", "ok": False}), 400
    except Exception as e:
        return jsonify({"error": str(e), "ok": False}), 500


@tools_bp.route("/tools", methods=["GET"])
def list_tools():
    from sandbox_tools import TOOL_REGISTRY
    return jsonify({
        "tools": [
            {"name": name, "doc": (fn.__doc__ or "").strip().split("\n")[0]}
            for name, fn in sorted(TOOL_REGISTRY.items())
        ],
        "count": len(TOOL_REGISTRY),
    })
