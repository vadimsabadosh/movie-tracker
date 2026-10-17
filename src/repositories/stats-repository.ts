// Viewing Statistics aggregates (FR-8). Aggregation happens in SQL (NFR-1); all three statements are fixed
// literals with no parameters at all (NFR-3, ADR-011: no SQL built from strings).
// No DISTINCT: ADR-009 allows one watch per movie and the movie_genres PK prevents duplicate links.
// "Year" is the movie's release year (ADR-010). Order (plan D6/D7, NFR-5): genres by count desc, then name_key
// (ADR-008, total and case-insensitive); years ascending (the group key is unique, so the order is total).
import type Database from 'better-sqlite3';
import type { GenreCount, StatsTotals, YearCount } from '../schemas/stats.ts';

// Always exactly one row; AVG over zero rows is NULL.
const STATS_TOTALS_SQL = `
  SELECT COUNT(*) AS watchedCount, ROUND(AVG(rating), 2) AS averageRating
  FROM watches`;

const STATS_BY_GENRE_SQL = `
  SELECT g.name AS name, COUNT(*) AS count
  FROM watches w
  JOIN movie_genres mg ON mg.movie_id = w.movie_id
  JOIN genres g ON g.id = mg.genre_id
  GROUP BY g.id
  ORDER BY COUNT(*) DESC, g.name_key ASC`;

const STATS_BY_YEAR_SQL = `
  SELECT m.year AS year, COUNT(*) AS count
  FROM watches w
  JOIN movies m ON m.id = w.movie_id
  GROUP BY m.year
  ORDER BY m.year ASC`;

export class StatsRepository {
  private readonly totalsStmt: Database.Statement<[], StatsTotals>;
  private readonly byGenreStmt: Database.Statement<[], GenreCount>;
  private readonly byYearStmt: Database.Statement<[], YearCount>;

  constructor(db: Database.Database) {
    this.totalsStmt = db.prepare<[], StatsTotals>(STATS_TOTALS_SQL);
    this.byGenreStmt = db.prepare<[], GenreCount>(STATS_BY_GENRE_SQL);
    this.byYearStmt = db.prepare<[], YearCount>(STATS_BY_YEAR_SQL);
  }

  totals(): StatsTotals {
    // An aggregate without GROUP BY always yields one row.
    return this.totalsStmt.get()!;
  }

  byGenre(): GenreCount[] {
    return this.byGenreStmt.all();
  }

  byYear(): YearCount[] {
    return this.byYearStmt.all();
  }
}
