import { describe, expect, it } from 'vitest';
import { parseExpenseMessage } from '../src/lib/parseMessage.js';

describe('parseExpenseMessage', () => {
  it('parses amount and note', () => {
    expect(parseExpenseMessage('spent 250 chai')).toMatchObject({ amount: 250, note: 'chai' });
  });

  it('parses category when first word looks like category', () => {
    expect(parseExpenseMessage('food 499 swiggy')).toMatchObject({ amount: 499, category: 'food', note: 'swiggy' });
  });

  it('parses rupee symbol and commas', () => {
    expect(parseExpenseMessage('₹1,250 groceries')).toMatchObject({ amount: 1250, note: 'groceries' });
  });

  it('parses USD', () => {
    expect(parseExpenseMessage('usd 12.50 coffee')).toMatchObject({ amount: 12.5, currency: 'USD', note: 'coffee' });
  });

  it('parses backdated ISO date', () => {
    expect(parseExpenseMessage('rent 1200 2026-02-01')).toMatchObject({ amount: 1200, occurredOn: '2026-02-01' });
  });

  it('returns null when no number', () => {
    expect(parseExpenseMessage('hello there')).toBeNull();
  });

  it('supports split:equal token syntax', () => {
    const parsed = parseExpenseMessage('room 300 paidby:roommate other:vyas split:equal other:vyas 2026-02-15');
    expect(parsed?.amount).toBe(300);
    expect(parsed?.paidBy).toBe('roommate');
    expect(parsed?.splitType).toBe('equal');
    expect(parsed?.otherParties?.map((s) => s.toLowerCase())).toContain('vyas');
    expect(parsed?.occurredOn).toBe('2026-02-15');
  });

  it('supports split:<ratio> token syntax', () => {
    const parsed = parseExpenseMessage('food 90 paidby:me split:2/1 other:vyas');
    expect(parsed?.amount).toBe(90);
    expect(parsed?.splitType).toBe('ratio');
    expect(parsed?.splitRatioMe).toBe(2);
    expect(parsed?.splitRatioOther).toBe(1);
  });

  it('parses ledger type token', () => {
    const p = parseExpenseMessage('salary 5000 type:income account:checking');
    expect(p?.amount).toBe(5000);
    expect(p?.type).toBe('income');
    expect(p?.account).toBe('checking');
  });

  it('parses investment and liability meta tokens', () => {
    const inv = parseExpenseMessage('invest 250 type:investment asset:vti');
    expect(inv?.type).toBe('investment');
    expect(inv?.asset).toBe('vti');

    const liab = parseExpenseMessage('loan 1200 type:liability liability:car');
    expect(liab?.type).toBe('liability');
    expect(liab?.liability).toBe('car');
  });

  it('parses receivable meta tokens', () => {
    const p = parseExpenseMessage('took 1200 type:receivable counterparty:kevin direction:i_borrowed');
    expect(p?.type).toBe('receivable');
    expect(p?.counterparty).toBe('kevin');
    expect(p?.direction).toBe('i_borrowed');
  });

  it('maps cab/uber/ola to transport category', () => {
    const p = parseExpenseMessage('cab 18 airport');
    expect(p).toBeTruthy();
    expect(p?.category).toBe('transport');
    expect(p?.note).toBe('airport');

    const u = parseExpenseMessage('uber 22');
    expect(u?.category).toBe('transport');
  });

  it('parses for:<person> token for expenses fully on behalf of someone else', () => {
    const p = parseExpenseMessage('food 20 for:kevin');
    expect(p).toBeTruthy();
    expect(p?.forPerson).toBe('kevin');
  });
});
