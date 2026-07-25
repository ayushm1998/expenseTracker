import { spawn } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  spawn(npmCmd, ['run', 'dev:api'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SERVE_DIST_CLIENT: '0',
      DEV_FRONTEND_URL: process.env.DEV_FRONTEND_URL || 'http://localhost:5173',
    },
  }),
  spawn(npmCmd, ['run', 'dev:client'], {
    stdio: 'inherit',
    env: process.env,
  }),
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 || signal === 'SIGTERM') return;
    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
