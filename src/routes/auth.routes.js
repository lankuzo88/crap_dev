'use strict';
const express  = require('express');
const path     = require('path');
const router   = express.Router();
const { getSession, getSessionToken, createSession, deleteSession, refreshSession, buildSessionCookie, buildClearSessionCookie, ttlForOptions } = require('../services/session.service');
const { USERS, verifyPassword } = require('../repositories/users.repo');
const { loginLimiter } = require('../middleware/security');
const { BASE_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

router.get(['/login', '/login.html'], (req, res) => {
  const token = getSessionToken(req);
  const sess  = getSession(token);
  if (sess) {
    const refreshed = refreshSession(sess.token, sess.expires, sess.ttlMs);
    res.setHeader('Set-Cookie', buildSessionCookie(sess.token, refreshed.expires, refreshed.ttlMs));
    return res.redirect('/');
  }
  res.sendFile(path.join(BASE_DIR, 'login.html'));
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const remember = req.body?.remember === '1' || req.body?.remember === 'on';
    if (!username || !password) return res.redirect('/login?error=1');

    const user = USERS[username];
    if (!user) return res.redirect('/login?error=1');

    const isValid = await verifyPassword(password, user.passwordHash);
    if (isValid) {
      const token = createSession(username, user.role, { remember });
      const ttlMs = ttlForOptions({ remember });
      log(`Login successful: ${username}`);
      res.setHeader('Set-Cookie', buildSessionCookie(token, Date.now() + ttlMs, ttlMs));
      return res.redirect('/');
    }
    return res.redirect('/login?error=1');
  } catch (err) {
    log(`Login error: ${err.message}`);
    next(err);
  }
});

router.get('/logout', (req, res) => {
  const token = getSessionToken(req);
  deleteSession(token);
  res.setHeader('Set-Cookie', buildClearSessionCookie());
  res.redirect('/login');
});

module.exports = router;
