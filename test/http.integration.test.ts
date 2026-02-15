import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

import app from '../src/app.js';
import { ensureSchema } from '../src/db-pg/migrate.js';
import { getPool } from '../src/db-pg/pool.js';

function listen(server: http.Server): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1');
    server.once('listening', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('Unexpected listen address'));
      resolve({ port: addr.port });
    });
    server.once('error', reject);
  });
}

async function httpJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

describe('HTTP integration (optional)', () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? it : it.skip;

  let server: http.Server | null = null;
  let base = '';

  beforeAll(async () => {
    if (!hasDb) return;
    await ensureSchema();
    server = http.createServer(app);
    const { port } = await listen(server);
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (!hasDb) return;
    if (server) await new Promise<void>((r) => server?.close(() => r()));
    // Cleanly end pool so vitest doesn't hang.
    await getPool().end();
  });

  testFn('POST /api/ingest-message updates Vyas reimbursement balance', async () => {
    const before = await httpJson(`${base}/api/reimbursements/balance?otherParty=vyas`);
    const beforeNet = Number(before.balance?.net ?? before.net ?? 0);

    // Vyas paid, split equal => I owe Vyas half.
    // Use the new UI-compatible split token syntax.
    await httpJson(`${base}/api/ingest-message`, {
      method: 'POST',
      body: JSON.stringify({
        text: 'room 300 paidby:roommate other:vyas split:equal 2026-02-15',
        source: 'test',
      }),
    });

    const after = await httpJson(`${base}/api/reimbursements/balance?otherParty=vyas`);
    const afterNet = Number(after.balance?.net ?? after.net ?? 0);

    // Net = theyOweMe - iOweThem, so adding iOweThem 150 should reduce net by 150.
    expect(afterNet - beforeNet).toBeCloseTo(-150, 5);
  });
});
