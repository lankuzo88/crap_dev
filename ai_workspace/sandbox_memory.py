#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB AI Cowork Sandbox — Memory Manager
Quản lý: Sessions / Projects / Tasks / Facts / Insights
- Layer 2 (sandbox OWN): sandbox_*.json
- Atomic JSON write: write-to-temp → os.replace()
"""
import os, json, uuid
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent.resolve()

SESSIONS_FP  = BASE_DIR / "sandbox_sessions.json"
TASKS_FP     = BASE_DIR / "sandbox_tasks.json"
PROJECTS_FP  = BASE_DIR / "sandbox_projects.json"
FACTS_FP     = BASE_DIR / "sandbox_facts.json"
INSIGHTS_FP  = BASE_DIR / "sandbox_insights.json"


# ── Atomic JSON helpers ──────────────────────────────────────────────────────
def _atomic_write(fp: Path, data: dict):
    """Write JSON atomically: temp → os.replace() → no corruption on crash."""
    tmp = fp.with_suffix('.tmp')
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, fp)


def _load(fp: Path, default: dict) -> dict:
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


# ── Sessions ────────────────────────────────────────────────────────────────
def new_session() -> str:
    return uuid.uuid4().hex[:8]


def save_message(session_id: str, role: str, content: str):
    data = _load(SESSIONS_FP, {"sessions": []})
    now = datetime.now().isoformat()

    sess = next((s for s in data["sessions"] if s["id"] == session_id), None)
    if sess is None:
        sess = {"id": session_id, "created": now, "messages": [], "active_project": None}
        data["sessions"].append(sess)

    sess["messages"].append({"role": role, "content": content, "at": now})
    sess["messages"] = sess["messages"][-30:]          # keep last 30
    data["sessions"] = data["sessions"][-10:]         # keep last 10 sessions
    _atomic_write(SESSIONS_FP, data)


def get_session_context(session_id: str, limit: int = 8) -> str:
    data = _load(SESSIONS_FP, {"sessions": []})
    for sess in data["sessions"]:
        if sess["id"] == session_id:
            msgs = sess["messages"]
            if len(msgs) <= 2:
                return ""
            ctx = ["[Session History — recent conversation]"]
            for m in msgs[-(limit + 1):-1]:
                role = "Ban" if m["role"] == "user" else "AI"
                ctx.append(f"  {role}: {m['content'][:120]}")
            return "\n".join(ctx)
    return ""


def get_raw_session_messages(session_id: str, limit: int = 8) -> list:
    """
    Trả về raw messages list cho session (để build Anthropic API messages array).
    Đảm bảo luôn bắt đầu bằng role='user' (API yêu cầu).
    """
    data = _load(SESSIONS_FP, {"sessions": []})
    sess = next((s for s in data["sessions"] if s["id"] == session_id), None)
    if not sess:
        return []
    msgs = sess.get("messages", [])[-limit:]
    # API yêu cầu bắt đầu bằng user
    while msgs and msgs[0]["role"] != "user":
        msgs = msgs[1:]
    return [{"role": m["role"], "content": m["content"]} for m in msgs]


def list_sessions() -> list:
    data = _load(SESSIONS_FP, {"sessions": []})
    return [
        {
            "id": s["id"],
            "created": s["created"],
            "msg_count": len(s["messages"]),
            "active_project": s.get("active_project"),
        }
        for s in data["sessions"]
    ]


def delete_session(session_id: str):
    data = _load(SESSIONS_FP, {"sessions": []})
    data["sessions"] = [s for s in data["sessions"] if s["id"] != session_id]
    _atomic_write(SESSIONS_FP, data)


def set_session_project(session_id: str, project_id: str = None):
    data = _load(SESSIONS_FP, {"sessions": []})
    for s in data["sessions"]:
        if s["id"] == session_id:
            s["active_project"] = project_id
            break
    _atomic_write(SESSIONS_FP, data)


# ── Projects ────────────────────────────────────────────────────────────────
def create_project(name: str, description: str = "", tags: list = None) -> dict:
    data = _load(PROJECTS_FP, {"projects": []})
    proj = {
        "id":       uuid.uuid4().hex[:8],
        "name":     name,
        "description": description,
        "tags":     tags or [],
        "status":   "active",
        "created":  datetime.now().isoformat(),
        "updated":  datetime.now().isoformat(),
    }
    data["projects"].insert(0, proj)
    _atomic_write(PROJECTS_FP, data)
    return proj


def get_project(project_id: str) -> dict:
    data = _load(PROJECTS_FP, {"projects": []})
    return next((p for p in data["projects"] if p["id"] == project_id), None)


def update_project(project_id: str, **fields):
    data = _load(PROJECTS_FP, {"projects": []})
    for p in data["projects"]:
        if p["id"] == project_id:
            p.update(fields)
            p["updated"] = datetime.now().isoformat()
            break
    _atomic_write(PROJECTS_FP, data)


def list_projects(active_only: bool = True) -> list:
    data = _load(PROJECTS_FP, {"projects": []})
    projects = data["projects"]
    if active_only:
        projects = [p for p in projects if p.get("status") == "active"]
    return projects


def close_project(project_id: str):
    update_project(project_id, status="closed")


# ── Tasks ──────────────────────────────────────────────────────────────────
def create_task(project_id: str, description: str,
                priority: str = "medium",
                tags: list = None) -> dict:
    data = _load(TASKS_FP, {"tasks": []})
    task = {
        "id":          uuid.uuid4().hex[:8],
        "project_id":  project_id,
        "description": description,
        "priority":    priority,
        "tags":        tags or [],
        "status":      "pending",
        "created":     datetime.now().isoformat(),
        "updated":     datetime.now().isoformat(),
    }
    data["tasks"].insert(0, task)
    _atomic_write(TASKS_FP, data)
    return task


def get_task(task_id: str) -> dict:
    data = _load(TASKS_FP, {"tasks": []})
    return next((t for t in data["tasks"] if t["id"] == task_id), None)


def update_task(task_id: str, status: str = None, **fields):
    data = _load(TASKS_FP, {"tasks": []})
    for t in data["tasks"]:
        if t["id"] == task_id:
            if status:
                t["status"] = status
            t.update(fields)
            t["updated"] = datetime.now().isoformat()
            break
    _atomic_write(TASKS_FP, data)


def list_tasks(project_id: str = None, status: str = None) -> list:
    data = _load(TASKS_FP, {"tasks": []})
    tasks = data["tasks"]
    if project_id:
        tasks = [t for t in tasks if t.get("project_id") == project_id]
    if status:
        tasks = [t for t in tasks if t.get("status") == status]
    return sorted(tasks, key=lambda t: (
        {"high": 0, "medium": 1, "low": 2}.get(t.get("priority", "medium"), 1),
        t.get("created", "")
    ))


def close_task(task_id: str):
    update_task(task_id, status="done")


def count_pending_tasks() -> dict:
    data = _load(TASKS_FP, {"tasks": []})
    total = len(data["tasks"])
    done  = sum(1 for t in data["tasks"] if t.get("status") == "done")
    pending = total - done
    return {"total": total, "done": done, "pending": pending}


# ── Facts ──────────────────────────────────────────────────────────────────
def add_fact(fact: str, source: str = "sandbox", confidence: str = "medium",
             tags: list = None) -> dict:
    data = _load(FACTS_FP, {"facts": []})
    now  = datetime.now().isoformat()

    for f in data["facts"]:
        if f["fact"] == fact:
            f["lastSeen"] = now
            f["count"]    = f.get("count", 1) + 1
            _atomic_write(FACTS_FP, data)
            return f

    entry = {
        "id":        uuid.uuid4().hex[:8],
        "fact":      fact,
        "source":    source,
        "confidence": confidence,
        "tags":      tags or [],
        "firstSeen": now,
        "lastSeen":  now,
        "count":     1,
        "verified":   False,
    }
    data["facts"].insert(0, entry)
    data["facts"] = data["facts"][-100:]          # keep 100 max
    _atomic_write(FACTS_FP, data)
    return entry


def verify_fact(fact: str = None, fact_id: str = None):
    data = _load(FACTS_FP, {"facts": []})
    for f in data["facts"]:
        if (fact and f["fact"] == fact) or (fact_id and f["id"] == fact_id):
            f["verified"] = True
    _atomic_write(FACTS_FP, data)


def get_facts_summary(limit: int = 10) -> str:
    data = _load(FACTS_FP, {"facts": []})
    if not data["facts"]:
        return ""

    verified   = [f for f in data["facts"] if f.get("verified")]
    unverified = [f for f in data["facts"] if not f.get("verified")]

    lines = ["[Workspace Learned Facts]"]
    if verified:
        lines.append(f"  ✓ Da xac nhan ({len(verified)}):")
        for f in verified[:limit]:
            lines.append(f"    • {f['fact']} [src={f.get('source','?')} count={f.get('count',1)}]")
    if unverified:
        lines.append(f"  ? Chua xac nhan ({len(unverified)}):")
        for f in unverified[:5]:
            lines.append(f"    • {f['fact']} (confidence={f.get('confidence','?')})")
    return "\n".join(lines)


# ── Insights ────────────────────────────────────────────────────────────────
def append_insight(text: str, metadata: dict = None) -> dict:
    data = _load(INSIGHTS_FP, {"entries": []})
    entry = {
        "id":       uuid.uuid4().hex[:8],
        "at":       datetime.now().isoformat(),
        "text":     text,
        "metadata": metadata or {},
    }
    data["entries"].insert(0, entry)
    data["entries"] = data["entries"][-50:]          # keep 50 max
    _atomic_write(INSIGHTS_FP, data)
    return entry


def get_insights_summary(limit: int = 5) -> str:
    data = _load(INSIGHTS_FP, {"entries": []})
    if not data["entries"]:
        return ""
    lines = ["[Workspace Insight Timeline]"]
    for e in data["entries"][:limit]:
        lines.append(f"  - {e['at'][:10]}: {e['text'][:80]}")
    return "\n".join(lines)


# ── Dashboard integration helpers ──────────────────────────────────────────
def get_sandbox_state() -> dict:
    """Tra ve summary cho AI prompt."""
    pending = count_pending_tasks()
    projects = list_projects(active_only=True)
    facts_str = get_facts_summary(5)
    insights_str = get_insights_summary(5)
    sessions = list_sessions()

    return {
        "pending_tasks": pending,
        "active_projects": [p["name"] for p in projects[:3]],
        "facts_summary":   facts_str,
        "insights_summary": insights_str,
        "active_sessions": len([s for s in sessions if s["msg_count"] > 0]),
    }
