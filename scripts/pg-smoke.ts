import 'dotenv/config';

import { ensureSchema } from '../src/db-pg/migrate.js';
import { insertExpense, listExpenses, sumAllTime, sumForRange } from '../src/db-pg/expensesRepo.js';
import { parseExpenseMessage } from '../src/lib/parseMessage.js';

async function main() {
  // Basic guards
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Put it in your .env (not committed) or export it in your shell.');
  }

  console.log('Ensuring schema...');
  await ensureSchema();

  console.log('Inserting one test expense...');
  const parsed = parseExpenseMessage('food 12 test-smoke');
  if (!parsed) throw new Error('parseExpenseMessage failed');

  const exp = await insertExpense({
    text: 'food 12 test-smoke',
    from: 'smoke',
    source: 'smoke',
    parsed,
    defaultCurrency: process.env.CURRENCY ?? 'INR',
  });
  console.log('Inserted:', { id: exp.id, amount: exp.amount, currency: exp.currency, occurredOn: exp.occurredOn });

  const all = await sumAllTime();
  console.log('All-time:', all);

  const today = new Date().toISOString().slice(0, 10);
  const todaySum = await sumForRange({ from: today, toInclusive: today });
  console.log('Today:', todaySum);

  const recent = await listExpenses({ limit: 5 });
  console.log('Recent (max 5):', recent.map((r) => ({ id: r.id, amount: r.amount, currency: r.currency })));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
