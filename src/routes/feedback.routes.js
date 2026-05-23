'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin, requirePermission } = require('../middleware/auth');
const { getDB } = require('../db/index');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

router.get('/api/feedback/types', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const rows = db.prepare(`
      SELECT * FROM feedback_types
      WHERE active=1
      ORDER BY
        CASE category
          WHEN 'tot' THEN 1
          WHEN 'chat_luong' THEN 2
          WHEN 'tien_do_dich_vu' THEN 3
          WHEN 'thong_tin_phu_kien' THEN 4
          WHEN 'khac' THEN 5
          ELSE 9
        END,
        id
    `).all();
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/api/feedback/types', requirePermission('admin.users.manage'), express.json(), (req, res) => {
  const { name, category, description } = req.body;
  if (!name || !category) return res.status(400).json({ ok: false, error: 'name and category are required' });
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const result = db.prepare('INSERT INTO feedback_types (name, category, description) VALUES (?, ?, ?)').run(name, category, description || '');
    log(`[Feedback] Type created: ${name} (${category})`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/api/feedback/types/:id', requirePermission('admin.users.manage'), express.json(), (req, res) => {
  const { name, category, description } = req.body;
  if (!name || !category) return res.status(400).json({ ok: false, error: 'name and category are required' });
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const result = db.prepare(
      `UPDATE feedback_types
       SET name=?, category=?, description=?
       WHERE id=? AND active=1`
    ).run(name, category, description || '', req.params.id);
    if (!result.changes) return res.status(404).json({ ok: false, error: 'Feedback type not found' });
    log(`[Feedback] Type updated: ${req.params.id} -> ${name} (${category})`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.delete('/api/feedback/types/:id', requirePermission('admin.users.manage'), (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    db.prepare('UPDATE feedback_types SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/feedbacks/clinics', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const rows = db.prepare(
      `SELECT DISTINCT khach_hang AS name FROM don_hang
       WHERE khach_hang IS NOT NULL AND TRIM(khach_hang) != ''
       ORDER BY khach_hang ASC`
    ).all();
    res.json({ ok: true, data: rows.map(r => r.name) });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/feedbacks/stats', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const requested = String(req.query.month || '').trim();
    const latest = db.prepare(`
      SELECT substr(created_at, 1, 7) AS month
      FROM feedbacks
      WHERE TRIM(COALESCE(created_at, '')) != ''
      ORDER BY created_at DESC
      LIMIT 1
    `).get();
    const currentMonth = new Date().toISOString().slice(0, 7);
    const month = /^\d{4}-\d{2}$/.test(requested) ? requested : (latest?.month || currentMonth);
    const months = db.prepare(`
      SELECT substr(created_at, 1, 7) AS month, COUNT(*) AS total
      FROM feedbacks
      WHERE TRIM(COALESCE(created_at, '')) != ''
      GROUP BY substr(created_at, 1, 7)
      ORDER BY month DESC
    `).all();
    const rows = db.prepare(`
      SELECT f.id, f.nha_khoa, f.feedback_type_id, f.severity, f.status, f.created_at,
             ft.name AS type_name, ft.category
      FROM feedbacks f
      LEFT JOIN feedback_types ft ON f.feedback_type_id = ft.id
      WHERE substr(f.created_at, 1, 7) = ?
      ORDER BY f.created_at DESC
    `).all(month);

    const summary = { total: rows.length, good: 0, bad: 0, urgent: 0, normal: 0, open: 0, resolved: 0 };
    const byClinic = new Map();
    const byType = new Map();
    const byCategory = new Map();
    const bySeverity = new Map();
    const add = (map, key, patch = {}) => {
      const label = key || 'Không rõ';
      if (!map.has(label)) map.set(label, { name: label, total: 0, good: 0, bad: 0, urgent: 0, ...patch });
      return map.get(label);
    };

    for (const row of rows) {
      const category = row.category || 'khac';
      const severity = row.severity || 'medium';
      const isGood = category === 'tot' || severity === 'low';
      const isUrgent = severity === 'high';
      summary.good += isGood ? 1 : 0;
      summary.bad += isGood ? 0 : 1;
      summary.urgent += isUrgent ? 1 : 0;
      summary.normal += severity === 'medium' ? 1 : 0;
      summary.open += row.status === 'open' ? 1 : 0;
      summary.resolved += (row.status === 'resolved' || row.status === 'closed') ? 1 : 0;

      const clinic = add(byClinic, row.nha_khoa || 'Không rõ nha khoa');
      clinic.total += 1; clinic.good += isGood ? 1 : 0; clinic.bad += isGood ? 0 : 1; clinic.urgent += isUrgent ? 1 : 0;

      const type = add(byType, row.type_name || 'Chưa phân loại', { category });
      type.total += 1; type.good += isGood ? 1 : 0; type.bad += isGood ? 0 : 1; type.urgent += isUrgent ? 1 : 0;

      const cat = add(byCategory, category);
      cat.total += 1; cat.good += isGood ? 1 : 0; cat.bad += isGood ? 0 : 1; cat.urgent += isUrgent ? 1 : 0;

      const sev = add(bySeverity, severity);
      sev.total += 1; sev.good += isGood ? 1 : 0; sev.bad += isGood ? 0 : 1; sev.urgent += isUrgent ? 1 : 0;
    }

    const top = map => Array.from(map.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'vi')).slice(0, 10);
    res.json({
      ok: true,
      month,
      months,
      summary,
      byClinic: top(byClinic),
      byType: top(byType),
      byCategory: top(byCategory),
      bySeverity: top(bySeverity),
    });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/feedbacks', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    let sql = `SELECT f.*, ft.name as type_name, ft.category
               FROM feedbacks f
               LEFT JOIN feedback_types ft ON f.feedback_type_id = ft.id
               WHERE 1=1`;
    const params = [];
    if (req.query.nha_khoa) { sql += ' AND f.nha_khoa=?'; params.push(req.query.nha_khoa); }
    if (req.query.ma_dh)    { sql += ' AND f.ma_dh=?';    params.push(req.query.ma_dh); }
    if (req.query.status)   { sql += ' AND f.status=?';   params.push(req.query.status); }
    sql += ' ORDER BY f.created_at DESC';
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    sql += ` LIMIT ${limit}`;
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/api/feedbacks', requirePermission('feedback.submit'), express.json(), (req, res) => {
  const { nha_khoa, ma_dh, feedback_type_id, description, severity } = req.body;
  if (!nha_khoa || !feedback_type_id || !description)
    return res.status(400).json({ ok: false, error: 'nha_khoa, feedback_type_id, and description are required' });
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const username = req.session ? req.session.user : 'unknown';
    const result = db.prepare(
      `INSERT INTO feedbacks (nha_khoa, ma_dh, feedback_type_id, description, severity, reported_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nha_khoa, ma_dh || '', feedback_type_id, description, severity || 'medium', username);
    log(`[Feedback] Created: ${nha_khoa}${ma_dh ? ' / ' + ma_dh : ''} by ${username}`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/api/feedbacks/:id', requireAuth, requireAdmin, express.json(), (req, res) => {
  const { id } = req.params;
  const { status, assigned_to } = req.body;
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const updates = [];
    const params  = [];
    if (status) {
      updates.push('status=?'); params.push(status);
      if (status === 'resolved' || status === 'closed') updates.push("resolved_at=datetime('now','localtime')");
    }
    if (assigned_to !== undefined) { updates.push('assigned_to=?'); params.push(assigned_to); }
    updates.push("updated_at=datetime('now','localtime')");
    params.push(id);
    db.prepare(`UPDATE feedbacks SET ${updates.join(', ')} WHERE id=?`).run(...params);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
