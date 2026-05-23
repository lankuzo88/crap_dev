'use strict';
const express = require('express');
const path    = require('path');
const router  = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getScrapeJob, getKeylabJob, getScrapeQueue } = require('../services/scraper.service');

router.get('/scrape-status', requireAuth, (req, res) => {
  const job = getScrapeJob();
  res.json({ ...job, queue: getScrapeQueue().map(f => path.basename(f)) });
});

router.get('/api/auto-scrape/status', requireAuth, (req, res) => {
  const job = getScrapeJob();
  res.json({
    enabled: true,
    running: job.running,
    currentFile: job.file,
    nextRun: 'progress 10 phut; KeyLab SQL export 60 phut',
    mode: '24/7 + hourly KeyLab SQL export',
    queue: getScrapeQueue().length,
  });
});

router.post('/api/auto-scrape/run', requirePermission('admin.upload_excel'), (req, res) => {
  res.status(410).json({
    ok: false,
    error: 'Manual auto-scrape is disabled. Use Upload Excel or the hourly auto exporter.',
  });
});

router.get('/keylab-status', requireAuth, (req, res) => {
  res.json(getKeylabJob());
});

router.get('/keylab-health', requireAuth, (req, res) => {
  res.json({ ok: true, message: 'KeyLab SQL export is managed by the hourly auto exporter.' });
});

router.post('/keylab-export-now', requirePermission('admin.keylab_export'), (req, res) => {
  res.status(410).json({
    ok: false,
    message: 'Manual KeyLab refresh is disabled. KeyLab SQL export runs automatically every hour.',
  });
});

router.get('/keylab-export-status', requireAuth, (req, res) => {
  res.json(getKeylabJob());
});

module.exports = router;
