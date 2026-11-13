// NFR-1: GET /movies (FR-5 filters + sort) answers within p95 ≤ 200 ms at 20 000 movies, above the real ~19 000.
// ADR-011 CASE ordering means no index helps the sort (D10): this test measures that cost at the real size.
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { CATALOG_GENRES as GENRES, seedCatalog } from './helpers.ts';

const MOVIES = 20_000;
const genre = (n: number) => encodeURIComponent(`Жанр ${n}`);

describe('catalog performance (NFR-1)', () => {
  it('keeps p95 under 200 ms on 20 000 movies', async () => {
    const db = openDatabase(':memory:');
    seedCatalog(db, { movies: MOVIES, watchEvery: 3 });
    const app = await buildApp({ db });
    await app.ready();

    const urls = [
      '/movies',
      '/movies?sort=rating&order=asc&offset=19000&limit=100',
      '/movies?director=director%2012&sort=year',
      `/movies?genre=${genre(5)}&yearFrom=1950&yearTo=2010&sort=votes&limit=100`,
      '/movies?q=1&sort=title&order=desc&offset=5000',
      `/movies?watched=false&director=director&genre=${genre(12)}&yearFrom=1990`,
      '/genres',
    ];
    const durations: number[] = [];
    for (let i = 0; i < 60; i++) {
      const url = urls[i % urls.length]!;
      const start = performance.now();
      const res = await app.inject(url);
      durations.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    // Sanity: the seeded catalog is really there and the filters match.
    expect((await app.inject('/movies')).json().total).toBe(MOVIES);
    expect((await app.inject(`/movies?genre=${genre(1)}`)).json().total).toBe((MOVIES * 3) / GENRES);
    expect((await app.inject('/movies?watched=true')).json().total).toBe(Math.floor(MOVIES / 3));

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1]!;
    expect(p95, `GET /movies p95 = ${p95.toFixed(1)} ms over ${durations.length} requests`).toBeLessThan(200);
    await app.close();
  }, 30_000);
});
