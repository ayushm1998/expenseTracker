import 'dotenv/config';

import { beforeAll, describe, expect, it } from 'vitest';
import { ensureSchema } from '../src/db-pg/migrate.js';
import { insertExpense, listExpenses } from '../src/db-pg/expensesRepo.js';
import { parseExpenseMessage } from '../src/lib/parseMessage.js';

const hasDb = Boolean(process.env.DATABASE_URL);

// These are integration tests; they run only when DATABASE_URL is provided.
// To run:
//   DATABASE_URL=... npm test
// or set it in .env.

describe.runIf(hasDb)('db-pg expensesRepo (integration)', () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  it('returns occurredOn as YYYY-MM-DD', async () => {
    const parsed = parseExpenseMessage('food 1 repo-test');
    expect(parsed).not.toBeNull();

    const exp = await insertExpense({
      text: 'food 1 repo-test',
      from: 'test',
      source: 'test',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      parsed: parsed!,
      defaultCurrency: 'INR',
    });

    expect(exp.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [latest] = await listExpenses({ limit: 1 });
    expect(latest).toBeTruthy();
    expect(latest.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
