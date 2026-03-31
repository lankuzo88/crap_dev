#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB - AI Chat: Chatbot local bang llama.cpp (Qwen2.5-1.5B Q4_K_M)
Hoan toan tach biet voi server.js / dashboard.html.
"""
import subprocess, json, sys, os, io, re, tempfile

# Fix Windows console UTF-8
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
LLAMA_BIN = os.path.join(BASE_DIR, "llama_bin", "llama-completion.exe")
MODEL     = os.path.join(BASE_DIR, "models",    "qwen2.5-1.5b-instruct-q4_k_m.gguf")
MEMORY_FP = os.path.join(BASE_DIR, "ai_memory.json")

N_THREADS  = 4
N_CONTEXT  = 1024
MAX_TOKENS = 384


def load_memory() -> dict:
    if not os.path.exists(MEMORY_FP):
        return {}
    try:
        with open(MEMORY_FP, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def build_system_prompt(memory: dict) -> str:
    lstats    = memory.get("learnedStats", {})
    insights  = memory.get("insights", [])
    persona   = memory.get("aiPersona", {})
    spec      = memory.get("specialOrders", {})
    lab       = memory.get("lab", {})

    lines = []
    lines.append("Lab: " + lab.get("name", "ASIA LAB") + " - " + lab.get("description", "Labo Nha Khoa"))

    if spec:
        lines.append("Special orders:")
        for k, v in spec.items():
            lines.append("  - " + k + ": " + v.get("description", ""))

    if lstats:
        lt = lstats.get("avgLeadTime", {})
        lt_str = " | ".join([k + "=" + str(v) + "ng" for k, v in lt.items() if v and v != "---"])
        if lt_str:
            lines.append("Avg lead time: " + lt_str)
        bn = lstats.get("bottleneckStage", "")
        bp = lstats.get("bottleneckPct", 0)
        if bn:
            lines.append("Bottleneck: " + bn + " (" + str(bp) + "% pending)")
        rr = lstats.get("remakeRate", "")
        if rr:
            lines.append("Remake rate: " + rr)
        dv = lstats.get("dailyVolume", {})
        if dv:
            lines.append("Daily volume: avg=" + str(dv.get("avg", 0)) + ", max=" + str(dv.get("max", 0)))
        tc = lstats.get("topCustomers", [])
        if tc:
            tc_str = " | ".join([c["name"] + "=" + str(c["count"]) for c in tc[:3]])
            lines.append("Top customers: " + tc_str)
        kp = lstats.get("ktvPerformance", [])
        if kp:
            kp_str = " | ".join([k["name"] + "=" + str(k["xnCount"]) for k in kp[:3]])
            lines.append("Top KTV: " + kp_str)

    if insights:
        lines.append("Insights:")
        for ins in insights:
            lines.append("  - " + ins)

    role = persona.get("role", "AI Assistant")
    rules = persona.get("rules", [])
    rules_str = " | ".join(rules[:4]) if rules else "Tra loi ngan gon, di kem du lieu cu the."
    lines.append("Role: " + role + " | Rules: " + rules_str)

    body = "\n".join(lines)
    sys_part = (
        "<<SYS>>\n"
        + body
        + "\n\n---\n\n"
        + "You are a Vietnamese-speaking AI assistant.\n"
        + "Always answer in Vietnamese.\n"
        + "Keep responses short (max 200 words).\n"
        + "Include specific data when relevant.\n"
        + "If you do not know, say: Toi khong co thong tin ve dieu nay.\n"
        + "<</SYS>>"
    )
    return sys_part


def build_full_prompt(user_msg: str, memory: dict) -> str:
    sys_p = build_system_prompt(memory)
    return sys_p + "\n\nUser: " + user_msg + "\nAssistant:"


def chat(user_msg: str, verbose: bool = False) -> str:
    if not os.path.exists(LLAMA_BIN):
        return "LOI: Khong tim thay llama-completion.exe tai:\n" + LLAMA_BIN
    if not os.path.exists(MODEL):
        return "LOI: Khong tim thay model tai:\n" + MODEL

    memory      = load_memory()
    full_prompt = build_full_prompt(user_msg, memory)

    if verbose:
        print("[BIN] " + LLAMA_BIN, file=sys.stderr)
        print("[MODEL] " + MODEL, file=sys.stderr)
        print("[PROMPT] " + full_prompt[:200] + "...", file=sys.stderr)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(full_prompt)
            tmp_path = tmp.name

        proc = subprocess.Popen(
            [LLAMA_BIN, "-m", MODEL,
             "-c", str(N_CONTEXT), "-t", str(N_THREADS),
             "-n", str(MAX_TOKENS), "-f", tmp_path],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        out_bytes, _ = proc.communicate(timeout=300)
        out = (out_bytes or b"").decode("utf-8", errors="ignore")

        # Strip ANSI escape codes
        response = re.sub(r"\x1b\[[0-9;]*m", "", out)
        # The file content (prompt) is echoed first, then "User:" and "Assistant:" with response
        # Extract: find last "Assistant:" → take everything after it
        parts = response.split("Assistant:")
        if len(parts) >= 2:
            response = parts[-1].strip()
        else:
            response = response.strip()
        # Remove common artefacts
        response = re.sub(r"^\s*assistant\s*", "", response, flags=re.IGNORECASE).strip()
        response = re.sub(r"^>\s*", "", response).strip()

    except subprocess.TimeoutExpired:
        proc.kill()
        return "LOI: Model phan hoi qua lau (>300s)."
    except Exception as e:
        return "LOI: " + type(e).__name__ + ": " + str(e)
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    return response


def interactive():
    print("=" * 50)
    print("  ASIA LAB AI Chat -- Qwen2.5-1.5B-Instruct Q4")
    print("  Go 'exit'/'quit' de thoat")
    print("=" * 50)
    print()
    memory = load_memory()
    if memory.get("learnedStats"):
        insights_count = len(memory.get("insights", []))
        dr = memory["learnedStats"].get("dataRange", {})
        print("  Da doc learnedStats (" + str(insights_count) + " insights)")
        print("  Data: " + dr.get("from", "?") + " -> " + dr.get("to", "?"))
    else:
        print("  Chua co learnedStats -- chay python ai_stats.py truoc")
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
        print("  AI: " + result)
        print()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
        result = chat(question)
        print(result)
    else:
        interactive()
