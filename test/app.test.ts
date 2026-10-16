import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/database.ts';
import { testApp } from './helpers.ts';

describe('app', () => {
  it('answers /health and serves the OpenAPI document', async () => {
    const app = await testApp();
    expect((await app.inject('/health')).json()).toEqual({ status: 'ok' });
    const openapi = (await app.inject('/openapi.json')).json();
    expect(openapi.openapi).toMatch(/^3\./);
  });

  it('returns 404 in the common error format for unknown routes', async () => {
    const app = await testApp();
    const res = await app.inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBeTypeOf('string');
  });
});

describe('migrate', () => {
  it('applies pending migrations once and records the version', () => {
    const db = new Database(':memory:');
    const migrations = ['CREATE TABLE a (id INTEGER PRIMARY KEY);', 'CREATE TABLE b (id INTEGER PRIMARY KEY);'];
    migrate(db, migrations.slice(0, 1));
    migrate(db, migrations);
    migrate(db, migrations);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });

  it('refuses a database newer than the code', () => {
    const db = new Database(':memory:');
    db.pragma('user_version = 3');
    expect(() => migrate(db, [])).toThrow(/schema version 3/);
  });
});
