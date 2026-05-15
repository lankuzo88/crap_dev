'use strict';
const fs     = require('fs');
const bcrypt = require('bcrypt');
const { USERS_JSON_PATH } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const USER_CONG_DOAN_VALUES = ['', 'CBM', 'sáp', 'CAD/CAM', 'sườn', 'đắp', 'mài'];
const PERMISSIONS = [
  'orders.view_pending',
  'orders.view_all',
  'orders.route',
  'stats.view_daily',
  'stats.view_production',
  'stats.view_monthly',
  'error_reports.submit',
  'error_reports.view_own',
  'error_reports.review',
  'error_codes.manage',
  'delay_reports.submit',
  'delay_reports.view_active',
  'delay_reports.review',
  'admin.users.manage',
  'admin.upload_excel',
  'admin.keylab_export',
  'analytics.view',
  'munger.view',
];
const ROLE_DEFAULT_PERMISSIONS = {
  admin: ['*'],
  user: ['orders.view_pending', 'error_reports.submit', 'error_reports.view_own', 'delay_reports.view_active'],
  qc: ['orders.view_pending', 'error_reports.submit', 'error_reports.view_own', 'delay_reports.view_active'],
  delay_qc: ['orders.view_pending', 'delay_reports.submit', 'delay_reports.view_active'],
};
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

function replaceUsers(nextUsers) {
  for (const username of Object.keys(USERS)) delete USERS[username];
  Object.assign(USERS, nextUsers);
}

function normalizeUserCongDoan(value) {
  const raw = (value || '').trim();
  return USER_CONG_DOAN_LEGACY_MAP[raw] ?? raw;
}

function isValidUserCongDoan(value) {
  return USER_CONG_DOAN_VALUES.includes(value);
}

function normalizePermissions(value, role, canViewStats) {
  const defaults = ROLE_DEFAULT_PERMISSIONS[role] || ROLE_DEFAULT_PERMISSIONS.user;
  const raw = Array.isArray(value) ? value : defaults;
  const allowed = new Set(['*', ...PERMISSIONS]);
  const normalized = [...new Set(raw.filter(p => allowed.has(p)))];
  if (canViewStats === true && !normalized.includes('*') && !normalized.includes('stats.view_daily')) {
    normalized.push('stats.view_daily');
  }
  return normalized;
}

function hasPermission(userOrUsername, permission) {
  const user = typeof userOrUsername === 'string' ? USERS[userOrUsername] : userOrUsername;
  if (!user) return false;
  const permissions = normalizePermissions(user.permissions, user.role, user.can_view_stats);
  return permissions.includes('*') || permissions.includes(permission);
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
      const loadedUsers = {};
      data.users.forEach(u => {
        const cong_doan = normalizeUserCongDoan(u.cong_doan);
        loadedUsers[u.username] = {
          passwordHash: u.passwordHash || u.password,
          role: u.role,
          cong_doan,
          can_view_stats: u.can_view_stats === true,
          permissions: normalizePermissions(u.permissions, u.role, u.can_view_stats === true),
        };
      });
      replaceUsers(loadedUsers);
      log(`📋 Loaded ${data.users.length} user(s) from users.json`);
    } else {
      replaceUsers({ admin: { passwordHash: '$2b$10$placeholder', role: 'admin' } });
      saveUsers();
      log(`✅ Created default admin user`);
    }
  } catch (e) {
    log(`⚠ Error loading users: ${e.message}`);
    replaceUsers({ admin: { passwordHash: '$2b$10$placeholder', role: 'admin' } });
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
      permissions: normalizePermissions(data.permissions, data.role, data.can_view_stats === true),
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
  PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  normalizeUserCongDoan,
  isValidUserCongDoan,
  normalizePermissions,
  hasPermission,
  hashPassword,
  verifyPassword,
  loadUsers,
  saveUsers,
};
