// NFR-1: GET /stats (Viewing Statistics, FR-8) answers within p95 ≤ 200 ms on 10 000 movies, all watched.
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { CATALOG_GENRES, CATALOG_MOVIES, seedCatalog } from './helpers.ts';

// seedCatalog gives movie i the release year 1900 + i % 127.
const CATALOG_YEARS = 127;
const sum = (items: { count: number }[]) => items.reduce((total, item) => total + item.count, 0);

async function appWith(watchEvery: number) {
  const db = openDatabase(':memory:');
  seedCatalog(db, { watchEvery });
  const app = await buildApp({ db, today: () => '2026-10-16' });
  await app.ready();
  return app;
}

describe('viewing statistics performance (NFR-1)', () => {
  it('keeps p95 under 200 ms on 10 000 watched movies', async () => {
    const app = await appWith(1);

    const durations: number[] = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      const res = await app.inject('/stats');
      durations.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    // Sanity: the seeded catalog's totals and distributions.
    const { watchedCount, averageRating, byGenre, byYear } = (await app.inject('/stats')).json();
    expect(watchedCount).toBe(CATALOG_MOVIES);
    expect(averageRating).toBe(5.5); // ratings i % 10 + 1 are uniform over 10 000 movies
    expect(byGenre).toHaveLength(CATALOG_GENRES);
    expect(sum(byGenre)).toBe(CATALOG_MOVIES * 3);
    expect(byYear).toHaveLength(CATALOG_YEARS);
    expect(sum(byYear)).toBe(CATALOG_MOVIES);
    expect(byYear[0].year).toBe(1900);
    for (let i = 1; i < byYear.length; i++) expect(byYear[i].year).toBeGreaterThan(byYear[i - 1].year);

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1]!;
    expect(p95, `GET /stats p95 = ${p95.toFixed(1)} ms over ${durations.length} requests`).toBeLessThan(200);
    await app.close();
  }, 30_000);

  it('excludes unwatched movies at scale', async () => {
    const app = await appWith(3);
    const { watchedCount, byYear } = (await app.inject('/stats')).json();
    expect(watchedCount).toBe(Math.floor(CATALOG_MOVIES / 3));
    expect(sum(byYear)).toBe(watchedCount);
    await app.close();
  }, 30_000);
});
