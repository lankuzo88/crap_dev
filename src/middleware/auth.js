'use strict';
const { sessions, getSessionToken } = require('../services/session.service');

function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (!sess || sess.expires < Date.now()) {
    sessions.delete(token);
    return res.redirect('/login');
  }
  req.session = sess;
  next();
}

function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  const sess  = sessions.get(token);
  if (!sess || sess.expires < Date.now()) {
    sessions.delete(token);
    return res.redirect('/login');
  }
  if (sess.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.session = sess;
  next();
}

module.exports = { requireAuth, requireAdmin };
