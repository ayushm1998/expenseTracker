import { describe, expect, it } from 'vitest';
import { computeAccountBucketsFromRows } from '../src/db-pg/ledgerRepo.js';

describe('computeAccountBucketsFromRows', () => {
  it('sums all rows, not just a recent window', () => {
    const rows = [
      { type: 'income', amount: 1000, account: 'checking' },
      { type: 'transfer', amount: 200, account: null },
      { type: 'income', amount: 500, account: 'checking' },
    ];
    expect(computeAccountBucketsFromRows(rows)).toMatchObject({
      checking: 1500,
      savings: 200,
      investments: 0,
      liabilities: 0,
      savingsIndia: 0,
    });
  });

  it('tracks savings india separately', () => {
    const rows = [{ type: 'transfer', amount: 300, account: 'savings', note: 'savings_india' }];
    expect(computeAccountBucketsFromRows(rows)).toMatchObject({
      checking: 0,
      savings: 0,
      savingsIndia: 300,
    });
  });
});
