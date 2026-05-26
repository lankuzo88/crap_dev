'use strict';
const crypto = require('crypto');
const { getDB } = require('../db/index');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;
const SESS_TTL        = SESSION_HOURS * 60 * 60 * 1000; // 12 hours (ms)
const REMEMBER_TTL    = REMEMBER_DAYS * 24 * 60 * 60 * 1000; // 30 days (ms)
const SESS_COOKIE_AGE = Math.floor(SESS_TTL / 1000);         // 12 hours (seconds)
const REMEMBER_COOKIE_AGE = Math.floor(REMEMBER_TTL / 1000); // 30 days (seconds)
const SESS_REFRESH_DRIFT = 5 * 60 * 1000;                    // avoid DB writes on every poll
const SESSION_CACHE_TTL = 10 * 1000;
const sessionCache = new Map();

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

function ttlForOptions(options = {}) {
  return options.remember ? REMEMBER_TTL : SESS_TTL;
}

function cookieAgeForTtl(ttlMs = SESS_TTL) {
  return Math.floor(Number(ttlMs || SESS_TTL) / 1000);
}

function createSession(username, role, options = {}) {
  const db = getDB();
  if (!db) throw new Error('Database not available');
  const token = genToken();
  const ttlMs = ttlForOptions(options);
  const expires = Date.now() + ttlMs;
  db.prepare(`
    INSERT INTO sessions (token, username, role, expires, ttl_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, username, role, expires, ttlMs);
  sessionCache.set(token, {
    token,
    user: username,
    username,
    role,
    expires,
    ttlMs,
    cachedUntil: Math.min(expires, Date.now() + SESSION_CACHE_TTL),
  });
  return token;
}

function buildSessionCookie(token, expires = Date.now() + SESS_TTL, ttlMs = SESS_TTL) {
  const expiresUtc = new Date(expires).toUTCString();
  return `sid=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${cookieAgeForTtl(ttlMs)}; Expires=${expiresUtc}`;
}

function buildClearSessionCookie() {
  return 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

function refreshSession(token, currentExpires = 0, ttlMs = SESS_TTL) {
  if (!token) return { expires: currentExpires, ttlMs };
  const nextExpires = Date.now() + Number(ttlMs || SESS_TTL);
  if (Math.abs(Number(currentExpires || 0) - nextExpires) < SESS_REFRESH_DRIFT) {
    return { expires: currentExpires, ttlMs };
  }
  const db = getDB();
  if (!db) return { expires: currentExpires, ttlMs };
  db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').run(nextExpires, token);
  const cached = sessionCache.get(token);
  if (cached) {
    cached.expires = nextExpires;
    cached.ttlMs = ttlMs;
    cached.cachedUntil = Math.min(nextExpires, Date.now() + SESSION_CACHE_TTL);
  }
  return { expires: nextExpires, ttlMs };
}

function getSession(token) {
  if (!token) return null;
  const cached = sessionCache.get(token);
  if (cached) {
    const now = Date.now();
    if (cached.expires >= now && cached.cachedUntil >= now) {
      return {
        token: cached.token,
        user: cached.user,
        username: cached.username,
        role: cached.role,
        expires: cached.expires,
        ttlMs: cached.ttlMs,
      };
    }
    sessionCache.delete(token);
  }

  const db = getDB();
  if (!db) return null;
  const row = db.prepare(`
    SELECT token, username, role, expires, COALESCE(ttl_ms, ?) AS ttl_ms
    FROM sessions
    WHERE token = ?
  `).get(SESS_TTL, token);
  if (!row) return null;
  if (row.expires < Date.now()) {
    deleteSession(token);
    return null;
  }
  const session = {
    token: row.token,
    user: row.username,
    username: row.username,
    role: row.role,
    expires: row.expires,
    ttlMs: row.ttl_ms || SESS_TTL,
  };
  sessionCache.set(token, {
    ...session,
    cachedUntil: Math.min(session.expires, Date.now() + SESSION_CACHE_TTL),
  });
  return session;
}

function deleteSession(token) {
  if (!token) return;
  sessionCache.delete(token);
  const db = getDB();
  if (!db) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function cleanExpiredSessions() {
  const db = getDB();
  if (!db) return;
  try {
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    const now = Date.now();
    for (const [token, session] of sessionCache.entries()) {
      if (session.expires < now || session.cachedUntil < now) sessionCache.delete(token);
    }
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
  buildSessionCookie,
  buildClearSessionCookie,
  refreshSession,
  ttlForOptions,
  SESS_TTL,
  REMEMBER_TTL,
  SESS_COOKIE_AGE,
  REMEMBER_COOKIE_AGE,
};
