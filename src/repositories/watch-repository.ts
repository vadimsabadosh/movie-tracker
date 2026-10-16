// Watch entries: one row per watched movie (ADR-001, NFR-3: parameters only).
import type Database from 'better-sqlite3';
import type { WatchEntry, WatchListQuery } from '../schemas/watch.ts';

interface WatchRow {
  movie_id: number;
  watched_at: string;
  rating: number;
  note: string | null;
}

const toEntry = (row: WatchRow): WatchEntry => ({ movieId: row.movie_id, watchedAt: row.watched_at, rating: row.rating, note: row.note });

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
    const row = this.db
      .prepare('SELECT movie_id, watched_at, rating, note FROM watches WHERE movie_id = ?')
      .get(movieId) as WatchRow | undefined;
    return row && toEntry(row);
  }

  list(query: WatchListQuery): { items: WatchEntry[]; total: number } {
    // Newest first; FR-4 filters (genre, year, rating range, period) come with the Watch History task.
    const rows = this.db
      .prepare('SELECT movie_id, watched_at, rating, note FROM watches ORDER BY watched_at DESC, movie_id LIMIT @limit OFFSET @offset')
      .all({ limit: query.limit, offset: query.offset }) as WatchRow[];
    const { total } = this.db.prepare('SELECT COUNT(*) AS total FROM watches').get() as { total: number };
    return { items: rows.map(toEntry), total };
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
