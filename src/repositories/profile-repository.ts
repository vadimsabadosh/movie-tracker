// Preference Profile aggregates (FR-6). Aggregation happens in SQL (NFR-1); both statements are fixed literals
// with no parameters at all (NFR-3, ADR-011: no SQL built from strings).
// No DISTINCT: ADR-009 allows one watch per movie and the movie_genres PK prevents duplicate links.
// Order (plan D3, NFR-5): count desc, then the exact (unrounded) average desc, then name, so the order is total
// and the same database always gives the same profile. Genres group by id (unique name_key, ADR-008) and order
// by name_key; directors group by the exact stored string (plan D5).
import type Database from 'better-sqlite3';
import type { PreferenceItem } from '../schemas/profile.ts';

const GENRE_PROFILE_SQL = `
  SELECT g.name AS name, COUNT(*) AS count, ROUND(AVG(w.rating), 2) AS averageRating
  FROM watches w
  JOIN movie_genres mg ON mg.movie_id = w.movie_id
  JOIN genres g ON g.id = mg.genre_id
  GROUP BY g.id
  ORDER BY COUNT(*) DESC, AVG(w.rating) DESC, g.name_key ASC`;

const DIRECTOR_PROFILE_SQL = `
  SELECT m.director AS name, COUNT(*) AS count, ROUND(AVG(w.rating), 2) AS averageRating
  FROM watches w
  JOIN movies m ON m.id = w.movie_id
  GROUP BY m.director
  ORDER BY COUNT(*) DESC, AVG(w.rating) DESC, m.director ASC`;

export class ProfileRepository {
  private readonly genreStmt: Database.Statement<[], PreferenceItem>;
  private readonly directorStmt: Database.Statement<[], PreferenceItem>;

  constructor(db: Database.Database) {
    this.genreStmt = db.prepare<[], PreferenceItem>(GENRE_PROFILE_SQL);
    this.directorStmt = db.prepare<[], PreferenceItem>(DIRECTOR_PROFILE_SQL);
  }

  genres(): PreferenceItem[] {
    return this.genreStmt.all();
  }

  directors(): PreferenceItem[] {
    return this.directorStmt.all();
  }
}
