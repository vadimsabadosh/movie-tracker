// Watch entries: one row per watched movie (ADR-001, NFR-3: parameters only).
import type Database from 'better-sqlite3';
import type { SortOrder, WatchEntry, WatchHistoryItem, WatchListQuery } from '../schemas/watch.ts';
import { genresByMovie, textKey } from './movie-repository.ts';

interface WatchRow {
  movie_id: number;
  watched_at: string;
  rating: number;
  note: string | null;
}

const toEntry = (row: WatchRow): WatchEntry => ({ movieId: row.movie_id, watchedAt: row.watched_at, rating: row.rating, note: row.note });

interface HistoryRow extends WatchRow {
  title: string;
  year: number;
  director: string;
}

/** History query after WatchService has resolved the per-sort default order. */
export type WatchHistoryQuery = WatchListQuery & { order: SortOrder };

// FR-4 Watch History (NFR-1, NFR-3). Both statements are fixed literals with the same filter block:
// keep the WHERE clauses identical so that total always matches the filtered items. Drift is caught by the
// per-filter total assertions in test/watches.test.ts ('watch history (FR-4)': the titles() helper checks total).
// Every filter is "@p IS NULL OR <cond>"; EXISTS on genres never duplicates a watch with several genres.
// Sort field and direction are bound parameters picked by CASE (SQLite cannot bind identifiers/ASC/DESC),
// so no SQL text is built from input. Tie-breakers keep paging stable.
const HISTORY_PAGE_SQL = `
  SELECT w.movie_id, w.watched_at, w.rating, w.note, m.title, m.year, m.director
  FROM watches w JOIN movies m ON m.id = w.movie_id
  WHERE (@genreKey IS NULL OR EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
                                      WHERE mg.movie_id = w.movie_id AND g.name_key = @genreKey))
    AND (@yearFrom IS NULL OR m.year >= @yearFrom)
    AND (@yearTo IS NULL OR m.year <= @yearTo)
    AND (@ratingMin IS NULL OR w.rating >= @ratingMin)
    AND (@ratingMax IS NULL OR w.rating <= @ratingMax)
    AND (@watchedFrom IS NULL OR w.watched_at >= @watchedFrom)
    AND (@watchedTo IS NULL OR w.watched_at <= @watchedTo)
  ORDER BY
    CASE WHEN @sort = 'watchedAt' AND @order = 'asc'  THEN w.watched_at END ASC,
    CASE WHEN @sort = 'watchedAt' AND @order = 'desc' THEN w.watched_at END DESC,
    CASE WHEN @sort = 'rating'    AND @order = 'asc'  THEN w.rating     END ASC,
    CASE WHEN @sort = 'rating'    AND @order = 'desc' THEN w.rating     END DESC,
    CASE WHEN @sort = 'year'      AND @order = 'asc'  THEN m.year       END ASC,
    CASE WHEN @sort = 'year'      AND @order = 'desc' THEN m.year       END DESC,
    CASE WHEN @sort = 'title'     AND @order = 'asc'  THEN m.title_key  END ASC,
    CASE WHEN @sort = 'title'     AND @order = 'desc' THEN m.title_key  END DESC,
    CASE WHEN @sort IN ('rating', 'year') THEN w.watched_at END DESC,
    CASE WHEN @sort = 'title' THEN m.year END ASC,
    w.movie_id ASC
  LIMIT @limit OFFSET @offset`;

const HISTORY_COUNT_SQL = `
  SELECT COUNT(*) AS total
  FROM watches w JOIN movies m ON m.id = w.movie_id
  WHERE (@genreKey IS NULL OR EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
                                      WHERE mg.movie_id = w.movie_id AND g.name_key = @genreKey))
    AND (@yearFrom IS NULL OR m.year >= @yearFrom)
    AND (@yearTo IS NULL OR m.year <= @yearTo)
    AND (@ratingMin IS NULL OR w.rating >= @ratingMin)
    AND (@ratingMax IS NULL OR w.rating <= @ratingMax)
    AND (@watchedFrom IS NULL OR w.watched_at >= @watchedFrom)
    AND (@watchedTo IS NULL OR w.watched_at <= @watchedTo)`;

export interface WatchData {
  watchedAt: string;
  rating: number;
  note: string | null;
}

export class WatchRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  findByMovie(movieId: number): WatchEntry | undefined {
    const row = this.db.prepare('SELECT movie_id, watched_at, rating, note FROM watches WHERE movie_id = ?').get(movieId) as
      WatchRow | undefined;
    return row && toEntry(row);
  }

  /** FR-4: filtered, sorted and paginated history with the movie of each entry, all in SQL. */
  list(query: WatchHistoryQuery): { items: WatchHistoryItem[]; total: number } {
    // better-sqlite3 needs every named parameter bound: absent filters become NULL.
    const filters = {
      genreKey: query.genre === undefined ? null : textKey(query.genre),
      yearFrom: query.yearFrom ?? null,
      yearTo: query.yearTo ?? null,
      ratingMin: query.ratingMin ?? null,
      ratingMax: query.ratingMax ?? null,
      watchedFrom: query.watchedFrom ?? null,
      watchedTo: query.watchedTo ?? null,
    };
    const rows = this.db
      .prepare(HISTORY_PAGE_SQL)
      .all({ ...filters, sort: query.sort, order: query.order, limit: query.limit, offset: query.offset }) as HistoryRow[];
    const { total } = this.db.prepare(HISTORY_COUNT_SQL).get(filters) as { total: number };
    const genres = genresByMovie(
      this.db,
      rows.map((r) => r.movie_id),
    );
    const items = rows.map((r) => ({
      ...toEntry(r),
      movie: { id: r.movie_id, title: r.title, year: r.year, director: r.director, genres: genres.get(r.movie_id) ?? [] },
    }));
    return { items, total };
  }

  create(movieId: number, data: WatchData): WatchEntry {
    this.db
      .prepare('INSERT INTO watches (movie_id, watched_at, rating, note) VALUES (@movieId, @watchedAt, @rating, @note)')
      .run({ movieId, ...data });
    return this.findByMovie(movieId)!;
  }

  update(movieId: number, data: WatchData): WatchEntry | undefined {
    const { changes } = this.db
      .prepare('UPDATE watches SET watched_at = @watchedAt, rating = @rating, note = @note WHERE movie_id = @movieId')
      .run({ movieId, ...data });
    return changes ? this.findByMovie(movieId) : undefined;
  }

  delete(movieId: number): boolean {
    return this.db.prepare('DELETE FROM watches WHERE movie_id = ?').run(movieId).changes > 0;
  }
}
