#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASIA LAB - AI Stats: Phan tich du lieu thang tu Data_thang/*.xlsx
Cap nhat ai_memory.json voi learnedStats + insights.
"""
import os, sys, json, io, glob, re
from datetime import datetime
from collections import defaultdict
from pathlib import Path

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR  = Path(__file__).parent.resolve()
DATA_DIR  = BASE_DIR / "Data_thang"
MEMORY_FP = BASE_DIR / "ai_memory.json"

STAGE_ORDER = ["CBM", "SÁP/Cadcam", "SƯỜN", "ĐẮP", "MÀI"]


def str_(v):
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return str(int(v)) if float(v) == int(v) else str(v)
    return str(v).strip()


def parse_excel_date(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, (int, float)):
        try:
            from openpyxl.utils.datetime import from_excel
            return from_excel(val)
        except Exception:
            return None
    s = str(val).strip()
    if not s or s in ("-", "None", "nan"):
        return None
    for fmt in [
        "%d/%m/%Y %H:%M:%S", "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M",   "%Y-%m-%d %H:%M",
        "%d/%m/%Y",         "%Y-%m-%d",
    ]:
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            pass
    return None


def days_between(d1, d2):
    if d1 and d2:
        return (d2 - d1).total_seconds() / 86400.0
    return None


LOAI_LINH    = ["Làm mới", "Làm lại", "Sửa", "Bảo hành", "Làm tiếp"]
REMAKE_LOAI  = {"Làm lại", "Sửa"}


def normalize_loai_lenh(s):
    s = s or ""
    for l in LOAI_LINH:
        if l.lower() in s.lower():
            return l
    return "Khác"


def detect_material(text):
    t = text.lower()
    keywords = {
        "Zirconia":    ["zircornia","ziconia","cercon","diamond","zirconia","zolid","zr","HT"],
        "Titanium":    ["titanium","ti "],
        "Kim loại":    ["kim loại","thường","mão kim loại"],
        "Veneer":      ["veneer","laminate","cut back","mặt dán"],
        "Temp/PMMA":   ["tạm","temporary","pmma"],
    }
    for mat, kws in keywords.items():
        if any(kw in t for kw in kws):
            return mat
    return "Khác"


def read_tien_do(ws):
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    h = [str_(v) for v in rows[0]]
    idx = {name: i for i, name in enumerate(h)}
    def gi(name):
        return idx.get(name, -1)
    records = []
    for row in rows[1:]:
        ma = str_(row[gi("Mã ĐH")])
        if not ma or ma == "Mã ĐH":
            continue
        tt_raw = row[gi("TT")]
        try:
            tt = int(float(tt_raw)) if tt_raw is not None else None
        except Exception:
            tt = None
        records.append({
            "ma_dh":     ma,
            "tt":        tt,
            "cong_doan": str_(row[gi("Công đoạn")]),
            "ktv":       str_(row[gi("KTV")]),
            "xac_nhan":  str_(row[gi("Xác nhận")]),
            "tg_ht":     parse_excel_date(row[gi("Thời gian HT")]),
            "phuc_hinh": str_(row[gi("Phục hình")]),
            "sl":        int(float(row[gi("SL")])) if row[gi("SL")] is not None else 0,
            "loai_lenh": str_(row[gi("Loại lệnh")]),
        })
    return records


def read_don_hang(ws):
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {}
    h = [str_(v) for v in rows[0]]
    idx = {name: i for i, name in enumerate(h)}
    def gi(name):
        return idx.get(name, -1)
    orders = {}
    for row in rows[1:]:
        ma = str_(row[gi("Mã ĐH")])
        if not ma or ma == "Mã ĐH":
            continue
        orders[ma] = {
            "khach_hang": str_(row[gi("Khách hàng")]),
            "benh_nhan":  str_(row[gi("Bệnh nhân")]),
            "phuc_hinh":  str_(row[gi("Phục hình")]),
            "sl":         int(float(row[gi("SL")])) if row[gi("SL")] is not None else 0,
            "ngay_nhan":  parse_excel_date(row[gi("Nhận lúc")]),
        }
    return orders


def analyze_monthly_files(data_dir):
    all_td_records = []
    all_orders     = {}
    all_files      = []

    for fp in sorted(data_dir.glob("Thang_*.xlsx")):
        all_files.append(fp.name)
        try:
            import openpyxl
            wb = openpyxl.load_workbook(fp, data_only=True, read_only=True)
        except Exception as e:
            print(f"  ! Loi doc {fp.name}: {e}")
            continue

        don_sheet      = None
        tien_do_sheet  = None
        for shname in wb.sheetnames:
            l = shname.lower()
            if "đơn hàng" in l or "don hang" in l:
                don_sheet = shname
            if "tiến độ" in l or "tien do" in l:
                tien_do_sheet = shname

        if don_sheet:
            orders = read_don_hang(wb[don_sheet])
            for ma, o in orders.items():
                if ma not in all_orders:
                    all_orders[ma] = o

        if tien_do_sheet:
            records = read_tien_do(wb[tien_do_sheet])
            all_td_records.extend(records)

        wb.close()

    print(f"  Da doc {len(all_files)} file(s): {', '.join(all_files)}")
    print(f"  Tong don: {len(all_orders)} | Tong dong tien do: {len(all_td_records)}")

    # Dedup tien do
    td_map = {}
    for rec in all_td_records:
        key = (rec["ma_dh"], rec["cong_doan"])
        existing = td_map.get(key)
        if existing is None:
            td_map[key] = rec
        elif rec["tg_ht"] and (existing["tg_ht"] is None or rec["tg_ht"] > existing["tg_ht"]):
            td_map[key] = rec

    by_order = defaultdict(list)
    for rec in td_map.values():
        by_order[rec["ma_dh"]].append(rec)
    for ma in by_order:
        by_order[ma].sort(key=lambda r: (
            r["tt"] if r["tt"] is not None
            else STAGE_ORDER.index(r["cong_doan"]) + 1
            if r["cong_doan"] in STAGE_ORDER else 99
        ))

    # Lead time
    lead_times = {s: [] for s in STAGE_ORDER}
    for ma, recs in by_order.items():
        confirmed = [r for r in recs if r["xac_nhan"] == "Có"]
        for i in range(1, len(confirmed)):
            prev, curr = confirmed[i-1], confirmed[i]
            if prev["tg_ht"] and curr["tg_ht"]:
                days = days_between(prev["tg_ht"], curr["tg_ht"])
                if days is not None and 0 <= days <= 30:
                    cd = curr["cong_doan"]
                    if cd in STAGE_ORDER:
                        lead_times[cd].append(days)
                    elif "sáp" in cd.lower() or "cadcam" in cd.lower():
                        lead_times["SÁP/Cadcam"].append(days)

    avg_lead_time = {}
    for s, vals in lead_times.items():
        avg_lead_time[s] = round(sum(vals)/len(vals), 2) if vals else None

    # Bottleneck
    stage_done  = {s: 0 for s in STAGE_ORDER}
    stage_total = {s: 0 for s in STAGE_ORDER}
    for ma, recs in by_order.items():
        confirmed_cd = {r["cong_doan"]: True for r in recs if r["xac_nhan"] == "Có"}
        for s in STAGE_ORDER:
            stage_total[s] += 1
            if s in confirmed_cd:
                stage_done[s] += 1
    bottleneck_scores = {}
    for s in STAGE_ORDER:
        total = stage_total[s]
        if total > 0:
            pending = total - stage_done[s]
            bottleneck_scores[s] = pending / total
        else:
            bottleneck_scores[s] = 0
    bottleneck_stage = max(bottleneck_scores, key=bottleneck_scores.get)
    bottleneck_pct  = round(bottleneck_scores[bottleneck_stage] * 100, 1)

    # KTV throughput
    ktv_xn     = defaultdict(int)
    ktv_teeth  = defaultdict(int)
    ktv_orders = defaultdict(set)
    for rec in td_map.values():
        if rec["xac_nhan"] == "Có" and rec["ktv"]:
            ktv = rec["ktv"].strip()
            if ktv and ktv != "-":
                ktv_xn[ktv]     += 1
                ktv_teeth[ktv]  += rec["sl"]
                ktv_orders[ktv].add(rec["ma_dh"])
    ktv_perf = sorted(
        [{"name": k, "xnCount": ktv_xn[k], "totalSL": ktv_teeth[k], "orderCount": len(ktv_orders[k])}
         for k in ktv_xn],
        key=lambda x: x["xnCount"], reverse=True
    )[:20]

    # Material
    mat_count = defaultdict(int)
    for o in all_orders.values():
        mat_count[detect_material(o["phuc_hinh"])] += 1
    top_materials = [m for m, _ in sorted(mat_count.items(), key=lambda x: -x[1])]

    # Remake rate
    total_orders = len(all_orders)
    unique_ma_remake = set()
    for rec in td_map.values():
        ll = normalize_loai_lenh(rec["loai_lenh"])
        if ll in REMAKE_LOAI:
            unique_ma_remake.add(rec["ma_dh"])
    remake_rate_pct = round(len(unique_ma_remake) / total_orders * 100, 1) if total_orders else 0

    # Top customers
    kh_count = defaultdict(int)
    for o in all_orders.values():
        kh = o["khach_hang"]
        if kh:
            kh_count[kh] += 1
    top_customers = [
        {"name": k, "count": v}
        for k, v in sorted(kh_count.items(), key=lambda x: -x[1])[:10]
    ]

    # Daily volume
    daily_counts = defaultdict(int)
    for o in all_orders.values():
        if o["ngay_nhan"]:
            day = o["ngay_nhan"].strftime("%Y-%m-%d")
            daily_counts[day] += 1
    if daily_counts:
        vals = list(daily_counts.values())
        daily_vol = {"avg": round(sum(vals)/len(vals), 1), "max": max(vals),
                     "min": min(vals), "days": len(vals)}
    else:
        daily_vol = {"avg": 0, "max": 0, "min": 0, "days": 0}

    # Completion by type
    completion_by_type = {}
    for loai in LOAI_LINH:
        all_of_type  = set()
        done_of_type = set()
        for ma, recs in by_order.items():
            has_loai = any(normalize_loai_lenh(r["loai_lenh"]) == loai for r in recs)
            if has_loai:
                all_of_type.add(ma)
                if any(r["cong_doan"] == "MÀI" and r["xac_nhan"] == "Có" for r in recs):
                    done_of_type.add(ma)
        if all_of_type:
            completion_by_type[loai] = f"{round(len(done_of_type)/len(all_of_type)*100, 0):.0f}%"
        else:
            completion_by_type[loai] = "—"

    # Data range
    all_dates = [o["ngay_nhan"] for o in all_orders.values() if o["ngay_nhan"]]
    if all_dates:
        data_from = min(all_dates).strftime("%Y-%m-%d")
        data_to   = max(all_dates).strftime("%Y-%m-%d")
    else:
        data_from = data_to = ""

    total_teeth = sum(o["sl"] for o in all_orders.values())

    return {
        "avgLeadTime":           {s: (f"{v:.1f}" if v else "—") for s, v in avg_lead_time.items()},
        "bottleneckStage":       bottleneck_stage,
        "bottleneckPct":         bottleneck_pct,
        "remakeRate":            f"{remake_rate_pct}%",
        "remakeCount":           len(unique_ma_remake),
        "dailyVolume":           daily_vol,
        "topMaterials":          top_materials,
        "topCustomers":         top_customers,
        "ktvPerformance":       ktv_perf,
        "completionRateByType": completion_by_type,
        "dataRange":             {"from": data_from, "to": data_to},
        "totalOrdersAnalyzed":   total_orders,
        "totalTeeth":            total_teeth,
        "_debug_files":          all_files,
    }


def generate_insights(stats):
    insights = []
    bs = stats.get("bottleneckStage", "")
    bp = stats.get("bottleneckPct", 0)
    lt = stats.get("avgLeadTime", {})
    if bs and bp:
        insights.append(
            f"Nut that: {bs} chiếm {bp}% đơn chưa xác nhận. "
            f"(Stage co ti le cho cao nhat: {bs} {bp}%)"
        )
    rr = stats.get("remakeRate", "0%")
    rc = stats.get("remakeCount", 0)
    insights.append(f"Ty le remake: {rr} ({rc} don) — chu yeu tu 'Lam lai' va 'Sua'.")
    tc = stats.get("topCustomers", [])
    if tc:
        insights.append(f"Top KH: {tc[0]['name']} voi {tc[0]['count']} don/thang.")
    kp = stats.get("ktvPerformance", [])
    if kp:
        insights.append(
            f"KTV nang suat nhat: {kp[0]['name']} voi "
            f"{kp[0]['xnCount']} don, {kp[0]['totalSL']} rang."
        )
    dv = stats.get("dailyVolume", {})
    if dv.get("avg"):
        insights.append(
            f"TB {dv['avg']} don/ngay (max {dv['max']}, min {dv['min']} / {dv.get('days', 0)} ngay)."
        )
    return insights


def learn():
    print("=" * 50)
    print("  ASIA LAB AI Stats - Phan tich thang")
    print("=" * 50)

    if not DATA_DIR.exists():
        print(f"! Thu muc Data_thang khong ton tai: {DATA_DIR}")
        return

    print(f"\nDang phan tich: {DATA_DIR}")
    stats = analyze_monthly_files(DATA_DIR)

    print(f"\n  Tong don: {stats['totalOrdersAnalyzed']}")
    print(f"  Tong rang: {stats['totalTeeth']}")
    print(f"  Du lieu: {stats['dataRange']['from']} -> {stats['dataRange']['to']}")
    print(f"\n  Lead time TB:")
    for s, v in stats["avgLeadTime"].items():
        print(f"     {s:12s}: {v} ngay")
    print(f"\n  Nut that: {stats['bottleneckStage']} ({stats['bottleneckPct']}% don chua xong)")
    print(f"  Remake rate: {stats['remakeRate']} ({stats['remakeCount']} don)")
    print(f"\n  Top KH:")
    for c in stats["topCustomers"][:3]:
        print(f"     {c['name']}: {c['count']} don")
    print(f"\n  Top KTV:")
    for k in stats["ktvPerformance"][:3]:
        print(f"     {k['name']}: {k['xnCount']} don, {k['totalSL']} rang")

    insights = generate_insights(stats)
    print(f"\n  Insights:")
    for i, ins in enumerate(insights, 1):
        print(f"     {i}. {ins}")

    # Update memory
    if MEMORY_FP.exists():
        with open(MEMORY_FP, "r", encoding="utf-8") as f:
            memory = json.load(f)
    else:
        memory = {"version": "2.0", "updated": ""}

    memory["learnedStats"] = stats
    memory["insights"]     = insights
    memory["learnedAt"]    = datetime.now().isoformat()

    for key in ["lab","stages","stageGroups","specialOrders","deadline",
                "materials","ktvs","dataFields","typicalStats",
                "morningBriefing","aiPersona","learnedFacts"]:
        if key not in memory:
            memory[key] = {}

    with open(MEMORY_FP, "w", encoding="utf-8") as f:
        json.dump(memory, f, ensure_ascii=False, indent=2)

    print(f"\n  Da cap nhat: {MEMORY_FP}")
    print("=" * 50)


# ── WATCH MODE ───────────────────────────────────────────────────────────────
def watch():
    """
    Theo doi Data_thang/ — khi co file .xlsx thay doi,
    tu dong chay learn() de cap nhat ai_memory.json.
    """
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler

    class ExcelChangeHandler(FileSystemEventHandler):
        def __init__(self, debounce_sec=5):
            self.debounce_sec = debounce_sec
            self.last_run = 0
            self.pending  = False

        def on_modified(self, event):
            if event.is_directory:
                return
            if not event.src_path.lower().endswith(".xlsx"):
                return
            now = datetime.now().timestamp()
            if now - self.last_run < self.debounce_sec:
                return
            self.last_run = now
            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Phat hien thay doi: {event.src_path}")
            print("  -> Chay phan tich...")
            learn()

        def on_created(self, event):
            if event.is_directory:
                return
            if not event.src_path.lower().endswith(".xlsx"):
                return
            now = datetime.now().timestamp()
            if now - self.last_run < self.debounce_sec:
                return
            self.last_run = now
            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] File moi: {event.src_path}")
            print("  -> Chay phan tich...")
            learn()

    if not DATA_DIR.exists():
        print(f"! Thu muc khong ton tai: {DATA_DIR}")
        return

    print("=" * 50)
    print("  AI Stats Watcher - Tu dong cap nhat khi file Excel thay doi")
    print("=" * 50)
    print(f"\n  Theo doi: {DATA_DIR}")
    print(f"  Debounce: 5 giay")
    print(f"\n  Nhan Ctrl+C de dung.\n")

    handler  = ExcelChangeHandler(debounce_sec=5)
    observer = Observer()
    observer.schedule(handler, str(DATA_DIR), recursive=False)
    observer.start()

    print(f"  [Dang theo doi...]")
    try:
        while True:
            import time
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n  Dung watcher.")
        observer.stop()
    observer.join()


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--watch":
        watch()
    else:
        learn()

