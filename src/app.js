'use strict';
require('./config/env'); // Load .env sớm nhất

const express = require('express');
const app     = express();

// Wire up scraper ↔ orders cache reset (tránh circular dep)
// ── Body parser ───────────────────────────────────────
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────
app.use('/', require('./routes/auth.routes'));
app.use('/', require('./routes/dashboard.routes'));
app.use('/', require('./routes/users.routes'));
app.use('/', require('./routes/admin.routes'));
app.use('/', require('./routes/orders.routes'));
app.use('/', require('./routes/ordersNew.routes'));
app.use('/', require('./routes/analytics.routes'));
app.use('/', require('./routes/keylab.routes'));
app.use('/', require('./routes/feedback.routes'));
app.use('/', require('./routes/errorReports.routes'));
app.use('/', require('./routes/delayReports.routes'));
app.use('/', require('./routes/munger.routes'));
app.use('/', require('./routes/stats.routes'));
app.use('/', require('./routes/backup.routes'));

// ── Static: ảnh lỗi (auth protected) ─────────────────
const { serveErrorImages, blockDirectHtml } = require('./middleware/security');
app.use(blockDirectHtml);
app.use('/uploads/error-images', serveErrorImages);

// ── 404 ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[Error] ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
