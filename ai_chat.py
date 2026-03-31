#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB - AI Chat: Claude Sonnet 4 qua proxy pro-x.io.vn
"""
import os, sys, json, io

# Fix Windows console UTF-8
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
MEMORY_FP = os.path.join(BASE_DIR, "ai_memory.json")

# ── ANTHROPIC CLIENT ─────────────────────────────────────────────────────────
API_KEY  = "sk-7df540121d72d9bbe64730c4c96f4db488492620644269c88ca817225496839a"
BASE_URL = "http://pro-x.io.vn"
MODEL    = "claude-sonnet-4-6"


def get_client():
    import anthropic
    return anthropic.Anthropic(
        api_key=API_KEY,
        base_url=BASE_URL,
    )


# ── MEMORY ──────────────────────────────────────────────────────────────────
def load_memory() -> dict:
    if not os.path.exists(MEMORY_FP):
        return {}
    try:
        with open(MEMORY_FP, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


# ── SYSTEM PROMPT ───────────────────────────────────────────────────────────
def build_system_prompt(memory: dict) -> str:
    lstats   = memory.get("learnedStats", {})
    insights = memory.get("insights", [])
    lab      = memory.get("lab", {})

    total_orders = lstats.get("totalOrdersAnalyzed", "—")
    total_teeth  = lstats.get("totalTeeth", "—")
    data_from    = lstats.get("dataRange", {}).get("from", "?")
    data_to      = lstats.get("dataRange", {}).get("to", "?")

    lt_lines = "\n".join([
        f"  {s}: {v} ngay"
        for s, v in lstats.get("avgLeadTime", {}).items()
        if v and v != "—"
    ]) or "  (khong co du lieu)"

    tc_lines = "\n".join([
        f"  {c['name']}: {c['count']} don"
        for c in lstats.get("topCustomers", [])[:3]
    ]) or "  (khong co du lieu)"

    kp_lines = "\n".join([
        f"  {k['name']}: {k['xnCount']} don, {k['totalSL']} rang"
        for k in lstats.get("ktvPerformance", [])[:3]
    ]) or "  (khong co du lieu)"

    dv  = lstats.get("dailyVolume", {})
    dv_txt = f"TB {dv.get('avg','?')} don/ngay | Max {dv.get('max','?')} | Min {dv.get('min','?')} | {dv.get('days','?')} ngay"

    bn = lstats.get("bottleneckStage", "?")
    bp = lstats.get("bottleneckPct", 0)
    rr = lstats.get("remakeRate", "?")
    rc = lstats.get("remakeCount", 0)

    ins_block = "\n".join([f"  - {i}" for i in insights]) if insights else "  (chua co insights)"

    persona = memory.get("aiPersona", {})
    rules   = persona.get("rules", [])
    rules_txt = "\n".join([f"  - {r}" for r in rules[:6]]) if rules else "  - Tra loi ngan gon, co du lieu cu the."

    return f"""Ban la {persona.get('role', 'AI Assistant cua ASIA LAB')}.

Ban tra loi bang TIENG VIET, ngắn gọn, di kem so lieu cu the tu bang ben duoi.
Neu khong biet, noi: "Toi khong co thong tin ve dieu nay."
TUYET DOI KHONG TU DOAN hay BO SUNG so lieu.

=== DU LIEU (DATA: {data_from} den {data_to}) ===
Tong so don: {total_orders} don
Tong so rang: {total_teeth} rang

=== LEAD TIME TB ===
{lt_lines}

=== NUT THAT ===
Cong doan: {bn} ({bp}% don chua xong)

=== REMAKE ===
Ty le: {rr} ({rc} don)

=== DAILY VOLUME ===
{dv_txt}

=== TOP 3 KHACH HANG ===
{tc_lines}

=== TOP 3 KTV ===
{kp_lines}

=== INSIGHTS ===
{ins_block}

=== QUY TAC ===
{rules_txt}
"""


# ── CHAT ────────────────────────────────────────────────────────────────────
def chat(user_msg: str, verbose: bool = False) -> str:
    print("  [Dang suy nghi... ]", end="", flush=True)
    try:
        client = get_client()
        memory  = load_memory()
        system  = build_system_prompt(memory)

        if verbose:
            print(f"\n[SYSTEM]\n{system[:300]}...", file=sys.stderr)

        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[
                {"role": "user", "content": system + "\n\n---\n\nCau hoi nguoi dung: " + user_msg},
            ],
        )

        print("\r  [Xong]            \n", flush=True)
        # response.content can be list of TextBlock/ThinkingBlock
        parts = []
        for block in response.content:
            if hasattr(block, "text"):
                parts.append(block.text.strip())
        return "\n".join(parts).strip()

    except Exception as e:
        print(f"\r  [Loi: {e}]            ", flush=True)
        return f"LOI: {e}"


# ── INTERACTIVE ─────────────────────────────────────────────────────────────
def interactive():
    print("=" * 50)
    print("  ASIA LAB AI Chat -- Claude Sonnet 4")
    print("  Go 'exit'/'quit' de thoat")
    print("=" * 50)
    print()
    memory = load_memory()
    if memory.get("learnedStats"):
        dr = memory["learnedStats"].get("dataRange", {})
        print("  Da doc learnedStats")
        print("  Data: " + dr.get("from", "?") + " -> " + dr.get("to", "?"))
    else:
        print("  Chua co learnedStats -- chay ai_stats.py truoc")
    print()

    while True:
        try:
            user = input("Ban: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nTam biet!")
            break
        if not user:
            continue
        if user.lower() in ("exit", "quit", "q"):
            print("Tam biet!")
            break
        if user.lower() == "reload":
            memory = load_memory()
            print("  Da reload ai_memory.json")
            continue
        print()
        result = chat(user)
        print("  AI:", result)
        print()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
        print(chat(question))
    else:
        interactive()
