module.exports = {
  apps: [{
    name: 'asia-lab-server',
    script: 'server.js',
    cwd: 'C:\\Users\\Administrator\\Desktop\\crap_dev',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
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
      LABO_USER1: 'lanhn',
      LABO_PASS1: '796803',
      LABO_USER2: 'kythuat',
      LABO_PASS2: '670226',
      PLAYWRIGHT_BROWSERS_PATH: 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright',
    }
  }]
};
