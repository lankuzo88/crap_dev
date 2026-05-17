'use strict';
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const multer = require('multer');
const { r2Client, PutObjectCommand, DeleteObjectCommand } = require('./r2.service');
const { getDB } = require('../db/index');
const env   = require('../config/env');
const { BASE_DIR, ERROR_IMAGE_DIR } = require('../config/paths');

const log = msg => console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
const REPORT_IMAGE_LIMIT = 6;

async function compressErrorImage(inputBuffer) {
  return sharp(inputBuffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: env.IMAGE_MAX_WIDTH,
      height: env.IMAGE_MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: env.IMAGE_WEBP_QUALITY, effort: 4 })
    .toBuffer();
}

class R2Storage {
  _handleFile(req, file, cb) {
    const ma_dh = (req.body?.ma_dh || 'unknown').replace(/[^a-zA-Z0-9\-]/g, '_');
    const suffix = crypto.randomBytes(4).toString('hex');
    const key   = `error-images/${ma_dh}_${Date.now()}_${suffix}.webp`;
    const chunks = [];

    file.stream.on('data', chunk => chunks.push(chunk));
    file.stream.on('end', async () => {
      try {
        const original = Buffer.concat(chunks);
        const body = await compressErrorImage(original);
        await r2Client.send(new PutObjectCommand({
          Bucket: env.R2_BUCKET_NAME,
          Key: key,
          Body: body,
          ContentType: 'image/webp',
        }));
        log(`[R2] Image compressed ${original.length} -> ${body.length} bytes (${key})`);
        cb(null, {
          key,
          location: `${env.R2_PUBLIC_URL}/${key}`,
          size: body.length,
          originalSize: original.length,
        });
      } catch (err) {
        log(`[R2] Upload failed: ${err.message}`);
        cb(err);
      }
    });
    file.stream.on('error', cb);
  }

  _removeFile(req, file, cb) { cb(null); }
}

const uploadImage = multer({
  storage: new R2Storage(),
  fileFilter: (req, file, cb) => { cb(null, file.mimetype.startsWith('image/')); },
  limits: { fileSize: 10 * 1024 * 1024, files: REPORT_IMAGE_LIMIT },
});

const uploadLocalImage = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => { cb(null, file.mimetype.startsWith('image/')); },
  limits: { fileSize: 10 * 1024 * 1024, files: REPORT_IMAGE_LIMIT },
});

function parseImageRefs(imageRef) {
  if (!imageRef) return [];
  if (Array.isArray(imageRef)) return imageRef.filter(Boolean).map(String);
  const raw = String(imageRef).trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {}
  }
  return [raw];
}

function stringifyImageRefs(imageRefs) {
  const refs = parseImageRefs(imageRefs);
  if (!refs.length) return null;
  return JSON.stringify(refs);
}

async function saveCompressedLocalImage(file, maDh, prefix = 'delay') {
  if (!file?.buffer) throw new Error('Image file is empty');
  const safeMaDh = String(maDh || 'unknown').replace(/[^a-zA-Z0-9\-]/g, '_');
  fs.mkdirSync(ERROR_IMAGE_DIR, { recursive: true });
  const fileName = `${prefix}_${safeMaDh}_${Date.now()}.webp`;
  const filePath = path.join(ERROR_IMAGE_DIR, fileName);
  const body = await compressErrorImage(file.buffer);
  fs.writeFileSync(filePath, body);
  log(`[LocalImage] Image compressed ${file.buffer.length} -> ${body.length} bytes (${fileName})`);
  return {
    fileName,
    path: filePath,
    size: body.length,
    originalSize: file.buffer.length,
  };
}

function getR2KeyFromImageRef(imageRef) {
  if (!imageRef || !imageRef.startsWith('http')) return '';
  try {
    const url = new URL(imageRef);
    if (env.R2_PUBLIC_URL) {
      const publicUrl = new URL(env.R2_PUBLIC_URL);
      if (url.origin !== publicUrl.origin) return '';
    }
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch { return ''; }
}

function getLocalErrorImagePath(imageRef) {
  if (!imageRef || imageRef.startsWith('http')) return '';
  const fileName = path.basename(imageRef);
  return path.join(BASE_DIR, 'uploads', 'error-images', fileName);
}

async function deleteErrorImage(imageRef) {
  if (!imageRef) return false;

  const r2Key = getR2KeyFromImageRef(imageRef);
  if (r2Key) {
    await r2Client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: r2Key }));
    return true;
  }

  const localPath = getLocalErrorImagePath(imageRef);
  if (localPath && fs.existsSync(localPath)) {
    fs.unlinkSync(localPath);
    return true;
  }
  return false;
}

async function cleanupExpiredErrorImages() {
  const retentionDays = Number.isFinite(env.IMAGE_RETENTION_DAYS) && env.IMAGE_RETENTION_DAYS > 0
    ? env.IMAGE_RETENTION_DAYS : 90;
  const db = getDB();
  if (!db) return;

  const rows = db.prepare(`
    SELECT 'error_reports' AS source_table, id, hinh_anh FROM error_reports
    WHERE hinh_anh IS NOT NULL AND hinh_anh <> ''
      AND submitted_at < datetime('now','localtime', ?)
    UNION ALL
    SELECT 'delay_reports' AS source_table, id, hinh_anh FROM delay_reports
    WHERE hinh_anh IS NOT NULL AND hinh_anh <> ''
      AND submitted_at < datetime('now','localtime', ?)
  `).all(`-${retentionDays} days`, `-${retentionDays} days`);

  if (!rows.length) { log(`[ImageCleanup] No images older than ${retentionDays} days`); return; }

  let deleted = 0, cleared = 0, failed = 0;
  const clearErrorRef = db.prepare('UPDATE error_reports SET hinh_anh=NULL WHERE id=?');
  const clearDelayRef = db.prepare('UPDATE delay_reports SET hinh_anh=NULL WHERE id=?');

  for (const row of rows) {
    try {
      const refs = parseImageRefs(row.hinh_anh);
      let rowDeleted = 0;
      for (const ref of refs) {
        if (await deleteErrorImage(ref)) rowDeleted++;
      }
      if (row.source_table === 'delay_reports') clearDelayRef.run(row.id);
      else clearErrorRef.run(row.id);
      deleted += rowDeleted;
      cleared++;
    } catch (err) {
      failed++;
      log(`[ImageCleanup] Failed report=${row.id}: ${err.message}`);
    }
  }
  log(`[ImageCleanup] Cleared ${cleared}/${rows.length} old image ref(s), deleted=${deleted}, failed=${failed}`);
}

function startImageCleanupSchedule() {
  cleanupExpiredErrorImages().catch(err => log(`[ImageCleanup] Startup error: ${err.message}`));
  setInterval(() => {
    cleanupExpiredErrorImages().catch(err => log(`[ImageCleanup] Scheduled error: ${err.message}`));
  }, 24 * 60 * 60 * 1000);
}

module.exports = {
  compressErrorImage,
  uploadImage,
  uploadLocalImage,
  saveCompressedLocalImage,
  parseImageRefs,
  stringifyImageRefs,
  REPORT_IMAGE_LIMIT,
  getR2KeyFromImageRef,
  getLocalErrorImagePath,
  deleteErrorImage,
  cleanupExpiredErrorImages,
  startImageCleanupSchedule,
};
