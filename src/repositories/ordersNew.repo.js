'use strict';
/**
 * orders_new + stages_new repository — đơn tạo từ dashboard (tab Order).
 *
 * ma_dh format giống KeyLab: YYDDMM + STT 3 chữ (vd 260306500 = 03/06/2026 STT 500).
 * Dashboard reserve STT 500-999 để không đụng KeyLab (KeyLab thường <100 đơn/ngày).
 * Phụ lục: <ma_dh_goc>-<so_phu> (giống KeyLab).
 *
 * Uniqueness check cross-table (don_hang ∪ orders_new) để khi merge sau này
 * không phát sinh trùng ma_dh.
 */

const { getDB } = require('../db/index');

const STAGE_NAMES = ['CBM', 'SÁP/Cadcam', 'SƯỜN', 'ĐẮP', 'MÀI'];
const DASHBOARD_STT_MIN = 500;
const DASHBOARD_STT_MAX = 999;

const str = v => (v != null) ? String(v).trim() : '';
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function todayMaPrefix(d = new Date()) {
  const YY = String(d.getFullYear() % 100).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  return `${YY}${DD}${MM}`;
}

function nowVnString(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Issue ma_dh mới trong dashboard STT range cho prefix ngày hiện tại.
 * Đọc max STT đang dùng ở cả don_hang lẫn orders_new (range 500-999) → +1.
 */
function issueMaDh(db, prefix = todayMaPrefix()) {
  const pattern = `${prefix}???`; // GLOB ? = exactly 1 char (NOT _ which is LIKE)
  const row = db.prepare(`
    SELECT MAX(CAST(SUBSTR(ma_dh, 7, 3) AS INTEGER)) AS max_stt FROM (
      SELECT ma_dh FROM don_hang   WHERE ma_dh GLOB ? AND la_don_phu = 0
      UNION ALL
      SELECT ma_dh FROM orders_new WHERE ma_dh GLOB ? AND la_don_phu = 0
    )
    WHERE CAST(SUBSTR(ma_dh, 7, 3) AS INTEGER) BETWEEN ? AND ?
  `).get(pattern, pattern, DASHBOARD_STT_MIN, DASHBOARD_STT_MAX);

  const next = (row?.max_stt ?? (DASHBOARD_STT_MIN - 1)) + 1;
  if (next > DASHBOARD_STT_MAX) {
    throw new Error(`Hết STT dashboard cho ngày ${prefix} (đã dùng tới ${DASHBOARD_STT_MAX})`);
  }
  return `${prefix}${String(next).padStart(3, '0')}`;
}

/**
 * Issue ma_dh phụ lục: <ma_dh_goc>-<next so_phu>.
 * so_phu = max(so_phu hiện có ở cả 2 bảng) + 1, mặc định 1.
 */
function issuePhuLucMaDh(db, ma_dh_goc) {
  const row = db.prepare(`
    SELECT MAX(so_phu) AS max_sp FROM (
      SELECT so_phu FROM don_hang   WHERE ma_dh_goc = ? AND la_don_phu = 1
      UNION ALL
      SELECT so_phu FROM orders_new WHERE ma_dh_goc = ? AND la_don_phu = 1
    )
  `).get(ma_dh_goc, ma_dh_goc);
  const so_phu = (row?.max_sp ?? 0) + 1;
  return { ma_dh: `${ma_dh_goc}-${so_phu}`, so_phu };
}

/**
 * Kiểm tra ma_dh tồn tại ở 1 trong 2 bảng (cho phụ lục reference check).
 */
function maDhExists(db, ma_dh) {
  const row = db.prepare(`
    SELECT 1 AS hit FROM don_hang WHERE ma_dh = ?
    UNION ALL
    SELECT 1 AS hit FROM orders_new WHERE ma_dh = ?
    LIMIT 1
  `).get(ma_dh, ma_dh);
  return !!row;
}

function insertOrderRow(db, fields) {
  db.prepare(`
    INSERT INTO orders_new (
      ma_dh, ma_dh_goc, so_phu, la_don_phu,
      nhap_luc, yc_hoan_thanh, yc_giao,
      khach_hang, benh_nhan, phuc_hinh, sl,
      loai_lenh, ghi_chu, ghi_chu_sx,
      tai_khoan_cao, routed_to, keylab_sx_info,
      source, created_by
    ) VALUES (
      @ma_dh, @ma_dh_goc, @so_phu, @la_don_phu,
      @nhap_luc, @yc_hoan_thanh, @yc_giao,
      @khach_hang, @benh_nhan, @phuc_hinh, @sl,
      @loai_lenh, @ghi_chu, @ghi_chu_sx,
      @tai_khoan_cao, @routed_to, @keylab_sx_info,
      'dashboard', @created_by
    )
  `).run(fields);
}

function insertDefaultStages(db, ma_dh, stages = STAGE_NAMES) {
  const ins = db.prepare('INSERT INTO stages_new (ma_dh, thu_tu, cong_doan) VALUES (?, ?, ?)');
  stages.forEach((cong_doan, i) => ins.run(ma_dh, i + 1, cong_doan));
}

/**
 * Tạo đơn mới (la_don_phu = 0). Auto-issue ma_dh + 5 stage mặc định, atomic.
 * payload: { khach_hang, benh_nhan, phuc_hinh, sl, loai_lenh, ghi_chu, ghi_chu_sx,
 *            yc_hoan_thanh, yc_giao, tai_khoan_cao, routed_to, keylab_sx_info, stages? }
 */
function createOrder(db, payload, createdBy) {
  if (!createdBy) throw new Error('createdBy required');
  const stages = Array.isArray(payload.stages) && payload.stages.length ? payload.stages : STAGE_NAMES;
  let ma_dh;
  const tx = db.transaction(() => {
    ma_dh = issueMaDh(db);
    insertOrderRow(db, {
      ma_dh, ma_dh_goc: ma_dh, so_phu: null, la_don_phu: 0,
      nhap_luc: str(payload.nhap_luc) || nowVnString(),
      yc_hoan_thanh: str(payload.yc_hoan_thanh),
      yc_giao: str(payload.yc_giao),
      khach_hang: str(payload.khach_hang),
      benh_nhan: str(payload.benh_nhan),
      phuc_hinh: str(payload.phuc_hinh),
      sl: num(payload.sl),
      loai_lenh: str(payload.loai_lenh),
      ghi_chu: str(payload.ghi_chu),
      ghi_chu_sx: str(payload.ghi_chu_sx),
      tai_khoan_cao: str(payload.tai_khoan_cao),
      routed_to: str(payload.routed_to) || null,
      keylab_sx_info: str(payload.keylab_sx_info),
      created_by: createdBy,
    });
    insertDefaultStages(db, ma_dh, stages);
  });
  tx();
  return ma_dh;
}

/**
 * Tạo phụ lục cho ma_dh_goc (có thể là đơn của don_hang HOẶC orders_new).
 * Phụ lục có tiến độ độc lập (5 stage mới), giống pattern KeyLab hiện tại.
 */
function createPhuLuc(db, ma_dh_goc, payload, createdBy) {
  if (!createdBy) throw new Error('createdBy required');
  if (!maDhExists(db, ma_dh_goc)) throw new Error(`ma_dh_goc không tồn tại: ${ma_dh_goc}`);
  const stages = Array.isArray(payload.stages) && payload.stages.length ? payload.stages : STAGE_NAMES;
  let ma_dh, so_phu;
  const tx = db.transaction(() => {
    ({ ma_dh, so_phu } = issuePhuLucMaDh(db, ma_dh_goc));
    insertOrderRow(db, {
      ma_dh, ma_dh_goc, so_phu, la_don_phu: 1,
      nhap_luc: str(payload.nhap_luc) || nowVnString(),
      yc_hoan_thanh: str(payload.yc_hoan_thanh),
      yc_giao: str(payload.yc_giao),
      khach_hang: str(payload.khach_hang),
      benh_nhan: str(payload.benh_nhan),
      phuc_hinh: str(payload.phuc_hinh),
      sl: num(payload.sl),
      loai_lenh: str(payload.loai_lenh),
      ghi_chu: str(payload.ghi_chu),
      ghi_chu_sx: str(payload.ghi_chu_sx),
      tai_khoan_cao: str(payload.tai_khoan_cao),
      routed_to: str(payload.routed_to) || null,
      keylab_sx_info: str(payload.keylab_sx_info),
      created_by: createdBy,
    });
    insertDefaultStages(db, ma_dh, stages);
  });
  tx();
  return { ma_dh, so_phu };
}

function getOrder(db, ma_dh) {
  const order = db.prepare('SELECT * FROM orders_new WHERE ma_dh = ?').get(ma_dh);
  if (!order) return null;
  const stages = db.prepare('SELECT * FROM stages_new WHERE ma_dh = ? ORDER BY thu_tu').all(ma_dh);
  return { order, stages };
}

// Fields user được phép sửa qua PATCH. KHÔNG cho sửa identity (ma_dh, ma_dh_goc,
// so_phu, la_don_phu), source, created_*, hoặc raw nguon_file. SL phải > 0.
const EDITABLE_FIELDS = [
  'khach_hang', 'benh_nhan', 'phuc_hinh', 'sl', 'loai_lenh',
  'ghi_chu', 'ghi_chu_sx', 'trang_thai',
  'yc_hoan_thanh', 'yc_giao', 'tai_khoan_cao', 'routed_to', 'keylab_sx_info',
];

function updateOrder(db, ma_dh, patch, editor) {
  if (!editor) throw new Error('editor required');
  const existing = db.prepare('SELECT ma_dh FROM orders_new WHERE ma_dh = ?').get(ma_dh);
  if (!existing) throw new Error(`Đơn không tồn tại: ${ma_dh}`);

  const sets = [];
  const params = {};
  for (const field of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const raw = patch[field];
    if (field === 'sl') {
      const n = num(raw);
      if (n <= 0) throw new Error('sl phải > 0');
      params[field] = n;
    } else if (field === 'routed_to') {
      params[field] = str(raw) || null;
    } else {
      params[field] = str(raw);
    }
    sets.push(`${field} = @${field}`);
  }
  if (!sets.length) throw new Error('Không có field nào để cập nhật');

  sets.push("edited_by = @editor", "edited_at = datetime('now','localtime')");
  params.editor = editor;
  params.ma_dh = ma_dh;

  db.prepare(`UPDATE orders_new SET ${sets.join(', ')} WHERE ma_dh = @ma_dh`).run(params);
  return getOrder(db, ma_dh);
}

function listOrders(db, { limit = 100, offset = 0, ma_dh_goc, loai_lenh, created_by, la_don_phu } = {}) {
  let sql = 'SELECT * FROM orders_new WHERE 1=1';
  const params = [];
  if (ma_dh_goc)         { sql += ' AND ma_dh_goc = ?';   params.push(ma_dh_goc); }
  if (loai_lenh)         { sql += ' AND loai_lenh = ?';   params.push(loai_lenh); }
  if (created_by)        { sql += ' AND created_by = ?';  params.push(created_by); }
  if (la_don_phu === 0 || la_don_phu === 1) {
    sql += ' AND la_don_phu = ?'; params.push(la_don_phu);
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(num(limit) || 100, num(offset));
  return db.prepare(sql).all(...params);
}

module.exports = {
  STAGE_NAMES, EDITABLE_FIELDS,
  DASHBOARD_STT_MIN, DASHBOARD_STT_MAX,
  todayMaPrefix, nowVnString,
  issueMaDh, issuePhuLucMaDh, maDhExists,
  createOrder, createPhuLuc, getOrder, listOrders, updateOrder,
};
