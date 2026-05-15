'use strict';
const { getSession, getSessionToken, deleteSession } = require('../services/session.service');
const { USERS, hasPermission } = require('../repositories/users.repo');

function currentSessionWithUserRole(sess) {
  const user = USERS[sess.user] || USERS[sess.username];
  if (!user) return sess;
  return { ...sess, role: user.role || sess.role };
}

function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  const sess  = getSession(token);
  if (!sess) {
    deleteSession(token);
    return res.redirect('/login');
  }
  req.session = currentSessionWithUserRole(sess);
  next();
}

function requireAdmin(req, res, next) {
  const token = getSessionToken(req);
  const sess  = getSession(token);
  if (!sess) {
    deleteSession(token);
    return res.redirect('/login');
  }
  const currentSess = currentSessionWithUserRole(sess);
  if (currentSess.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.session = currentSess;
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    const token = getSessionToken(req);
    const sess  = getSession(token);
    if (!sess) {
      deleteSession(token);
      return res.redirect('/login');
    }
    const currentSess = currentSessionWithUserRole(sess);
    if (!hasPermission(currentSess.user, permission)) {
      return res.status(403).json({ ok: false, error: 'Permission denied', permission });
    }
    req.session = currentSess;
    next();
  };
}

module.exports = { requireAuth, requireAdmin, requirePermission };
