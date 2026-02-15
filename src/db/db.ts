import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type ExpenseRow = {
  id: string;
  createdAt: string;
  occurredOn: string;
  source: string;
  fromUser: string | null;
  rawText: string;
  amount: number;
  currency: string;
  category: string | null;
  note: string | null;
};

export function openDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      occurredOn TEXT NOT NULL,
      source TEXT NOT NULL,
      fromUser TEXT,
      rawText TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      category TEXT,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_occurredOn ON expenses(occurredOn);
    CREATE INDEX IF NOT EXISTS idx_expenses_createdAt ON expenses(createdAt);
  `);

  return db;
}
