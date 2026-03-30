module.exports = {
  apps: [{
    name:              'jtl-sync',
    script:            './dist/main.js',
    instances:         1,           // MUST be 1 — cron must not run twice
    exec_mode:         'fork',       // NOT cluster
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '256M',
    error_file:         './logs/pm2-error.log',
    out_file:           './logs/pm2-out.log',
    log_date_format:    'YYYY-MM-DD HH:mm:ss',
    watch:              false,
    autorestart:        true,
    restart_delay:      10000,
    // Graceful shutdown
    kill_timeout:       5000,
    listen_timeout:     3000,
  }],
};
