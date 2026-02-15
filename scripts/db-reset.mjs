#!/usr/bin/env node

// Danger: this deletes ALL data from Postgres tables used by this app.
// Intended for local reset when you only have test data.

import 'dotenv/config';

import { Pool } from 'pg';

function cleanConnectionString(raw) {
  if (!raw) return null;
  // Keep this in sync with src/db-pg/pool.ts (strip ssl params and rely on ssl option)
  return raw
    .replace(/[?&]sslmode=[^&]+/gi, '')
    .replace(/[?&]sslrootcert=[^&]+/gi, '')
    .replace(/[?&]sslcert=[^&]+/gi, '')
    .replace(/[?&]sslkey=[^&]+/gi, '')
    .replace(/[?&]sslpassword=[^&]+/gi, '')
    .replace(/[?&]useLibpqCompat=[^&]+/gi, '')
    .replace(/\?&/g, '?')
    .replace(/\?$/, '');
}

async function main() {
  const raw = process.env.DATABASE_URL;
  const connectionString = cleanConnectionString(raw);
  if (!connectionString) {
    console.error('DATABASE_URL is required to reset the DB');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  });

  try {
    // Ensure the tables exist then wipe them.
    // Order matters because reimbursements can reference expenses by expense_id (not FK-enforced).
    await pool.query('BEGIN');
    await pool.query('CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY)');
    await pool.query('CREATE TABLE IF NOT EXISTS reimbursements (id TEXT PRIMARY KEY)');

    await pool.query('TRUNCATE TABLE reimbursements');
    await pool.query('TRUNCATE TABLE expenses');

    await pool.query('COMMIT');
    console.log('[db-reset] Done. Truncated: reimbursements, expenses');
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch {}
    console.error('[db-reset] Failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
