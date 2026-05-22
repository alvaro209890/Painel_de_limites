module.exports = {
  apps: [{
    name: 'painel-limites',
    script: 'server.js',
    cwd: __dirname,
    env: {
      LIMITS_PANEL_PORT: '8787',
      LIMITS_PANEL_SITE_PORT: '4173',
      NODE_ENV: 'production',
    },
    // Auto-restart on crash
    autorestart: true,
    // Max 10 restarts in 30s, then give up
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 2000,
    // Watch for changes (disable in prod)
    watch: false,
    // Logs
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    // Graceful shutdown
    kill_timeout: 5000,
    // Keep alive
    exp_backoff_restart_delay: 100,
    // Memory limit — restart if leaking
    max_memory_restart: '1G',
  }],
}
