import crypto from 'node:crypto';
import { getPool } from './pool.js';
import { ensureSchema } from './migrate.js';
import type { ParsedExpense } from '../lib/parseMessage.js';

export type Expense = {
  id: string;
  createdAt: string;
  occurredOn: string; // YYYY-MM-DD
  source: string;
  fromUser: string | null;
  rawText: string;
  amount: number;
  currency: string;
  category: string | null;
  note: string | null;
  card: string | null;
  paidBy: string;
  splitType: string;
  splitRatioMe: number | null;
  splitRatioOther: number | null;
  otherParty: string | null;
  myAmount: number;
};

function toIso(d: Date): string {
  return d.toISOString();
}

function toYmd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export async function insertExpense(args: {
  text: string;
  from?: string;
  source: string;
  parsed: ParsedExpense;
  defaultCurrency: string;
}): Promise<Expense> {
  await ensureSchema();
  const pool = getPool();

  const id = crypto.randomUUID();
  const createdAt = new Date();
  const occurredOn = args.parsed.occurredOn ?? toIso(createdAt).slice(0, 10);
  const currency = args.parsed.currency ?? args.defaultCurrency;
  const myAmount = args.parsed.myAmount ?? args.parsed.amount;

  const row = await pool.query(
    `INSERT INTO expenses (
      id, created_at, occurred_on, source, from_user, raw_text, amount, currency, category, note,
      card, paid_by, split_type, split_ratio_me, split_ratio_other, other_party, my_amount
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING id, created_at, occurred_on::text as occurred_on, source, from_user, raw_text, amount, currency, category, note,
      card, paid_by, split_type, split_ratio_me, split_ratio_other, other_party, my_amount`,
    [
      id,
      createdAt,
      occurredOn,
      args.source,
      args.from ?? null,
      args.text,
      args.parsed.amount,
      currency,
      args.parsed.category ?? null,
      args.parsed.note ?? null,
      args.parsed.card ?? null,
      args.parsed.paidBy ?? 'me',
      args.parsed.splitType ?? 'none',
      args.parsed.splitRatioMe ?? null,
      args.parsed.splitRatioOther ?? null,
      args.parsed.otherParty ?? null,
      myAmount,
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
    amount: Number(r.amount),
    currency: r.currency,
    category: r.category,
    note: r.note,
    card: r.card,
    paidBy: r.paid_by,
    splitType: r.split_type,
    splitRatioMe: r.split_ratio_me == null ? null : Number(r.split_ratio_me),
    splitRatioOther: r.split_ratio_other == null ? null : Number(r.split_ratio_other),
    otherParty: r.other_party,
    myAmount: r.my_amount == null ? Number(r.amount) : Number(r.my_amount),
  };
}

export async function listExpenses(args: { limit: number; from?: string; to?: string; card?: string }): Promise<Expense[]> {
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

  if (args.card) {
    if (args.card === 'none') {
      where += ` AND (card IS NULL OR card = '')`;
    } else {
      params.push(args.card);
      where += ` AND card = $${params.length}`;
    }
  }

  params.push(args.limit);
  const limitParam = `$${params.length}`;

  const res = await pool.query(
    `SELECT id, created_at, occurred_on::text as occurred_on, source, from_user, raw_text, amount, currency, category, note,
      card, paid_by, split_type, split_ratio_me, split_ratio_other, other_party, my_amount
     FROM expenses
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
    amount: Number(r.amount),
    currency: r.currency,
    category: r.category,
    note: r.note,
    card: r.card,
    paidBy: r.paid_by,
    splitType: r.split_type,
    splitRatioMe: r.split_ratio_me == null ? null : Number(r.split_ratio_me),
    splitRatioOther: r.split_ratio_other == null ? null : Number(r.split_ratio_other),
    otherParty: r.other_party,
    myAmount: r.my_amount == null ? Number(r.amount) : Number(r.my_amount),
  }));
}

export async function sumForRange(args: {
  from: string;
  toExclusive?: string;
  toInclusive?: string;
  currency?: string;
}): Promise<{ count: number; total: number }> {
  await ensureSchema();
  const pool = getPool();

  const params: Array<string> = [args.from];
  let where = `occurred_on >= $1`;

  if (args.toExclusive) {
    params.push(args.toExclusive);
    where += ` AND occurred_on < $${params.length}`;
  }
  if (args.toInclusive) {
    params.push(args.toInclusive);
    where += ` AND occurred_on <= $${params.length}`;
  }
  if (args.currency) {
    params.push(args.currency);
    where += ` AND currency = $${params.length}`;
  }

  const res = await pool.query(
    `SELECT COUNT(*)::int as count, COALESCE(SUM(amount), 0)::text as total
     FROM expenses
     WHERE ${where}`,
    params
  );

  return { count: res.rows[0].count, total: Number(res.rows[0].total) };
}

export async function sumAllTime(): Promise<{ count: number; total: number }> {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query(
    `SELECT COUNT(*)::int as count, COALESCE(SUM(amount), 0)::text as total FROM expenses`
  );
  return { count: res.rows[0].count, total: Number(res.rows[0].total) };
}

export async function deleteExpenseById(args: { id: string }): Promise<{ deleted: boolean }> {
  await ensureSchema();
  const pool = getPool();

  // Delete dependent reimbursements first.
  await pool.query(`DELETE FROM reimbursements WHERE expense_id = $1`, [args.id]);
  const res = await pool.query(`DELETE FROM expenses WHERE id = $1`, [args.id]);
  return { deleted: (res.rowCount ?? 0) > 0 };
}

export async function updateExpenseById(args: {
  id: string;
  occurredOn?: string;
  amount?: number;
  myAmount?: number;
  category?: string | null;
  note?: string | null;
  card?: string | null;
  paidBy?: string;
  splitType?: string;
  splitRatioMe?: number | null;
  splitRatioOther?: number | null;
  otherParty?: string | null;
}): Promise<Expense | null> {
  await ensureSchema();
  const pool = getPool();

  const row = await pool.query(
    `UPDATE expenses
     SET occurred_on = COALESCE($2, occurred_on),
         amount = COALESCE($3, amount),
         my_amount = COALESCE($4, my_amount),
         category = COALESCE($5, category),
         note = COALESCE($6, note),
         card = COALESCE($7, card),
         paid_by = COALESCE($8, paid_by),
         split_type = COALESCE($9, split_type),
         split_ratio_me = COALESCE($10, split_ratio_me),
         split_ratio_other = COALESCE($11, split_ratio_other),
         other_party = COALESCE($12, other_party)
     WHERE id = $1
     RETURNING id, created_at, occurred_on::text as occurred_on, source, from_user, raw_text, amount, currency, category, note,
       card, paid_by, split_type, split_ratio_me, split_ratio_other, other_party, my_amount`,
    [
      args.id,
      args.occurredOn ?? null,
      args.amount ?? null,
      args.myAmount ?? null,
      args.category ?? null,
      args.note ?? null,
      args.card ?? null,
      args.paidBy ?? null,
      args.splitType ?? null,
      args.splitRatioMe ?? null,
      args.splitRatioOther ?? null,
      args.otherParty ?? null,
    ]
  );

  if (!row.rows.length) return null;
  const r = row.rows[0];
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    occurredOn: toYmd(r.occurred_on),
    source: r.source,
    fromUser: r.from_user,
    rawText: r.raw_text,
    amount: Number(r.amount),
    currency: r.currency,
    category: r.category,
    note: r.note,
    card: r.card,
    paidBy: r.paid_by,
    splitType: r.split_type,
    splitRatioMe: r.split_ratio_me == null ? null : Number(r.split_ratio_me),
    splitRatioOther: r.split_ratio_other == null ? null : Number(r.split_ratio_other),
    otherParty: r.other_party,
    myAmount: r.my_amount == null ? Number(r.amount) : Number(r.my_amount),
  };
}
