'use strict';
const express = require('express');
const path    = require('path');
const router  = express.Router();
const { spawn } = require('child_process');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  getScrapeJob, getKeylabJob, getScrapeQueue,
  spawnScraper, findLatestExcel, checkKeylabHealth, spawnKeylabExport, PYTHON,
} = require('../services/scraper.service');
const { BASE_DIR, EXCEL_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);

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
    nextRun: '10 phút',
    mode: '24/7',
    queue: getScrapeQueue().length,
  });
});

router.post('/api/auto-scrape/run', requirePermission('admin.upload_excel'), (req, res) => {
  const job = getScrapeJob();
  if (job.running) return res.json({ ok: false, error: 'Scraper đang chạy: ' + job.file });
  const latest = findLatestExcel();
  if (!latest) return res.json({ ok: false, error: 'Không tìm thấy file Excel' });
  log(`🔄 Manual auto-scrape: ${latest.name}`);
  spawnScraper(latest.path);
  res.json({ ok: true, file: latest.name });
});

router.get('/keylab-status', requireAuth, (req, res) => {
  res.json(getKeylabJob());
});

router.get('/keylab-health', requireAuth, async (req, res) => {
  try {
    const result = await checkKeylabHealth();
    res.json(result);
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

router.post('/keylab-export-now', requirePermission('admin.keylab_export'), async (req, res) => {
  const job = getKeylabJob();
  if (job.running) return res.status(409).json({ ok: false, message: 'Đang chạy rồi, vui lòng đợi...' });

  try {
    const healthCheck = await checkKeylabHealth();
    if (!healthCheck.ok) {
      log(`⚠ Pre-flight check failed: ${healthCheck.message}`);
      return res.status(503).json({ ok: false, message: 'Keylab2022 không chạy. Vui lòng mở app trước.' });
    }
    log(`✓ Pre-flight check passed: ${healthCheck.message}`);
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Không thể kiểm tra Keylab2022' });
  }

  spawnKeylabExport();
  res.json({ ok: true, message: 'Đang xuất Excel từ KeyLab...' });
});

router.get('/keylab-export-status', requireAuth, (req, res) => {
  res.json(getKeylabJob());
});

module.exports = router;
