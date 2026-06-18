#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB — Memory Manager
3 hệ thống nhớ:
  ai_insights.json   — Timeline: insights tích lũy theo thời gian
  ai_facts.json     — Facts: AI tự phát hiện pattern mới
  ai_sessions.json  — Session: lịch sử trò chuyện hiện tại
"""
import os, json
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent.resolve()

INSIGHTS_FP = BASE_DIR / "ai_insights.json"
FACTS_FP    = BASE_DIR / "ai_facts.json"
SESSIONS_FP = BASE_DIR / "ai_sessions.json"


# ── INSIGHTS TIMELINE ────────────────────────────────────────────────────────
def load_insights():
    try:
        with open(INSIGHTS_FP, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"entries": []}


def save_insights(data):
    with open(INSIGHTS_FP, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def append_insight(insights: list, stats: dict):
    """Ghi insight moi nhat +o timeline. So sanh voi lan truoc de ra trend."""
    data = load_insights()
    now  = datetime.now().isoformat()

    entry = {
        "at":         now,
        "stats": {
            "totalOrders": stats.get("totalOrdersAnalyzed"),
            "totalTeeth":  stats.get("totalTeeth"),
            "bottleneck":  stats.get("bottleneckStage"),
            "bottleneckPct": stats.get("bottleneckPct"),
            "remakeRate":  stats.get("remakeRate"),
            "dailyAvg":    stats.get("dailyVolume", {}).get("avg"),
            "topCustomer": stats.get("topCustomers", [{}])[0].get("name") if stats.get("topCustomers") else None,
            "topKTV":      stats.get("ktvPerformance", [{}])[0].get("name") if stats.get("ktvPerformance") else None,
        },
        "insights": insights,
    }

    # So sanh voi entry cuoi cung de tao trend
    if data["entries"]:
        prev = data["entries"][-1]
        entry["trend"] = compute_trend(prev["stats"], entry["stats"])
    else:
        entry["trend"] = {}

    data["entries"].append(entry)
    # Chi giu 30 entry gan nhat
    data["entries"] = data["entries"][-30:]
    save_insights(data)
    return entry


def compute_trend(prev, curr):
    """So sanh 2 stats de ra trend."""
    trends = []
    if prev.get("bottleneck") != curr.get("bottleneck"):
        trends.append(f"Nut that chuyen tu {prev.get('bottleneck')} → {curr.get('bottleneck')}")
    bp_prev = prev.get("bottleneckPct") or 0
    bp_curr = curr.get("bottleneckPct") or 0
    if bp_curr < bp_prev - 2:
        trends.append(f"Bottleneck giam {bp_prev}% → {bp_curr}%")
    elif bp_curr > bp_prev + 2:
        trends.append(f"Bottleneck tang {bp_prev}% → {bp_curr}%")
    rr_prev = prev.get("remakeRate", "0%").replace("%","")
    rr_curr = curr.get("remakeRate", "0%").replace("%","")
    try:
        if float(rr_curr) < float(rr_prev) - 0.5:
            trends.append(f"Remake giam {rr_prev}% → {rr_curr}%")
    except Exception:
        pass
    ta_prev = prev.get("totalOrders") or 0
    ta_curr = curr.get("totalOrders") or 0
    if ta_curr != ta_prev:
        trends.append(f"Tong don {ta_prev} → {ta_curr}")
    return trends


def get_insights_summary() -> str:
    """Tra ve string summary cho AI prompt."""
    data = load_insights()
    if not data["entries"]:
        return "(chua co insight timeline)"

    lines = []
    # Entry cuoi
    last = data["entries"][-1]
    lines.append(f"[Insight Timeline] Cap nhat luc: {last['at'][:10]}")
    if last.get("trend"):
        lines.append("  TREND thay doi:")
        for t in last["trend"]:
            lines.append(f"    - {t}")
    # 3 entry gan nhat
    lines.append("  3 lan phan tich gan nhat:")
    for e in data["entries"][-3:]:
        lines.append(f"    - {e['at'][:10]}: don={e['stats'].get('totalOrders')}, "
                     f"bottleneck={e['stats'].get('bottleneck')}({e['stats'].get('bottleneckPct')}%), "
                     f"remake={e['stats'].get('remakeRate')}")
    return "\n".join(lines)


# ── LEARNED FACTS ──────────────────────────────────────────────────────────
def load_facts():
    try:
        with open(FACTS_FP, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"facts": []}


def save_facts(data):
    with open(FACTS_FP, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def add_fact(fact: str, source: str, confidence: str = "medium"):
    """AI goi ham nay de ghi fact moi."""
    data = load_facts()
    now  = datetime.now().isoformat()

    # Kiem tra trung
    for f in data["facts"]:
        if f["fact"] == fact:
            f["lastSeen"] = now
            f["count"]    = f.get("count", 1) + 1
            save_facts(data)
            return

    data["facts"].append({
        "fact":      fact,
        "source":    source,
        "confidence": confidence,
        "firstSeen": now,
        "lastSeen":  now,
        "count":     1,
        "verified":  False,
    })
    data["facts"].sort(key=lambda x: x["count"], reverse=True)
    save_facts(data)


def verify_fact(fact: str):
    """Danh dau fact da duoc xac nhan."""
    data = load_facts()
    for f in data["facts"]:
        if f["fact"] == fact:
            f["verified"] = True
    save_facts(data)


def get_facts_summary() -> str:
    """Tra ve string summary cho AI prompt."""
    data = load_facts()
    if not data["facts"]:
        return "(chua co learned facts)"

    verified   = [f for f in data["facts"] if f.get("verified")]
    unverified = [f for f in data["facts"] if not f.get("verified")]

    lines = ["[Learned Facts]"]
    if verified:
        lines.append(f"  Da xac nhan ({len(verified)}):")
        for f in verified[:5]:
            lines.append(f"    ✓ {f['fact']}")
    if unverified:
        lines.append(f"  Chua xac nhan ({len(unverified)}):")
        for f in unverified[:3]:
            lines.append(f"    ? {f['fact']} (confidence={f.get('confidence','?')})")
    return "\n".join(lines)


# ── SESSION MEMORY ──────────────────────────────────────────────────────────
SESSION_ID = None


def new_session() -> str:
    """Tao session moi, tra ve session_id."""
    global SESSION_ID
    import uuid
    SESSION_ID = uuid.uuid4().hex[:8]
    return SESSION_ID


def save_message(session_id: str, role: str, content: str):
    """Luu 1 tin nhan vao session."""
    data = load_sessions()
    now  = datetime.now().isoformat()

    # Tim hoac tao session
    sess = None
    for s in data["sessions"]:
        if s["id"] == session_id:
            sess = s
            break
    if sess is None:
        sess = {"id": session_id, "created": now, "messages": []}
        data["sessions"].append(sess)

    sess["messages"].append({"role": role, "content": content, "at": now})
    # Chi giu 20 message gan nhat
    sess["messages"] = sess["messages"][-20:]
    # Chi giu 5 session gan nhat
    data["sessions"] = data["sessions"][-5:]
    save_sessions(data)


def load_sessions():
    try:
        with open(SESSIONS_FP, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"sessions": []}


def save_sessions(data):
    with open(SESSIONS_FP, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_session_context(session_id: str) -> str:
    """Tra ve context cho AI prompt tu lich su session."""
    data = load_sessions()
    for sess in data["sessions"]:
        if sess["id"] == session_id:
            msgs = sess["messages"]
            if len(msgs) <= 2:
                return ""
            lines = ["[Session History]"]
            for m in msgs[-6:-1]:  # 5 message gan nhat, tru cau hoi cuoi
                role = "Ban" if m["role"] == "user" else "AI"
                lines.append(f"  {role}: {m['content'][:100]}")
            return "\n".join(lines)
    return ""


def clear_session(session_id: str):
    """Xoa session."""
    data = load_sessions()
    data["sessions"] = [s for s in data["sessions"] if s["id"] != session_id]
    save_sessions(data)
