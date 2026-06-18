#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Memory & Sessions REST API endpoints."""
from flask import Blueprint, request, jsonify
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()

memory_bp = Blueprint("memory", __name__)


@memory_bp.route("/sessions", methods=["GET"])
def get_sessions():
    from sandbox_memory import list_sessions
    return jsonify({"sessions": list_sessions()})


@memory_bp.route("/sessions/<session_id>", methods=["GET"])
def get_session(session_id: str):
    from sandbox_memory import _load, SESSIONS_FP
    data = _load(SESSIONS_FP, {"sessions": []})
    sess = next((s for s in data["sessions"] if s["id"] == session_id), None)
    if not sess:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(sess)


@memory_bp.route("/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id: str):
    from sandbox_memory import delete_session
    delete_session(session_id)
    return jsonify({"ok": True})


@memory_bp.route("/memory/facts", methods=["GET"])
def get_facts():
    from sandbox_memory import _load, FACTS_FP
    return jsonify(_load(FACTS_FP, {"facts": []}))


@memory_bp.route("/memory/facts", methods=["POST"])
def add_fact():
    body = request.get_json() or {}
    from sandbox_memory import add_fact as af
    entry = af(
        fact=body.get("fact", ""),
        source=body.get("source", "api"),
        confidence=body.get("confidence", "medium"),
        tags=body.get("tags"),
    )
    return jsonify({"ok": True, "entry": entry})


@memory_bp.route("/memory/tasks", methods=["GET"])
def get_tasks():
    from sandbox_memory import list_tasks as lt
    tasks = lt(project_id=request.args.get("project_id"), status=request.args.get("status"))
    return jsonify({"tasks": tasks, "count": len(tasks)})


@memory_bp.route("/memory/tasks", methods=["POST"])
def create_task():
    body = request.get_json() or {}
    from sandbox_memory import create_task as ct
    task = ct(
        project_id=body.get("project_id", "default"),
        description=body.get("description", ""),
        priority=body.get("priority", "medium"),
        tags=body.get("tags"),
    )
    return jsonify({"ok": True, "task": task})


@memory_bp.route("/memory/tasks/<task_id>", methods=["PATCH"])
def update_task(task_id: str):
    body = request.get_json() or {}
    from sandbox_memory import update_task
    update_task(task_id, status=body.get("status"), **body)
    return jsonify({"ok": True})


@memory_bp.route("/memory/projects", methods=["GET"])
def get_projects():
    from sandbox_memory import list_projects as lp
    projects = lp(active_only=request.args.get("active_only", "true").lower() == "true")
    return jsonify({"projects": projects})


@memory_bp.route("/memory/projects", methods=["POST"])
def create_project():
    body = request.get_json() or {}
    from sandbox_memory import create_project as cp
    proj = cp(
        name=body.get("name", ""),
        description=body.get("description", ""),
        tags=body.get("tags"),
    )
    return jsonify({"ok": True, "project": proj})


@memory_bp.route("/memory/insights", methods=["GET"])
def get_insights():
    from sandbox_memory import _load, INSIGHTS_FP
    limit = int(request.args.get("limit", 20))
    data = _load(INSIGHTS_FP, {"entries": []})
    return jsonify({"entries": data["entries"][:limit], "total": len(data["entries"])})


@memory_bp.route("/memory/sessions", methods=["GET"])
def get_sessions_root():
    from sandbox_memory import list_sessions
    return jsonify({"sessions": list_sessions()})


@memory_bp.route("/memory", methods=["GET"])
def get_all_memory():
    from sandbox_memory import (
        list_sessions, list_projects, list_tasks,
        count_pending_tasks, _load, FACTS_FP, INSIGHTS_FP
    )
    pending = count_pending_tasks()
    return jsonify({
        "sessions": list_sessions(),
        "projects": list_projects(),
        "tasks": list_tasks(),
        "task_stats": pending,
        "facts_count": len(_load(FACTS_FP, {"facts": []})["facts"]),
        "insights_count": len(_load(INSIGHTS_FP, {"entries": []})["entries"]),
    })
