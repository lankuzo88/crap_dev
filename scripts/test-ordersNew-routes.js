'use strict';
/**
 * End-to-end HTTP test cho ordersNew.routes.js.
 * - Start express trên port 3099 với test DB tạm
 * - Stub session middleware: req.session.user = 'admin' (bypass auth)
 * - Test: list, get, create đơn, create phụ lục, reject 400/403/404
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const Database = require('better-sqlite3');
const express = require('express');

const TMP = path.join(__dirname, '..', '.tmp-test-routes.db');
if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
const db = new Database(TMP);

// Minimal don_hang để repo cross-table query không lỗi
db.exec(`CREATE TABLE don_hang (id INTEGER PRIMARY KEY, ma_dh TEXT UNIQUE, ma_dh_goc TEXT, so_phu INTEGER, la_don_phu INTEGER DEFAULT 0)`);

// Apply orders_new + stages_new từ migration
const migSrc = fs.readFileSync(path.join(__dirname, '..', 'src/db/migrations.js'), 'utf8');
const sqlBlock = migSrc.match(/function initOrdersNewTables[\s\S]*?db\.exec\(`([\s\S]*?)`\)/)[1];
db.exec(sqlBlock);

// Shim getDB before requiring routes
require.cache[require.resolve('../src/db/index')] = {
  exports: { getDB: () => db, dbHasData: () => true, closeDB: () => {} },
};

// Shim middleware/auth: bypass requireAuth/requirePermission, simulate user
const sessionState = { user: 'admin', role: 'admin', hasPerm: true };
require.cache[require.resolve('../src/middleware/auth')] = {
  exports: {
    requireAuth: (req, _res, next) => { req.session = { user: sessionState.user, role: sessionState.role }; next(); },
    requireAdmin: (req, _res, next) => { req.session = { user: sessionState.user, role: sessionState.role }; next(); },
    requirePermission: (perm) => (req, res, next) => {
      if (!sessionState.hasPerm) return res.status(403).json({ ok: false, error: 'Permission denied', permission: perm });
      req.session = { user: sessionState.user, role: sessionState.role };
      next();
    },
  },
};

const app = express();
app.use(express.json());
app.use('/', require('../src/routes/ordersNew.routes'));

const PORT = 3099;
const server = app.listen(PORT, '127.0.0.1');

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port: PORT, path: p, method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: buf ? JSON.parse(buf) : null }); }
        catch (e) { resolve({ status: res.statusCode, raw: buf, parseErr: e.message }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); cleanup(); process.exit(1); }
}
function cleanup() {
  server.close();
  db.close();
  if (fs.existsSync(TMP)) fs.unlinkSync(TMP);
}

(async () => {
  try {
    // Seed: KeyLab order
    const today = (() => {
      const d = new Date();
      const YY = String(d.getFullYear() % 100).padStart(2, '0');
      const DD = String(d.getDate()).padStart(2, '0');
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      return `${YY}${DD}${MM}`;
    })();
    db.prepare(`INSERT INTO don_hang (ma_dh, ma_dh_goc, la_don_phu) VALUES (?, ?, 0)`).run(`${today}029`, `${today}029`);

    // 1. List trống
    let r = await request('GET', '/api/orders-new');
    assert(r.status === 200, `GET list status: ${r.status}`);
    assert(r.json.ok && r.json.count === 0, `expected empty list, got ${JSON.stringify(r.json)}`);
    console.log(`✓ GET /api/orders-new (empty): ${r.json.count}`);

    // 2. POST tạo đơn — valid
    r = await request('POST', '/api/orders-new', {
      khach_hang: 'NK HTTP Test', benh_nhan: 'BN H1',
      phuc_hinh: 'Răng sứ Zircornia (R:11-13, - SL: 3)', sl: 3,
      loai_lenh: 'Làm mới', yc_giao: '04/06/2026 17:30', ghi_chu: 'Test HTTP',
    });
    assert(r.status === 201, `POST create status: ${r.status} body=${JSON.stringify(r.json)}`);
    assert(r.json.ma_dh === `${today}500`, `expected ${today}500, got ${r.json.ma_dh}`);
    assert(r.json.order && r.json.stages?.length === 5, 'response missing order+stages');
    const ma1 = r.json.ma_dh;
    console.log(`✓ POST /api/orders-new → ${ma1} (with 5 stages)`);

    // 3. GET single
    r = await request('GET', `/api/orders-new/${ma1}`);
    assert(r.status === 200 && r.json.order?.khach_hang === 'NK HTTP Test', 'GET single failed');
    console.log(`✓ GET /api/orders-new/${ma1}`);

    // 4. POST phụ lục cho đơn dashboard
    r = await request('POST', `/api/orders-new/${ma1}/phu-luc`, {
      khach_hang: 'NK HTTP Test', benh_nhan: 'BN H1',
      phuc_hinh: 'Răng sứ Zircornia (R:11, - SL: 1)', sl: 1,
      loai_lenh: 'Sửa', ghi_chu: 'Sửa fit',
    });
    assert(r.status === 201, `POST phụ lục status: ${r.status} body=${JSON.stringify(r.json)}`);
    assert(r.json.ma_dh === `${ma1}-1` && r.json.so_phu === 1, `phụ lục: ${JSON.stringify(r.json)}`);
    console.log(`✓ POST /api/orders-new/${ma1}/phu-luc → ${r.json.ma_dh}`);

    // 5. POST phụ lục cho đơn KeyLab (cross-table)
    r = await request('POST', `/api/orders-new/${today}029/phu-luc`, {
      khach_hang: 'NK KL', benh_nhan: 'BN KL',
      phuc_hinh: 'Răng sứ kim loại', sl: 2, loai_lenh: 'Bảo hành',
    });
    assert(r.status === 201, `phụ lục KeyLab status: ${r.status}`);
    assert(r.json.ma_dh === `${today}029-1`, `expected ${today}029-1, got ${r.json.ma_dh}`);
    console.log(`✓ POST phụ lục cho đơn KeyLab → ${r.json.ma_dh}`);

    // 6. POST validation: thiếu khach_hang → 400
    r = await request('POST', '/api/orders-new', { phuc_hinh: 'X', sl: 1, loai_lenh: 'Làm mới' });
    assert(r.status === 400 && r.json.error.includes('khach_hang'), `expected 400 khach_hang, got ${r.status} ${JSON.stringify(r.json)}`);
    console.log(`✓ POST validation: thiếu khach_hang → 400`);

    // 7. POST validation: loai_lenh sai → 400
    r = await request('POST', '/api/orders-new', {
      khach_hang: 'X', phuc_hinh: 'Y', sl: 1, loai_lenh: 'BậyBạ',
    });
    assert(r.status === 400 && r.json.error.includes('loai_lenh'), `expected 400 loai_lenh, got ${r.status}`);
    console.log(`✓ POST validation: loai_lenh sai → 400`);

    // 8. POST validation: sl <= 0 → 400
    r = await request('POST', '/api/orders-new', {
      khach_hang: 'X', phuc_hinh: 'Y', sl: 0, loai_lenh: 'Làm mới',
    });
    assert(r.status === 400 && r.json.error.includes('sl'), `expected 400 sl, got ${r.status}`);
    console.log(`✓ POST validation: sl <= 0 → 400`);

    // 9. POST phụ lục với ma_dh_goc không tồn tại → 404
    r = await request('POST', '/api/orders-new/999888777/phu-luc', {
      khach_hang: 'X', phuc_hinh: 'Y', sl: 1, loai_lenh: 'Sửa',
    });
    assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.json)}`);
    console.log(`✓ POST phụ lục với ma_dh_goc lạ → 404`);

    // 10. GET single với ma_dh không tồn tại → 404
    r = await request('GET', '/api/orders-new/999888777');
    assert(r.status === 404, `expected 404, got ${r.status}`);
    console.log(`✓ GET /api/orders-new/999888777 → 404`);

    // 11. Permission denied → 403
    sessionState.hasPerm = false;
    r = await request('POST', '/api/orders-new', {
      khach_hang: 'X', phuc_hinh: 'Y', sl: 1, loai_lenh: 'Làm mới',
    });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    console.log(`✓ POST không có quyền → 403`);

    // 12. List sau khi tạo
    sessionState.hasPerm = true;
    r = await request('GET', '/api/orders-new');
    assert(r.json.count === 3, `expected 3 orders (1 parent + 2 phụ lục), got ${r.json.count}`);
    r = await request('GET', '/api/orders-new?la_don_phu=0');
    assert(r.json.count === 1, `parents only: expected 1, got ${r.json.count}`);
    r = await request('GET', '/api/orders-new?la_don_phu=1');
    assert(r.json.count === 2, `phụ lục only: expected 2, got ${r.json.count}`);
    console.log(`✓ GET list filters`);

    // 13. PATCH sửa metadata
    r = await request('PATCH', `/api/orders-new/${ma1}`, {
      khach_hang: 'NK Đã sửa', benh_nhan: 'BN Mới', sl: 7, ghi_chu: 'PATCH ok',
    });
    assert(r.status === 200, `PATCH status: ${r.status} ${JSON.stringify(r.json)}`);
    assert(r.json.order.khach_hang === 'NK Đã sửa', `khach_hang: ${r.json.order.khach_hang}`);
    assert(r.json.order.sl === 7, `sl: ${r.json.order.sl}`);
    assert(r.json.order.edited_by === 'admin', `edited_by: ${r.json.order.edited_by}`);
    console.log(`✓ PATCH /api/orders-new/${ma1} → cập nhật metadata`);

    // 14. PATCH bỏ qua field không cho phép
    r = await request('PATCH', `/api/orders-new/${ma1}`, {
      khach_hang: 'NK A', ma_dh: 'HACK', source: 'evil', created_by: 'attacker',
    });
    assert(r.status === 200, `PATCH should accept mixed payload, got ${r.status}`);
    assert(r.json.order.ma_dh === ma1, `ma_dh changed: ${r.json.order.ma_dh}`);
    assert(r.json.order.source === 'dashboard', `source changed: ${r.json.order.source}`);
    console.log(`✓ PATCH bỏ qua identity/audit fields`);

    // 15. PATCH chỉ với forbidden fields → 400
    r = await request('PATCH', `/api/orders-new/${ma1}`, { ma_dh: 'X', source: 'X' });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    console.log(`✓ PATCH chỉ field cấm → 400`);

    // 16. PATCH loai_lenh sai → 400
    r = await request('PATCH', `/api/orders-new/${ma1}`, { loai_lenh: 'BậyBạ' });
    assert(r.status === 400, `expected 400 loai_lenh, got ${r.status}`);
    console.log(`✓ PATCH loai_lenh sai → 400`);

    // 17. PATCH sl <= 0 → 400
    r = await request('PATCH', `/api/orders-new/${ma1}`, { sl: 0 });
    assert(r.status === 400 && r.json.error.includes('sl'), `expected 400 sl, got ${r.status}`);
    console.log(`✓ PATCH sl <= 0 → 400`);

    // 18. PATCH ma_dh không tồn tại → 404
    r = await request('PATCH', '/api/orders-new/999888777', { ghi_chu: 'x' });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    console.log(`✓ PATCH ma_dh lạ → 404`);

    // 19. PATCH không có quyền → 403
    sessionState.hasPerm = false;
    r = await request('PATCH', `/api/orders-new/${ma1}`, { ghi_chu: 'denied' });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    sessionState.hasPerm = true;
    console.log(`✓ PATCH không có quyền → 403`);

    cleanup();
    console.log('\nALL HTTP TESTS PASSED');
  } catch (e) {
    console.error('UNEXPECTED ERROR:', e);
    cleanup();
    process.exit(1);
  }
})();
