import 'dotenv/config';

import http from 'node:http';

import app from './app.js';

const PORT = Number(process.env.PORT ?? 3000);

// Extra safety: ensure sockets can't hang forever even if middleware doesn't run.
// This helps avoid Vite proxy requests sitting in a perpetual "pending" state.
const server = http.createServer(app);

// Node's defaults are generous; tighten them so unhealthy downstreams fail fast.
// - requestTimeout: time from socket connection to request completion
// - headersTimeout: time allowed to receive the full headers
// - keepAliveTimeout: idle keep-alive
const REQUEST_TIMEOUT_MS = Number(process.env.SERVER_REQUEST_TIMEOUT_MS ?? 15_000);
const HEADERS_TIMEOUT_MS = Number(process.env.SERVER_HEADERS_TIMEOUT_MS ?? 10_000);
const KEEP_ALIVE_TIMEOUT_MS = Number(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS ?? 5_000);

server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = HEADERS_TIMEOUT_MS;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

// If Node itself times out a request, make sure the connection is closed.
server.on('timeout', (socket) => {
  try {
    socket.end();
  } catch {
    // ignore
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Expense tracker running on http://localhost:${PORT}`);
});
