module.exports = {
  apps: [
    {
      name: 'aleo-oracle-gateway',
      script: 'dist/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      // Delegated proving still compiles circuits + builds authorizations locally.
      // These steps can exceed 512MB RSS (first run may be >1GB), so keep this high enough
      // or PM2 will restart the process mid-transaction.
      max_memory_restart: '4096M',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
