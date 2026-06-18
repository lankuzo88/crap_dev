#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""POST /chat — AI chat với real tool calling (agentic loop)."""
import json
from flask import Blueprint, request, jsonify
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()

chat_bp = Blueprint("chat", __name__)

API_KEY      = "sk-7df540121d72d9bbe64730c4c96f4db488492620644269c88ca817225496839a"
BASE_URL     = "http://pro-x.io.vn"
MODEL        = "claude-sonnet-4-6"
MAX_TOKENS   = 4096
MAX_TOOL_ITER = 5   # tối đa số vòng tool calling


def _call_with_tools(client, system_prompt: str, messages: list,
                     tool_defs: list) -> str:
    """
    Agentic loop: gọi Claude → nếu cần tool → thực thi → trả kết quả → lặp.
    Tối đa MAX_TOOL_ITER vòng để tránh loop vô hạn.
    """
    from sandbox_tools import TOOL_REGISTRY

    current_messages = list(messages)

    for _ in range(MAX_TOOL_ITER):
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system_prompt,
            messages=current_messages,
            tools=tool_defs if tool_defs else [],
        )

        if response.stop_reason != "tool_use":
            # Claude đã trả lời xong — trả về text
            return "".join(
                block.text.strip()
                for block in response.content
                if hasattr(block, "text")
            )

        # Claude muốn gọi tool(s)
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            tool_name  = block.name
            tool_input = block.input or {}

            try:
                if tool_name in TOOL_REGISTRY:
                    result = TOOL_REGISTRY[tool_name](**tool_input)
                else:
                    result = {"error": f"Tool không tồn tại: {tool_name}"}
            except TypeError as e:
                result = {"error": f"Tham số sai: {e}"}
            except PermissionError as e:
                result = {"error": f"Không được phép: {e}"}
            except Exception as e:
                result = {"error": str(e)}

            result_str = json.dumps(result, ensure_ascii=False, default=str)
            if len(result_str) > 8000:
                result_str = result_str[:8000] + "...[đã cắt bớt]"

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result_str,
            })

        # Thêm assistant response + tool results vào messages để tiếp tục
        current_messages.append({"role": "assistant", "content": response.content})
        current_messages.append({"role": "user",      "content": tool_results})

    # Hết số vòng cho phép — lấy câu trả lời cuối không dùng tool
    final = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=current_messages,
    )
    return "".join(
        block.text.strip()
        for block in final.content
        if hasattr(block, "text")
    )


@chat_bp.route("/chat", methods=["POST"])
def handle_chat():
    body       = request.get_json() or {}
    message    = (body.get("message") or "").strip()
    session_id = body.get("sessionId") or ""

    if not message:
        return jsonify({"error": "Cần có message"}), 400

    from sandbox_memory import new_session, save_message
    from sandbox_knowledge import refresh_knowledge
    from sandbox_tools import build_tool_definitions, TOOL_REGISTRY
    from sandbox_prompt import build_system_prompt, build_user_messages
    from sandbox_memory import get_sandbox_state, list_sessions, get_project

    if not session_id:
        session_id = new_session()

    lab_state = refresh_knowledge({})

    # Workspace state
    sessions    = list_sessions()
    active_proj = None
    for s in sessions:
        if s["id"] == session_id and s.get("active_project"):
            active_proj = get_project(s["active_project"])
    ws_state = get_sandbox_state()
    ws_state["active_project"] = active_proj

    # Build system prompt, messages array, và tool definitions
    system_prompt = build_system_prompt(lab_state, ws_state, TOOL_REGISTRY)
    messages      = build_user_messages(session_id, message)
    tool_defs     = build_tool_definitions(TOOL_REGISTRY)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=API_KEY, base_url=BASE_URL)
        answer = _call_with_tools(client, system_prompt, messages, tool_defs)
    except Exception as e:
        return jsonify({
            "answer": f"Lỗi AI: {e}",
            "sessionId": session_id,
            "ok": False,
        })

    save_message(session_id, "user",      message)
    save_message(session_id, "assistant", answer)

    try:
        from sandbox_logging import log_action
        log_action("chat", {
            "session":    session_id,
            "msg_len":    len(message),
            "answer_len": len(answer),
        })
    except Exception:
        pass

    return jsonify({"answer": answer, "sessionId": session_id, "ok": True})
