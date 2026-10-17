// NFR-1: GET /watches (Watch History, FR-4) answers within p95 ≤ 200 ms on 10 000 movies, all watched.
// The catalog comes from seedCatalog in helpers.ts (shared with the /profile perf test).
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { CATALOG_GENRES as GENRES, CATALOG_MOVIES as MOVIES, seedCatalog } from './helpers.ts';

const TODAY = '2026-10-16';

describe('watch history performance (NFR-1)', () => {
  it('keeps p95 under 200 ms on 10 000 watched movies', async () => {
    const db = openDatabase(':memory:');
    seedCatalog(db);
    const app = await buildApp({ db, today: () => TODAY });
    await app.ready();

    const urls = [
      '/watches',
      '/watches?genre=%D0%B6%D0%B0%D0%BD%D1%80%205&yearFrom=1950&yearTo=2010&ratingMin=3&ratingMax=8&watchedFrom=2005-01-01&watchedTo=2020-12-31&sort=year&limit=100',
      '/watches?sort=title&order=desc&offset=9000&limit=100',
      '/watches?genre=%D0%96%D0%B0%D0%BD%D1%80%2012&ratingMin=6&ratingMax=9&watchedFrom=2010-01-01&watchedTo=2024-06-30',
      '/watches?sort=rating&limit=100&offset=5000',
      '/watches?order=asc&offset=9980',
    ];
    const durations: number[] = [];
    for (let i = 0; i < 60; i++) {
      const url = urls[i % urls.length]!;
      const start = performance.now();
      const res = await app.inject(url);
      durations.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    // Sanity: the seeded history is really there and the genre filter matches.
    expect((await app.inject('/watches')).json().total).toBe(MOVIES);
    expect((await app.inject('/watches?genre=%D0%96%D0%B0%D0%BD%D1%80%201')).json().total).toBe((MOVIES * 3) / GENRES);

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1]!;
    expect(p95, `GET /watches p95 = ${p95.toFixed(1)} ms over ${durations.length} requests`).toBeLessThan(200);
    await app.close();
  }, 30_000);
});
