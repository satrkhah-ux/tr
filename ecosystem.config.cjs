/**
 * PM2 Ecosystem — PalmX Bot
 * ─────────────────────────
 * Start:   pm2 start ecosystem.config.cjs --only plamx-bot
 * Stop:    pm2 stop plamx-bot
 * Restart: pm2 restart plamx-bot
 * Logs:    pm2 logs plamx-bot
 * Status:  pm2 status
 * Save:    pm2 save  (persist across reboots)
 */

module.exports = {
  apps: [
    {
      name: "plamx-bot",
      script: "scripts/bot.mjs",
      interpreter: "node",
      cwd: process.cwd(),

      // ── Restart policy ─────────────────────────────────────
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 5000,       // wait 5s between restarts
      exp_backoff_restart_delay: 1000,

      // ── Logging ────────────────────────────────────────────
      out_file: "logs/bot-out.log",
      error_file: "logs/bot-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      // ── Environment ────────────────────────────────────────
      env: {
        NODE_ENV: "production",
      },
      env_file: ".env.local",

      // ── Node flags ─────────────────────────────────────────
      node_args: "--experimental-vm-modules",
    },
  ],
};
