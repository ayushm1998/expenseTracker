import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const raw = process.env.DATABASE_URL;
  // If the connection string contains sslmode/sslrootcert params, pg-connection-string may
  // enforce stricter verification than our explicit `ssl` option. Strip those and rely on
  // `ssl: { rejectUnauthorized: false }` for a smooth Supabase DX.
  const connectionString = raw
    ?.replace(/[?&]sslmode=[^&]+/gi, '')
    ?.replace(/[?&]sslrootcert=[^&]+/gi, '')
    ?.replace(/[?&]sslcert=[^&]+/gi, '')
    ?.replace(/[?&]sslkey=[^&]+/gi, '')
    ?.replace(/[?&]sslpassword=[^&]+/gi, '')
    ?.replace(/[?&]useLibpqCompat=[^&]+/gi, '')
    ?.replace(/\?&/g, '?')
    ?.replace(/\?$/, '');
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  pool = new Pool({
    connectionString,
     // Avoid requests hanging forever if the DB is unreachable.
     connectionTimeoutMillis: 3000,
     query_timeout: 8000,
     statement_timeout: 8000,
    // Supabase requires SSL in most hosted environments.
    // In local dev, Node may complain about the certificate chain; this keeps the DX simple.
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}
