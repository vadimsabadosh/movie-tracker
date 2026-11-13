import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../src/db/database.ts';
import { MIGRATIONS } from '../src/db/migrations.ts';
import { testApp } from './helpers.ts';

describe('app', () => {
  it('serves the web UI at /', async () => {
    const res = await (await testApp()).inject('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<main id="app">');
    expect(res.body).toContain('not endorsed or certified by TMDB');
  });

  it('documents GET /movies/{id}/poster with the id param and 302/404/503 (NFR-6)', async () => {
    const openapi = (await (await testApp()).inject('/openapi.json')).json();
    const get = openapi.paths['/movies/{id}/poster'].get;
    expect(get.parameters.map((p: { name: string; in: string }) => `${p.in}:${p.name}`)).toEqual(['path:id']);
    expect(Object.keys(get.responses)).toEqual(expect.arrayContaining(['302', '404', '503']));
  });

  it('keeps JSON 404 for unknown paths', async () => {
    const res = await (await testApp()).inject('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('answers /health and serves the OpenAPI document', async () => {
    const app = await testApp();
    expect((await app.inject('/health')).json()).toEqual({ status: 'ok' });
    const openapi = (await app.inject('/openapi.json')).json();
    expect(openapi.openapi).toMatch(/^3\./);
  });

  it('documents the Watch History query parameters on GET /watches (NFR-6)', async () => {
    const app = await testApp();
    const openapi = (await app.inject('/openapi.json')).json();
    const names = (openapi.paths['/watches'].get.parameters as { name: string; in: string }[])
      .filter((p) => p.in === 'query')
      .map((p) => p.name);
    expect(names.sort()).toEqual(
      ['genre', 'yearFrom', 'yearTo', 'ratingMin', 'ratingMax', 'watchedFrom', 'watchedTo', 'sort', 'order', 'limit', 'offset'].sort(),
    );
  });

  it('documents the catalog query parameters and item fields on GET /movies (NFR-6)', async () => {
    const openapi = (await (await testApp()).inject('/openapi.json')).json();
    const get = openapi.paths['/movies'].get;
    const names = (get.parameters as { name: string; in: string }[]).filter((p) => p.in === 'query').map((p) => p.name);
    expect(names.sort()).toEqual(['q', 'genre', 'yearFrom', 'yearTo', 'director', 'watched', 'sort', 'order', 'limit', 'offset'].sort());
    const item = get.responses['200'].content['application/json'].schema.properties.items.items;
    expect(Object.keys(item.properties)).toEqual(expect.arrayContaining(['imdbRating', 'imdbVotes', 'watched']));
  });

  it('documents GET /genres with a list of names (NFR-6)', async () => {
    const openapi = (await (await testApp()).inject('/openapi.json')).json();
    const schema = openapi.paths['/genres'].get.responses['200'].content['application/json'].schema;
    expect(schema.properties.items).toMatchObject({ type: 'array', items: { type: 'string' } });
  });

  it('documents GET /profile with a 200 response schema (NFR-6)', async () => {
    const app = await testApp();
    const openapi = (await app.inject('/openapi.json')).json();
    const ok = openapi.paths['/profile'].get.responses['200'];
    expect(ok.content['application/json'].schema.properties).toHaveProperty('genres');
    expect(ok.content['application/json'].schema.properties).toHaveProperty('directors');
  });

  it('documents GET /recommendations with limit and a 200 response schema (NFR-6)', async () => {
    const app = await testApp();
    const openapi = (await app.inject('/openapi.json')).json();
    const get = openapi.paths['/recommendations'].get;
    expect((get.parameters as { name: string; in: string }[]).filter((p) => p.in === 'query').map((p) => p.name)).toEqual(['limit']);
    const items = get.responses['200'].content['application/json'].schema.properties.items;
    expect(Object.keys(items.items.properties).sort()).toEqual(['explanation', 'movie', 'reasons', 'score']);
  });

  it('documents GET /stats with a 200 response schema (NFR-6)', async () => {
    const app = await testApp();
    const openapi = (await app.inject('/openapi.json')).json();
    const schema = openapi.paths['/stats'].get.responses['200'].content['application/json'].schema;
    expect(Object.keys(schema.properties).sort()).toEqual(['averageRating', 'byGenre', 'byYear', 'watchedCount']);
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

  it('creates the poster columns on a fresh database (migration 3)', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    const columns = (db.pragma('table_info(movies)') as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['imdb_id', 'poster_path']));
  });

  it('upgrades a v2 database to v3 and keeps its movies', () => {
    const db = new Database(':memory:');
    migrate(db, MIGRATIONS.slice(0, 2));
    db.prepare("INSERT INTO movies (title, title_key, year, director) VALUES ('Old', 'old', 2000, 'D')").run();
    migrate(db, MIGRATIONS);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT title, imdb_id, poster_path FROM movies').all()).toEqual([
      { title: 'Old', imdb_id: null, poster_path: null },
    ]);
  });

  it('rejects malformed imdb_id and poster_path values', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT INTO movies (title, title_key, year, director, imdb_id, poster_path) VALUES ('A', 'a', 2000, 'D', @imdbId, @posterPath)",
    );
    expect(() => insert.run({ imdbId: 'x1', posterPath: null })).toThrow(/CHECK/);
    expect(() => insert.run({ imdbId: 'tt1abc', posterPath: null })).toThrow(/CHECK/);
    expect(() => insert.run({ imdbId: 'tt', posterPath: null })).toThrow(/CHECK/);
    expect(() => insert.run({ imdbId: 'tt1', posterPath: 'http://evil' })).toThrow(/CHECK/);
    expect(() => insert.run({ imdbId: 'tt1', posterPath: '' })).not.toThrow();
  });

  it('creates the IMDb and director_key columns on a fresh database (migration 4)', () => {
    const db = openDatabase(':memory:');
    const columns = (db.pragma('table_info(movies)') as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['imdb_rating', 'imdb_votes', 'director_key']));
  });

  it('upgrades a v3 database to v4 and back-fills director_key (Cyrillic folded)', () => {
    const db = new Database(':memory:');
    migrate(db, MIGRATIONS.slice(0, 3));
    db.prepare("INSERT INTO movies (title, title_key, year, director) VALUES ('Тіні', 'тіні', 1965, 'Сергій Параджанов')").run();
    migrate(db, MIGRATIONS);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT director_key, imdb_rating, imdb_votes FROM movies').all()).toEqual([
      { director_key: 'сергій параджанов', imdb_rating: null, imdb_votes: null },
    ]);
  });

  it('rejects out-of-range IMDb rating and votes', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT INTO movies (title, title_key, year, director, imdb_rating, imdb_votes) VALUES (@t, @t, 2000, 'D', @rating, @votes)",
    );
    expect(() => insert.run({ t: 'a', rating: 0.5, votes: 1 })).toThrow(/CHECK/);
    expect(() => insert.run({ t: 'b', rating: 10.5, votes: 1 })).toThrow(/CHECK/);
    expect(() => insert.run({ t: 'c', rating: 5, votes: -1 })).toThrow(/CHECK/);
    expect(() => insert.run({ t: 'd', rating: 1, votes: 0 })).not.toThrow();
    expect(() => insert.run({ t: 'e', rating: 10, votes: 0 })).not.toThrow();
  });

  it('refuses a database newer than the code', () => {
    const db = new Database(':memory:');
    db.pragma('user_version = 3');
    expect(() => migrate(db, [])).toThrow(/schema version 3/);
  });
});
