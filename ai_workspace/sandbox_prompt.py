#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB AI Cowork Sandbox — Prompt Assembler
Assemble full system prompt: SANDBOX.md + tools + lab context + workspace state + user message
"""
import os
from pathlib import Path

BASE_DIR  = Path(__file__).parent.resolve()
SANDBOX_MD = BASE_DIR / "SANDBOX.md"


def load_text(fp: Path) -> str:
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def build_system_prompt(lab_state: dict, workspace_state: dict,
                         tool_registry: dict) -> str:
    """
    Xây dựng system prompt: SANDBOX.md + tools + lab context + workspace state.
    Dùng cho tham số system= của Anthropic API.
    """
    lines = []

    # 1. SANDBOX.md — persona + rules
    sandbox_md = load_text(SANDBOX_MD)
    if sandbox_md:
        lines.append(sandbox_md)
        lines.append("")

    # 2. Tools (để AI biết có những tool nào)
    if tool_registry:
        lines.append("=== TOOLS AVAILABLE ===")
        for name in sorted(tool_registry.keys()):
            fn  = tool_registry[name]
            doc = (fn.__doc__ or "No description").strip().split("\n")[0]
            lines.append(f"- {name}: {doc}")
        lines.append("Gọi tools để lấy dữ liệu thực tế — không đoán.")
        lines.append("")

    # 3. Lab context (shared knowledge + stats)
    from sandbox_knowledge import build_lab_context
    lab_ctx = build_lab_context(lab_state)
    if lab_ctx:
        lines.append("=== LAB CONTEXT ===")
        lines.append(lab_ctx)
        lines.append("")

    # 4. Project & tasks
    active_project = workspace_state.get("active_project")
    pending        = workspace_state.get("pending_tasks", {})
    if active_project:
        lines.append("=== CURRENT PROJECT ===")
        lines.append(f"  Name: {active_project.get('name','?')}")
        lines.append(f"  Description: {active_project.get('description','?')}")
        lines.append("")
    if pending and pending.get("pending", 0) > 0:
        p = pending["pending"]
        lines.append(f"=== PENDING TASKS ({p}) ===")
        for t in workspace_state.get("pending_task_list", [])[:5]:
            lines.append(f"  [{t.get('priority','?')}] {t.get('description','?')}")
        lines.append("")

    # 5. Workspace meta
    active_sessions = workspace_state.get("active_sessions", 0)
    lines.append(f"[Workspace: ai_workspace/ | Active sessions: {active_sessions}]")

    return "\n".join(lines)


def build_user_messages(session_id: str, user_message: str) -> list:
    """
    Xây dựng messages array cho Anthropic API.
    Bao gồm: lịch sử session (alternating roles) + facts/insights + user message.
    """
    from sandbox_memory import get_raw_session_messages, get_facts_summary, get_insights_summary

    messages = []

    # Lịch sử session — đúng format alternating user/assistant
    history = get_raw_session_messages(session_id, limit=8)
    messages.extend(history)

    # Thêm facts + insights vào user message hiện tại
    parts = []
    facts_str    = get_facts_summary(limit=5)
    insights_str = get_insights_summary(limit=3)
    if facts_str and "(chua co" not in facts_str:
        parts.append(f"=== WORKSPACE FACTS ===\n{facts_str}")
    if insights_str and "(chua co" not in insights_str:
        parts.append(f"=== WORKSPACE INSIGHTS ===\n{insights_str}")

    full_msg = ("\n\n".join(parts) + "\n\n" + user_message) if parts else user_message
    messages.append({"role": "user", "content": full_msg})
    return messages


def build_sandbox_prompt(user_message: str, session_id: str,
                          lab_state: dict, workspace_state: dict,
                          tool_registry: dict) -> str:
    """Legacy: trả về system prompt dạng string (giữ cho backward compat)."""
    return build_system_prompt(lab_state, workspace_state, tool_registry)
