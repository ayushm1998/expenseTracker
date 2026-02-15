import crypto from 'node:crypto';
import { getPool } from './pool.js';
import { ensureSchema } from './migrate.js';

export type Reimbursement = {
  id: string;
  createdAt: string;
  occurredOn: string; // YYYY-MM-DD
  source: string;
  fromUser: string | null;
  expenseId: string | null;
  otherParty: string;
  direction: 'they_owe_me' | 'i_owe_them';
  amount: number;
  currency: string;
  note: string | null;
  rawText: string;
};

function toYmd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function insertReimbursement(args: {
  occurredOn: string;
  source: string;
  from?: string;
  expenseId?: string;
  otherParty: string;
  direction: 'they_owe_me' | 'i_owe_them';
  amount: number;
  currency: string;
  note?: string;
  rawText: string;
}): Promise<Reimbursement> {
  await ensureSchema();
  const pool = getPool();

  const id = crypto.randomUUID();
  const createdAt = new Date();

  const row = await pool.query(
    `INSERT INTO reimbursements (
      id, created_at, occurred_on, source, from_user, expense_id,
      other_party, direction, amount, currency, note, raw_text
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING id, created_at, occurred_on::text as occurred_on, source, from_user, expense_id,
      other_party, direction, amount, currency, note, raw_text`,
    [
      id,
      createdAt,
      args.occurredOn,
      args.source,
      args.from ?? null,
      args.expenseId ?? null,
      args.otherParty,
      args.direction,
      args.amount,
      args.currency,
      args.note ?? null,
      args.rawText,
    ]
  );

  const r = row.rows[0];
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    occurredOn: toYmd(r.occurred_on),
    source: r.source,
    fromUser: r.from_user,
    expenseId: r.expense_id,
    otherParty: r.other_party,
    direction: r.direction,
    amount: Number(r.amount),
    currency: r.currency,
    note: r.note,
    rawText: r.raw_text,
  };
}

export async function getReimbursementBalance(args?: {
  otherParty?: string;
  currency?: string;
}): Promise<{ theyOweMe: number; iOweThem: number; net: number }> {
  await ensureSchema();
  const pool = getPool();

  const params: Array<string> = [];
  let where = 'TRUE';

  if (args?.otherParty) {
    params.push(args.otherParty);
    where += ` AND other_party = $${params.length}`;
  }
  if (args?.currency) {
    params.push(args.currency);
    where += ` AND currency = $${params.length}`;
  }

  const res = await pool.query(
    `SELECT direction, COALESCE(SUM(amount), 0)::text as total
     FROM reimbursements
     WHERE ${where}
     GROUP BY direction`,
    params
  );

  let theyOweMe = 0;
  let iOweThem = 0;
  for (const row of res.rows) {
    if (row.direction === 'they_owe_me') theyOweMe = Number(row.total);
    if (row.direction === 'i_owe_them') iOweThem = Number(row.total);
  }

  return { theyOweMe, iOweThem, net: theyOweMe - iOweThem };
}

export async function listReimbursements(args?: {
  limit?: number;
  from?: string;
  to?: string;
  otherParty?: string;
  currency?: string;
}): Promise<Reimbursement[]> {
  await ensureSchema();
  const pool = getPool();

  const limit = Math.min(args?.limit ?? 100, 500);

  const params: Array<string | number> = [];
  let where = 'TRUE';

  if (args?.from) {
    params.push(args.from);
    where += ` AND occurred_on >= $${params.length}`;
  }
  if (args?.to) {
    params.push(args.to);
    where += ` AND occurred_on <= $${params.length}`;
  }
  if (args?.otherParty) {
    params.push(args.otherParty);
    where += ` AND other_party = $${params.length}`;
  }
  if (args?.currency) {
    params.push(args.currency);
    where += ` AND currency = $${params.length}`;
  }

  params.push(limit);
  const limitParam = `$${params.length}`;

  const res = await pool.query(
    `SELECT id, created_at, occurred_on::text as occurred_on, source, from_user, expense_id,
        other_party, direction, amount, currency, note, raw_text
     FROM reimbursements
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
    expenseId: r.expense_id,
    otherParty: r.other_party,
    direction: r.direction,
    amount: Number(r.amount),
    currency: r.currency,
    note: r.note,
    rawText: r.raw_text,
  }));
}

export async function listOtherParties(args?: { currency?: string }): Promise<string[]> {
  await ensureSchema();
  const pool = getPool();

  const params: string[] = [];
  let where = 'TRUE';
  if (args?.currency) {
    params.push(args.currency);
    where += ` AND currency = $1`;
  }

  const res = await pool.query(
    `SELECT DISTINCT other_party
     FROM reimbursements
     WHERE ${where}
     ORDER BY other_party ASC`,
    params
  );
  return res.rows.map((r) => String(r.other_party));
}
