#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB - AI Chat: Claude Sonnet 4 + NotebookLM-style RAG
- 3 nguon data: realtime (server.js) / learnedStats / knowledge
- Trich dan nguon moi cau tra loi
- Khong hallucinate
"""
import os, sys, json, io, re, urllib.request, urllib.error, uuid

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
INSTRUCTIONS = os.path.join(BASE_DIR, "ai_instructions.txt")
KNOWLEDGE_FP = os.path.join(BASE_DIR, "ai_knowledge.json")
MEMORY_FP   = os.path.join(BASE_DIR, "ai_memory.json")
API_KEY     = "sk-7df540121d72d9bbe64730c4c96f4db488492620644269c88ca817225496839a"
BASE_URL    = "http://pro-x.io.vn"
MODEL       = "claude-sonnet-4-6"

# Memory systems
from ai_memory import (
    get_insights_summary, get_facts_summary,
    save_message, new_session, get_session_context,
    add_fact, load_insights,
)


# ── LOAD FILES ────────────────────────────────────────────────────────────────
def load_text(fp):
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def load_json(fp):
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


# ── REALTIME DATA (server.js) ───────────────────────────────────────────────
def fetch_realtime() -> tuple:
    """Goi server.js /data.json — tra ve (orders, error_msg)."""
    try:
        import socket
        socket.setdefaulttimeout(5)
        req = urllib.request.Request(
            "http://localhost:3000/data.json",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("orders", []), None
    except Exception as e:
        return [], str(e)


def build_realtime_context(orders: list, error: str = None) -> str:
    """Build Realtime data chunk cho prompt."""
    if error:
        return f"[Nguon: realtime] Khong lay duoc (server.js: {error})"
    if not orders:
        return None

    today = ""  # ngay hom nay theo Excel
    total = len(orders)
    by_kh = {}
    pending = []
    done = []

    for o in orders:
        kh = o.get("kh") or "?"
        by_kh[kh] = by_kh.get(kh, 0) + 1
        if o.get("pct", 0) >= 100:
            done.append(o)
        else:
            pending.append(o)

    # Top KH hien tai
    top_kh = sorted(by_kh.items(), key=lambda x: -x[1])[:3]
    kh_txt = " | ".join([f"{k}={v}don" for k, v in top_kh])

    return f"""[Nguon: realtime]
Tong don hien tai: {total}
Don da hoan thanh (pct=100): {len(done)}
Don dang lam (pct<100): {len(pending)}
Top KH: {kh_txt}"""


# ── RAG: RETRIEVE RELEVANT KNOWLEDGE ─────────────────────────────────────────
REALTIME_TRIGGERS = [
    "hôm nay","hom nay","hiện tại","hien tai","realtime",
    "đang làm","dang lam","cần giao","can giao","chưa xong",
    "sắp giao","sap giao","đơn hôm nay","don hom nay",
    "tình trạng","tinh trang","hien co","hiện có",
]

STATS_TRIGGERS = [
    "tổng đơn","tong don","tháng","thang","tổng cộng",
    "top khách","top khach","top ktv","ktv nhiều",
    "nút thắt","nut that","bottleneck","lead time",
    "remake","làm lại","xu hướng","xu huong","trend",
    "số lượng","so luong","bao nhiêu","bao nhieu",
    "trung bình","trung binh","tổng răng","tong rang",
]

KNOWLEDGE_TRIGGERS = [
    "quy trình","quy trinh","công đoạn","cong doan","cbm",
    "sáp","sườn","đắp","mài","cadcam",
    "vật liệu","vat lieu","zirconia","titanium",
    "làm lại","sửa","bảo hành","bảo hành","làm tiếp",
    "thử sườn","thu suon","ts","đơn sửa","don sua",
    "khách hàng","khach hang","ktv là gì","ai là ktv",
]


def detect_sources(user_msg: str) -> list:
    """Xac dinh nguon nao can doc cho cau hoi nay."""
    msg = user_msg.lower()
    sources = []

    if any(t in msg for t in REALTIME_TRIGGERS):
        sources.append("realtime")
    if any(t in msg for t in STATS_TRIGGERS):
        sources.append("stats")
    if any(t in msg for t in KNOWLEDGE_TRIGGERS):
        sources.append("knowledge")

    # Mac dinh: stats + knowledge
    if not sources:
        sources = ["stats", "knowledge"]

    return list(dict.fromkeys(sources))  # keep order, remove dup


def build_stats_context(memory: dict) -> str:
    ls = memory.get("learnedStats", {})
    if not ls:
        return None

    dr  = ls.get("dataRange", {})
    lt  = ls.get("avgLeadTime", {})
    lt_txt = " | ".join([f"{k}={v}" for k, v in lt.items() if v and v != "—"])

    tc  = ls.get("topCustomers", [])[:3]
    tc_txt = " | ".join([f"{c['name']}={c['count']}" for c in tc])

    kp  = ls.get("ktvPerformance", [])[:3]
    kp_txt = " | ".join([f"{k['name']}={k['xnCount']}don" for k in kp])

    dv  = ls.get("dailyVolume", {})
    dv_txt = f"TB={dv.get('avg','?')}/ngay Max={dv.get('max','?')} Min={dv.get('min','?')}"

    return f"""[Nguon: learnedStats] (Data: {dr.get('from','?')} → {dr.get('to','?')})
Tong don: {ls.get('totalOrdersAnalyzed','?')} | Tong rang: {ls.get('totalTeeth','?')}
Lead time: {lt_txt or '?'}
Nut that: {ls.get('bottleneckStage','?')} ({ls.get('bottleneckPct','?')}% don chua xong)
Remake: {ls.get('remakeRate','?')} ({ls.get('remakeCount','?')} don)
Daily vol: {dv_txt}
Top KH: {tc_txt or '?'}
Top KTV: {kp_txt or '?'}"""


def build_knowledge_context(knowledge: dict) -> str:
    lab = knowledge.get("lab", {})
    stages = lab.get("stages", [])

    stage_txt = "\n".join([
        f"  {s}: {lab.get('stage_descriptions',{}).get(s,'')}"
        for s in stages
    ])

    mats = knowledge.get("materials", {})
    mat_txt = "\n".join([
        f"  {m}: {v.get('time','?')} ({', '.join(v.get('keywords',[])[:3])})"
        for m, v in mats.items()
    ])

    ktvs = knowledge.get("ktvs", [])
    ktv_txt = ", ".join(ktvs[:10]) + ("..." if len(ktvs) > 10 else "")

    sos = knowledge.get("special_orders", {})
    so_txt = "\n".join([f"  {k}: {v.get('note','')}" for k, v in sos.items()])

    return f"""[Nguon: knowledge]
Stages: {', '.join(stages)}
{stage_txt}

Vat lieu:
{mat_txt or '  (khong co du lieu)'}

KTV ({len(ktvs)} nguoi): {ktv_txt}

Don dac biet:
{so_txt or '  (khong co du lieu)'}"""


# ── ASSEMBLE PROMPT ──────────────────────────────────────────────────────────
def build_prompt(user_msg: str, sources: list, memory: dict, knowledge: dict,
                 session_id: str = None) -> str:
    instructions = load_text(INSTRUCTIONS)

    lines = []
    lines.append(instructions)
    lines.append("")

    # Session context (neu co lich su)
    if session_id:
        ctx = get_session_context(session_id)
        if ctx:
            lines.append(ctx)
            lines.append("")

    # Data chunks
    lines.append("=== DATA CHUNKS ===")

    has_realtime = False
    for src in sources:
        if src == "realtime":
            orders, err = fetch_realtime()
            ctx = build_realtime_context(orders, err)
            lines.append(ctx)
            has_realtime = True

        elif src == "stats":
            ctx = build_stats_context(memory)
            if ctx:
                lines.append(ctx)

        elif src == "knowledge":
            ctx = build_knowledge_context(knowledge)
            if ctx:
                lines.append(ctx)

    # Insights timeline + Learned facts
    insights_txt = get_insights_summary()
    facts_txt    = get_facts_summary()
    if insights_txt and "(chua co" not in insights_txt:
        lines.append("")
        lines.append(insights_txt)
    if facts_txt and "(chua co" not in facts_txt:
        lines.append("")
        lines.append(facts_txt)

    if not has_realtime:
        lines.append("")
        lines.append("[Luu y] Cau hoi ve du lieu hien tai — xem chunk [Nguon: realtime] o tren")

    lines.append("")
    lines.append(f"=== CAU HOI ===\n{user_msg}")

    return "\n".join(lines)


# ── CHAT ────────────────────────────────────────────────────────────────────
def chat(user_msg: str, verbose: bool = False, session_id: str = None) -> str:
    print("  [Dang suy nghi... ]", end="", flush=True)
    try:
        import anthropic
        client    = anthropic.Anthropic(api_key=API_KEY, base_url=BASE_URL)
        memory    = load_json(MEMORY_FP)
        knowledge = load_json(KNOWLEDGE_FP)
        sources   = detect_sources(user_msg)
        prompt    = build_prompt(user_msg, sources, memory, knowledge, session_id)

        if verbose:
            print(f"\n[SOURCES: {sources}]", file=sys.stderr)
            print(f"[PROMPT]\n{prompt[:500]}...", file=sys.stderr)

        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
            tools=[],  # tat tool use — chi tra loi, khong tu browse
        )

        parts = []
        for block in response.content:
            if hasattr(block, "text"):
                parts.append(block.text.strip())

        answer = "\n".join(parts).strip()

        # Luu lich su session
        if session_id:
            save_message(session_id, "user",   user_msg)
            save_message(session_id, "assistant", answer)

        print("\r  [Xong]            \n", flush=True)
        return answer

    except Exception as e:
        print(f"\r  [Loi: {e}]            ", flush=True)
        return f"LOI: {e}"


# ── INTERACTIVE ─────────────────────────────────────────────────────────────
def interactive():
    print("=" * 50)
    print("  ASIA LAB AI Chat -- Claude Sonnet 4 (NotebookLM)")
    print("  3 nguon: realtime | learnedStats | knowledge")
    print("  Tu hoc: insights timeline | learned facts | session memory")
    print("  Go 'exit'/'quit' de thoat | 'new' de reset session")
    print("=" * 50)

    memory     = load_json(MEMORY_FP)
    knowledge  = load_json(KNOWLEDGE_FP)
    session_id = new_session()

    if memory.get("learnedStats"):
        dr = memory["learnedStats"].get("dataRange", {})
        print(f"\n  [learnedStats] Data: {dr.get('from','?')} -> {dr.get('to','?')}")
    if knowledge.get("lab"):
        print(f"  [knowledge] Lab: {knowledge['lab'].get('name','?')}")
    insights_txt = get_insights_summary()
    if insights_txt and "(chua co" not in insights_txt:
        print(f"  [insights] Timeline co {load_insights()['entries'][-1]['at'][:10]}")
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
        if user.lower() == "new":
            session_id = new_session()
            print("  Session moi — da reset lich su")
            continue
        if user.lower() == "reload":
            memory    = load_json(MEMORY_FP)
            knowledge = load_json(KNOWLEDGE_FP)
            print("  Da reload memory + knowledge")
            continue
        if user.lower() == "sources":
            print(f"  Nguon: {detect_sources(input('Cau hoi: ').strip())}")
            continue

        print()
        result = chat(user, session_id=session_id)
        print("  AI:", result)
        print()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
        print(chat(question))
    else:
        interactive()
