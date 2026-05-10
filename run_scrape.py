"""
Headless scraper — chạy bởi server.js sau khi admin upload Excel.
Usage: python run_scrape.py <excel_path>
Env vars: LABO_USER1, LABO_PASS1  (tối đa 4 tài khoản: LABO_USER1..4)
"""
import sys, os, queue, threading, subprocess, json
from pathlib import Path

_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0

sys.path.insert(0, str(Path(__file__).parent))
from laboasia_gui_scraper_tkinter import (
    LaboAsiaAPIClient, load_order_ids, build_progress_df,
    save_json, merge_back_to_workbook, DEFAULT_SELECTORS,
    DATA_DIR, CLEAN_DIR, BASE_DIR,
)

BASE_URL      = 'https://laboasia.com.vn/scan'
SHEET_HINTS   = ['Đơn hàng', 'Don hang', 'Sheet1', 'Sheet']
COL_HINTS     = ['Mã ĐH', 'mã_dh', 'ma_dh', 'Mã đơn', 'MaDH', 'ORDER_ID']

def detect_sheet_col(xlsx_path: str):
    """Tự nhận diện tên sheet và cột mã đơn hàng."""
    import pandas as pd
    xl = pd.ExcelFile(xlsx_path)
    sheets = xl.sheet_names

    # Chọn sheet: ưu tiên theo SHEET_HINTS, fallback lấy sheet đầu tiên
    sheet = next((s for s in SHEET_HINTS if s in sheets), sheets[0])

    df = xl.parse(sheet_name=sheet, nrows=1)
    cols = list(df.columns)

    # Chọn cột: so khớp không phân biệt hoa thường / dấu
    def normalize(s):
        return str(s).lower().replace(' ', '').replace('_', '').replace('đ', 'd')

    norm_hints = [normalize(h) for h in COL_HINTS]
    col = next(
        (c for c in cols if normalize(c) in norm_hints),
        cols[0]  # fallback: cột đầu tiên
    )
    log(f'[runner] Sheet: "{sheet}" | Cột mã đơn: "{col}" (trong {cols})')
    return sheet, col

def log(msg):
    print(msg, flush=True)

def get_accounts():
    accounts = []
    for i in range(1, 5):
        u = os.environ.get(f'LABO_USER{i}', '').strip()
        p = os.environ.get(f'LABO_PASS{i}', '').strip()
        if u and p:
            accounts.append((u, p))
    return accounts

def run(excel_path: str):
    p = Path(excel_path)
    log(f'[runner] Bắt đầu cào: {p.name}')

    # 1. Load danh sách đơn hàng
    try:
        sheet, col = detect_sheet_col(str(p))
        order_ids = load_order_ids(str(p), sheet, col)
    except Exception as e:
        log(f'[runner] ERROR load_order_ids: {e}')
        sys.exit(1)
    log(f'[runner] Tổng {len(order_ids)} đơn hàng')

    # 2. Lấy credentials từ env
    if not order_ids:
        log('[runner] Khong co don hang de cao.')
        sys.exit(1)

    accounts = get_accounts()
    if not accounts:
        log('[runner] ERROR: Thiếu credentials. Cần set LABO_USER1 và LABO_PASS1.')
        sys.exit(1)
    n = len(accounts)
    log(f'[runner] {n} worker(s)')

    # 3. Queue mode: worker nao xong 1 don se lay don tiep theo.
    order_q = queue.Queue()
    for ma_dh in order_ids:
        order_q.put(ma_dh)
    active_workers = n
    log(f'[runner] Queue mode: {len(order_ids)} don, {active_workers} worker active')

    # 4. Khởi động workers
    event_q    = queue.Queue()
    all_results, all_failed = [], []
    finished   = [0]
    done_event = threading.Event()

    for i, (username, password) in enumerate(accounts, 1):
        scraper = LaboAsiaAPIClient(
            base_url=BASE_URL,
            username=username,
            password=password,
            selectors=DEFAULT_SELECTORS,
            page_timeout_ms=30_000,
            max_retry_per_order=2,
        )
        t = threading.Thread(
            target=scraper.scrape_order_queue,
            args=(order_q, event_q, f'Worker-{i}'),
            daemon=True,
        )
        t.start()

    # 5. Xử lý events từ workers
    while not (done_event.is_set() and event_q.empty()):
        try:
            ev = event_q.get(timeout=0.5)
        except queue.Empty:
            continue
        etype = ev[0]
        if etype == 'log':
            log(ev[1])
        elif etype == 'order_done':
            _, w, ma, rows, err = ev
            if err:
                log(f'[{w}] FAIL {ma}: {err}')
            else:
                log(f'[{w}] OK {ma}: {rows} công đoạn')
        elif etype == 'worker_finished':
            _, w, results, failed, _ = ev
            all_results.extend(results)
            all_failed.extend(failed)
            finished[0] += 1
            log(f'[{w}] Xong: {len(results)} OK, {len(failed)} thất bại')
            if finished[0] >= active_workers:
                done_event.set()

    if not all_results:
        log('[runner] Không có kết quả, thoát.')
        sys.exit(1)

    # 6. Lưu JSON + scraped xlsx vào Data/
    stem         = p.stem
    scraped_xlsx = str(DATA_DIR / f'{stem}_scraped.xlsx')
    json_out     = str(DATA_DIR / f'{stem}_scraped.json')

    progress_df = build_progress_df(all_results)
    save_json(progress_df, json_out)

    # openpyxl không đọc .xls → convert sang .xlsx trước khi merge
    merge_input = str(p)
    if p.suffix.lower() == '.xls':
        import pandas as pd
        xlsx_tmp = DATA_DIR / f'{stem}.xlsx'
        xl = pd.ExcelFile(str(p))
        with pd.ExcelWriter(str(xlsx_tmp), engine='openpyxl') as writer:
            for sn in xl.sheet_names:
                xl.parse(sheet_name=sn).to_excel(writer, sheet_name=sn, index=False)
        merge_input = str(xlsx_tmp)
        log(f'[runner] Đã convert {p.name} → {xlsx_tmp.name}')

    merge_back_to_workbook(merge_input, scraped_xlsx, progress_df)
    log(f'[runner] Đã lưu: {Path(json_out).name} + {Path(scraped_xlsx).name}')

    # 7. Chạy labo_cleaner → File_sach/*_final.xlsx
    clean_out    = str(CLEAN_DIR / f'{stem}_final.xlsx')
    cleaner_path = BASE_DIR / 'labo_cleaner.py'
    if cleaner_path.exists():
        log(f'[runner] Chạy labo_cleaner → {Path(clean_out).name}')
        r = subprocess.run(
            [sys.executable, str(cleaner_path), scraped_xlsx, clean_out],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
            creationflags=_NO_WINDOW,
        )
        if r.returncode == 0:
            log('[runner] Làm sạch xong!')
        else:
            log(f'[runner] labo_cleaner lỗi (code {r.returncode}): {r.stderr[:300]}')
    else:
        log('[runner] Không tìm thấy labo_cleaner.py, bỏ qua bước làm sạch.')

    # 8. Cập nhật labo_config.json
    cfg_path = BASE_DIR / 'labo_config.json'
    cfg_path.write_text(
        json.dumps({'last_run_file': str(p)}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    # 9. Import vào SQLite rồi xóa file tạm
    try:
        from db_manager import init_db, import_json, import_excel_final
        init_db()
        r_json = import_json(json_out)
        log(f'[runner] DB import JSON: {r_json}')
        if cleaner_path.exists():
            r_xl = import_excel_final(clean_out)
            log(f'[runner] DB import Excel: {r_xl}')
    except Exception as e:
        log(f'[runner] DB import lỗi (không ảnh hưởng scrape): {e}')

    # 10. Xóa file tạm — Data/ và File_sach/ không cần tích lũy nữa
    for tmp in [json_out, scraped_xlsx, clean_out]:
        try:
            Path(tmp).unlink(missing_ok=True)
        except Exception:
            pass
    # Xóa file .xlsx tạm được tạo khi convert .xls
    if p.suffix.lower() == '.xls':
        (DATA_DIR / f'{stem}.xlsx').unlink(missing_ok=True)
    log('[runner] Đã xóa file tạm (Data/, File_sach/)')

    log(f'[runner] HOÀN THÀNH: {len(all_results)} công đoạn, {len(all_failed)} thất bại.')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python run_scrape.py <excel_path>')
        sys.exit(1)
    run(sys.argv[1])
