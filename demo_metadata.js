/**
 * DEMO: Hybrid metadata approach cho ASIA LAB
 * Chạy: node demo_metadata.js
 */

const Database = require('better-sqlite3');
const db = new Database(':memory:'); // In-memory demo

// ═══════════════════════════════════════════════════════
// 1. TẠO BẢNG VỚI METADATA
// ═══════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE don_hang (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ma_dh TEXT NOT NULL UNIQUE,
    ma_dh_goc TEXT,

    -- Core fields (query thường xuyên)
    khach_hang TEXT,
    benh_nhan TEXT,
    phuc_hinh TEXT,
    sl INTEGER DEFAULT 1,
    loai_lenh TEXT,
    trang_thai TEXT DEFAULT 'Mới',
    yc_giao TEXT,

    -- Metadata (linh hoạt)
    metadata TEXT DEFAULT '{}',  -- SQLite dùng TEXT cho JSON

    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Index cho metadata (SQLite 3.38+ hỗ trợ JSON)
  CREATE INDEX idx_metadata ON don_hang(json_extract(metadata, '$.gia_tri_don'));
`);

console.log('✅ Đã tạo bảng don_hang với metadata\n');

// ═══════════════════════════════════════════════════════
// 2. THÊM ĐƠN HÀNG VỚI METADATA
// ═══════════════════════════════════════════════════════

const insertOrder = db.prepare(`
  INSERT INTO don_hang (ma_dh, ma_dh_goc, khach_hang, benh_nhan, phuc_hinh, sl, loai_lenh, yc_giao, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Đơn 1: Đơn thường, metadata đơn giản
insertOrder.run(
  '262403054',
  '262403054',
  'SG-Nk Hưng Phú',
  'Quyên',
  'Zirconia',
  3,
  'Mới',
  '03/05/2024',
  JSON.stringify({
    mau_rang: 'A2',
    loai_vat_lieu: 'Zirconia HT',
    gia_tri_don: 2500000,
    ghi_chu_noi_bo: 'Khách VIP'
  })
);

// Đơn 2: Đơn có bảo hiểm, metadata phức tạp
insertOrder.run(
  '262403055',
  '262403055',
  'SG-Nk Linh Dental',
  'Nguyễn Văn B',
  'Kim loại',
  5,
  'Mới',
  '05/05/2024',
  JSON.stringify({
    mau_rang: 'B3',
    loai_vat_lieu: 'Kim loại Ni-Cr',
    gia_tri_don: 1800000,
    ma_bao_hiem: 'BH-2024-001',
    ty_le_bao_hiem: 70,
    bac_si: 'BS. Trần Thị C',
    vi_tri_rang: ['36', '37', '46', '47', '48'],
    yeu_cau_dac_biet: {
      uu_tien: 'cao',
      giao_truoc: '2024-05-04',
      lien_he_truoc_khi_giao: true,
      so_dien_thoai_lien_he: '0901234567'
    }
  })
);

// Đơn 3: Đơn sửa chữa, có lịch sử
insertOrder.run(
  '262403056',
  '262403056',
  'AG-Nk Nguyễn Gia',
  'Lê Thị D',
  'Mặt dán Veneer',
  2,
  'Sửa',
  '02/05/2024',
  JSON.stringify({
    mau_rang: 'A1',
    loai_vat_lieu: 'Emax',
    gia_tri_don: 3500000,
    don_goc: '262303020',
    ly_do_sua: 'Màu không đúng',
    lich_su_sua_chua: [
      {
        ngay: '2024-04-28',
        van_de: 'Màu sáng hơn yêu cầu',
        xu_ly: 'Làm lại với màu A1',
        nguoi_xu_ly: 'KTV Minh'
      }
    ],
    mien_phi: true,
    ghi_chu_noi_bo: 'Đơn bảo hành, không tính tiền'
  })
);

// Đơn 4: Đơn tích hợp ERP (giả lập tương lai)
insertOrder.run(
  '262403057',
  '262403057',
  'HN-Nk Smile Care',
  'Phạm Văn E',
  'Implant Crown',
  1,
  'Mới',
  '10/05/2024',
  JSON.stringify({
    mau_rang: 'A2',
    loai_vat_lieu: 'Zirconia Multilayer',
    gia_tri_don: 8500000,

    // Tích hợp ERP
    erp_order_id: 'ERP-2024-00123',
    erp_customer_id: 'CUST-00456',
    erp_invoice_id: 'INV-2024-00789',

    // Tích hợp CRM
    crm_contact_id: 'CRM-CONTACT-123',
    crm_deal_id: 'CRM-DEAL-456',

    // Thông tin implant
    implant_info: {
      hang_implant: 'Straumann',
      ma_implant: 'BLT-4.1x10',
      vi_tri: '26',
      ngay_cay_implant: '2024-03-15',
      bac_si_cay: 'BS. Nguyễn Văn F'
    },

    // Custom fields của phòng khám này
    custom_fields: {
      patient_insurance_provider: 'Bảo Việt',
      patient_member_id: 'BV-123456',
      referral_source: 'Facebook Ads',
      marketing_campaign: 'Implant-Q2-2024'
    }
  })
);

console.log('✅ Đã thêm 4 đơn hàng với metadata khác nhau\n');

// ═══════════════════════════════════════════════════════
// 3. QUERY VÍ DỤ
// ═══════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════');
console.log('📊 VÍ DỤ QUERY VỚI METADATA');
console.log('═══════════════════════════════════════════════════════\n');

// Query 1: Tìm đơn có giá trị > 3 triệu
console.log('1️⃣  Đơn hàng có giá trị > 3 triệu:');
const highValueOrders = db.prepare(`
  SELECT ma_dh, khach_hang, benh_nhan,
         json_extract(metadata, '$.gia_tri_don') as gia_tri
  FROM don_hang
  WHERE CAST(json_extract(metadata, '$.gia_tri_don') AS INTEGER) > 3000000
`).all();
console.table(highValueOrders);

// Query 2: Tìm đơn có bảo hiểm
console.log('\n2️⃣  Đơn hàng có bảo hiểm:');
const insuranceOrders = db.prepare(`
  SELECT ma_dh, benh_nhan,
         json_extract(metadata, '$.ma_bao_hiem') as ma_bh,
         json_extract(metadata, '$.ty_le_bao_hiem') as ty_le
  FROM don_hang
  WHERE json_extract(metadata, '$.ma_bao_hiem') IS NOT NULL
`).all();
console.table(insuranceOrders);

// Query 3: Tìm đơn ưu tiên cao
console.log('\n3️⃣  Đơn hàng ưu tiên cao:');
const urgentOrders = db.prepare(`
  SELECT ma_dh, benh_nhan, yc_giao,
         json_extract(metadata, '$.yeu_cau_dac_biet.uu_tien') as uu_tien,
         json_extract(metadata, '$.yeu_cau_dac_biet.giao_truoc') as giao_truoc
  FROM don_hang
  WHERE json_extract(metadata, '$.yeu_cau_dac_biet.uu_tien') = 'cao'
`).all();
console.table(urgentOrders);

// Query 4: Tìm đơn miễn phí (bảo hành)
console.log('\n4️⃣  Đơn hàng miễn phí (bảo hành):');
const freeOrders = db.prepare(`
  SELECT ma_dh, benh_nhan, loai_lenh,
         json_extract(metadata, '$.ly_do_sua') as ly_do,
         json_extract(metadata, '$.don_goc') as don_goc
  FROM don_hang
  WHERE json_extract(metadata, '$.mien_phi') = 1
`).all();
console.table(freeOrders);

// Query 5: Tìm đơn có tích hợp ERP
console.log('\n5️⃣  Đơn hàng tích hợp ERP:');
const erpOrders = db.prepare(`
  SELECT ma_dh, benh_nhan,
         json_extract(metadata, '$.erp_order_id') as erp_id,
         json_extract(metadata, '$.erp_invoice_id') as invoice_id
  FROM don_hang
  WHERE json_extract(metadata, '$.erp_order_id') IS NOT NULL
`).all();
console.table(erpOrders);

// ═══════════════════════════════════════════════════════
// 4. UPDATE METADATA
// ═══════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════');
console.log('✏️  VÍ DỤ UPDATE METADATA');
console.log('═══════════════════════════════════════════════════════\n');

// Update 1: Thêm ghi chú mới vào đơn
console.log('1️⃣  Thêm ghi chú vào đơn 262403054:');
const order1 = db.prepare('SELECT metadata FROM don_hang WHERE ma_dh = ?').get('262403054');
const meta1 = JSON.parse(order1.metadata);
meta1.ghi_chu_them = 'Đã gọi xác nhận với khách, OK';
meta1.nguoi_ghi_chu = 'Admin';
meta1.thoi_gian_ghi_chu = new Date().toISOString();

db.prepare('UPDATE don_hang SET metadata = ?, updated_at = datetime(\'now\',\'localtime\') WHERE ma_dh = ?')
  .run(JSON.stringify(meta1), '262403054');
console.log('✅ Đã thêm ghi chú');

// Update 2: Cập nhật trạng thái thanh toán
console.log('\n2️⃣  Cập nhật trạng thái thanh toán đơn 262403055:');
const order2 = db.prepare('SELECT metadata FROM don_hang WHERE ma_dh = ?').get('262403055');
const meta2 = JSON.parse(order2.metadata);
meta2.thanh_toan = {
  trang_thai: 'Đã thanh toán',
  ngay_thanh_toan: '2024-05-01',
  phuong_thuc: 'Chuyển khoản',
  so_tien: meta2.gia_tri_don * (1 - meta2.ty_le_bao_hiem / 100),
  ma_giao_dich: 'TXN-2024-001'
};

db.prepare('UPDATE don_hang SET metadata = ?, updated_at = datetime(\'now\',\'localtime\') WHERE ma_dh = ?')
  .run(JSON.stringify(meta2), '262403055');
console.log('✅ Đã cập nhật thanh toán');

// ═══════════════════════════════════════════════════════
// 5. XEM KẾT QUẢ SAU KHI UPDATE
// ═══════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════');
console.log('📋 METADATA SAU KHI UPDATE');
console.log('═══════════════════════════════════════════════════════\n');

const allOrders = db.prepare('SELECT ma_dh, benh_nhan, metadata FROM don_hang').all();
allOrders.forEach(order => {
  console.log(`\n📦 Đơn ${order.ma_dh} - ${order.benh_nhan}:`);
  console.log(JSON.stringify(JSON.parse(order.metadata), null, 2));
});

// ═══════════════════════════════════════════════════════
// 6. SO SÁNH: TRƯỚC VÀ SAU KHI CÓ METADATA
// ═══════════════════════════════════════════════════════

console.log('\n\n═══════════════════════════════════════════════════════');
console.log('📊 SO SÁNH: TRƯỚC VÀ SAU KHI CÓ METADATA');
console.log('═══════════════════════════════════════════════════════\n');

console.log('❌ TRƯỚC (Fixed schema):');
console.log(`
  - Muốn thêm "mã bảo hiểm" → ALTER TABLE thêm cột
  - Muốn thêm "lịch sử sửa chữa" → Tạo bảng mới + JOIN
  - Muốn tích hợp ERP → Thêm 10+ cột mới
  - Mỗi phòng khám có yêu cầu khác → Không thể customize
  - Migration phức tạp, downtime cao
`);

console.log('✅ SAU (Hybrid metadata):');
console.log(`
  - Thêm field mới → Chỉ cần update JSON, không ALTER TABLE
  - Dữ liệu phức tạp → Lưu nested object trong metadata
  - Tích hợp hệ thống khác → Thêm vào metadata.erp_*, metadata.crm_*
  - Custom fields → Mỗi phòng khám có metadata.custom_fields riêng
  - Zero downtime, không cần migration
`);

console.log('\n💡 KẾT LUẬN:');
console.log(`
  ✅ Core fields (ma_dh, khach_hang, benh_nhan...) → Fixed schema (query nhanh)
  ✅ Extended fields (bảo hiểm, ERP, custom...) → Metadata (linh hoạt)
  ✅ Best of both worlds!
`);

db.close();
