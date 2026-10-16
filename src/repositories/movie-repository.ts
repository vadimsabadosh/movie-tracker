// Movie persistence: movies, genres, movie_genres (ADR-001, NFR-3: parameters only).
// Case-insensitive matching uses *_key columns lowercased in JS: SQLite NOCASE/LIKE fold ASCII only.
import type Database from 'better-sqlite3';
import type { Movie, MovieInput, MovieListQuery } from '../schemas/movie.ts';

interface MovieRow {
  id: number;
  title: string;
  year: number;
  director: string;
}

export const textKey = (text: string) => text.trim().toLocaleLowerCase('uk');

export class MovieRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  findById(id: number): Movie | undefined {
    const row = this.db.prepare('SELECT id, title, year, director FROM movies WHERE id = ?').get(id) as MovieRow | undefined;
    return row && this.withGenres([row])[0];
  }

  /** Another movie with the same title (case-insensitive) and year, if any. */
  findDuplicate(title: string, year: number, exceptId?: number): number | undefined {
    const row = this.db
      .prepare('SELECT id FROM movies WHERE title_key = ? AND year = ? AND id IS NOT ?')
      .get(textKey(title), year, exceptId ?? null) as { id: number } | undefined;
    return row?.id;
  }

  list(query: MovieListQuery): { items: Movie[]; total: number } {
    // instr() instead of LIKE: no wildcard escaping, and the key column is already lowercased.
    const q = query.q === undefined ? null : textKey(query.q);
    const rows = this.db
      .prepare(
        `SELECT id, title, year, director FROM movies
         WHERE @q IS NULL OR instr(title_key, @q) > 0
         ORDER BY title_key, year, id LIMIT @limit OFFSET @offset`,
      )
      .all({ q, limit: query.limit, offset: query.offset }) as MovieRow[];
    const { total } = this.db
      .prepare('SELECT COUNT(*) AS total FROM movies WHERE @q IS NULL OR instr(title_key, @q) > 0')
      .get({ q }) as { total: number };
    return { items: this.withGenres(rows), total };
  }

  create(input: MovieInput): Movie {
    return this.db.transaction(() => {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO movies (title, title_key, year, director) VALUES (?, ?, ?, ?)')
        .run(input.title, textKey(input.title), input.year, input.director);
      const id = Number(lastInsertRowid);
      this.setGenres(id, input.genres);
      return this.findById(id)!;
    })();
  }

  update(id: number, input: MovieInput): Movie | undefined {
    return this.db.transaction(() => {
      const { changes } = this.db
        .prepare('UPDATE movies SET title = ?, title_key = ?, year = ?, director = ? WHERE id = ?')
        .run(input.title, textKey(input.title), input.year, input.director, id);
      if (!changes) return undefined;
      this.setGenres(id, input.genres);
      return this.findById(id);
    })();
  }

  delete(id: number): boolean {
    // movie_genres rows go with ON DELETE CASCADE; genres stay for other movies.
    return this.db.prepare('DELETE FROM movies WHERE id = ?').run(id).changes > 0;
  }

  private setGenres(movieId: number, names: string[]): void {
    const insertGenre = this.db.prepare('INSERT INTO genres (name, name_key) VALUES (?, ?) ON CONFLICT (name_key) DO NOTHING');
    const genreId = this.db.prepare('SELECT id FROM genres WHERE name_key = ?');
    const link = this.db.prepare('INSERT OR IGNORE INTO movie_genres (movie_id, genre_id) VALUES (?, ?)');
    this.db.prepare('DELETE FROM movie_genres WHERE movie_id = ?').run(movieId);
    for (const name of names) {
      // The first spelling of a genre is kept ("Sci-Fi" stays even if "sci-fi" comes later).
      insertGenre.run(name.trim(), textKey(name));
      const { id } = genreId.get(textKey(name)) as { id: number };
      link.run(movieId, id);
    }
  }

  private withGenres(rows: MovieRow[]): Movie[] {
    if (rows.length === 0) return [];
    // json_each: one query for the whole page without building an IN (...) list.
    const links = this.db
      .prepare(
        `SELECT mg.movie_id AS movieId, g.name FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
         WHERE mg.movie_id IN (SELECT value FROM json_each(?)) ORDER BY g.name_key`,
      )
      .all(JSON.stringify(rows.map((r) => r.id))) as { movieId: number; name: string }[];
    return rows.map((r) => ({ ...r, genres: links.filter((l) => l.movieId === r.id).map((l) => l.name) }));
  }
}
