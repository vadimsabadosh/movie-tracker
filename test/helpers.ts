// Test app on an in-memory database with all migrations applied, plus the shared NFR-1 catalog fixture.
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { textKey } from '../src/repositories/movie-repository.ts';

export async function testApp(options: Omit<AppOptions, 'db'> = {}): Promise<FastifyInstance> {
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
 * `movies`: catalog size (default CATALOG_MOVIES). Every 50th movie has no IMDb data, like one added by hand.
 */
export function seedCatalog(
  db: ReturnType<typeof openDatabase>,
  { watchEvery = 1, movies = CATALOG_MOVIES }: { watchEvery?: number; movies?: number } = {},
): void {
  const genre = db.prepare('INSERT INTO genres (id, name, name_key) VALUES (?, ?, ?)');
  const movie = db.prepare(
    `INSERT INTO movies (id, title, title_key, year, director, director_key, imdb_rating, imdb_votes)
     VALUES (@id, @title, @titleKey, @year, @director, @directorKey, @rating, @votes)`,
  );
  const link = db.prepare('INSERT INTO movie_genres (movie_id, genre_id) VALUES (?, ?)');
  const watch = db.prepare('INSERT INTO watches (movie_id, watched_at, rating, note) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (let g = 1; g <= CATALOG_GENRES; g++) genre.run(g, `Жанр ${g}`, textKey(`Жанр ${g}`));
    for (let i = 1; i <= movies; i++) {
      const title = `Фільм ${(i * 7919) % movies} ${i}`;
      const director = `Director ${i % CATALOG_DIRECTORS}`;
      const imdb = i % 50 !== 0;
      movie.run({
        id: i,
        title,
        titleKey: textKey(title),
        year: 1900 + (i % 127),
        director,
        directorKey: textKey(director),
        rating: imdb ? (((i * 37) % 91) + 10) / 10 : null,
        votes: imdb ? 5000 + ((i * 7919) % 2_000_000) : null,
      });
      // Three distinct genres per movie, chosen deterministically.
      for (const g of [i % CATALOG_GENRES, (i + 7) % CATALOG_GENRES, (i + 13) % CATALOG_GENRES]) link.run(i, g + 1);
      const day = new Date(FIRST_DAY + ((i * 37) % (DAYS + 1)) * DAY_MS).toISOString().slice(0, 10);
      if (i % watchEvery === 0) watch.run(i, day, (i % 10) + 1, i % 3 === 0 ? `note ${i}` : null);
    }
  })();
}
