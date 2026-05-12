'use strict';
const crypto = require('crypto');
const { getDB } = require('../db/index');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const SESS_TTL        = 7 * 24 * 60 * 60 * 1000; // 7 days (ms)
const SESS_COOKIE_AGE = 7 * 24 * 60 * 60;         // 7 days (seconds)

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getSessionToken(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 'sid') return decodeURIComponent(v);
  }
  return '';
}

function loadSessions() {
  // SQLite-backed sessions need no process-local warmup.
}

function saveSessions() {
  // Kept as a no-op for compatibility with older callers.
}

function createSession(username, role) {
  const db = getDB();
  if (!db) throw new Error('Database not available');
  const token = genToken();
  const expires = Date.now() + SESS_TTL;
  db.prepare(`
    INSERT INTO sessions (token, username, role, expires)
    VALUES (?, ?, ?, ?)
  `).run(token, username, role, expires);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const db = getDB();
  if (!db) return null;
  const row = db.prepare(`
    SELECT token, username, role, expires
    FROM sessions
    WHERE token = ?
  `).get(token);
  if (!row) return null;
  if (row.expires < Date.now()) {
    deleteSession(token);
    return null;
  }
  return {
    token: row.token,
    user: row.username,
    username: row.username,
    role: row.role,
    expires: row.expires,
  };
}

function deleteSession(token) {
  if (!token) return;
  const db = getDB();
  if (!db) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function cleanExpiredSessions() {
  const db = getDB();
  if (!db) return;
  try {
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  } catch (err) {
    log(`Session cleanup error: ${err.message}`);
  }
}

const cleanupInterval = setInterval(cleanExpiredSessions, 60 * 60 * 1000);
if (cleanupInterval.unref) cleanupInterval.unref();

module.exports = {
  genToken,
  getSessionToken,
  loadSessions,
  saveSessions,
  createSession,
  getSession,
  deleteSession,
  cleanExpiredSessions,
  SESS_TTL,
  SESS_COOKIE_AGE,
};
