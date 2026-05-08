'use strict';
const fs     = require('fs');
const crypto = require('crypto');
const { SESSIONS_PATH } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const sessions   = new Map();
const SESS_TTL        = 7 * 24 * 60 * 60 * 1000; // 7 ngày (ms)
const SESS_COOKIE_AGE = 7 * 24 * 60 * 60;         // 7 ngày (giây, Max-Age)

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
  try {
    if (!fs.existsSync(SESSIONS_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
    const now = Date.now();
    let loaded = 0;
    for (const [token, sess] of Object.entries(raw)) {
      if (sess.expires > now) { sessions.set(token, sess); loaded++; }
    }
    if (loaded) log(`🔑 Restored ${loaded} session(s)`);
  } catch (e) {
    log(`⚠ Could not load sessions: ${e.message}`);
  }
}

function saveSessions() {
  try {
    const obj = {};
    for (const [token, sess] of sessions) obj[token] = sess;
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(obj));
  } catch (e) {
    log(`⚠ Could not save sessions: ${e.message}`);
  }
}

module.exports = {
  sessions,
  SESS_TTL,
  SESS_COOKIE_AGE,
  genToken,
  getSessionToken,
  loadSessions,
  saveSessions,
};
