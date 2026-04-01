#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB AI Cowork Sandbox — MCP Server
Exposes sandbox_tools as MCP tools for Claude Code.

Run: python sandbox_mcp.py
Then add to ~/.claude/settings.json:
  "mcpServers": {
    "sandbox-tools": {
      "command": "python",
      "args": ["C:\\Users\\Administrator\\Desktop\\crap_dev\\ai_workspace\\sandbox_mcp.py"]
    }
  }
"""
import sys, os
from pathlib import Path

# Add parent dir to path so we can import sandbox_modules
BASE_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(BASE_DIR))

from fastmcp import FastMCP

mcp = FastMCP("AsiaLab Sandbox")

# ── Monthly Analysis Tools ────────────────────────────────────────────────────

@mcp.tool()
def analyze_monthly(file_name: str = None) -> str:
    """
    Phan tich chi tiet mot file tu Data_thang/.
    Bao gom: tong don, loai lenh, vat lieu, top KH, top KTV.
    file_name: vd 'Thang_04_2026.xlsx'. Bo trong = file moi nhat.
    """
    from sandbox_tools import analyze_monthly
    result = analyze_monthly(file_name=file_name)
    return _fmt_result(result)


@mcp.tool()
def compare_months(month1: str = "Thang_03_2026.xlsx",
                  month2: str = "Thang_04_2026.xlsx") -> str:
    """
    So sanh 2 thang tu Data_thang/.
    Tra ve: don, rang, loai lenh, vat lieu, top KH thay doi.
    Dung de biet tang truong hay giam giua cac thang.
    """
    from sandbox_tools import compare_months
    result = compare_months(month1=month1, month2=month2)
    return _fmt_result(result)


@mcp.tool()
def read_monthly_excel(file_name: str = None, sheet: str = None) -> str:
    """
    Doc noi dung thô cua file Data_thang/.
    file_name: vd 'Thang_04_2026.xlsx'. Bo trong = file moi nhat.
    sheet: ten sheet tuy chon (vd: 'Đơn hàng').
    """
    from sandbox_tools import read_monthly_excel
    result = read_monthly_excel(file_name=file_name, sheet=sheet)
    return _fmt_result(result)


# ── Analysis Tools ──────────────────────────────────────────────────────────────

@mcp.tool()
def analyze_excel(file_path: str = None, all_files: bool = False) -> str:
    """
    Phan tich Excel tu File_sach/. Doc nhanh: tong don, bottleneck, top KTV, top KH.
    file_path: ten file trong File_sach/ (vd: 'Thang_04_2026.xlsx')
    all_files: True = phan tich nhieu file nhat moi
    """
    from sandbox_tools import analyze_excel
    result = analyze_excel(file_path=file_path, all_files=all_files)
    return _fmt_result(result)


@mcp.tool()
def analyze_ktv(file_path: str = None) -> str:
    """Xep hang KTV theo so don da xac nhan. Tra ve top KTV nhieu don nhat."""
    from sandbox_tools import analyze_ktv
    result = analyze_ktv(file_path=file_path)
    return _fmt_result(result)


@mcp.tool()
def analyze_customers(file_path: str = None) -> str:
    """Xep hang khach hang theo so don. Tra ve top KH nhieu don nhat."""
    from sandbox_tools import analyze_customers
    result = analyze_customers(file_path=file_path)
    return _fmt_result(result)


@mcp.tool()
def analyze_lead_times(file_path: str = None) -> str:
    """Phan tich thoi gian trung binh moi cong doan. Phat hien don qua han."""
    from sandbox_tools import analyze_lead_times
    result = analyze_lead_times(file_path=file_path)
    return _fmt_result(result)


# ── Report Tools ───────────────────────────────────────────────────────────────

@mcp.tool()
def generate_report(report_type: str = "daily_summary",
                    period: str = "latest",
                    file_path: str = None) -> str:
    """
    Tao bao cao va luu vao ai_workspace/analysis/reports/.
    report_type: daily_summary | ktv_report | customer_report | lead_time_report
    """
    from sandbox_tools import generate_report
    result = generate_report(report_type=report_type, period=period, file_path=file_path)
    return _fmt_result(result)


# ── Memory & Task Tools ───────────────────────────────────────────────────────

@mcp.tool()
def add_learned_fact(fact: str, source: str = "claude_code",
                     confidence: str = "medium",
                     tags: str = "") -> str:
    """
    Ghi nho mot fact moi. AI tu dong goi khi phat hien pattern moi.
    fact: noi dung fact (vd: 'SG-Nk Hai Nguyen danh dau 40 don/thang')
    confidence: high | medium | low
    """
    from sandbox_tools import add_learned_fact
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    result = add_learned_fact(fact, source=source, confidence=confidence, tags=tag_list)
    return _fmt_result(result)


@mcp.tool()
def save_task(description: str, project_id: str = "default",
              priority: str = "medium") -> str:
    """
    Tao mot task theo doi. Dung de nho AI lam gi do sau.
    priority: high | medium | low
    """
    from sandbox_tools import save_task
    result = save_task(project_id=project_id, description=description, priority=priority)
    return _fmt_result(result)


@mcp.tool()
def list_tasks(project_id: str = None, status: str = None) -> str:
    """Liet ke tat ca tasks. Loc theo project_id hoac status (pending/done)."""
    from sandbox_tools import list_tasks
    result = list_tasks(project_id=project_id, status=status)
    return _fmt_result(result)


@mcp.tool()
def save_project(name: str, description: str = "", tags: str = "") -> str:
    """Tao mot du an moi de nhom cong viec."""
    from sandbox_tools import save_project
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    result = save_project(name=name, description=description, tags=tag_list)
    return _fmt_result(result)


@mcp.tool()
def list_projects(active_only: bool = True) -> str:
    """Liet ke tat ca du an. active_only=True = chi du an dang hoat dong."""
    from sandbox_tools import list_projects
    result = list_projects(active_only=active_only)
    return _fmt_result(result)


# ── Lab State ─────────────────────────────────────────────────────────────────

@mcp.tool()
def get_lab_state() -> str:
    """Lay trang thai hien tai cua lab: knowledge summary, latest excel, loaded_at."""
    from sandbox_tools import get_lab_state
    result = get_lab_state()
    return _fmt_result(result)


# ── System Tools ──────────────────────────────────────────────────────────────

@mcp.tool()
def get_status() -> str:
    """Lay trang thai sandbox: uptime, sessions, tasks, reports count."""
    from sandbox_tools import get_status
    result = get_status()
    return _fmt_result(result)


@mcp.tool()
def get_logs(limit: int = 20) -> str:
    """Doc log hoat dong gan nhat. limit: so dong (mac dinh 20)."""
    from sandbox_tools import get_logs
    result = get_logs(limit=limit)
    return _fmt_result(result)


# ── File Tools ────────────────────────────────────────────────────────────────

@mcp.tool()
def read_file(path: str) -> str:
    """Doc noi dung file text trong ai_workspace/. path: vd 'logs/activity.log'"""
    from sandbox_tools import read_file
    return read_file(path)


@mcp.tool()
def list_dir(path: str = ".") -> str:
    """Liet ke file va thu muc trong ai_workspace/. path mac dinh = '.'"""
    from sandbox_tools import list_dir
    result = list_dir(path=path)
    return _fmt_result(result)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_result(result: dict) -> str:
    """Format tool result for display."""
    import json
    if isinstance(result, str):
        return result
    if result.get("ok") and "preview" in result:
        return result["preview"]
    return json.dumps(result, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    # Run as STDIO server (default)
    mcp.run()
