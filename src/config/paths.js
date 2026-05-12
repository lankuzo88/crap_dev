'use strict';
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', '..');

module.exports = {
  BASE_DIR,
  FILE_SACH_DIR:  path.join(BASE_DIR, 'File_sach'),
  DATA_DIR:       path.join(BASE_DIR, 'Data'),
  EXCEL_DIR:      path.join(BASE_DIR, 'Excel'),
  DB_PATH:        path.join(BASE_DIR, 'labo_data.db'),
  KEYLAB_NOTES_PATH: path.join(BASE_DIR, 'keylab_notes.json'),
  SESSIONS_PATH:  path.join(BASE_DIR, 'sessions.json'),
  USERS_JSON_PATH: path.join(BASE_DIR, 'users.json'),

  DASHBOARD:        path.join(BASE_DIR, 'dashboard.html'),
  DASHBOARD_MOBILE: path.join(BASE_DIR, 'dashboard_mobile_terracotta.html'),
  ERROR_IMAGE_DIR:  path.join(BASE_DIR, 'uploads', 'error-images'),
};
