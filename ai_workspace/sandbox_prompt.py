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


def build_sandbox_prompt(user_message: str, session_id: str,
                          lab_state: dict, workspace_state: dict,
                          tool_registry: dict) -> str:
    """
    Assemble full prompt for Claude Sonnet 4.
    Order: SANDBOX.md → tools → lab context → project/tasks → session → facts → user
    """
    lines = []

    # 1. SANDBOX.md — workspace persona + rules
    sandbox_md = load_text(SANDBOX_MD)
    if sandbox_md:
        lines.append(sandbox_md)
        lines.append("")

    # 2. Available tools
    if tool_registry:
        lines.append("=== AVAILABLE TOOLS ===")
        for name in sorted(tool_registry.keys()):
            fn = tool_registry[name]
            doc = (fn.__doc__ or "No description").strip().split("\n")[0]
            lines.append(f"- {name}: {doc}")
        lines.append("")
        lines.append("To use a tool, respond with a tool_use block in your response.")
        lines.append("")

    # 3. Lab context (shared knowledge + stats)
    from sandbox_knowledge import build_lab_context
    lab_ctx = build_lab_context(lab_state)
    if lab_ctx:
        lines.append("=== LAB CONTEXT ===")
        lines.append(lab_ctx)
        lines.append("")

    # 4. Current project & pending tasks
    active_project = workspace_state.get("active_project")
    pending = workspace_state.get("pending_tasks", {})
    if active_project:
        lines.append("=== CURRENT PROJECT ===")
        lines.append(f"  Name: {active_project.get('name','?')}")
        lines.append(f"  Description: {active_project.get('description','?')}")
        lines.append(f"  Status: {active_project.get('status','?')}")
        lines.append("")

    if pending:
        p = pending.get("pending", 0)
        if p > 0:
            lines.append(f"=== PENDING TASKS ({p}) ===")
            tasks = workspace_state.get("pending_task_list", [])[:5]
            for t in tasks:
                lines.append(f"  [{t.get('priority','?')}] {t.get('description','?')} [{t.get('id','?'):>8}]")
            lines.append("")

    # 5. Workspace state summary
    active_sessions = workspace_state.get("active_sessions", 0)
    lines.append(f"[Workspace: ai_workspace/ | Active sessions: {active_sessions}]")
    lines.append("")

    # 6. Session history
    from sandbox_memory import get_session_context
    session_ctx = get_session_context(session_id, limit=6)
    if session_ctx:
        lines.append("=== SESSION HISTORY ===")
        lines.append(session_ctx)
        lines.append("")

    # 7. Sandbox learned facts
    from sandbox_memory import get_facts_summary
    facts_str = get_facts_summary(limit=8)
    if facts_str:
        lines.append("=== WORKSPACE FACTS ===")
        lines.append(facts_str)
        lines.append("")

    # 8. Sandbox insights
    from sandbox_memory import get_insights_summary
    insights_str = get_insights_summary(limit=5)
    if insights_str:
        lines.append("=== WORKSPACE INSIGHTS ===")
        lines.append(insights_str)
        lines.append("")

    # 9. User message
    lines.append("=== USER MESSAGE ===")
    lines.append(user_message)
    lines.append("")
    lines.append("=== YOUR RESPONSE ===")
    lines.append("Answer the user's question. Use tools where appropriate to get accurate data.")
    lines.append("Cite sources: [realtime], [learnedStats], [knowledge], [workspace], [sandbox_memory]")
    lines.append("After analysis, proactively suggest: what to do next, any patterns found.")
    lines.append("Log significant findings to your workspace: create tasks, add facts, generate reports.")

    return "\n".join(lines)
