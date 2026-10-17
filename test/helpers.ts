// Test app on an in-memory database with all migrations applied, plus the shared NFR-1 catalog fixture.
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { textKey } from '../src/repositories/movie-repository.ts';

export async function testApp(options: { today?: () => string } = {}): Promise<FastifyInstance> {
  const app = await buildApp({ db: openDatabase(':memory:'), ...options });
  await app.ready();
  return app;
}

// NFR-1 catalog: 10 000 movies, all watched (dates up to 2026-10-16), 20 genres with 3 per movie, 500 directors.
export const CATALOG_MOVIES = 10_000;
export const CATALOG_GENRES = 20;
export const CATALOG_DIRECTORS = 500;
const DAY_MS = 86_400_000;
const FIRST_DAY = Date.UTC(2000, 0, 1);
const DAYS = (Date.UTC(2026, 9, 16) - FIRST_DAY) / DAY_MS;

/**
 * Seeds the NFR-1 catalog with SQL straight into the test database (fixture code): 20 000 API calls would be slow.
 * `watchEvery`: only movie ids divisible by it are watched (default 1: all, as the existing perf tests expect).
 */
export function seedCatalog(db: ReturnType<typeof openDatabase>, { watchEvery = 1 }: { watchEvery?: number } = {}): void {
  const genre = db.prepare('INSERT INTO genres (id, name, name_key) VALUES (?, ?, ?)');
  const movie = db.prepare('INSERT INTO movies (id, title, title_key, year, director) VALUES (?, ?, ?, ?, ?)');
  const link = db.prepare('INSERT INTO movie_genres (movie_id, genre_id) VALUES (?, ?)');
  const watch = db.prepare('INSERT INTO watches (movie_id, watched_at, rating, note) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (let g = 1; g <= CATALOG_GENRES; g++) genre.run(g, `Жанр ${g}`, textKey(`Жанр ${g}`));
    for (let i = 1; i <= CATALOG_MOVIES; i++) {
      const title = `Фільм ${(i * 7919) % CATALOG_MOVIES} ${i}`;
      movie.run(i, title, textKey(title), 1900 + (i % 127), `Director ${i % CATALOG_DIRECTORS}`);
      // Three distinct genres per movie, chosen deterministically.
      for (const g of [i % CATALOG_GENRES, (i + 7) % CATALOG_GENRES, (i + 13) % CATALOG_GENRES]) link.run(i, g + 1);
      const day = new Date(FIRST_DAY + ((i * 37) % (DAYS + 1)) * DAY_MS).toISOString().slice(0, 10);
      if (i % watchEvery === 0) watch.run(i, day, (i % 10) + 1, i % 3 === 0 ? `note ${i}` : null);
    }
  })();
}
