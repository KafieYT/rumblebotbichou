module.exports = {
  apps: [
    {
      name: 'rumble-bot',
      script: 'src/Bot.mjs',
      interpreter: 'node',
      interpreter_args: '--experimental-vm-modules',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
}
