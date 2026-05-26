module.exports = {
  apps: [{
    name: 'asia-lab-server',
    script: 'server.js',
    cwd: 'C:\\Users\\Administrator\\Desktop\\crap_dev',
    instances: 2,
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      TZ: 'Asia/Ho_Chi_Minh'
    },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000
  },
  {
    name: 'auto-scrape',
    script: 'auto_scrape_headless.py',
    interpreter: 'python',
    cwd: 'C:\\Users\\Administrator\\Desktop\\crap_dev',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    error_file: 'logs/auto-scrape-error.log',
    out_file: 'logs/auto-scrape-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    min_uptime: '30s',
    max_restarts: 5,
    restart_delay: 10000,
    env: {
      PYTHONIOENCODING: 'utf-8',
      PLAYWRIGHT_BROWSERS_PATH: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright',
      TZ: 'Asia/Ho_Chi_Minh'
    }
  },
  {
    name: 'd1-sqlite-sync',
    script: 'scripts/d1-sync-sqlite.js',
    cwd: 'C:\\Users\\Administrator\\Desktop\\crap_dev',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    args: '--direction=auto --loop --interval=300',
    error_file: 'logs/d1-sync-error.log',
    out_file: 'logs/d1-sync-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    min_uptime: '30s',
    max_restarts: 5,
    restart_delay: 10000,
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Ho_Chi_Minh'
    }
  }]
};
