#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB AI Cowork Sandbox — Lab Knowledge Builder
Doc parent dir: ai_memory.json, ai_knowledge.json, ai_instructions.txt, File_sach/
Tra ve dict chua toan bo lab context cho AI prompt.
"""
import os, json
from datetime import datetime
from pathlib import Path

# Parent dir = crap_dev/
_BASE_DIR = Path(__file__).parent.parent.resolve()

MEMORY_FP   = _BASE_DIR / "ai_memory.json"
KNOWLEDGE_FP = _BASE_DIR / "ai_knowledge.json"
INSTRUCTIONS_FP = _BASE_DIR / "ai_instructions.txt"
STATS_SCRIPT = _BASE_DIR / "ai_stats.py"
FILE_SACH_DIR = _BASE_DIR / "File_sach"
DATA_DIR      = _BASE_DIR / "Data"


def get_parent_dir() -> str:
    return str(_BASE_DIR)


def load_json(fp: Path, default: dict = None) -> dict:
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default or {}


def load_text(fp: Path) -> str:
    try:
        with open(fp, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def refresh_knowledge(state: dict = None) -> dict:
    """Load/reload shared lab data. Goi lai khi /reload."""
    knowledge    = load_json(KNOWLEDGE_FP)
    memory      = load_json(MEMORY_FP)
    instructions = load_text(INSTRUCTIONS_FP)

    # Tim file Excel moi nhat trong File_sach
    excel_files = sorted(
        FILE_SACH_DIR.glob("*.xlsx"),
        key=lambda p: p.stat().st_mtime,
        reverse=True
    )
    # Tim file JSON moi nhat trong Data/
    json_files = sorted(
        DATA_DIR.glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True
    )

    new_state = state or {}
    new_state.update({
        "knowledge":     knowledge,
        "memory":        memory,
        "instructions":  instructions,
        "loaded_at":     datetime.now().isoformat(),
        "latest_excel":  excel_files[0].name if excel_files else None,
        "latest_json":   json_files[0].name  if json_files else None,
        "excel_count":   len(excel_files),
    })
    return new_state


def build_lab_context(state: dict) -> str:
    """Assemble full lab context string cho AI prompt."""
    parts = []
    instructions = state.get("instructions", "")
    knowledge    = state.get("knowledge", {})
    memory       = state.get("memory", {})
    ls           = memory.get("learnedStats", {})

    # 1. Shared identity
    if instructions:
        parts.append("=== SHARED AI IDENTITY ===")
        parts.append(instructions)
        parts.append("")

    # 2. Lab knowledge
    if knowledge:
        parts.append("=== LAB KNOWLEDGE ===")
        lab = knowledge.get("lab", {})
        parts.append(f"Lab: {lab.get('name','ASIA LAB')} — {lab.get('type','')}")
        stages = lab.get("stages", [])
        parts.append(f"5 Cong doan: {', '.join(stages)}")

        sd = lab.get("stage_descriptions", {})
        for s in stages:
            d = sd.get(s, "")
            if d:
                parts.append(f"  {s}: {d}")

        mats = knowledge.get("materials", {})
        if mats:
            parts.append("\nVat lieu:")
            for m, v in mats.items():
                parts.append(f"  {m}: {v.get('time','?')} | keywords: {', '.join(v.get('keywords',[])[:5])}")

        ktvs = knowledge.get("ktvs", [])
        if ktvs:
            parts.append(f"\nKTVs ({len(ktvs)} nguoi): {', '.join(ktvs[:15])}...")

        sos = knowledge.get("special_orders", {})
        if sos:
            parts.append("\nDon dac biet:")
            for k, v in sos.items():
                parts.append(f"  {k}: skip={v.get('skip',[])} only={v.get('only',[])} | {v.get('note','')}")

    # 3. Learned stats
    if ls:
        parts.append("")
        parts.append("=== LEARNED STATS (from ai_memory.json) ===")
        dr = ls.get("dataRange", {})
        lt = ls.get("avgLeadTime", {})
        lt_txt = " | ".join([f"{k}={v}" for k, v in lt.items() if v and v != "—"])

        tc = ls.get("topCustomers", [])[:3]
        tc_txt = " | ".join([f"{c['name']}={c['count']}don" for c in tc])

        kp = ls.get("ktvPerformance", [])[:3]
        kp_txt = " | ".join([f"{k['name']}={k['xnCount']}don" for k in kp])

        dv = ls.get("dailyVolume", {})
        dv_txt = f"TB={dv.get('avg','?')}/ngay Max={dv.get('max','?')} Min={dv.get('min','?')}"

        parts.append(f"Data: {dr.get('from','?')} → {dr.get('to','?')}")
        parts.append(f"Tong don: {ls.get('totalOrdersAnalyzed','?')} | Tong rang: {ls.get('totalTeeth','?')}")
        parts.append(f"Lead time: {lt_txt or '?'}")
        parts.append(f"Nut that: {ls.get('bottleneckStage','?')} ({ls.get('bottleneckPct','?')}% don chua xong)")
        parts.append(f"Remake: {ls.get('remakeRate','?')} ({ls.get('remakeCount','?')} don)")
        parts.append(f"Daily vol: {dv_txt}")
        parts.append(f"Top KH: {tc_txt or '?'}")
        parts.append(f"Top KTV: {kp_txt or '?'}")

    # 4. Recent insights
    insights = memory.get("insights", [])
    if insights:
        parts.append("")
        parts.append("=== INSIGHTS TIMELINE ===")
        for ins in insights[-3:]:
            parts.append(f"  - {str(ins)[:120]}")

    # 5. Latest data files
    parts.append("")
    parts.append(f"=== DATA FILES ===")
    parts.append(f"Latest Excel: {state.get('latest_excel','?')} ({state.get('excel_count',0)} files in File_sach/)")
    parts.append(f"Latest JSON: {state.get('latest_json','?')}")
    parts.append(f"Loaded at: {state.get('loaded_at','?')}")

    return "\n".join(parts)
