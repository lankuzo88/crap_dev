'use strict';
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DB_PROVIDER: (process.env.DB_PROVIDER || 'sqlite').toLowerCase(),

  // Image settings
  IMAGE_RETENTION_DAYS: Number(process.env.IMAGE_RETENTION_DAYS || 90),
  IMAGE_MAX_WIDTH:      Number(process.env.IMAGE_MAX_WIDTH || 1600),
  IMAGE_MAX_HEIGHT:     Number(process.env.IMAGE_MAX_HEIGHT || 1600),
  IMAGE_WEBP_QUALITY:   Number(process.env.IMAGE_WEBP_QUALITY || 75),

  // R2 / Cloudflare
  R2_ENDPOINT:        process.env.R2_ENDPOINT,
  R2_ACCESS_KEY_ID:   process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME:     process.env.R2_BUCKET_NAME,
  R2_PUBLIC_URL:      process.env.R2_PUBLIC_URL,

  // Cloudflare D1
  D1_ACCOUNT_ID:       process.env.D1_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID,
  D1_DATABASE_ID:      process.env.D1_DATABASE_ID || '43d68055-1ca4-4e80-ad4c-2b099f3f4004',
  D1_API_TOKEN:        process.env.D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN,
  D1_API_BASE_URL:     process.env.D1_API_BASE_URL || 'https://api.cloudflare.com/client/v4',
  D1_SYNC_TIMEOUT_MS:  Number(process.env.D1_SYNC_TIMEOUT_MS || 30000),
};
