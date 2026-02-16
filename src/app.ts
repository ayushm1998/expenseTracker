import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { parseExpenseMessage } from './lib/parseMessage.js';
import {
  insertExpense,
  listExpenses,
  sumAllTime,
  sumForRange,
  deleteExpenseById,
  updateExpenseById,
} from './db-pg/expensesRepo.js';
import { getPool } from './db-pg/pool.js';
import { ensureSchema } from './db-pg/migrate.js';
import {
  insertReimbursement,
  getReimbursementBalance,
  listReimbursements,
  listOtherParties,
} from './db-pg/reimbursementsRepo.js';
import { insertLedgerEntry, listLedgerEntries, getLedgerTotals, getReceivableBalances } from './db-pg/ledgerRepo.js';

const CURRENCY = process.env.CURRENCY ?? 'USD';
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const APP_API_KEY = process.env.APP_API_KEY;

const app = express();
app.use(express.json({ limit: '200kb' }));

// Lightweight auth guard (single-user deployment).
// If APP_API_KEY is set, require it for all /api and /webhook routes.
// Clients can send either:
//  - Authorization: Bearer <key>
//  - x-api-key: <key>
function checkApiKey(req: Request): boolean {
  if (!APP_API_KEY) return true;
  const header = String(req.headers.authorization || '');
  const m = header.match(/^Bearer\s+(.+)$/i);
  const bearer = m ? m[1].trim() : '';
  const xKey = String(req.headers['x-api-key'] || '').trim();
  const key = bearer || xKey;
  return Boolean(key) && key === APP_API_KEY;
}

app.use((req, res, next) => {
  if (!APP_API_KEY) return next();
  if (!req.path.startsWith('/api') && !req.path.startsWith('/webhook')) return next();
  if (checkApiKey(req)) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
});

// Tiny request timing logger (helps diagnose the next "server is listening but not responding" scenario).
// Enable with REQUEST_LOG=1.
app.use((req, res, next) => {
  if (process.env.REQUEST_LOG !== '1') return next();
  const start = Date.now();
  const { method, originalUrl } = req;
  res.on('finish', () => {
    const ms = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[req] ${method} ${originalUrl} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Safety net: don't let requests hang forever if downstream services (DB) stall.
// This keeps the UI from sitting in a perpetual "pending" state.
app.use((req, res, next) => {
  const ms = Number(process.env.REQUEST_TIMEOUT_MS ?? 10000);
  // Only apply to API & webhook routes.
  if (!req.path.startsWith('/api') && !req.path.startsWith('/webhook')) return next();

  const timer = setTimeout(() => {
    if (res.headersSent) return;
    res.status(504).json({ ok: false, error: 'Request timed out (likely DB connection issue)' });
  }, ms);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});

// Kick off schema creation early (idempotent). We intentionally don't block server start.
// During unit tests Vitest imports the app even when DATABASE_URL isn't configured.
// Avoid noisy errors in that case; routes that hit the DB will still fail if called.
if (!process.env.VITEST) {
  ensureSchema().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to ensure Postgres schema:', err);
  });
}

function wantsPlainText(req: Request): boolean {
  return (
    String(req.query.format ?? '').toLowerCase() === 'text' ||
    String(req.headers.accept ?? '').toLowerCase().includes('text/plain')
  );
}

// Health check that does NOT touch the DB.
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ ok: true, status: 'up' });
});

function computeAckMessage(args: {
  currency: string;
  amount: number;
  occurredOn: string;
  monthTotal: number;
  ytdTotal: number;
}): string {
  const { currency, amount, occurredOn, monthTotal, ytdTotal } = args;
  return `Added ${currency} ${amount} on ${occurredOn}. Month total: ${monthTotal}. YTD: ${ytdTotal}.`;
}

function verifyMetaSignatureIfConfigured(req: Request, rawBody: string): boolean {
  if (!WHATSAPP_APP_SECRET) return true;
  const header = String(req.headers['x-hub-signature-256'] ?? '');
  const m = header.match(/^sha256=([a-f0-9]{64})$/i);
  if (!m) return false;
  const expected = Buffer.from(m[1], 'hex');
  const actualHex = crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(rawBody, 'utf8').digest('hex');
  const actual = Buffer.from(actualHex, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

const IngestSchema = z.object({
  text: z.string().min(1),
  from: z.string().optional(),
  source: z.string().optional(),
});

const WhatsAppWebhookSchema = z
  .object({
    text: z.string().optional(),
    from: z.string().optional(),
    Body: z.string().optional(),
    From: z.string().optional(),
    entry: z
      .array(
        z.object({
          changes: z
            .array(
              z.object({
                value: z
                  .object({
                    messages: z
                      .array(
                        z.object({
                          from: z.string().optional(),
                          text: z.object({ body: z.string().optional() }).optional(),
                        })
                      )
                      .optional(),
                  })
                  .optional(),
              })
            )
            .optional(),
        })
      )
      .optional(),
  })
  .passthrough();

function extractWhatsAppLikeMessage(body: unknown): { text?: string; from?: string } {
  const parsed = WhatsAppWebhookSchema.safeParse(body);
  if (!parsed.success) return {};
  const b = parsed.data;

  const directText = b.text ?? b.Body;
  const directFrom = b.from ?? b.From;
  if (directText) return { text: directText, from: directFrom };

  const msg = b.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const metaText = msg?.text?.body;
  const metaFrom = msg?.from;
  return { text: metaText, from: metaFrom };
}

// Serve built Vite assets when present (production).
const distClientDir = path.resolve('dist-client');
if (fs.existsSync(distClientDir)) {
  app.use(express.static(distClientDir));
}

app.get('/', (_req: Request, res: Response) => {
  const prodIndex = path.resolve('dist-client/index.html');
  const devIndex = path.resolve('src/web/index.html');
  res.sendFile(fs.existsSync(prodIndex) ? prodIndex : devIndex);
});

app.post('/api/ingest-message', async (req: Request, res: Response) => {
  const parsedBody = IngestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ ok: false, error: 'Invalid body', details: parsedBody.error.flatten() });
  }

  const { text, from, source } = parsedBody.data;
  const parsed = parseExpenseMessage(text);
  if (!parsed) {
    if (wantsPlainText(req)) return res.type('text/plain').send('Could not parse amount from message');
    return res.status(200).json({ ok: false, error: 'Could not parse amount from message', text });
  }

  // Compute "my share" so analytics reflect what *I* actually spent.
  // - No split: myAmount = full amount
  // - Split equal: myAmount = amount/(1+N)
  // - Split ratio a/b: myAmount = amount * a/(a+b)
  {
    const splitType = parsed.splitType ?? 'none';
    const ratioMe = parsed.splitRatioMe;
    const ratioOther = parsed.splitRatioOther;

    const others = (parsed.otherParties?.length ? parsed.otherParties : parsed.otherParty ? [parsed.otherParty] : [])
      .map((s) => String(s).trim())
      .filter(Boolean);

    let myShare = parsed.amount;
    if (splitType !== 'none') {
      const nOthers = others.length || 1;
      myShare = parsed.amount / (1 + nOthers);
      if (
        splitType === 'ratio' &&
        typeof ratioMe === 'number' &&
        typeof ratioOther === 'number' &&
        ratioMe > 0 &&
        ratioOther > 0
      ) {
        const total = ratioMe + ratioOther;
        myShare = (parsed.amount * ratioMe) / total;
      }
    }

    parsed.myAmount = myShare;
  }

  // If this expense was fully for someone else (e.g. "lunch 20 for:kevin"),
  // then it shouldn't count towards *my* share; they owe me the full amount.
  // (Reimbursement rows are created below.)
  if (parsed.forPerson) {
    parsed.otherParty = parsed.otherParty ?? parsed.forPerson;
    parsed.otherParties = parsed.otherParties?.length ? parsed.otherParties : [parsed.forPerson];
    parsed.splitType = 'none';
    parsed.myAmount = 0;
  }

  const expense = await insertExpense({
    text,
    from,
    source: source ?? 'message',
    parsed,
    defaultCurrency: CURRENCY,
  });

  // Option B: keep the full expense amount as your spend, and track split reimbursements separately.
  // If `paidBy=me` and split applies, roommate owes you their share.
  // If `paidBy=roommate` and split applies, you owe roommate your share.
  const otherParties = (parsed.otherParties?.length ? parsed.otherParties : parsed.otherParty ? [parsed.otherParty] : ['vyas'])
    .map((s) => String(s).trim())
    .filter(Boolean);

  const otherParty = otherParties[0] ?? 'vyas';
  const paidBy = parsed.paidBy ?? 'me';
  const splitType = parsed.splitType ?? 'none';
  const ratioMe = parsed.splitRatioMe;
  const ratioOther = parsed.splitRatioOther;

  // If it's fully "for" someone else, treat as "they owe me the full amount" (if I paid)
  // or "I owe them the full amount" (if roommate paid).
  if (parsed.forPerson) {
    const p = otherParties[0] ?? parsed.forPerson;
    if (paidBy === 'me') {
      await insertReimbursement({
        occurredOn: expense.occurredOn,
        source: expense.source,
        from,
        expenseId: expense.id,
        otherParty: p,
        direction: 'they_owe_me',
        amount: expense.amount,
        currency: expense.currency,
        note: expense.note ?? undefined,
        rawText: text,
      });
    } else {
      await insertReimbursement({
        occurredOn: expense.occurredOn,
        source: expense.source,
        from,
        expenseId: expense.id,
        otherParty: p,
        direction: 'i_owe_them',
        amount: expense.amount,
        currency: expense.currency,
        note: expense.note ?? undefined,
        rawText: text,
      });
    }
  } else if (splitType !== 'none') {
    // Split math
    const nOthers = otherParties.length;
    const denom = 1 + (nOthers || 1);
    let myShare = expense.amount / denom;
    let eachOtherShare = nOthers > 0 ? (expense.amount - myShare) / nOthers : expense.amount - myShare;

    if (splitType === 'ratio' && typeof ratioMe === 'number' && typeof ratioOther === 'number' && ratioMe > 0 && ratioOther > 0) {
      const total = ratioMe + ratioOther;
      myShare = (expense.amount * ratioMe) / total;
      // With ratio split, treat the remainder as the "others" bucket and split it equally across others.
      const othersTotal = expense.amount - myShare;
      eachOtherShare = nOthers > 0 ? othersTotal / nOthers : othersTotal;
    }

    if (paidBy === 'me') {
      // Everyone else owes me their share.
      for (const p of otherParties) {
        await insertReimbursement({
          occurredOn: expense.occurredOn,
          source: expense.source,
          from,
          expenseId: expense.id,
          otherParty: p,
          direction: 'they_owe_me',
          amount: eachOtherShare,
          currency: expense.currency,
          note: expense.note ?? undefined,
          rawText: text,
        });
      }
    } else {
      // Someone else paid: keep *my* ledger only.
      // I owe the payer my share (not everyone).
      await insertReimbursement({
        occurredOn: expense.occurredOn,
        source: expense.source,
        from,
        expenseId: expense.id,
        otherParty,
        direction: 'i_owe_them',
        amount: myShare,
        currency: expense.currency,
        note: expense.note ?? undefined,
        rawText: text,
      });
    }
  }

  const currency = expense.currency;
  const occurredOn = expense.occurredOn;
  const [y, m] = occurredOn.split('-').map((x) => Number(x));
  const monthStart = new Date(y, (m ?? 1) - 1, 1);
  const monthStartYmd = monthStart.toISOString().slice(0, 10);
  const nextMonthStart = new Date(y, (m ?? 1), 1);
  const nextMonthStartYmd = nextMonthStart.toISOString().slice(0, 10);
  const yearStart = new Date(y, 0, 1);
  const yearStartYmd = yearStart.toISOString().slice(0, 10);

  const month = await sumForRange({ from: monthStartYmd, toExclusive: nextMonthStartYmd, currency });
  const ytd = await sumForRange({ from: yearStartYmd, toInclusive: occurredOn, currency });

  const message = computeAckMessage({
    currency,
    amount: expense.amount,
    occurredOn,
    monthTotal: month.total,
    ytdTotal: ytd.total,
  });

  if (wantsPlainText(req)) return res.type('text/plain').send(message);

  return res.json({
    ok: true,
    expense,
    ack: { message, month, ytd, currency },
  });
});

app.get('/api/expenses', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const fromYmd = typeof req.query.from === 'string' ? req.query.from : undefined;
  const toYmd = typeof req.query.to === 'string' ? req.query.to : undefined;
  const card = typeof req.query.card === 'string' ? req.query.card : undefined;

  const expenses = await listExpenses({ limit, from: fromYmd, to: toYmd, card });
  res.json({ ok: true, expenses, currency: CURRENCY, from: fromYmd, to: toYmd, card });
});

app.delete('/api/expenses/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const out = await deleteExpenseById({ id });
  if (!out.deleted) return res.status(404).json({ ok: false, error: 'Not found' });
  return res.json({ ok: true });
});

app.put('/api/expenses/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  const body = req.body ?? {};
  const text = typeof body.text === 'string' ? body.text : '';
  const occurredOn = typeof body.occurredOn === 'string' ? body.occurredOn : '';

  const parsed = parseExpenseMessage(text);
  if (!parsed) return res.status(400).json({ ok: false, error: 'Could not parse amount from message' });
  if (occurredOn) parsed.occurredOn = occurredOn;

  // Recompute my share
  {
    const splitType = parsed.splitType ?? 'none';
    const ratioMe = parsed.splitRatioMe;
    const ratioOther = parsed.splitRatioOther;
    const others = (parsed.otherParties?.length ? parsed.otherParties : parsed.otherParty ? [parsed.otherParty] : [])
      .map((s) => String(s).trim())
      .filter(Boolean);
    let myShare = parsed.amount;
    if (splitType !== 'none') {
      const nOthers = others.length || 1;
      myShare = parsed.amount / (1 + nOthers);
      if (
        splitType === 'ratio' &&
        typeof ratioMe === 'number' &&
        typeof ratioOther === 'number' &&
        ratioMe > 0 &&
        ratioOther > 0
      ) {
        const total = ratioMe + ratioOther;
        myShare = (parsed.amount * ratioMe) / total;
      }
    }
    parsed.myAmount = myShare;
  }

  // Full-for-someone-else on edit, same behavior as ingest.
  if (parsed.forPerson) {
    parsed.otherParty = parsed.otherParty ?? parsed.forPerson;
    parsed.otherParties = parsed.otherParties?.length ? parsed.otherParties : [parsed.forPerson];
    parsed.splitType = 'none';
    parsed.myAmount = 0;
  }

  const otherParties = (parsed.otherParties?.length ? parsed.otherParties : parsed.otherParty ? [parsed.otherParty] : ['vyas'])
    .map((s) => String(s).trim())
    .filter(Boolean);
  const otherParty = otherParties[0] ?? 'vyas';
  const paidBy = parsed.paidBy ?? 'me';
  const splitType = parsed.splitType ?? 'none';

  const updated = await updateExpenseById({
    id,
    occurredOn: parsed.occurredOn,
    amount: parsed.amount,
    myAmount: parsed.myAmount ?? parsed.amount,
    category: parsed.category ?? null,
    note: parsed.note ?? null,
    card: parsed.card ?? null,
    paidBy,
    splitType,
    splitRatioMe: parsed.splitRatioMe ?? null,
    splitRatioOther: parsed.splitRatioOther ?? null,
    otherParty,
  });

  if (!updated) return res.status(404).json({ ok: false, error: 'Not found' });

  // Rebuild reimbursements for this expense.
  await getPool().query(`DELETE FROM reimbursements WHERE expense_id = $1`, [id]);

  if (parsed.forPerson) {
    const p = otherParties[0] ?? parsed.forPerson;
    if (paidBy === 'me') {
      await insertReimbursement({
        occurredOn: updated.occurredOn,
        source: updated.source,
        from: updated.fromUser ?? undefined,
        expenseId: updated.id,
        otherParty: p,
        direction: 'they_owe_me',
        amount: updated.amount,
        currency: updated.currency,
        note: updated.note ?? undefined,
        rawText: text,
      });
    } else {
      await insertReimbursement({
        occurredOn: updated.occurredOn,
        source: updated.source,
        from: updated.fromUser ?? undefined,
        expenseId: updated.id,
        otherParty: p,
        direction: 'i_owe_them',
        amount: updated.amount,
        currency: updated.currency,
        note: updated.note ?? undefined,
        rawText: text,
      });
    }
  } else if (splitType !== 'none') {
    const nOthers = otherParties.length;
    const denom = 1 + (nOthers || 1);
    let myShare = updated.amount / denom;
    let eachOtherShare = nOthers > 0 ? (updated.amount - myShare) / nOthers : updated.amount - myShare;

    if (
      splitType === 'ratio' &&
      typeof parsed.splitRatioMe === 'number' &&
      typeof parsed.splitRatioOther === 'number' &&
      parsed.splitRatioMe > 0 &&
      parsed.splitRatioOther > 0
    ) {
      const total = parsed.splitRatioMe + parsed.splitRatioOther;
      myShare = (updated.amount * parsed.splitRatioMe) / total;
      const othersTotal = updated.amount - myShare;
      eachOtherShare = nOthers > 0 ? othersTotal / nOthers : othersTotal;
    }

    if (paidBy === 'me') {
      for (const p of otherParties) {
        await insertReimbursement({
          occurredOn: updated.occurredOn,
          source: updated.source,
          from: updated.fromUser ?? undefined,
          expenseId: updated.id,
          otherParty: p,
          direction: 'they_owe_me',
          amount: eachOtherShare,
          currency: updated.currency,
          note: updated.note ?? undefined,
          rawText: text,
        });
      }
    } else {
      await insertReimbursement({
        occurredOn: updated.occurredOn,
        source: updated.source,
        from: updated.fromUser ?? undefined,
        expenseId: updated.id,
        otherParty,
        direction: 'i_owe_them',
        amount: myShare,
        currency: updated.currency,
        note: updated.note ?? undefined,
        rawText: text,
      });
    }
  }

  return res.json({ ok: true, expense: updated });
});

app.get('/api/summary', async (_req: Request, res: Response) => {
  const now = new Date();
  const todayYmd = now.toISOString().slice(0, 10);

  // week start (Mon)
  const dow = (now.getDay() + 6) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const weekStartYmd = weekStart.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowYmd = tomorrow.toISOString().slice(0, 10);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartYmd = monthStart.toISOString().slice(0, 10);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthStartYmd = nextMonthStart.toISOString().slice(0, 10);

  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearStartYmd = yearStart.toISOString().slice(0, 10);

  const [allTime, week, month, ytd] = await Promise.all([
    sumAllTime(),
    sumForRange({ from: weekStartYmd, toExclusive: tomorrowYmd }),
    sumForRange({ from: monthStartYmd, toExclusive: nextMonthStartYmd }),
    sumForRange({ from: yearStartYmd, toInclusive: todayYmd }),
  ]);

  const reimbursementBalance = await getReimbursementBalance({ currency: CURRENCY });
  const ledgerTotals = await getLedgerTotals({ currency: CURRENCY });
  const receivables = await getReceivableBalances({ currency: CURRENCY });

  const netWorth = ledgerTotals.incomeTotal - (allTime.total + ledgerTotals.savingsTotal + ledgerTotals.investmentTotal + ledgerTotals.liabilityTotal);

  return res.json({
    ok: true,
    currency: CURRENCY,
    allTime,
    week,
    month,
    ytd,
    reimbursementBalance,
    ledger: {
      incomeTotal: ledgerTotals.incomeTotal,
      savingsTotal: ledgerTotals.savingsTotal,
      investmentTotal: ledgerTotals.investmentTotal,
      liabilityTotal: ledgerTotals.liabilityTotal,
      netWorth,
    },
    receivables,
  });
});

// Ledger: earnings, savings transfers, investments, liabilities
app.post('/api/ledger', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return res.status(400).json({ ok: false, error: 'Missing text' });

  const parsed = parseExpenseMessage(text);
  if (!parsed) return res.status(400).json({ ok: false, error: 'Could not parse amount from message' });

  const type = parsed.type ?? 'income';
  const allowed = new Set(['income', 'transfer', 'investment', 'liability', 'receivable']);
  if (!allowed.has(type)) return res.status(400).json({ ok: false, error: `Unsupported ledger type: ${type}` });

  if (type === 'receivable') {
    if (!parsed.counterparty) return res.status(400).json({ ok: false, error: 'Missing counterparty (use counterparty:<name>)' });
    if (!parsed.direction) return res.status(400).json({ ok: false, error: 'Missing direction (use direction:i_borrowed|i_lent|repay|collect)' });
  }

  const occurredOn = parsed.occurredOn ?? new Date().toISOString().slice(0, 10);
  const entry = await insertLedgerEntry({
    occurredOn,
    source: 'message',
    from: typeof body.from === 'string' ? body.from : undefined,
    rawText: text,
    type,
    amount: parsed.amount,
    currency: parsed.currency ?? CURRENCY,
    direction: (parsed.direction as any) ?? undefined,
    counterparty: parsed.counterparty,
    account: parsed.account,
    asset: parsed.asset,
    liability: parsed.liability,
    note: parsed.note,
  });

  return res.json({ ok: true, entry });
});

app.get('/api/ledger', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const fromYmd = typeof req.query.from === 'string' ? req.query.from : undefined;
  const toYmd = typeof req.query.to === 'string' ? req.query.to : undefined;
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;

  const allowed = new Set(['income', 'transfer', 'investment', 'liability']);
  const t = type && allowed.has(type) ? (type as any) : undefined;

  const entries = await listLedgerEntries({ limit, from: fromYmd, to: toYmd, type: t });
  res.json({ ok: true, entries, currency: CURRENCY, from: fromYmd, to: toYmd, type: t ?? '' });
});

app.get('/api/reimbursements', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
  const fromYmd = typeof req.query.from === 'string' ? req.query.from : undefined;
  const toYmd = typeof req.query.to === 'string' ? req.query.to : undefined;
  const otherParty = typeof req.query.otherParty === 'string' ? req.query.otherParty : undefined;

  const rows = await listReimbursements({ limit, from: fromYmd, to: toYmd, otherParty, currency: CURRENCY });
  const balance = await getReimbursementBalance({ otherParty, currency: CURRENCY });

  res.json({ ok: true, currency: CURRENCY, reimbursements: rows, balance, from: fromYmd, to: toYmd, otherParty });
});

app.get('/api/reimbursements/parties', async (_req: Request, res: Response) => {
  const parties = await listOtherParties({ currency: CURRENCY });
  res.json({ ok: true, parties });
});

app.post('/webhook/whatsapp', async (req: Request, res: Response) => {
  if (WHATSAPP_APP_SECRET) {
    const rawBody = JSON.stringify(req.body ?? {});
    if (!verifyMetaSignatureIfConfigured(req, rawBody)) {
      if (wantsPlainText(req)) return res.type('text/plain').status(401).send('Invalid signature');
      return res.status(401).json({ ok: false, error: 'Invalid signature' });
    }
  }

  const extracted = extractWhatsAppLikeMessage(req.body);
  if (!extracted.text) {
    if (wantsPlainText(req)) return res.type('text/plain').status(400).send('Missing message text');
    return res.status(400).json({ ok: false, error: 'Missing message text' });
  }

  const parsed = parseExpenseMessage(extracted.text);
  if (!parsed) {
    if (wantsPlainText(req)) return res.type('text/plain').send('Could not parse amount from message');
    return res.status(200).json({ ok: false, error: 'Could not parse amount from message', text: extracted.text });
  }

  const expense = await insertExpense({
    text: extracted.text,
    from: extracted.from,
    source: 'whatsapp',
    parsed,
    defaultCurrency: CURRENCY,
  });

  const currency = expense.currency;
  const occurredOn = expense.occurredOn;
  const [y, m] = occurredOn.split('-').map((x) => Number(x));
  const monthStart = new Date(y, (m ?? 1) - 1, 1);
  const monthStartYmd = monthStart.toISOString().slice(0, 10);
  const nextMonthStart = new Date(y, (m ?? 1), 1);
  const nextMonthStartYmd = nextMonthStart.toISOString().slice(0, 10);
  const yearStart = new Date(y, 0, 1);
  const yearStartYmd = yearStart.toISOString().slice(0, 10);

  const month = await sumForRange({ from: monthStartYmd, toExclusive: nextMonthStartYmd, currency });
  const ytd = await sumForRange({ from: yearStartYmd, toInclusive: occurredOn, currency });

  const message = computeAckMessage({
    currency,
    amount: expense.amount,
    occurredOn,
    monthTotal: month.total,
    ytdTotal: ytd.total,
  });

  // Default to plain text for webhook friendliness.
  if (wantsPlainText(req) || !String(req.headers.accept ?? '').toLowerCase().includes('application/json')) {
    return res.type('text/plain').send(message);
  }

  return res.json({ ok: true, expense, ack: { message, month, ytd, currency } });
});

app.get('/webhook/whatsapp', (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] ?? '');
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');

  if (mode === 'subscribe' && WHATSAPP_VERIFY_TOKEN && token === WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).type('text/plain').send(challenge);
  }

  return res.status(403).type('text/plain').send('Forbidden');
});

export default app;
