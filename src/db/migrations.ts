// Schema migrations, applied in order; PRAGMA user_version stores how many have run.
// Append only: never edit a migration that has been committed (guardrail W3 asks before changes here).
export const MIGRATIONS: readonly string[] = [
  // 1. Catalog: movies, genres, movie_genres (FR-1). *_key = lowercased text for case-insensitive
  //    uniqueness and search, computed in the repository (SQLite NOCASE folds ASCII only).
  `
  CREATE TABLE movies (
    id        INTEGER PRIMARY KEY,
    title     TEXT    NOT NULL CHECK (length(trim(title)) > 0),
    title_key TEXT    NOT NULL,
    year      INTEGER NOT NULL CHECK (year >= 1888),
    director  TEXT    NOT NULL CHECK (length(trim(director)) > 0),
    UNIQUE (title_key, year)
  );
  CREATE TABLE genres (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE
  );
  CREATE TABLE movie_genres (
    movie_id INTEGER NOT NULL REFERENCES movies (id) ON DELETE CASCADE,
    genre_id INTEGER NOT NULL REFERENCES genres (id) ON DELETE RESTRICT,
    PRIMARY KEY (movie_id, genre_id)
  );
  CREATE INDEX movie_genres_genre ON movie_genres (genre_id);
  `,
];
