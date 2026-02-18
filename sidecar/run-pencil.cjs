const { spawn } = require('child_process');

// Use npm exec to run the server, forcing public registry and ignoring auth
const child = spawn('cmd', ['/c', 'npm', 'exec', '--yes', '--registry=https://registry.npmjs.org/', '--no-audit', '@modelcontextprotocol/server-pencil'], {
    stdio: 'inherit',
    env: { ...process.env, npm_config_registry: 'https://registry.npmjs.org/' }
});

child.on('error', (err) => {
    console.error('Failed to start pencil server:', err);
    process.exit(1);
});

child.on('exit', (code) => {
    process.exit(code);
});
