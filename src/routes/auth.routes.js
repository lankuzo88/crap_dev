'use strict';
const express  = require('express');
const path     = require('path');
const router   = express.Router();
const { sessions, genToken, getSessionToken, saveSessions, SESS_TTL, SESS_COOKIE_AGE } = require('../services/session.service');
const { USERS, verifyPassword } = require('../repositories/users.repo');
const { loginLimiter } = require('../middleware/security');
const { BASE_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

router.get(['/login', '/login.html'], (req, res) => {
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (sess && sess.expires > Date.now()) return res.redirect('/');
  res.sendFile(path.join(BASE_DIR, 'login.html'));
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.redirect('/login?error=1');

    const user = USERS[username];
    if (!user) return res.redirect('/login?error=1');

    const isValid = await verifyPassword(password, user.passwordHash);
    if (isValid) {
      const token = genToken();
      sessions.set(token, { user: username, role: user.role, expires: Date.now() + SESS_TTL });
      saveSessions();
      log(`✅ Login successful: ${username}`);
      res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESS_COOKIE_AGE}`);
      return res.redirect('/');
    }
    return res.redirect('/login?error=1');
  } catch (err) {
    log(`❌ Login error: ${err.message}`);
    next(err);
  }
});

router.get('/logout', (req, res) => {
  const token = getSessionToken(req);
  sessions.delete(token);
  saveSessions();
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.redirect('/login');
});

module.exports = router;
