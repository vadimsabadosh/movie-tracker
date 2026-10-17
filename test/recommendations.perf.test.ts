// NFR-1: GET /recommendations answers within p95 ≤ 200 ms on 10 000 movies (3 333 watched, 6 667 candidates).
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { seedCatalog } from './helpers.ts';

describe('recommendations performance (NFR-1)', () => {
  it('keeps p95 under 200 ms on a 10 000 movie catalog', async () => {
    const db = openDatabase(':memory:');
    // Every third movie watched; gcd(3, 500) = 1, so candidates share directors with the watched movies.
    seedCatalog(db, { watchEvery: 3 });
    const app = await buildApp({ db, today: () => '2026-10-16' });
    await app.ready();

    const durations: number[] = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      const res = await app.inject('/recommendations?limit=100');
      durations.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    // Sanity: a non-empty, correctly ordered list of unwatched movies.
    const { items } = (await app.inject('/recommendations?limit=100')).json() as { items: { movie: { id: number }; score: number }[] };
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(100);
    for (const item of items) expect(item.movie.id % 3).not.toBe(0);
    for (let i = 1; i < items.length; i++) expect(items[i]!.score).toBeLessThanOrEqual(items[i - 1]!.score);

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1]!;
    expect(p95, `GET /recommendations p95 = ${p95.toFixed(1)} ms over ${durations.length} requests`).toBeLessThan(200);
    await app.close();
  }, 30_000);
});
