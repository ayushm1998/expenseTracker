#!/usr/bin/env node

// Danger: this deletes ALL data from Postgres tables used by this app.
// Intended for local reset when you only have test data.

import 'dotenv/config';

import { Pool } from 'pg';

function redactConnectionString(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.password) u.password = 'REDACTED';
    return u.toString();
  } catch {
    return '[unparseable DATABASE_URL]';
  }
}

function getTargetInfo(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname || '';
    const database = (u.pathname || '').replace(/^\//, '');
    return { host, database };
  } catch {
    return { host: '', database: '' };
  }
}

function looksLikeSupabaseHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  // Direct (db.<project-ref>.supabase.co)
  if (h.endsWith('.supabase.co')) return true;
  // Pooler (aws-0-...pooler.supabase.com)
  if (h.endsWith('.pooler.supabase.com')) return true;
  if (h.endsWith('.supabase.com')) return true;
  return false;
}

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

  const { host, database } = getTargetInfo(connectionString);
  const confirm = (process.env.CONFIRM_DB_RESET || '').trim();
  const allowSupabase = (process.env.ALLOW_SUPABASE_DB_RESET || '').trim();

  console.error('[db-reset] TARGET:', {
    host: host || '(unknown)',
    database: database || '(unknown)',
    connectionString: redactConnectionString(connectionString),
  });

  // Hard safety gate: require explicit confirmation token.
  // This prevents accidental truncation when DATABASE_URL points to any shared/prod DB.
  if (confirm !== 'YES_I_UNDERSTAND_THIS_DELETES_DATA') {
    console.error(
      [
        '[db-reset] Refusing to run without explicit confirmation.',
        'Set CONFIRM_DB_RESET=YES_I_UNDERSTAND_THIS_DELETES_DATA to proceed.',
      ].join(' '),
    );
    process.exit(1);
  }

  // Extra hard block for Supabase hosts unless explicitly overridden.
  if (looksLikeSupabaseHost(host) && allowSupabase !== 'I_AM_RESETING_SUPABASE_ON_PURPOSE') {
    console.error(
      [
        '[db-reset] This DATABASE_URL looks like Supabase (likely production).',
        'Refusing to reset unless you also set',
        'ALLOW_SUPABASE_DB_RESET=I_AM_RESETING_SUPABASE_ON_PURPOSE',
      ].join(' '),
    );
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
