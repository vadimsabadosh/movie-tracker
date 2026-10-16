// SQLite connection (ADR-002) and migration runner. Only repositories use the connection (ADR-001).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations.ts';

export function openDatabase(file: string, migrations: readonly string[] = MIGRATIONS): Database.Database {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db, migrations);
  return db;
}

export function migrate(db: Database.Database, migrations: readonly string[]): void {
  const applied = db.pragma('user_version', { simple: true }) as number;
  if (applied > migrations.length) {
    throw new Error(`database is at schema version ${applied}, code knows only ${migrations.length}`);
  }
  for (let version = applied; version < migrations.length; version++) {
    db.transaction(() => {
      db.exec(migrations[version] ?? '');
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
