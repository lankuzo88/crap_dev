'use strict';
const fs     = require('fs');
const bcrypt = require('bcrypt');
const { USERS_JSON_PATH } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const USER_CONG_DOAN_VALUES = ['', 'CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài'];
const USER_CONG_DOAN_LEGACY_MAP = {
  '': '',
  'CBM': 'CBM',
  'sáp': 'sáp',
  'SÁP': 'sáp',
  'SÁP/Cadcam': 'CAD/CAM',
  'CAD/CAM': 'CAD/CAM',
  'sườn': 'sườn',
  'SƯỜN': 'sườn',
  'đắp': 'đắp',
  'ĐẮP': 'đắp',
  'mài': 'mài',
  'MÀI': 'mài',
};

let USERS = {};

function normalizeUserCongDoan(value) {
  const raw = (value || '').trim();
  return USER_CONG_DOAN_LEGACY_MAP[raw] ?? raw;
}

function isValidUserCongDoan(value) {
  return USER_CONG_DOAN_VALUES.includes(value);
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_JSON_PATH)) {
      const data = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
      USERS = {};
      data.users.forEach(u => {
        const cong_doan = normalizeUserCongDoan(u.cong_doan);
        USERS[u.username] = {
          passwordHash: u.passwordHash || u.password,
          role: u.role,
          cong_doan,
          can_view_stats: u.can_view_stats === true,
        };
      });
      log(`📋 Loaded ${data.users.length} user(s) from users.json`);
    } else {
      USERS = { admin: { passwordHash: '$2b$10$placeholder', role: 'admin' } };
      saveUsers();
      log(`✅ Created default admin user`);
    }
  } catch (e) {
    log(`⚠ Error loading users: ${e.message}`);
    USERS = { admin: { passwordHash: '$2b$10$placeholder', role: 'admin' } };
  }
}

function saveUsers() {
  try {
    const users = Object.entries(USERS).map(([username, data]) => ({
      username,
      passwordHash: data.passwordHash,
      role: data.role,
      cong_doan: data.cong_doan || '',
      can_view_stats: data.can_view_stats === true,
    }));
    fs.writeFileSync(USERS_JSON_PATH, JSON.stringify({ users }, null, 2));
  } catch (e) {
    log(`❌ Error saving users: ${e.message}`);
  }
}

module.exports = {
  USERS,
  USER_CONG_DOAN_VALUES,
  USER_CONG_DOAN_LEGACY_MAP,
  normalizeUserCongDoan,
  isValidUserCongDoan,
  hashPassword,
  verifyPassword,
  loadUsers,
  saveUsers,
};
