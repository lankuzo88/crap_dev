const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'labo_data.db');
const db = new Database(DB_PATH);

const STAGE_NAMES = ['CBM', 'SÁP/Cadcam', 'SƯỜN', 'ĐẮP', 'MÀI'];

function getSkipStages(lk, gc) {
  const skip = [];
  if (['Sửa', 'Làm lại', 'Làm tiếp', 'Bảo hành'].includes(lk)) skip.push(0, 1, 2);
  return skip;
}

// Get all orders (no active filter for testing)
const rows = db.prepare(`
  SELECT d.ma_dh, d.nhap_luc, d.yc_hoan_thanh, d.yc_giao,
         d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
         d.loai_lenh, d.ghi_chu, d.trang_thai, d.tai_khoan_cao,
         GROUP_CONCAT(
           t.thu_tu || '|' || t.cong_doan || '|' || COALESCE(t.ten_ktv, '') || '|' ||
           COALESCE(t.xac_nhan, 'Chưa') || '|' || COALESCE(t.thoi_gian_hoan_thanh, ''),
           ';;'
         ) AS stages_raw
  FROM don_hang d
  LEFT JOIN tien_do t ON t.ma_dh = d.ma_dh
  GROUP BY d.ma_dh
  ORDER BY d.yc_giao ASC, d.nhap_luc ASC
`).all();

console.log(`Total orders: ${rows.length}`);

// Parse stages for each order
let tuanOrders = 0;
let tuanOrdersWithKtv = 0;

for (const row of rows) {
  const stagesMap = {};
  for (const part of (row.stages_raw || '').split(';;')) {
    const p = part.split('|');
    if (p.length >= 5) {
      const thu_tu = parseInt(p[0]);
      if (!isNaN(thu_tu)) {
        stagesMap[thu_tu] = { n: p[1], k: p[2], x: p[3] === 'Có', t: p[4] };
      }
    }
  }

  const stages = STAGE_NAMES.map((name, i) => {
    const s = stagesMap[i + 1] || { n: name, k: '', x: false, t: '' };
    return { n: name, k: s.k, x: s.x, t: s.t, sk: getSkipStages(row.loai_lenh || '', row.ghi_chu || '').includes(i) };
  });

  // Check if Tuan is in this order
  const hasTuan = stages.some(s => s.k.includes('Tuấn'));
  if (hasTuan) {
    tuanOrders++;
    // Check if Tuan is shown (has xac_nhan = Có)
    const tuanStage = stages.find(s => s.k.includes('Tuấn'));
    if (tuanStage && tuanStage.x) {
      tuanOrdersWithKtv++;
    }
  }
}

console.log(`Orders with Tuấn: ${tuanOrders}`);
console.log(`Orders with Tuấn showing correctly: ${tuanOrdersWithKtv}`);

// Show first 3 Tuan orders
console.log('\n=== Sample Tuan Orders ===');
let count = 0;
for (const row of rows) {
  const stagesMap = {};
  for (const part of (row.stages_raw || '').split(';;')) {
    const p = part.split('|');
    if (p.length >= 5) {
      const thu_tu = parseInt(p[0]);
      if (!isNaN(thu_tu)) {
        stagesMap[thu_tu] = { n: p[1], k: p[2], x: p[3] === 'Có', t: p[4] };
      }
    }
  }

  const stages = STAGE_NAMES.map((name, i) => {
    const s = stagesMap[i + 1] || { n: name, k: '', x: false, t: '' };
    return { n: name, k: s.k, x: s.x, t: s.t, sk: getSkipStages(row.loai_lenh || '', row.ghi_chu || '').includes(i) };
  });

  const hasTuan = stages.some(s => s.k.includes('Tuấn'));
  if (hasTuan) {
    const tuanStage = stages.find(s => s.k.includes('Tuấn'));
    console.log(`${row.ma_dh}: Stage=${tuanStage.n}, KTV=${tuanStage.k}, XacNhan=${tuanStage.x}, Time=${tuanStage.t}`);
    count++;
    if (count >= 3) break;
  }
}

db.close();
