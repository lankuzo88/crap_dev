'use strict';
const express = require('express');
const path    = require('path');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { sessions, getSessionToken } = require('../services/session.service');
const { USERS, normalizeUserCongDoan, isValidUserCongDoan, hashPassword } = require('../repositories/users.repo');
const { saveUsers } = require('../repositories/users.repo');
const { BASE_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

router.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'admin.html'));
});

router.get('/admin/api/users', requireAdmin, (req, res) => {
  const users = Object.entries(USERS).map(([username, data]) => ({
    username, role: data.role, cong_doan: data.cong_doan || '', can_view_stats: data.can_view_stats === true,
  }));
  res.json(users);
});

router.post('/admin/api/users', requireAdmin, express.json(), async (req, res) => {
  const { username, password, role, cong_doan } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Missing username, password, or role' });
  if (USERS[username]) return res.status(400).json({ error: 'Username already exists' });
  if (!['admin', 'user', 'qc'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const normalizedCongDoan = normalizeUserCongDoan(cong_doan);
  if (!isValidUserCongDoan(normalizedCongDoan)) return res.status(400).json({ error: 'Invalid cong_doan' });
  try {
    const passwordHash = await hashPassword(password);
    USERS[username] = { passwordHash, role, cong_doan: normalizedCongDoan };
    saveUsers();
    log(`👤 New user created: ${username} (${role}) cong_doan=${normalizedCongDoan || 'none'}`);
    res.json({ ok: true, username, role, cong_doan: normalizedCongDoan });
  } catch (err) {
    log(`❌ Error creating user: ${err.message}`);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.patch('/admin/api/users/:username/cong-doan', requireAdmin, express.json(), (req, res) => {
  const { username } = req.params;
  const { cong_doan } = req.body;
  const normalizedCongDoan = normalizeUserCongDoan(cong_doan);
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  if (!isValidUserCongDoan(normalizedCongDoan)) return res.status(400).json({ error: 'Invalid cong_doan' });
  USERS[username].cong_doan = normalizedCongDoan;
  saveUsers();
  log(`🔧 cong_doan set: ${username} → ${normalizedCongDoan || 'none'}`);
  res.json({ ok: true });
});

router.delete('/admin/api/users/:username', requireAdmin, (req, res) => {
  const { username } = req.params;
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (username === sess.user) return res.status(400).json({ error: 'Cannot delete your own account' });
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  delete USERS[username];
  saveUsers();
  log(`🗑 User deleted: ${username}`);
  res.json({ ok: true, username });
});

router.post('/admin/api/users/:username/reset-password', requireAdmin, express.json(), async (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'newPassword is required' });
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  try {
    const passwordHash = await hashPassword(newPassword);
    USERS[username].passwordHash = passwordHash;
    saveUsers();
    log(`🔑 Password reset for: ${username}`);
    res.json({ ok: true, username });
  } catch (err) {
    log(`❌ Error resetting password: ${err.message}`);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.patch('/api/admin/users/:username/stats-permission', requireAdmin, express.json(), (req, res) => {
  const { username } = req.params;
  const { can_view_stats } = req.body;
  if (!USERS[username]) return res.status(404).json({ error: 'User not found' });
  USERS[username].can_view_stats = can_view_stats === true;
  saveUsers();
  log(`📊 stats-permission: ${username} → ${USERS[username].can_view_stats}`);
  res.json({ ok: true, username, can_view_stats: USERS[username].can_view_stats });
});

module.exports = router;
