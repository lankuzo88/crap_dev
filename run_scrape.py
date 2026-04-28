"""
Headless scraper — chạy bởi server.js sau khi admin upload Excel.
Usage: python run_scrape.py <excel_path>
Env vars: LABO_USER1, LABO_PASS1  (tối đa 4 tài khoản: LABO_USER1..4)
"""
import sys, os, queue, threading, subprocess, json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from laboasia_gui_scraper_tkinter import (
    LaboAsiaAPIClient, load_order_ids, build_progress_df,
    save_json, merge_back_to_workbook, DEFAULT_SELECTORS,
    DATA_DIR, CLEAN_DIR, BASE_DIR,
)

BASE_URL = 'https://laboasia.com.vn/scan'
SHEET    = 'Đơn hàng'
COL      = 'Mã ĐH'

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
        order_ids = load_order_ids(str(p), SHEET, COL)
    except Exception as e:
        log(f'[runner] ERROR load_order_ids: {e}')
        sys.exit(1)
    log(f'[runner] Tổng {len(order_ids)} đơn hàng')

    # 2. Lấy credentials từ env
    accounts = get_accounts()
    if not accounts:
        log('[runner] ERROR: Thiếu credentials. Cần set LABO_USER1 và LABO_PASS1.')
        sys.exit(1)
    n = len(accounts)
    log(f'[runner] {n} worker(s)')

    # 3. Chia đơn theo số workers
    size   = max(1, (len(order_ids) + n - 1) // n)
    groups = [order_ids[i:i+size] for i in range(0, len(order_ids), size)]
    groups = groups[:n]

    # 4. Khởi động workers
    event_q    = queue.Queue()
    all_results, all_failed = [], []
    finished   = [0]
    done_event = threading.Event()

    for i, ((username, password), group) in enumerate(zip(accounts, groups), 1):
        scraper = LaboAsiaAPIClient(
            base_url=BASE_URL,
            username=username,
            password=password,
            selectors=DEFAULT_SELECTORS,
            page_timeout_ms=30_000,
            max_retry_per_order=2,
        )
        t = threading.Thread(
            target=scraper.scrape_order_list,
            args=(group, event_q, f'Worker-{i}'),
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
            if finished[0] >= n:
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
    merge_back_to_workbook(str(p), scraped_xlsx, progress_df)
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

    log(f'[runner] HOÀN THÀNH: {len(all_results)} công đoạn, {len(all_failed)} thất bại.')

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python run_scrape.py <excel_path>')
        sys.exit(1)
    run(sys.argv[1])
