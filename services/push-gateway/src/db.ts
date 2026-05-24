import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export function openDb(databasePath: string): Db {
  fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function migrate(db: Db, migrationsDir = new URL('../migrations/', import.meta.url)): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const dirPath = fileURLToPath(migrationsDir);
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => (row as { name: string }).name),
  );
  for (const name of fs.readdirSync(dirPath).filter((entry) => entry.endsWith('.sql')).toSorted()) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(dirPath, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
    })();
  }
}
