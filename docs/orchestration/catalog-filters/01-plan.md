# Plan: Catalog filters and sorting, posters in history (`catalog-filters`)

> **The vault MCP failed to connect in this session.** I could not call `get_note`, `search_notes` or read any ADR. Every domain fact below comes from the code, `docs/` and earlier orchestration records. Those records quote ADR-008, ADR-010 and ADR-011. Before the Coder starts, the orchestrator should check D3, D5 and D6 against vault ADR-008 and ADR-011 once the MCP reconnects.

## Goal
In the catalog (`GET /movies` and the `#/` screen), the user can filter by genre, year range and director, and sort by title, year, IMDb rating or IMDb vote count ("popularity"). Paging stays as it is, the title search `q` stays, and every order is deterministic. To support this, migration 4 stores the IMDb rating and vote count. The importer already reads both and throws them away. It will now store them, and a re-run of `npm run import:imdb` fills them in for the existing ~19 000 movies. Catalog list items show the IMDb rating. History rows get the same lazy poster that catalog rows have. Requirements: **FR-5** (extended, D9), **FR-9** (posters in history), **NFR-1** (measured at 20 000 movies), **NFR-2**, **NFR-3**, **NFR-4**, **NFR-5** (tie-breaks), **NFR-6**, **NFR-7** (hand-added movies have no IMDb data and the app works offline).

## Domain facts
| Fact | Source |
|---|---|
| Movie = `title`, `year` (1888 to next year), `genres[]` (1–20, each ≤ 50 chars), `director` (one string, ≤ 200 chars; IMDb co-directors joined with ", "). Unique by `title_key` + `year` | `src/schemas/movie.ts`, migration 1, `src/import/imdb.ts` `joinDirectors` |
| Case-insensitive text matching uses `*_key` columns built in JS with `textKey()` (`toLocaleLowerCase('uk')`). Never `LIKE`/`NOCASE`, which fold ASCII only | ADR-008 (cited in `movie-repository.ts` header and `watch-history/01-plan.md`) |
| A query has optional filters, inclusive ranges, an inverted range gives 400, an unknown genre gives 200 with an empty list, and `sort` + `order` default per sort | ADR-010 (watch-history README); `src/schemas/watch.ts` `WatchListQuery` |
| ORDER BY uses bound `@sort`/`@order` picked by `CASE` terms in one fixed statement, with no SQL built from strings. Accepted cost: no index helps the sort. "Revisit if the bound grows" past 10 000 | ADR-011; `docs/orchestration/watch-history/05-review.md` |
| Recommendations depend on the `Movie` type (`src/recommendation/*.ts` import it). Changing `Movie` touches W5 code | `grep` of `src/recommendation` |
| Re-running the importer is how existing catalogs get back-filled (`attachImdbId`, posters D9) | `src/import/imdb.ts` `importMovies` |
| `title.ratings` columns: `tconst`, `averageRating`, `numVotes`. The non-commercial IMDb datasets have no "popularity" or MOVIEmeter rank | `src/import/imdb.ts`, `test/imdb-import.test.ts` fixtures |
| Migrations are append-only, and a schema change is W3 (the human confirms it) | `src/db/migrations.ts` header; `docs/guardrails.md` |
| Real catalog is ~19 000 movies; the NFR-1 bound is 10 000 | `00-task.md`; `docs/app-requirements.md` |

## Current code
| File | What is there now | Change needed |
|---|---|---|
| `src/db/migrations.ts` | 3 migrations | Append migration 4 (D1, D3) |
| `src/db/database.ts` | `openDatabase`, `migrate` (exec each SQL string) | Register the deterministic SQL function `text_key` in `migrate()` so migration 4 can back-fill `director_key` (D3) |
| `src/schemas/common.ts` | `PaginationQuery`, `page`, `ErrorResponse` | Receives `SortOrder` and `inverted` moved from `watch.ts` (D7) |
| `src/schemas/watch.ts` | `WatchListQuery`; local `QueryYear` and `inverted`; exports `SortOrder` | Import `SortOrder`/`inverted` from `common.ts` and `QueryYear` from `movie.ts`. Behaviour unchanged |
| `src/schemas/movie.ts` | `MovieListQuery` = pagination + `q`; `MoviePage = page(Movie)` | Add filters, sort and order; `CatalogMovie`; `MoviePage = page(CatalogMovie)`; export `QueryYear`, `MovieSort` |
| `src/repositories/movie-repository.ts` | `list` orders by `title_key, year, id`; `create`/`update` write `title_key` | New fixed `CATALOG_PAGE_SQL`/`CATALOG_COUNT_SQL`; write `director_key`; new `setImdbRating`; generic `withGenres` |
| `src/repositories/watch-repository.ts` | imports `SortOrder` from `schemas/watch.ts` | Import path only, if `watch.ts` no longer re-exports it |
| `src/services/movie-service.ts` | `list` passes the query through | Resolve the default `order` per sort; add `setImdbRating` pass-through for the importer |
| `src/import/imdb.ts` | ratings read into a `Set` only for `minVotes` | Keep `{ rating, votes }` per `tconst`; `ImdbMovie` gets `imdbRating`, `imdbVotes`; `importMovies` stores them |
| `src/routes/movies.ts` | `GET /movies` with `MovieListQuery`, `MoviePage` | No code change (the schemas carry it); update the header comment |
| `public/app.js` | catalog: debounced search + pager; history: filter form, rows without poster | Catalog filter/sort form, IMDb line in rows, filter-aware empty text; `poster()` in history rows |
| `public/style.css` | `.history-row { grid-template-columns: 40px minmax(0,1fr) auto }` | Add a poster column; `.imdb` line style |
| `test/helpers.ts` | `seedCatalog` inserts 10 000 movies without `director_key`/IMDb data | Add `movies` option, `director_key`, deterministic IMDb data |
| `test/app.test.ts` | migration tests expect version 3 after `migrate(db, MIGRATIONS)` (line ~101) | Use `MIGRATIONS.length`; add migration-4 tests and an OpenAPI test for `/movies` |
| `test/movies.test.ts`, `test/imdb-import.test.ts` | FR-5 search tests; import tests compare whole `ImdbMovie` objects and call `services.movies.list({limit, offset})` | Extend (see Test plan); fix the `list` call so it type-checks (`sort` becomes required in the output type) |
| `docs/app-requirements.md` | FR-5 = title search only | Extend FR-5 (D9) |

## Decisions
| # | Decision | Why | Rejected alternatives |
|---|---|---|---|
| D1 | Migration 4: `ALTER TABLE movies ADD COLUMN imdb_rating REAL CHECK (imdb_rating BETWEEN 1 AND 10); ALTER TABLE movies ADD COLUMN imdb_votes INTEGER CHECK (imdb_votes >= 0);`. `NULL` means no IMDb data (hand-added movies, or not imported yet) | The task allows exactly these two values. The CHECKs back up the importer's parsing. `NULL` is how NFR-7 movies are represented | A separate `imdb_ratings` table (a join on every catalog query for two 1:1 values). `NOT NULL DEFAULT 0` (0 would sort as a real value and look like a real rating) |
| D2 | The importer **overwrites** rating and votes on every run: `UPDATE movies SET imdb_rating = @rating, imdb_votes = @votes WHERE imdb_id = @imdbId`. This runs after `attachImdbId`, for new and duplicate rows alike. A row whose `averageRating` is not a finite number in [1, 10] or whose `numVotes` is not an integer ≥ 0 counts as `invalid` | IMDb ratings change over time, so a re-run should refresh them. Updating by `imdb_id` hits exactly the movie that owns that ID, even when `attachImdbId` skipped a conflict. `importMovies` keeps its return shape `{ imported, duplicates, linked }`, so the CLI and its tests stay as they are | Never overwriting, like `attachImdbId` (stale forever). Matching by title + year (ambiguous; the ID is the stable key). A new `rated` counter (nobody asked for it) |
| D3 | Director filter = **case-insensitive substring** (Q4) on a new `director_key TEXT NOT NULL DEFAULT ''` column. The same migration back-fills it: `UPDATE movies SET director_key = text_key(director);`. `migrate()` registers `db.function('text_key', { deterministic: true }, (s) => textKey(String(s)))` before it runs migrations. `create`/`update` write `textKey(input.director)`. Move the `textKey` definition into `src/db/database.ts`; `movie-repository.ts` imports it and re-exports it (`export { textKey }`), so existing imports keep working | Same pattern as `title_key`/`name_key` (ADR-008), and Cyrillic folds correctly. Back-filling in SQL needs JS lowercasing, hence the function. It sits in `migrate()` and not in `openDatabase()` because tests call `migrate(new Database(...), MIGRATIONS)` directly. Moving `textKey` down into `db/` keeps the dependency direction repositories → db | `instr(lower(director), …)` (ASCII-only, breaks ADR-008). Calling the JS function at query time on every row (about 38 000 JS calls per request, and the repository would depend on a function registered somewhere else). Back-filling from JS in `openDatabase` on every start (data migration outside the migration list). `database.ts` importing from `repositories/` (wrong direction) |
| D4 | `GET /movies` query: `q` (unchanged), `genre` (trim, 1–50; exact name match via `name_key`, like History), `yearFrom`/`yearTo` (`QueryYear`: int 1888..next year; inverted range → 400 on `yearTo`, "must be ≥ yearFrom"), `director` (trim, 1–200, substring), `sort` ∈ `title\|year\|rating\|votes` (default per Q1: `votes`), `order` ∈ `asc\|desc` optional. All filters combine with AND | Mirrors `WatchListQuery` (ADR-010): same names, ranges and error paths, so the UI and the reviewer see one contract. Unknown genre → 200, empty | Genre substring (diverges from History). 404 for an unknown genre. `minRating`/`minVotes` filters (not asked) |
| D5 | Sorting follows ADR-011: one fixed `CATALOG_PAGE_SQL` with bound `@sort`/`@order` and `CASE` terms. The default order is resolved in `MovieService.list`: `title` → `asc`, every other sort → `desc`. Movies with no IMDb data come **last in both directions** (Q2), via `NULLS LAST`. Full ORDER BY in D6 | Same mechanism as History, accepted by the reviewer there, and no SQL is built from input (NFR-3). The tie-breaks give a total order (NFR-5): the last key is always `m.id` | A constant map of ORDER BY clauses concatenated into SQL (ADR-011 chose against it). Nulls first on `asc` (SQLite's default: hand-added movies would top "lowest rated") |
| D6 | SQL shape (WHERE copied into both statements, as in History; tests check that `total` matches every filter): <br>`SELECT m.id, m.title, m.year, m.director, m.imdb_rating AS imdbRating, m.imdb_votes AS imdbVotes FROM movies m`<br>`WHERE (@q IS NULL OR instr(m.title_key, @q) > 0)`<br>`AND (@genreKey IS NULL OR EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = m.id AND g.name_key = @genreKey))`<br>`AND (@yearFrom IS NULL OR m.year >= @yearFrom) AND (@yearTo IS NULL OR m.year <= @yearTo)`<br>`AND (@directorKey IS NULL OR instr(m.director_key, @directorKey) > 0)`<br>`ORDER BY`<br>`CASE WHEN @sort='title' AND @order='asc' THEN m.title_key END ASC,`<br>`CASE WHEN @sort='title' AND @order='desc' THEN m.title_key END DESC,`<br>`CASE WHEN @sort='year' AND @order='asc' THEN m.year END ASC,`<br>`CASE WHEN @sort='year' AND @order='desc' THEN m.year END DESC,`<br>`CASE WHEN @sort='rating' AND @order='asc' THEN m.imdb_rating END ASC NULLS LAST,`<br>`CASE WHEN @sort='rating' AND @order='desc' THEN m.imdb_rating END DESC NULLS LAST,`<br>`CASE WHEN @sort='votes' AND @order='asc' THEN m.imdb_votes END ASC NULLS LAST,`<br>`CASE WHEN @sort='votes' AND @order='desc' THEN m.imdb_votes END DESC NULLS LAST,`<br>`CASE WHEN @sort='rating' THEN m.imdb_votes END DESC NULLS LAST,`<br>`m.title_key ASC, m.year ASC, m.id ASC`<br>`LIMIT @limit OFFSET @offset`. <br>`CATALOG_COUNT_SQL` = `SELECT COUNT(*) AS total FROM movies m` + the same WHERE | Tie-breaks: rating → more votes first, then title. Title/year/votes → title A→Z, year, id. `EXISTS` never duplicates a movie that has several genres. `instr` keeps `%`/`_` literal, as today | Building the WHERE from a shared string constant (`${…}` is flagged by the skill's layer grep; History kept literals) |
| D7 | Move `SortOrder` and `inverted` from `schemas/watch.ts` into `schemas/common.ts`, and `QueryYear` into `schemas/movie.ts` (exported). `watch.ts` imports them | `movie.ts` cannot import `watch.ts` (`watch.ts` imports `Movie` at module load: a cycle). One definition per rule | Copying them into `movie.ts` (two year ranges to keep in sync) |
| D8 | Response: `CatalogMovie = Movie.extend({ imdbRating: z.number().min(1).max(10).nullable(), imdbVotes: z.number().int().min(0).nullable() })`, `MoviePage = page(CatalogMovie)`. `Movie` itself does **not** change, and neither do `GET /movies/:id`, history items or recommendations | Sorting by a value the user cannot see is confusing, so list rows show it. Changing `Movie` would reach `src/recommendation/` (W5) and every place that builds a `Movie` | Adding the fields to `Movie` (W5, larger diff). No new fields at all (rating sort becomes opaque) |
| D9 | Extend **FR-5** in `docs/app-requirements.md`: "Пошук фільмів у каталозі за частиною назви; фільтри за жанром, діапазоном років і режисером (частина імені); сортування за назвою, роком, рейтингом IMDb або кількістю голосів IMDb; пагінація. Рейтинг і голоси IMDb заповнює імпорт; фільми без них — в кінці списку." (Adjust the last clause if the human changes the Q2 answer) | Same endpoint, same screen. FR-4 is the precedent: one FR with search, filters, sort and paging | A new FR-10 (splits one endpoint across two requirements) |
| D10 | Indexes: **none added**. NFR-1 is checked by a perf test at **20 000** movies (above the real ~19 000) | With ADR-011's CASE ordering and `@p IS NULL OR …` filters, SQLite cannot use a sort or range index anyway. A top-N sort over 20 000 rows is the cost ADR-011 accepted, and the test measures it at the real size. **If p95 ≥ 200 ms, the Coder stops and reports.** Switching to SQL assembly would contradict ADR-011 and needs a human decision | Indexes on `imdb_votes`, `imdb_rating`, `year` (unused by these queries; extra writes on 19 000-row imports). Dropping ADR-011 now without a measurement |
| D11 | UI catalog: one filter form under the existing toolbar, built like `history()`: an `inputs` object with `genre` (text, placeholder "Any"), `yearFrom`/`yearTo` (number, min 1888, max next year), `director` (text), `sort` (select: Popularity (votes) / IMDb rating / Release year / Title, in Q1's default first), `order` (Default / Descending / Ascending). The form's `onchange` and `onsubmit` reset `offset` to 0 and call `load()`. The title search stays debounced. `load()` adds every non-empty input to the URLSearchParams | Reuses the History pattern, so there is nothing new to learn and nothing new to test. `onchange` (not per keystroke) for the text filters avoids one request per letter | Debouncing every field. A genre `<select>` (needs a new `GET /genres` endpoint, out of scope; Q5) |
| D12 | Catalog row: inside the existing `.title` span, after the year, add `el('span', { class: 'muted imdb', text: \`IMDb ${m.imdbRating.toFixed(1)} · ${m.imdbVotes.toLocaleString()} votes\` })` only when `imdbRating !== null`. CSS `.imdb { display: block; font-weight: 400; font-size: 0.85rem; }`. Empty text: "No movies match these filters." when `q` or any filter is set; otherwise the current "catalog is empty" text | Keeps the 3 non-poster children that the 640 px rule (`grid-row: span 3`) depends on | A fifth grid child (breaks the mobile layout) |
| D13 | History row: `poster(w.movieId, 'thumb', 40)` as the **first** child of `.row.history-row`. CSS becomes `.history-row { grid-template-columns: 40px 32px minmax(0, 1fr) auto; }` | Same position as in the catalog. The 40 px column gives the error placeholder `span` its width (grid stretch), just as the 46 px column does in the catalog. `.history-row` comes after the media query, so it also applies at 640 px | Poster after the rating badge (inconsistent with the catalog) |

## Steps
1. **Migration 4 (W3, Edit tool only, never Bash or an interpreter).** Append to `MIGRATIONS` in `src/db/migrations.ts`, with the comment `// 4. Catalog sort/filter (FR-5): IMDb rating + votes (NULL = no IMDb data); director_key as title_key (ADR-008).`:
   ```sql
   ALTER TABLE movies ADD COLUMN imdb_rating REAL CHECK (imdb_rating BETWEEN 1 AND 10);
   ALTER TABLE movies ADD COLUMN imdb_votes INTEGER CHECK (imdb_votes >= 0);
   ALTER TABLE movies ADD COLUMN director_key TEXT NOT NULL DEFAULT '';
   UPDATE movies SET director_key = text_key(director);
   ```
   — files: `src/db/migrations.ts` — done when: the W3 ask shows up in `.claude/guardrails.log` and a fresh `openDatabase(':memory:')` reaches `user_version` 4.
2. **`text_key` function (W3, Edit tool).** In `src/db/database.ts`, define `export const textKey = (text: string) => text.trim().toLocaleLowerCase('uk');` and register `db.function('text_key', { deterministic: true }, (s) => textKey(String(s)))` as the first statement of `migrate()`. In `movie-repository.ts`, replace the local definition with `import { textKey } from '../db/database.ts'` plus `export { textKey };`. — files: `src/db/database.ts`, `src/repositories/movie-repository.ts` — done when: `test/helpers.ts`, `watch-repository.ts` and other `textKey` imports compile unchanged.
3. **Schemas.** `common.ts`: move `SortOrder` (and its type) and `inverted` here. `movie.ts`: export `QueryYear`; add `MovieSort = z.enum(['title','year','rating','votes'])`; extend `MovieListQuery` per D4, using `.refine((q) => !inverted(q.yearFrom, q.yearTo), { path: ['yearTo'], message: 'must be ≥ yearFrom' })`; add `CatalogMovie` (D8); `MoviePage = page(CatalogMovie)`. `watch.ts`: import these from their new homes. — files: `src/schemas/{common,movie,watch}.ts`, the import in `src/repositories/watch-repository.ts` — done when: `npm run typecheck` passes and the History tests are green, unchanged.
4. **Repository.** `movie-repository.ts`: add the `CATALOG_PAGE_SQL`/`CATALOG_COUNT_SQL` constants (D6) with a comment like History's (identical WHERE, the tests guard `total`). Add `export type MovieCatalogQuery = MovieListQuery & { order: SortOrder }`. `list(query: MovieCatalogQuery)` binds `q`, `genreKey`, `yearFrom`, `yearTo`, `directorKey` (each `null` when absent; keys via `textKey`), `sort`, `order`, `limit`, `offset`; the count query gets only the filters. Make `withGenres` generic: `<T extends MovieRow>(rows: T[]): (T & { genres: string[] })[]`. `create`/`update` also write `director_key`. Add `setImdbRating(imdbId: string, rating: number, votes: number): void` (D2). — done when: `GET /movies?sort=rating` returns `imdbRating`/`imdbVotes` with no snake_case keys.
5. **Service.** `MovieService.list(query: MovieListQuery)` resolves `const order = query.order ?? (query.sort === 'title' ? 'asc' : 'desc')`. Add `setImdbRating(...)`, an importer-only pass-through like `attachImdbId`. — files: `src/services/movie-service.ts` — done when: `/movies?sort=title` comes back A→Z and `/movies?sort=year` newest first.
6. **Importer.** In `readImdbMovies`, replace `popular: Set` with `Map<string, { rating: number; votes: number }>` for rows with `votes >= minVotes`. When building inputs, a row is invalid if the rating is not finite in [1, 10] or the votes are not an integer ≥ 0. `ImdbMovie = MovieInput & { imdbId: string; imdbRating: number; imdbVotes: number }`. `importMovies` destructures the new fields and calls `movies.setImdbRating(imdbId, imdbRating, imdbVotes)` after `attachImdbId`. Update the file header comment. — files: `src/import/imdb.ts` — done when: importing twice still returns `{0, 3, 0}` on the second run and the ratings are in the DB.
7. **Route comment.** `src/routes/movies.ts`: change the header comment to "FR-5 search, filters and sort". No code change. — done when: OpenAPI lists the new parameters (test).
8. **Test fixture.** In `seedCatalog`, add the option `movies = CATALOG_MOVIES` (use it in the loop bound and the title modulo). Insert `director_key` = `textKey(director)`, `imdb_rating` = `((i * 37) % 91 + 10) / 10` (1.0–10.0), and `imdb_votes` = `5000 + (i * 7919) % 2_000_000`. Every 50th movie (`i % 50 === 0`) gets `NULL` for both (hand-added). — files: `test/helpers.ts` — done when: the existing perf tests still pass unchanged.
9. **Tests.** See the Test plan. — files: `test/movies.test.ts`, `test/imdb-import.test.ts`, `test/app.test.ts`, new `test/catalog.perf.test.ts` — done when: every case in the Test plan exists and passes.
10. **UI.** In `public/app.js`, implement D11, D12 and D13. Put the filter form between the toolbar and `error` in `catalog()`'s return. In `public/style.css`, add `.imdb` and change `.history-row`. — done when: `/` shows the form and IMDb lines, and `/#/history` rows show posters or placeholders. The orchestrator checks this in Chrome at full width and at 640 px (the posters-task lesson).
11. **Docs.** Make the FR-5 edit in `docs/app-requirements.md` (D9). — done when: the FR-5 row matches D9.
12. **Verify.** Run `npm run format`, then `npm run check` (NFR-4, coverage ≥ 80 %). Then run the layer greps from `.claude/skills/new-module/SKILL.md` step 5. — done when: all green, and the `${` grep finds nothing new in the repositories.
13. **Back-fill (human, after merge).** `npm run import:imdb`. Migration 4 applies on the first open, and the re-run fills rating and votes. — done when: the human sees ratings in the catalog. The Coder does not run this against `data/movie-tracker.db`.

## Guardrails
| File / action | Rule | Expected reaction |
|---|---|---|
| `src/db/migrations.ts` (migration 4) | **W3** | Ask the human. **Edit/Write tools only.** Writing through Bash or an interpreter bypasses W3 (the posters gap) and counts as a review finding |
| `src/db/database.ts` (`textKey`, `text_key` function) | **W3** (`src/db/**`) | Ask the human; Edit tool only |
| `src/schemas/*`, `src/repositories/*`, `src/services/movie-service.ts`, `src/import/imdb.ts`, `src/routes/movies.ts` | A2 | No prompt |
| `test/*` | A2 | No prompt |
| `docs/app-requirements.md` | A2 | No prompt |
| `public/app.js`, `public/style.css` | No guardrail rule (not in A2) | Normal Claude Code permissions, as in the posters task |
| `src/recommendation/**` | W5 | **Do not touch.** D8 keeps `Movie` unchanged for this reason |
| `package.json`, configs | W4 | Not needed. No new dependencies |
| `npm run format` / `npm run check` / `npm test` | A3 (format may prompt once) | Runs |
| `npm run import:imdb` against the real DB | none, but it writes `data/` | Not run by the Coder (step 13 is the human's) |
| `src/services/poster-service.ts`, `test/posters.test.ts` (uncommitted) | none | **Leave as they are**; not part of this task |
| `.env`, token names | B5 | Never read or mention them. Tests make no network calls |

## Test plan
| Case | Expected |
|---|---|
| Default `GET /movies` on hand-added movies (all IMDb fields null) | Order title, year, id; the existing "sorted by title then year" test still passes, because null votes tie and fall back to title |
| `sort=votes` (default if Q1 holds) with movies that have votes 100, 9000, 9000 and one null | Desc: 9000 (title A→Z between the two), 100, null last; `order=asc`: 100, 9000, 9000, null last |
| `sort=rating` desc with equal ratings | Higher votes first, then title; nulls last. `order=asc`: nulls still last |
| `sort=year` default / `order=asc` | Newest first / oldest first; ties broken by title |
| `sort=title&order=desc` | Z→A; same title → year ASC |
| `genre=sci-fi` (stored "Sci-Fi"), Cyrillic genre in other case | Matches; `total` equals the matched count; a movie with 2 genres is not duplicated |
| `genre=nope` | 200, `items: []`, `total: 0` |
| `yearFrom=2000&yearTo=2016` inclusive bounds | Movies from 2000 and 2016 both included; `total` correct |
| `yearFrom=2020&yearTo=2010`; `yearFrom=1887`; `yearTo=` next year + 1 | 400, common error format, `details` path `yearTo` / out of range |
| `director=villeneuve` matches "Denis Villeneuve"; `director=ПАРАДЖАНОВ` matches "Сергій Параджанов"; `director=Doe` matches "Jane Doe, John Roe" | Matches (substring, case-insensitive, Cyrillic) |
| `director=%25` / `director=_` | `total: 0` (literal) |
| Combined `q` + `genre` + `yearFrom` + `director` + `sort` | Intersection; `total` equals the filtered count, not the page length |
| `PUT /movies/:id` changes director → `director=<new>` | Found by the new director, not the old one (`director_key` updated) |
| `sort=popularity`, `order=up`, `director=` (empty) | 400 |
| List items include `imdbRating`/`imdbVotes` (null for hand-added); `GET /movies/:id` does not | As stated (D8) |
| OpenAPI `/movies` query params | Exactly `q, genre, yearFrom, yearTo, director, sort, order, limit, offset`; item schema has `imdbRating`, `imdbVotes` |
| Migration: fresh DB | `user_version` = `MIGRATIONS.length` (4); columns `imdb_rating`, `imdb_votes`, `director_key` exist |
| Migration: v3 DB with movie director "Сергій Параджанов" → migrate | `director_key = 'сергій параджанов'`, rating/votes null. Fix the existing v2→v3 test to expect `MIGRATIONS.length` |
| CHECK: `imdb_rating` 0.5 / 10.5, `imdb_votes` −1 | Throws `/CHECK/`; 1.0, 10.0 and votes 0 accepted |
| Import fixture: Arrival | `toEqual({... imdbId: 'tt1', imdbRating: 7.9, imdbVotes: 6000})`; after `importMovies` the DB row has `imdb_rating 7.9, imdb_votes 6000` |
| Import re-run with a changed rating (fixture copy with tt1 = 8.1) | Row updated to 8.1 (overwrite, D2); return value unchanged `{0, n, 0}` |
| Import: hand-added "ARRIVAL" 2016 then import | Gets `imdb_id` **and** rating/votes |
| Import: non-numeric `averageRating` row | Counted in `invalid`, not imported |
| `test/catalog.perf.test.ts`: `seedCatalog(db, { movies: 20_000 })`, 60 requests rotating over: `/movies`, `?sort=rating&order=asc&offset=19000&limit=100`, `?director=director%2012&sort=year`, `?genre=…&yearFrom=1950&yearTo=2010&sort=votes&limit=100`, `?q=1&sort=title&order=desc&offset=5000`, `?director=director&genre=…&yearFrom=1990` | All 200; p95 < 200 ms; sanity: `total` of the unfiltered list = 20 000 and a genre total = 20 000·3/20 |
| History poster | No automated UI test (no browser). The orchestrator checks in Chrome: poster or grey placeholder, no broken-image icon, layout at 640 px |
| Existing History, posters and recommendation tests | Unchanged and green |

## Open questions
| # | Question | Recommended answer | Why it matters |
|---|---|---|---|
| Q1 | Default catalog sort? | **`votes` desc (most popular first).** Title sorting stays one click away | Today the catalog opens on `#Alive`, `'71`, which is what the human complained about. Votes desc opens on well-known films. Rating desc would also surface niche films with high ratings and few votes |
| Q2 | Where do movies without IMDb data (hand-added) go when sorting by rating or votes? | **Last in both directions** | Otherwise "lowest rated first" opens on hand-added movies that have no rating at all. Last keeps them reachable without treating "unknown" as a value |
| Q3 | "Popularity" = IMDb `numVotes`? | **Yes**, labelled "Popularity (votes)" in the UI | The non-commercial datasets have no popularity rank. Votes is the only popularity signal we can store, and the task already says "number of votes" |
| Q4 | Director filter: substring or exact? | **Case-insensitive substring** | IMDb directors are stored as "A, B" for co-directors, so an exact match would miss every co-directed film. Typing "nolan" is the natural use |
| Q5 | Genre input: free text (exact name, case-insensitive) as in History, or a dropdown? | **Free text, like History.** A dropdown needs a new `GET /genres` endpoint: a follow-up | Consistent with the existing History screen and keeps the scope small. Cost: the user has to type "Sci-Fi" in full |
| Q6 | Show IMDb rating on the movie detail page too? | **Not now.** List rows only (D8); the detail page is a small follow-up | Showing it on the detail page means changing `Movie` or `GET /movies/:id`, and `Movie` reaches `src/recommendation/` (W5) |
| Q7 | Add a "watched / not watched" catalog filter (one extra `EXISTS (SELECT 1 FROM watches …)` clause)? | **No, not in this task** | It is cheap, but it is a personal filter that the task lists as out of scope unless it comes free. Catalog rows do not show watch state, so the filter would also need UI work |
| Q8 | Catalog filters reset when you open a movie and come back (the same happens in History today). Keep them, for example in the URL hash? | **Not now**; a follow-up for both screens | It is noticeable once filters exist, but keeping state needs routing changes for two screens, beyond "add filters" |

## Out of scope
- Changes to the History filters (History only gets posters).
- Filters or sorting on recommendations or statistics. `src/recommendation/` is not touched (W5).
- Storing other IMDb fields; `minRating`/`minVotes` filters; a `GET /genres` endpoint; IMDb rating on the detail page (Q6).
- Indexes for the catalog sorts (D10), unless the perf test fails. Then the Coder stops and the human decides.
- Running `npm run import:imdb` on the real database (the human's step 13).
- The uncommitted `POSTER_NOT_LINKED`/`POSTER_NOT_FOUND` change in `src/services/poster-service.ts` and `test/posters.test.ts`.
- ADR records (for example an ADR-011 follow-up, "catalog sort at 19 000 rows measured", or "IMDb rating as imported catalog data"). The orchestrator writes these through `ingest_note` (W6) once the vault MCP reconnects.

---
What I did not check: I did not run `npm test` for a baseline. I could not read the vault (MCP disconnected), so the ADR-008, ADR-010 and ADR-011 wording is second-hand.

Risks:
- Migration 4's back-fill depends on the `text_key` SQL function that `migrate()` registers. Any code that applies migrations some other way would fail with "no such function".
- I wrote the D6 ORDER BY in full but have not run it.

## Answers
Human's answers (2026-11-13), given through the orchestrator:
- **Q1:** Most popular first: `votes` desc (recommended).
- **Q2–Q4:** Accepted as recommended. Movies without IMDb data sort last in both directions; "Popularity" = IMDb vote count, labelled "Popularity (votes)"; the director filter is a case-insensitive substring.
- **Q5:** **Dropdown of genres** (not the recommendation). This needs a way to list genres, e.g. `GET /genres`.
- **Q6:** **Yes: show the IMDb rating on the movie page** (not the recommendation).
- **Q7:** **Yes: add a watched / not watched catalog filter** (not the recommendation).
- **Q8:** No: filters still reset when navigating back (recommended).

Because Q5–Q7 differ from the recommendations, the orchestrator asked the Planner to revise the plan (see `01-plan-rev2.md`). The revision is binding for the Coder where it differs from the plan above.
