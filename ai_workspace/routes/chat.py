#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""POST /chat — main AI chat endpoint."""
from flask import Blueprint, request, jsonify
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()

chat_bp = Blueprint("chat", __name__)

API_KEY  = "sk-7df540121d72d9bbe64730c4c96f4db488492620644269c88ca817225496839a"
BASE_URL = "http://pro-x.io.vn"
MODEL    = "claude-sonnet-4-6"

# Lazy import to avoid circular deps
def _get_modules():
    from sandbox_memory import new_session, save_message, get_session_context
    from sandbox_knowledge import build_lab_context
    from sandbox_tools import TOOL_REGISTRY
    return new_session, save_message, get_session_context, build_lab_context, TOOL_REGISTRY


@chat_bp.route("/chat", methods=["POST"])
def handle_chat():
    body = request.get_json() or {}
    message = (body.get("message") or "").strip()
    session_id = body.get("sessionId") or ""

    if not message:
        return jsonify({"error": "Cần có message"}), 400

    # Create session if needed
    new_sess, save_msg, get_ctx, build_ctx, tools = _get_modules()
    if not session_id:
        session_id = new_sess()

    # Build prompt
    from sandbox_prompt import build_sandbox_prompt
    from sandbox_knowledge import refresh_knowledge

    lab_state = refresh_knowledge({})

    # Get workspace state
    from sandbox_memory import get_sandbox_state, list_sessions
    sessions = list_sessions()
    active_proj = None
    for s in sessions:
        if s["id"] == session_id and s.get("active_project"):
            from sandbox_memory import get_project
            active_proj = get_project(s["active_project"])
    ws_state = get_sandbox_state()
    ws_state["active_project"] = active_proj

    prompt = build_sandbox_prompt(message, session_id, lab_state, ws_state, tools)

    # Call Claude
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=API_KEY, base_url=BASE_URL)
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
            tools=[],
        )
        answer = ""
        for block in response.content:
            if hasattr(block, "text"):
                answer += block.text.strip()

    except Exception as e:
        return jsonify({
            "answer": f"Lỗi AI: {e}",
            "sessionId": session_id,
            "ok": False,
        })

    # Save messages
    save_msg(session_id, "user", message)
    save_msg(session_id, "assistant", answer)

    # Log
    try:
        from sandbox_logging import log_action
        log_action("chat", {"session": session_id, "msg_len": len(message), "answer_len": len(answer)})
    except Exception:
        pass

    return jsonify({
        "answer": answer,
        "sessionId": session_id,
        "ok": True,
    })
