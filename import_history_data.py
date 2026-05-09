"""
Import historical data from CSV files into labo_data.db
Merge orders info + progress data
"""

import pandas as pd
import sqlite3
from pathlib import Path
import re
from datetime import datetime
import unicodedata

# Paths
BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "labo_data.db"
ORDERS_CSV = "C:/Users/Administrator/Desktop/te/merged_output.csv"
PROGRESS_CSV = "C:/Users/Administrator/Desktop/data-train/ktv_scheduler/data/merged_output_bang.csv"

def parse_phuc_hinh_type(text):
    """Parse loại phục hình từ text"""
    if not text or pd.isna(text):
        return 'kl'

    text_lower = text.lower()
    text_ascii = ''.join(
        ch for ch in unicodedata.normalize('NFD', text_lower)
        if unicodedata.category(ch) != 'Mn'
    ).replace('đ', 'd')

    zirconia_keywords = ['zircornia', 'zirconia', 'ziconia', 'zir-', 'zolid', 'cercon', 'la va', 'full zirconia', 'argen']
    metal_keywords = ['kim loai', 'titanium', 'titan', 'chrome', 'cobalt']

    # Hỗn hợp (cùi giả zirconia)
    if 'cùi giả zirconia' in text_lower or 'cui gia zirconia' in text_ascii:
        return 'hon'

    # Veneer phân nhóm theo vật liệu phía sau.
    if 'veneer' in text_lower:
        if any(kw in text_lower or kw in text_ascii for kw in zirconia_keywords):
            return 'zirc'
        if any(kw in text_lower or kw in text_ascii for kw in metal_keywords):
            return 'kl'
        return 'vnr'

    # Mặt dán không ghi vật liệu rõ thì giữ nhóm mặt dán.
    if 'mặt dán' in text_lower or 'mat dan' in text_ascii:
        return 'vnr'

    # Zirconia
    if any(kw in text_lower or kw in text_ascii for kw in zirconia_keywords):
        return 'zirc'

    # Kim loại (default)
    return 'kl'

def parse_so_luong(text):
    """Parse số lượng răng từ raw_row_text"""
    if not text or pd.isna(text):
        return None

    match = re.search(r'SL:\s*(\d+)', text, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None

def parse_loai_lenh(text):
    """Parse loại lệnh từ raw_row_text"""
    if not text or pd.isna(text):
        return 'Làm mới'

    text_lower = text.lower()

    if 'làm thêm' in text_lower or 'lam them' in text_lower:
        return 'Làm thêm'
    elif 'sửa' in text_lower or 'sua' in text_lower:
        return 'Sửa'
    elif 'làm lại' in text_lower or 'lam lai' in text_lower:
        return 'Làm lại'
    elif 'bảo hành' in text_lower or 'bao hanh' in text_lower:
        return 'Bảo hành'
    elif 'làm tiếp' in text_lower or 'lam tiep' in text_lower:
        return 'Làm tiếp'
    elif 'thử sườn' in text_lower or 'thu suon' in text_lower:
        return 'Thử sườn'

    return 'Làm mới'

def convert_datetime(date_str):
    """Convert DD/MM/YYYY HH:MM:SS to YYYY-MM-DD HH:MM:SS"""
    if not date_str or pd.isna(date_str):
        return None

    try:
        # Parse DD/MM/YYYY HH:MM:SS
        dt = datetime.strptime(str(date_str), '%d/%m/%Y %H:%M:%S')
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except:
        return None

def main():
    print("=" * 60)
    print("IMPORT HISTORICAL DATA TO DATABASE")
    print("=" * 60)

    # 1. Read CSV files
    print("\n[1/5] Reading CSV files...")
    orders_df = pd.read_csv(ORDERS_CSV)
    progress_df = pd.read_csv(PROGRESS_CSV)

    print(f"  Orders: {len(orders_df)} rows")
    print(f"  Progress: {len(progress_df)} rows")

    # 2. Merge data
    print("\n[2/5] Merging data...")
    merged_df = progress_df.merge(
        orders_df,
        left_on='ma_dh',
        right_on='So don hang',
        how='left'
    )

    print(f"  Merged: {len(merged_df)} rows")
    print(f"  Missing orders info: {merged_df['Ten nha khoa'].isna().sum()}")

    # 3. Parse and enrich data
    print("\n[3/5] Parsing and enriching data...")

    # Parse loại phục hình
    merged_df['loai_phuc_hinh_parsed'] = merged_df['raw_row_text'].apply(parse_phuc_hinh_type)

    # Parse số lượng (fallback to So luong column)
    merged_df['so_luong_parsed'] = merged_df.apply(
        lambda row: row['So luong'] if pd.notna(row.get('So luong')) else parse_so_luong(row['raw_row_text']),
        axis=1
    )

    # Parse loại lệnh (fallback to Loai phuc hinh column)
    merged_df['loai_lenh_parsed'] = merged_df.apply(
        lambda row: row['Loai phuc hinh'] if pd.notna(row.get('Loai phuc hinh')) else parse_loai_lenh(row['raw_row_text']),
        axis=1
    )

    # Convert datetime
    merged_df['thoi_gian_hoan_thanh_iso'] = merged_df['thoi_gian_hoan_thanh'].apply(convert_datetime)

    print(f"  Parsed loai phuc hinh: {merged_df['loai_phuc_hinh_parsed'].notna().sum()}")
    print(f"  Parsed so luong: {merged_df['so_luong_parsed'].notna().sum()}")
    print(f"  Parsed loai lenh: {merged_df['loai_lenh_parsed'].notna().sum()}")

    # 4. Connect to database
    print("\n[4/5] Connecting to database...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tien_do_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ma_dh TEXT,
        thu_tu INTEGER,
        cong_doan TEXT,
        ten_ktv TEXT,
        xac_nhan TEXT,
        thoi_gian_hoan_thanh TEXT,

        -- Thông tin đơn hàng
        ngay_nhan TEXT,
        ma_kh TEXT,
        ten_nha_khoa TEXT,
        bac_si TEXT,
        benh_nhan TEXT,
        phuc_hinh TEXT,
        so_luong INTEGER,
        loai_lenh TEXT,
        loai_phuc_hinh TEXT,

        -- Metadata
        tai_khoan_cao TEXT,
        raw_row_text TEXT,
        imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        UNIQUE(ma_dh, thu_tu, cong_doan, thoi_gian_hoan_thanh)
    )
    """)

    print("  Table 'tien_do_history' ready")

    # 5. Insert data
    print("\n[5/5] Inserting data...")

    inserted = 0
    skipped = 0

    for idx, row in merged_df.iterrows():
        try:
            cursor.execute("""
            INSERT OR IGNORE INTO tien_do_history (
                ma_dh, thu_tu, cong_doan, ten_ktv, xac_nhan, thoi_gian_hoan_thanh,
                ngay_nhan, ma_kh, ten_nha_khoa, bac_si, benh_nhan, phuc_hinh,
                so_luong, loai_lenh, loai_phuc_hinh, tai_khoan_cao, raw_row_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row['ma_dh'],
                row['thu_tu'],
                row['cong_doan'],
                row['ten_ktv'] if pd.notna(row['ten_ktv']) else '',
                row['xac_nhan'] if pd.notna(row['xac_nhan']) else 'Chưa',
                row['thoi_gian_hoan_thanh_iso'],
                row.get('Ngay nhan'),
                row.get('Ma KH'),
                row.get('Ten nha khoa'),
                row.get('Bac si'),
                row.get('Benh nhan'),
                row.get('Phuc hinh'),
                int(row['so_luong_parsed']) if pd.notna(row['so_luong_parsed']) else None,
                row['loai_lenh_parsed'],
                row['loai_phuc_hinh_parsed'],
                row['tai_khoan_cao'],
                row['raw_row_text']
            ))

            if cursor.rowcount > 0:
                inserted += 1
            else:
                skipped += 1

        except Exception as e:
            print(f"  Error at row {idx}: {e}")
            skipped += 1

        if (idx + 1) % 1000 == 0:
            print(f"  Progress: {idx + 1}/{len(merged_df)} rows...")
            conn.commit()

    conn.commit()

    # Stats
    total_records = cursor.execute("SELECT COUNT(*) FROM tien_do_history").fetchone()[0]
    unique_orders = cursor.execute("SELECT COUNT(DISTINCT ma_dh) FROM tien_do_history").fetchone()[0]
    unique_ktv = cursor.execute("SELECT COUNT(DISTINCT ten_ktv) FROM tien_do_history WHERE ten_ktv != ''").fetchone()[0]

    conn.close()

    print("\n" + "=" * 60)
    print("IMPORT COMPLETED!")
    print("=" * 60)
    print(f"  Inserted: {inserted}")
    print(f"  Skipped (duplicates): {skipped}")
    print(f"  Total records in DB: {total_records}")
    print(f"  Unique orders: {unique_orders}")
    print(f"  Unique KTV: {unique_ktv}")
    print("=" * 60)

if __name__ == "__main__":
    main()
