#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
  } catch {
    return '';
  }
}

function killPort(port) {
  const out = tryExec(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
  if (!out) return;
  const pids = out
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!pids.length) return;

  console.log(`[dev-clean] Killing listeners on port ${port}: ${pids.join(', ')}`);
  tryExec(`kill -9 ${pids.join(' ')}`);
}

function pkill(pattern) {
  // Ignore errors if nothing matches
  tryExec(`pkill -f "${pattern}" || true`);
}

// Be a bit aggressive: tsx watch sometimes leaves strays when interrupted.
killPort(3000);
killPort(5173);

pkill('tsx watch src/server.ts');
pkill('node.*tsx.*watch src/server.ts');
pkill('node.*src/server.ts');
pkill('vite');

// Start backend + client.
// Inherit env so .env works via dotenv/config and user shell exports.
const backend = spawn('npm', ['run', 'dev'], { stdio: 'inherit' });
const client = spawn('npm', ['run', 'dev:client'], { stdio: 'inherit' });

function shutdown(code = 0) {
  try {
    backend.kill('SIGTERM');
  } catch {}
  try {
    client.kill('SIGTERM');
  } catch {}
  // Ensure the ports are released even if watchers get stuck.
  setTimeout(() => {
    killPort(3000);
    killPort(5173);
    process.exit(code);
  }, 400);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

backend.on('exit', (code) => {
  console.log(`[dev-clean] Backend exited (${code ?? 'unknown'}). Shutting down client.`);
  shutdown(typeof code === 'number' ? code : 0);
});

client.on('exit', (code) => {
  console.log(`[dev-clean] Client exited (${code ?? 'unknown'}). Shutting down backend.`);
  shutdown(typeof code === 'number' ? code : 0);
});
