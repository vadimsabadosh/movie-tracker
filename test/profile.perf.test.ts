// NFR-1: GET /profile (Preference Profile, FR-6) answers within p95 ≤ 200 ms on 10 000 movies, all watched.
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { CATALOG_DIRECTORS, CATALOG_GENRES, CATALOG_MOVIES, seedCatalog } from './helpers.ts';

describe('preference profile performance (NFR-1)', () => {
  it('keeps p95 under 200 ms on 10 000 watched movies', async () => {
    const db = openDatabase(':memory:');
    seedCatalog(db);
    const app = await buildApp({ db, today: () => '2026-10-16' });
    await app.ready();

    const durations: number[] = [];
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      const res = await app.inject('/profile');
      durations.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    // Sanity: every genre and director of the seeded catalog is in the profile with the right totals.
    const { genres, directors } = (await app.inject('/profile')).json();
    expect(genres).toHaveLength(CATALOG_GENRES);
    expect(genres.reduce((sum: number, g: { count: number }) => sum + g.count, 0)).toBe(CATALOG_MOVIES * 3);
    expect(directors).toHaveLength(CATALOG_DIRECTORS);

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1]!;
    expect(p95, `GET /profile p95 = ${p95.toFixed(1)} ms over ${durations.length} requests`).toBeLessThan(200);
    await app.close();
  }, 30_000);
});
