const db = require('better-sqlite3')('./labo_data.db');

// Get all unique cong_doan values
const congDoans = db.prepare(`SELECT DISTINCT cong_doan FROM tien_do ORDER BY cong_doan`).all();
console.log('Available cong_doan values:');
congDoans.forEach(row => {
  const cnt = db.prepare(`SELECT COUNT(*) as cnt FROM tien_do WHERE cong_doan=?`).get(row.cong_doan);
  console.log(`  "${row.cong_doan}": ${cnt.cnt} records`);
});

// Check pending orders by cong_doan
console.log('\nPending orders by cong_doan:');
const pending = db.prepare(`
  SELECT cong_doan, COUNT(*) as cnt 
  FROM tien_do 
  WHERE xac_nhan IS NULL OR xac_nhan != 'Có'
  GROUP BY cong_doan
`).all();

pending.forEach(row => {
  console.log(`  "${row.cong_doan}": ${row.cnt} pending`);
});

// Sample: get first 3 pending orders with their details
console.log('\nFirst 3 pending orders:');
const sample = db.prepare(`
  SELECT d.ma_dh, d.khach_hang, d.benh_nhan, t.cong_doan, t.ten_ktv, t.xac_nhan
  FROM tien_do t
  JOIN don_hang d ON t.ma_dh = d.ma_dh
  WHERE t.xac_nhan IS NULL OR t.xac_nhan != 'Có'
  LIMIT 3
`).all();

sample.forEach(o => {
  console.log(`  ${o.ma_dh} | cong_doan="${o.cong_doan}" | xac_nhan="${o.xac_nhan}"`);
});
