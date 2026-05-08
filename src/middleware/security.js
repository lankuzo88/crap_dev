'use strict';
const rateLimit = require('express-rate-limit');
const path      = require('path');
const { requireAuth } = require('./auth');
const { ERROR_IMAGE_DIR } = require('../config/paths');
const express   = require('express');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: false,
  legacyHeaders: false,
  handler: (req, res) => {
    log(`🚨 Login rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      ok: false,
      error: 'Quá nhiều lần thử sai. Vui lòng thử lại sau 15 phút.',
      retryAfter: 900,
    });
  },
});

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
