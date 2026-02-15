import { describe, it, expect } from 'vitest';

import { ensureSchema } from '../src/db-pg/migrate.js';
import { getReimbursementBalance, insertReimbursement } from '../src/db-pg/reimbursementsRepo.js';

// Note: This test runs against the configured Postgres (Supabase) the same way the app does.
// It avoids HTTP to keep it fast/stable, but still validates the reimbursement math end-to-end
// at the DB layer.

describe('reimbursements pipeline (integration)', () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? it : it.skip;

  testFn('updates Vyas balance when a split reimbursement is inserted', async () => {
    await ensureSchema();

    const before = await getReimbursementBalance({ otherParty: 'vyas', currency: 'USD' });

    // Simulate: Vyas paid, equal split of 300 => I owe Vyas 150.
    await insertReimbursement({
      occurredOn: '2026-02-15',
      source: 'test',
      expenseId: `test-${Date.now()}`,
      otherParty: 'vyas',
      direction: 'i_owe_them',
      amount: 150,
      currency: 'USD',
      rawText: 'room 300 paidby:roommate other:vyas split:equal 2026-02-15',
    });

    const after = await getReimbursementBalance({ otherParty: 'vyas', currency: 'USD' });

    // After inserting an i_owe_them reimbursement, net should go down by that amount.
    expect(Number(after.net) - Number(before.net)).toBeCloseTo(-150, 5);
  });
});
