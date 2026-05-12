'use strict';
const { getSession, getSessionToken, deleteSession } = require('../services/session.service');

function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  const sess  = getSession(token);
  if (!sess) {
    deleteSession(token);
    return res.redirect('/login');
  }
  req.session = sess;
  next();
}

function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  const sess  = getSession(token);
  if (!sess) {
    deleteSession(token);
    return res.redirect('/login');
  }
  if (sess.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.session = sess;
  next();
}

module.exports = { requireAuth, requireAdmin };
