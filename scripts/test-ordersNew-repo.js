'use strict';
/**
 * Standalone test cho ordersNew.repo.js.
 * - Tạo DB tạm có schema don_hang + orders_new + stages_new
 * - Seed 1 đơn KeyLab giả ở STT 029 để verify dashboard issue 500+ (không đụng)
 * - Test: createOrder, issueMaDh increment, createPhuLuc, getOrder, listOrders,
 *         createPhuLuc cho ma_dh_goc của đơn KeyLab (cross-table reference)
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const TMP = path.join(__dirname, '..', '.tmp-test-orders.db');
if (fs.existsSync(TMP)) fs.unlinkSync(TMP);

const db = new Database(TMP);

// Minimal don_hang schema (chỉ field repo dùng để check uniqueness/exists)
db.exec(`
  CREATE TABLE don_hang (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ma_dh TEXT NOT NULL UNIQUE,
    ma_dh_goc TEXT NOT NULL,
    so_phu INTEGER,
    la_don_phu INTEGER DEFAULT 0,
    nguon_file TEXT DEFAULT ''
  );
`);

// Inject getDB shim BEFORE require()
require.cache[require.resolve('../src/db/index')] = {
  exports: { getDB: () => db, dbHasData: () => true },
};

// Apply orders_new + stages_new schema từ migration
const migSrc = fs.readFileSync(path.join(__dirname, '..', 'src/db/migrations.js'), 'utf8');
const initBody = migSrc.match(/function initOrdersNewTables\(\)\s*\{[\s\S]*?\n\}/)[0];
const sqlMatch = initBody.match(/db\.exec\(`([\s\S]*?)`\)/);
db.exec(sqlMatch[1]);

const repo = require('../src/repositories/ordersNew.repo');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

// Seed: KeyLab đã có đơn STT 029 hôm nay → dashboard phải issue 500
const prefix = repo.todayMaPrefix();
db.prepare(`INSERT INTO don_hang (ma_dh, ma_dh_goc, la_don_phu) VALUES (?, ?, 0)`).run(`${prefix}029`, `${prefix}029`);
console.log(`Seed: don_hang has ${prefix}029`);

// 1. Tạo đơn mới — phải ra ma_dh = prefix + 500
const ma1 = repo.createOrder(db, {
  khach_hang: 'NK Test 1', benh_nhan: 'BN A',
  phuc_hinh: 'Răng sứ Zircornia (R:11-13, - SL: 3)', sl: 3,
  loai_lenh: 'Làm mới', yc_giao: '04/06/2026 17:30',
}, 'admin');
assert(ma1 === `${prefix}500`, `createOrder: expected ${prefix}500, got ${ma1}`);
console.log(`✓ createOrder: ${ma1} (STT 500 reserved)`);

// 2. Tạo đơn thứ 2 — phải +1 = 501
const ma2 = repo.createOrder(db, {
  khach_hang: 'NK Test 2', benh_nhan: 'BN B',
  phuc_hinh: 'Mặt dán sứ', sl: 6, loai_lenh: 'Làm mới',
}, 'admin');
assert(ma2 === `${prefix}501`, `createOrder #2: expected ${prefix}501, got ${ma2}`);
console.log(`✓ createOrder increment: ${ma2}`);

// 3. getOrder + verify stages
const fetched = repo.getOrder(db, ma1);
assert(fetched, 'getOrder returned null');
assert(fetched.order.khach_hang === 'NK Test 1', 'khach_hang mismatch');
assert(fetched.order.source === 'dashboard', 'source not dashboard');
assert(fetched.stages.length === 5, `expected 5 stages, got ${fetched.stages.length}`);
assert(fetched.stages[0].cong_doan === 'CBM', `stage[0] ${fetched.stages[0].cong_doan}`);
assert(fetched.stages[4].cong_doan === 'MÀI', `stage[4] ${fetched.stages[4].cong_doan}`);
console.log(`✓ getOrder + 5 stages auto-created (CBM → MÀI)`);

// 4. Phụ lục cho đơn dashboard
const phuLuc1 = repo.createPhuLuc(db, ma1, {
  khach_hang: 'NK Test 1', benh_nhan: 'BN A',
  phuc_hinh: 'Răng sứ Zircornia (R:11, - SL: 1)', sl: 1,
  loai_lenh: 'Sửa', ghi_chu: 'Sửa fit răng 11',
}, 'admin');
assert(phuLuc1.ma_dh === `${ma1}-1`, `phụ lục ma_dh: expected ${ma1}-1, got ${phuLuc1.ma_dh}`);
assert(phuLuc1.so_phu === 1, `so_phu: expected 1, got ${phuLuc1.so_phu}`);
console.log(`✓ createPhuLuc cho đơn dashboard: ${phuLuc1.ma_dh}`);

// 5. Phụ lục #2 cho cùng đơn → so_phu = 2
const phuLuc2 = repo.createPhuLuc(db, ma1, {
  khach_hang: 'NK Test 1', benh_nhan: 'BN A',
  phuc_hinh: 'Răng sứ Zircornia', sl: 1, loai_lenh: 'Bảo hành',
}, 'admin');
assert(phuLuc2.so_phu === 2, `phụ lục 2 so_phu: expected 2, got ${phuLuc2.so_phu}`);
console.log(`✓ createPhuLuc tăng so_phu: ${phuLuc2.ma_dh}`);

// 6. Phụ lục cho đơn KeyLab (cross-table reference)
const keylabMa = `${prefix}029`;
const phuLucKL = repo.createPhuLuc(db, keylabMa, {
  khach_hang: 'NK KeyLab', benh_nhan: 'BN KL',
  phuc_hinh: 'Răng sứ kim loại', sl: 2, loai_lenh: 'Sửa',
}, 'admin');
assert(phuLucKL.ma_dh === `${keylabMa}-1`, `phụ lục KeyLab: ${phuLucKL.ma_dh}`);
console.log(`✓ createPhuLuc cho đơn KeyLab: ${phuLucKL.ma_dh}`);

// 7. listOrders filter
const allOrders = repo.listOrders(db);
assert(allOrders.length === 5, `listOrders total: expected 5, got ${allOrders.length}`);
const onlyParents = repo.listOrders(db, { la_don_phu: 0 });
assert(onlyParents.length === 2, `parents only: expected 2, got ${onlyParents.length}`);
const onlyPhuLuc = repo.listOrders(db, { la_don_phu: 1 });
assert(onlyPhuLuc.length === 3, `phụ lục only: expected 3, got ${onlyPhuLuc.length}`);
console.log(`✓ listOrders filters: total=${allOrders.length}, parents=${onlyParents.length}, phụ lục=${onlyPhuLuc.length}`);

// 8. Reject ma_dh_goc không tồn tại
let caught = false;
try { repo.createPhuLuc(db, '999999999', { sl: 1, loai_lenh: 'Sửa' }, 'admin'); }
catch (e) { caught = e.message.includes('không tồn tại'); }
assert(caught, 'should reject unknown ma_dh_goc');
console.log(`✓ createPhuLuc reject unknown ma_dh_goc`);

// 9. Reject missing createdBy
caught = false;
try { repo.createOrder(db, { khach_hang: 'X' }, ''); }
catch (e) { caught = e.message.includes('createdBy required'); }
assert(caught, 'should reject missing createdBy');
console.log(`✓ createOrder reject missing createdBy`);

db.close();
fs.unlinkSync(TMP);
console.log('\nALL TESTS PASSED');
