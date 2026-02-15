import { getPool } from './pool.js';

// Idempotent migration for MVP.
export async function ensureSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      occurred_on DATE NOT NULL,
      source TEXT NOT NULL,
      from_user TEXT,
      raw_text TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      currency TEXT NOT NULL,
      category TEXT,
      note TEXT
    );

    -- Add new columns (safe for existing DBs)
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS card TEXT;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_by TEXT NOT NULL DEFAULT 'me';
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_type TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_ratio_me NUMERIC;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_ratio_other NUMERIC;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS other_party TEXT;
  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS my_amount NUMERIC;

  -- Backfill my_amount for older rows (best-effort; safe to run repeatedly)
  UPDATE expenses SET my_amount = amount WHERE my_amount IS NULL;

  -- Automatic cleanup: rename legacy default party name
  UPDATE expenses SET other_party = 'vyas' WHERE other_party = 'roommate';

    CREATE TABLE IF NOT EXISTS reimbursements (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      occurred_on DATE NOT NULL,
      source TEXT NOT NULL,
      from_user TEXT,
      expense_id TEXT,
      other_party TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      currency TEXT NOT NULL,
      note TEXT,
      raw_text TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reimbursements_occurred_on ON reimbursements(occurred_on);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_created_at ON reimbursements(created_at);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_currency ON reimbursements(currency);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_other_party ON reimbursements(other_party);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_expense_id ON reimbursements(expense_id);

  -- Automatic cleanup: rename legacy default party name
  UPDATE reimbursements SET other_party = 'vyas' WHERE other_party = 'roommate';

    CREATE INDEX IF NOT EXISTS idx_expenses_occurred_on ON expenses(occurred_on);
    CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_currency ON expenses(currency);
    CREATE INDEX IF NOT EXISTS idx_expenses_card ON expenses(card);
  `);

  // General-purpose ledger for non-expense events (income, transfers to savings, investments, liabilities).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      occurred_on DATE NOT NULL,
      source TEXT NOT NULL,
      from_user TEXT,
      raw_text TEXT NOT NULL,
      type TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      currency TEXT NOT NULL,
      direction TEXT,
      counterparty TEXT,
      account TEXT,
      asset TEXT,
      liability TEXT,
      note TEXT
    )`
  );

  // Best-effort: add columns if a previous version created a smaller table.
  await pool.query(`ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS account TEXT`);
  await pool.query(`ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS asset TEXT`);
  await pool.query(`ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS liability TEXT`);
  await pool.query(`ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS note TEXT`);
  await pool.query(`ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS direction TEXT`);
  await pool.query(`ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS counterparty TEXT`);
}
