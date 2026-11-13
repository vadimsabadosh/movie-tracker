// Movie persistence: movies, genres, movie_genres (ADR-001, NFR-3: parameters only).
// Case-insensitive matching uses *_key columns lowercased in JS: SQLite NOCASE/LIKE fold ASCII only.
import type Database from 'better-sqlite3';
import { textKey } from '../db/database.ts';
import type { SortOrder } from '../schemas/common.ts';
import type { CatalogMovie, Movie, MovieInput, MovieListQuery } from '../schemas/movie.ts';

export { textKey };

interface MovieRow {
  id: number;
  title: string;
  year: number;
  director: string;
}

interface CatalogRow extends MovieRow {
  imdbRating: number | null;
  imdbVotes: number | null;
  watched: 0 | 1;
}

/** Catalog query after MovieService has resolved the per-sort default order. */
export type MovieCatalogQuery = MovieListQuery & { order: SortOrder };

// FR-5 catalog (NFR-1, NFR-3), built like HISTORY_PAGE_SQL in watch-repository.ts (ADR-011). Both statements are
// fixed literals with the same filter block: keep the WHERE clauses identical so that total matches the items.
// Drift is caught by the per-filter total assertions in test/movies.test.ts.
// Every filter is "@p IS NULL OR <cond>"; EXISTS never duplicates a movie with several genres.
// instr() instead of LIKE: no wildcard escaping, and the key columns are already lowercased (ADR-008).
// Sort field and direction are bound and picked by CASE; movies without IMDb data come last both ways.
// Tie-breaks: rating → more votes; then title, year, id (NFR-5).
const CATALOG_PAGE_SQL = `
  SELECT m.id, m.title, m.year, m.director, m.imdb_rating AS imdbRating, m.imdb_votes AS imdbVotes,
         EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = m.id) AS watched
  FROM movies m
  WHERE (@q IS NULL OR instr(m.title_key, @q) > 0)
    AND (@genreKey IS NULL OR EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
                                      WHERE mg.movie_id = m.id AND g.name_key = @genreKey))
    AND (@yearFrom IS NULL OR m.year >= @yearFrom)
    AND (@yearTo IS NULL OR m.year <= @yearTo)
    AND (@directorKey IS NULL OR instr(m.director_key, @directorKey) > 0)
    AND (@watched IS NULL OR EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = m.id) = @watched)
  ORDER BY
    CASE WHEN @sort = 'title' AND @order = 'asc' THEN m.title_key END ASC,
    CASE WHEN @sort = 'title' AND @order = 'desc' THEN m.title_key END DESC,
    CASE WHEN @sort = 'year' AND @order = 'asc' THEN m.year END ASC,
    CASE WHEN @sort = 'year' AND @order = 'desc' THEN m.year END DESC,
    CASE WHEN @sort = 'rating' AND @order = 'asc' THEN m.imdb_rating END ASC NULLS LAST,
    CASE WHEN @sort = 'rating' AND @order = 'desc' THEN m.imdb_rating END DESC NULLS LAST,
    CASE WHEN @sort = 'votes' AND @order = 'asc' THEN m.imdb_votes END ASC NULLS LAST,
    CASE WHEN @sort = 'votes' AND @order = 'desc' THEN m.imdb_votes END DESC NULLS LAST,
    CASE WHEN @sort = 'rating' THEN m.imdb_votes END DESC NULLS LAST,
    m.title_key ASC, m.year ASC, m.id ASC
  LIMIT @limit OFFSET @offset`;

const CATALOG_COUNT_SQL = `
  SELECT COUNT(*) AS total
  FROM movies m
  WHERE (@q IS NULL OR instr(m.title_key, @q) > 0)
    AND (@genreKey IS NULL OR EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
                                      WHERE mg.movie_id = m.id AND g.name_key = @genreKey))
    AND (@yearFrom IS NULL OR m.year >= @yearFrom)
    AND (@yearTo IS NULL OR m.year <= @yearTo)
    AND (@directorKey IS NULL OR instr(m.director_key, @directorKey) > 0)
    AND (@watched IS NULL OR EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = m.id) = @watched)`;

const toCatalog = ({ watched, ...row }: CatalogRow) => ({ ...row, watched: watched === 1 });

export class MovieRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  findById(id: number): CatalogMovie | undefined {
    const row = this.db
      .prepare(
        `SELECT m.id, m.title, m.year, m.director, m.imdb_rating AS imdbRating, m.imdb_votes AS imdbVotes,
                EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = m.id) AS watched
         FROM movies m WHERE m.id = @id`,
      )
      .get({ id }) as CatalogRow | undefined;
    return row && this.withGenres([toCatalog(row)])[0];
  }

  /** Another movie with the same title (case-insensitive) and year, if any. */
  findDuplicate(title: string, year: number, exceptId?: number): number | undefined {
    const row = this.db
      .prepare('SELECT id FROM movies WHERE title_key = ? AND year = ? AND id IS NOT ?')
      .get(textKey(title), year, exceptId ?? null) as { id: number } | undefined;
    return row?.id;
  }

  list(query: MovieCatalogQuery): { items: CatalogMovie[]; total: number } {
    const filters = {
      q: query.q === undefined ? null : textKey(query.q),
      genreKey: query.genre === undefined ? null : textKey(query.genre),
      yearFrom: query.yearFrom ?? null,
      yearTo: query.yearTo ?? null,
      directorKey: query.director === undefined ? null : textKey(query.director),
      watched: query.watched === undefined ? null : Number(query.watched === 'true'),
    };
    const rows = this.db
      .prepare(CATALOG_PAGE_SQL)
      .all({ ...filters, sort: query.sort, order: query.order, limit: query.limit, offset: query.offset }) as CatalogRow[];
    const { total } = this.db.prepare(CATALOG_COUNT_SQL).get(filters) as { total: number };
    return { items: this.withGenres(rows.map(toCatalog)), total };
  }

  /** Genre names used by at least one movie, case-insensitive order (ADR-008); id breaks ties (NFR-5). */
  listGenres(): string[] {
    return this.db
      .prepare(
        `SELECT g.name FROM genres g
         WHERE EXISTS (SELECT 1 FROM movie_genres mg WHERE mg.genre_id = g.id)
         ORDER BY g.name_key, g.id`,
      )
      .pluck()
      .all() as string[];
  }

  /** Every movie without a Watch Entry (FR-7 candidates), ordered by id; one literal statement (NFR-3). */
  listUnwatched(): Movie[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.title, m.year, m.director FROM movies m
         WHERE NOT EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = m.id)
         ORDER BY m.id`,
      )
      .all() as MovieRow[];
    return this.withGenres(rows);
  }

  create(input: MovieInput): CatalogMovie {
    return this.db.transaction(() => {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO movies (title, title_key, year, director, director_key) VALUES (?, ?, ?, ?, ?)')
        .run(input.title, textKey(input.title), input.year, input.director, textKey(input.director));
      const id = Number(lastInsertRowid);
      this.setGenres(id, input.genres);
      return this.findById(id)!;
    })();
  }

  update(id: number, input: MovieInput): CatalogMovie | undefined {
    return this.db.transaction(() => {
      const { changes } = this.db
        .prepare('UPDATE movies SET title = ?, title_key = ?, year = ?, director = ?, director_key = ? WHERE id = ?')
        .run(input.title, textKey(input.title), input.year, input.director, textKey(input.director), id);
      if (!changes) return undefined;
      this.setGenres(id, input.genres);
      return this.findById(id);
    })();
  }

  delete(id: number): boolean {
    // movie_genres rows go with ON DELETE CASCADE; genres stay for other movies.
    return this.db.prepare('DELETE FROM movies WHERE id = ?').run(id).changes > 0;
  }

  /** Links an IMDb ID to the movie with this title + year; never overwrites, skips an ID already used elsewhere. */
  attachImdbId(title: string, year: number, imdbId: string): boolean {
    return (
      this.db
        .prepare('UPDATE OR IGNORE movies SET imdb_id = @imdbId WHERE title_key = @key AND year = @year AND imdb_id IS NULL')
        .run({ imdbId, key: textKey(title), year }).changes > 0
    );
  }

  /** Importer only: overwrites the IMDb rating and votes of the movie with this IMDb ID (they change over time). */
  setImdbRating(imdbId: string, rating: number, votes: number): void {
    this.db.prepare('UPDATE movies SET imdb_rating = @rating, imdb_votes = @votes WHERE imdb_id = @imdbId').run({ imdbId, rating, votes });
  }

  posterInfo(id: number): { imdbId: string | null; posterPath: string | null } | undefined {
    return this.db.prepare('SELECT imdb_id AS imdbId, poster_path AS posterPath FROM movies WHERE id = @id').get({ id }) as
      { imdbId: string | null; posterPath: string | null } | undefined;
  }

  setPosterPath(id: number, path: string): void {
    this.db.prepare('UPDATE movies SET poster_path = @path WHERE id = @id').run({ id, path });
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

  private withGenres<T extends MovieRow>(rows: T[]): (T & { genres: string[] })[] {
    const genres = genresByMovie(
      this.db,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, genres: genres.get(r.id) ?? [] }));
  }
}

/** Genre names of each given movie, sorted by name_key; shared by repositories that return movies (D7). */
export function genresByMovie(db: Database.Database, movieIds: number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (movieIds.length === 0) return result;
  // json_each: one query for the whole page without building an IN (...) list.
  const links = db
    .prepare(
      `SELECT mg.movie_id AS movieId, g.name FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
       WHERE mg.movie_id IN (SELECT value FROM json_each(?)) ORDER BY g.name_key`,
    )
    .all(JSON.stringify(movieIds)) as { movieId: number; name: string }[];
  for (const { movieId, name } of links) {
    const list = result.get(movieId);
    if (list) list.push(name);
    else result.set(movieId, [name]);
  }
  return result;
}
