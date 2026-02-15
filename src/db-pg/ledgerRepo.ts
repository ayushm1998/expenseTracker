import crypto from 'node:crypto';

import { ensureSchema } from './migrate.js';
import { getPool } from './pool.js';

export type LedgerEntry = {
  id: string;
  createdAt: string;
  occurredOn: string; // YYYY-MM-DD
  source: string;
  fromUser: string | null;
  rawText: string;
  type: 'expense' | 'income' | 'transfer' | 'investment' | 'liability' | 'receivable';
  amount: number;
  currency: string;
  direction: 'i_lent' | 'i_borrowed' | 'repay' | 'collect' | null;
  counterparty: string | null;
  account: string | null;
  asset: string | null;
  liability: string | null;
  note: string | null;
};

function toYmd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function insertLedgerEntry(args: {
  occurredOn: string;
  source: string;
  from?: string;
  rawText: string;
  type: LedgerEntry['type'];
  amount: number;
  currency: string;
  direction?: LedgerEntry['direction'];
  counterparty?: string;
  account?: string;
  asset?: string;
  liability?: string;
  note?: string;
}): Promise<LedgerEntry> {
  await ensureSchema();
  const pool = getPool();

  const id = crypto.randomUUID();
  const createdAt = new Date();

  const row = await pool.query(
    `INSERT INTO ledger_entries (
      id, created_at, occurred_on, source, from_user, raw_text,
      type, amount, currency, direction, counterparty, account, asset, liability, note
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING id, created_at, occurred_on::text as occurred_on, source, from_user, raw_text,
      type, amount, currency, direction, counterparty, account, asset, liability, note`,
    [
      id,
      createdAt,
      args.occurredOn,
      args.source,
      args.from ?? null,
      args.rawText,
      args.type,
      args.amount,
      args.currency,
      args.direction ?? null,
      args.counterparty ?? null,
      args.account ?? null,
      args.asset ?? null,
      args.liability ?? null,
      args.note ?? null,
    ]
  );

  const r = row.rows[0];
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    occurredOn: toYmd(r.occurred_on),
    source: r.source,
    fromUser: r.from_user,
    rawText: r.raw_text,
    type: r.type,
    amount: Number(r.amount),
    currency: r.currency,
    direction: r.direction,
    counterparty: r.counterparty,
    account: r.account,
    asset: r.asset,
    liability: r.liability,
    note: r.note,
  };
}

export async function listLedgerEntries(args: {
  limit: number;
  from?: string;
  to?: string;
  type?: LedgerEntry['type'];
}): Promise<LedgerEntry[]> {
  await ensureSchema();
  const pool = getPool();

  const params: Array<string | number> = [];
  let where = 'TRUE';

  if (args.from) {
    params.push(args.from);
    where += ` AND occurred_on >= $${params.length}`;
  }
  if (args.to) {
    params.push(args.to);
    where += ` AND occurred_on <= $${params.length}`;
  }
  if (args.type) {
    params.push(args.type);
    where += ` AND type = $${params.length}`;
  }

  params.push(args.limit);
  const limitParam = `$${params.length}`;

  const res = await pool.query(
    `SELECT id, created_at, occurred_on::text as occurred_on, source, from_user, raw_text,
      type, amount, currency, direction, counterparty, account, asset, liability, note
     FROM ledger_entries
     WHERE ${where}
     ORDER BY occurred_on DESC, created_at DESC
     LIMIT ${limitParam}`,
    params
  );

  return res.rows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    occurredOn: toYmd(r.occurred_on),
    source: r.source,
    fromUser: r.from_user,
    rawText: r.raw_text,
    type: r.type,
    amount: Number(r.amount),
    currency: r.currency,
    direction: r.direction,
    counterparty: r.counterparty,
    account: r.account,
    asset: r.asset,
    liability: r.liability,
    note: r.note,
  }));
}

export async function getReceivableBalances(args: { currency: string }): Promise<
  Array<{ counterparty: string; net: number; iOwe: number; theyOwe: number }>
> {
  await ensureSchema();
  const pool = getPool();

  // Net sign convention:
  //  +net => they owe me
  //  -net => I owe them
  const res = await pool.query(
    `SELECT
      COALESCE(counterparty, '') as counterparty,
      COALESCE(SUM(
        CASE
          WHEN type = 'receivable' AND direction = 'i_lent' THEN amount
          WHEN type = 'receivable' AND direction = 'collect' THEN -amount
          WHEN type = 'receivable' AND direction = 'i_borrowed' THEN -amount
          WHEN type = 'receivable' AND direction = 'repay' THEN amount
          ELSE 0
        END
      ), 0)::text as net
     FROM ledger_entries
     WHERE currency = $1 AND type = 'receivable' AND counterparty IS NOT NULL AND counterparty <> ''
     GROUP BY counterparty
     ORDER BY counterparty ASC`,
    [args.currency]
  );

  return res.rows.map((r) => {
    const net = Number(r.net);
    return {
      counterparty: r.counterparty,
      net,
      theyOwe: net > 0 ? net : 0,
      iOwe: net < 0 ? -net : 0,
    };
  });
}

export async function getLedgerTotals(args: { currency: string }): Promise<{
  incomeTotal: number;
  savingsTotal: number;
  investmentTotal: number;
  liabilityTotal: number;
}> {
  await ensureSchema();
  const pool = getPool();

  const res = await pool.query(
    `SELECT
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::text as income_total,
      COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END), 0)::text as savings_total,
      COALESCE(SUM(CASE WHEN type = 'investment' THEN amount ELSE 0 END), 0)::text as investment_total,
      COALESCE(SUM(CASE WHEN type = 'liability' THEN amount ELSE 0 END), 0)::text as liability_total
     FROM ledger_entries
     WHERE currency = $1`,
    [args.currency]
  );

  return {
    incomeTotal: Number(res.rows[0].income_total),
    savingsTotal: Number(res.rows[0].savings_total),
    investmentTotal: Number(res.rows[0].investment_total),
    liabilityTotal: Number(res.rows[0].liability_total),
  };
}
