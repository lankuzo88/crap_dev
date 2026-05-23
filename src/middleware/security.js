'use strict';
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const path      = require('path');
const { requireAuth } = require('./auth');
const { ERROR_IMAGE_DIR } = require('../config/paths');
const express   = require('express');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

// Login thành công redirect về '/', login fail redirect về '/login?error=1'.
// Chỉ tính fail vào quota.
function loginWasSuccessful(req, res) {
  if (res.statusCode >= 400) return false;
  const loc = String(res.getHeader('Location') || '');
  return loc === '/' || loc.startsWith('/?');
}

// Lớp 1: per-username — chặn brute force theo tài khoản, miễn nhiễm NAT chung.
const loginLimiterByUsername = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: false,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: loginWasSuccessful,
  keyGenerator: (req) => {
    const u = String(req.body?.username || '').toLowerCase().trim();
    return u ? `user:${u}` : `ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: (req, res) => {
    const u = String(req.body?.username || '').trim() || req.ip;
    log(`🚨 Login rate limit (per user) exceeded: ${u}`);
    res.status(429).json({
      ok: false,
      error: 'Tài khoản này đã nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.',
      retryAfter: 900,
    });
  },
});

// Lớp 2: per-IP — loose, dùng làm phòng tuyến chống flood/credential stuffing.
// Đủ dư cho cả văn phòng (100 user NAT chung) login burst buổi sáng.
const loginLimiterByIp = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: false,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: loginWasSuccessful,
  handler: (req, res) => {
    log(`🚨 Login rate limit (per IP) exceeded for IP: ${req.ip}`);
    res.status(429).json({
      ok: false,
      error: 'Quá nhiều request từ địa chỉ này. Vui lòng thử lại sau 15 phút.',
      retryAfter: 900,
    });
  },
});

const loginLimiter = [loginLimiterByIp, loginLimiterByUsername];

// Chặn truy cập trực tiếp vào file HTML (trừ login.html)
function blockDirectHtml(req, res, next) {
  if (req.path.endsWith('.html') && req.path !== '/login.html') {
    return requireAuth(req, res, next);
  }
  next();
}

// Serve ảnh lỗi, chỉ cho user đã đăng nhập
const serveErrorImages = [
  requireAuth,
  express.static(ERROR_IMAGE_DIR, {
    dotfiles: 'deny',
    index: false,
    fallthrough: false,
    maxAge: '1h',
  }),
];

module.exports = { loginLimiter, blockDirectHtml, serveErrorImages };
