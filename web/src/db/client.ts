import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.join(process.cwd(), 'db', 'dev.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.exec(`
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
`);

// Runtime migration: add embedding/tags columns if they do not exist
try {
  const columns = sqlite.prepare("PRAGMA table_info(notes);").all() as Array<{ name: string }>;
  const hasEmbedding = columns.some((c) => c.name === 'embedding');
  if (!hasEmbedding) {
    sqlite.exec("ALTER TABLE notes ADD COLUMN embedding TEXT;");
  }
  const hasTags = columns.some((c) => c.name === 'tags');
  if (!hasTags) {
    sqlite.exec("ALTER TABLE notes ADD COLUMN tags TEXT;");
  }
} catch (e) {
  console.error('Failed to ensure columns on notes table', e);
}

export const db = drizzle(sqlite);

export * from './schema';
