#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Analysis & report API endpoints."""
from flask import Blueprint, request, jsonify
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()

analyze_bp = Blueprint("analyze", __name__)


@analyze_bp.route("/analyze/excel", methods=["GET"])
def analyze_excel():
    from sandbox_tools import analyze_excel
    result = analyze_excel(
        file_path=request.args.get("file"),
        all_files=request.args.get("all", "false").lower() == "true",
    )
    return jsonify(result)


@analyze_bp.route("/analyze/ktv", methods=["GET"])
def analyze_ktv():
    from sandbox_tools import analyze_ktv
    return jsonify(analyze_ktv(file_path=request.args.get("file")))


@analyze_bp.route("/analyze/customers", methods=["GET"])
def analyze_customers():
    from sandbox_tools import analyze_customers
    return jsonify(analyze_customers(file_path=request.args.get("file")))


@analyze_bp.route("/analyze/lead_times", methods=["GET"])
def analyze_lead_times():
    from sandbox_tools import analyze_lead_times
    return jsonify(analyze_lead_times(file_path=request.args.get("file")))


@analyze_bp.route("/report/generate", methods=["POST"])
def generate_report():
    from sandbox_tools import generate_report
    body = request.get_json() or {}
    result = generate_report(
        report_type=body.get("report_type", "daily_summary"),
        period=body.get("period", "latest"),
        file_path=body.get("file_path"),
    )
    return jsonify(result)


@analyze_bp.route("/report/list", methods=["GET"])
def list_reports():
    reports_dir = BASE_DIR / "analysis" / "reports"
    if not reports_dir.exists():
        return jsonify({"reports": [], "count": 0})
    reports = sorted(reports_dir.glob("*.txt"), key=lambda p: p.stat().st_mtime, reverse=True)
    return jsonify({
        "reports": [
            {
                "name": p.name,
                "size": p.stat().st_size,
                "modified": p.stat().st_mtime,
            }
            for p in reports[:50]
        ],
        "count": len(reports),
    })


@analyze_bp.route("/report/<path:filename>", methods=["GET"])
def get_report(filename: str):
    from flask import send_file
    fp = (BASE_DIR / "analysis" / "reports" / filename).resolve()
    if not str(fp).startswith(str(BASE_DIR)) or not fp.exists():
        return jsonify({"error": "Not found"}), 404
    return send_file(fp, mimetype="text/plain; charset=utf-8")


@analyze_bp.route("/export/csv", methods=["GET"])
def export_csv():
    from sandbox_tools import export_orders_csv
    result = export_orders_csv(filter_type=request.args.get("filter", "all"))
    return jsonify(result)
