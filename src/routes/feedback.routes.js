'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getDB } = require('../db/index');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

router.get('/api/feedback/types', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const rows = db.prepare('SELECT * FROM feedback_types WHERE active=1 ORDER BY category, name').all();
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/api/feedback/types', requireAuth, requireAdmin, express.json(), (req, res) => {
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

router.delete('/api/feedback/types/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    db.prepare('UPDATE feedback_types SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.get('/api/feedbacks', requireAuth, (req, res) => {
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    let sql = `SELECT f.*, ft.name as type_name, ft.category FROM feedbacks f
               JOIN feedback_types ft ON f.feedback_type_id=ft.id WHERE 1=1`;
    const params = [];
    if (req.query.ma_dh)  { sql += ' AND f.ma_dh=?';  params.push(req.query.ma_dh); }
    if (req.query.status) { sql += ' AND f.status=?'; params.push(req.query.status); }
    sql += ' ORDER BY f.created_at DESC LIMIT 100';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/api/feedbacks', requireAuth, express.json(), (req, res) => {
  const { ma_dh, feedback_type_id, description, severity } = req.body;
  if (!ma_dh || !feedback_type_id || !description)
    return res.status(400).json({ ok: false, error: 'ma_dh, feedback_type_id, and description are required' });
  try {
    const db = getDB();
    if (!db) return res.status(500).json({ ok: false, error: 'Database not available' });
    const username = req.session ? req.session.user : 'unknown';
    const result = db.prepare(`INSERT INTO feedbacks (ma_dh, feedback_type_id, description, severity, reported_by) VALUES (?, ?, ?, ?, ?)`)
      .run(ma_dh, feedback_type_id, description, severity || 'medium', username);
    log(`[Feedback] Created: ${ma_dh} by ${username}`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.patch('/api/feedbacks/:id', requireAuth, express.json(), (req, res) => {
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
