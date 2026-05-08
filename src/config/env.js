'use strict';
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

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
};
