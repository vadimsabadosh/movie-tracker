// NFR-1: GET /watches (Watch History, FR-4) answers within p95 ≤ 200 ms on 10 000 movies, all watched.
// The catalog is seeded with SQL straight into the test database (fixture code): 20 000 API calls would be slow.
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { textKey } from '../src/repositories/movie-repository.ts';

const TODAY = '2026-10-16';
const MOVIES = 10_000;
const GENRES = 20;
const DAY_MS = 86_400_000;
const FIRST_DAY = Date.UTC(2000, 0, 1);
const DAYS = (Date.UTC(2026, 9, 16) - FIRST_DAY) / DAY_MS;

function seed(db: ReturnType<typeof openDatabase>): void {
  const genre = db.prepare('INSERT INTO genres (id, name, name_key) VALUES (?, ?, ?)');
  const movie = db.prepare('INSERT INTO movies (id, title, title_key, year, director) VALUES (?, ?, ?, ?, ?)');
  const link = db.prepare('INSERT INTO movie_genres (movie_id, genre_id) VALUES (?, ?)');
  const watch = db.prepare('INSERT INTO watches (movie_id, watched_at, rating, note) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (let g = 1; g <= GENRES; g++) genre.run(g, `Жанр ${g}`, textKey(`Жанр ${g}`));
    for (let i = 1; i <= MOVIES; i++) {
      const title = `Фільм ${(i * 7919) % MOVIES} ${i}`;
      movie.run(i, title, textKey(title), 1900 + (i % 127), `Director ${i % 500}`);
      // Three distinct genres per movie, chosen deterministically.
      for (const g of [i % GENRES, (i + 7) % GENRES, (i + 13) % GENRES]) link.run(i, g + 1);
      const day = new Date(FIRST_DAY + ((i * 37) % (DAYS + 1)) * DAY_MS).toISOString().slice(0, 10);
      watch.run(i, day, (i % 10) + 1, i % 3 === 0 ? `note ${i}` : null);
    }
  })();
}

describe('watch history performance (NFR-1)', () => {
  it('keeps p95 under 200 ms on 10 000 watched movies', async () => {
    const db = openDatabase(':memory:');
    seed(db);
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
