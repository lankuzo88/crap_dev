const db = require('better-sqlite3')('./labo_data.db');

// Check cong_doan='sáp' in tien_do
const result1 = db.prepare(`SELECT COUNT(*) as cnt FROM tien_do WHERE cong_doan='sáp'`).get();
console.log('Total tien_do with cong_doan=sáp:', result1.cnt);

// Check pending orders (xac_nhan NULL or != 'Có')
const result2 = db.prepare(`
  SELECT COUNT(*) as cnt FROM tien_do 
  WHERE cong_doan='sáp' AND (xac_nhan IS NULL OR xac_nhan != 'Có')
`).get();
console.log('Pending (xac_nhan NULL or != Có):', result2.cnt);

// Get actual pending orders with details
const orders = db.prepare(`
  SELECT DISTINCT d.ma_dh, d.khach_hang, d.benh_nhan, d.phuc_hinh, d.sl,
         t.cong_doan, t.ten_ktv, t.xac_nhan, t.thoi_gian_hoan_thanh
  FROM tien_do t
  JOIN don_hang d ON t.ma_dh = d.ma_dh
  WHERE t.cong_doan='sáp' AND (t.xac_nhan IS NULL OR t.xac_nhan != 'Có')
  ORDER BY d.nhap_luc DESC
  LIMIT 5
`).all();

console.log('\nPending orders:');
orders.forEach(o => {
  console.log(`  ${o.ma_dh} | ${o.khach_hang} | ${o.benh_nhan} | KTV: ${o.ten_ktv} | xac_nhan: ${o.xac_nhan}`);
});
