'use strict';
const { getDB } = require('../db/index');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

// ── In-memory cache (30s TTL) ──────────────────────────
let _cache = null;      // Map<khach_hang, string[]>
let _cacheTime = 0;
const CACHE_TTL = 30_000;

function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

// Build a Map<khach_hang, label[]> từ DB
function buildTagsMap(db) {
  const rows = db.prepare(
    `SELECT khach_hang, label FROM clinic_tags ORDER BY created_at ASC`
  ).all();
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.khach_hang)) map.set(row.khach_hang, []);
    map.get(row.khach_hang).push(row.label);
  }
  return map;
}

// Trả Map<khach_hang, string[]> (cached 30s)
function getAllTagsMap() {
  const db = getDB();
  if (!db) return new Map();
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL) return _cache;
  _cache = buildTagsMap(db);
  _cacheTime = now;
  return _cache;
}

// List nha khoa (distinct non-empty từ don_hang) + count đơn + count chip
function listClinicsWithCounts() {
  const db = getDB();
  if (!db) return [];
  return db.prepare(`
    SELECT dh.khach_hang,
           COUNT(DISTINCT dh.ma_dh) AS order_count,
           COUNT(DISTINCT ct.id)    AS tag_count
    FROM don_hang dh
    LEFT JOIN clinic_tags ct ON ct.khach_hang = dh.khach_hang
    WHERE dh.khach_hang IS NOT NULL AND TRIM(dh.khach_hang) != ''
    GROUP BY dh.khach_hang
    ORDER BY dh.khach_hang ASC
  `).all();
}

// Distinct labels across ALL clinics, sorted by frequency (for autocomplete suggestions)
function listAllLabels() {
  const db = getDB();
  if (!db) return [];
  return db.prepare(`
    SELECT label, COUNT(*) AS count
    FROM clinic_tags
    GROUP BY label
    ORDER BY count DESC, label ASC
  `).all();
}

// Chip list theo nha khoa
function listTagsByClinic(khach_hang) {
  const db = getDB();
  if (!db) return [];
  return db.prepare(
    `SELECT id, label, created_at, created_by FROM clinic_tags WHERE khach_hang = ? ORDER BY created_at ASC`
  ).all(khach_hang);
}

// Thêm chip; ném lỗi .code = 'DUPLICATE' nếu trùng (khach_hang, label)
function addTag(khach_hang, label, created_by) {
  const db = getDB();
  if (!db) throw new Error('DB unavailable');
  const trimmed = String(label || '').trim();
  if (!trimmed || trimmed.length > 60) throw Object.assign(new Error('invalid_label'), { code: 'INVALID' });
  const kh = String(khach_hang || '').trim();
  if (!kh) throw Object.assign(new Error('invalid_khach_hang'), { code: 'INVALID' });
  try {
    const info = db.prepare(
      `INSERT INTO clinic_tags (khach_hang, label, created_at, created_by)
       VALUES (?, ?, datetime('now','localtime'), ?)`
    ).run(kh, trimmed, String(created_by || ''));
    invalidateCache();
    const row = db.prepare(`SELECT id, label, created_at, created_by FROM clinic_tags WHERE id = ?`).get(info.lastInsertRowid);
    return row;
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || (err.message && err.message.includes('UNIQUE constraint'))) {
      throw Object.assign(new Error('duplicate'), { code: 'DUPLICATE' });
    }
    throw err;
  }
}

// Xoá chip theo id; trả true nếu đã xoá
function deleteTag(id) {
  const db = getDB();
  if (!db) return false;
  const info = db.prepare(`DELETE FROM clinic_tags WHERE id = ?`).run(Number(id));
  if (info.changes > 0) {
    invalidateCache();
    log(`🗑 clinic_tag id=${id} deleted`);
    return true;
  }
  return false;
}

module.exports = { getAllTagsMap, listClinicsWithCounts, listAllLabels, listTagsByClinic, addTag, deleteTag, invalidateCache };
