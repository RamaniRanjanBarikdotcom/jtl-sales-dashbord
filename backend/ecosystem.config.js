module.exports = {
  apps: [{
    name: 'jtl-backend',
    script: './dist/main.js',
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '512M',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    watch: false,
    autorestart: true,
    restart_delay: 5000,
  }],
};
