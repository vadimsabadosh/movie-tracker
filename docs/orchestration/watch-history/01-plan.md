# Plan: Watch History (FR-4): filters, sorting and pagination on `GET /watches`

## Goal
Extend the existing `GET /watches` so it serves as the user's Watch History. It gets filters by genre, movie release year (range), rating range and watch period, a choice of sort field and direction, and the existing `limit`/`offset` pagination. Filtering, sorting, pagination and `total` all run in one parameterized SQL query pair in `WatchRepository`. Every query parameter is validated by Zod, and the parameters show up in the generated OpenAPI. Write endpoints stay unchanged. Requirements: FR-4, NFR-1, NFR-2, NFR-3, NFR-6.

## Domain facts
| Fact | Source (vault note / doc) |
|---|---|
| Watch History is the ordered list of all Watch Entries. FR-4 asks for filters by Genre, release year, Rating range and watch period, plus sorting and Pagination | `Watch History` |
| Watch Entry has `movie_id`, `watched_at` (calendar date), `rating` 1–10 and an optional `note` | `Watch Entry` |
| One Watch Entry per movie (`watches.movie_id` is the PK). History rows count without `DISTINCT`. A watched movie cannot be deleted (RESTRICT), so every `watches` row has its `movies` row | `ADR-009 One Watch Entry Per Movie Kept on Delete` |
| `watchedAt` is `YYYY-MM-DD`, ≥ 1888-01-01 | ADR-009, `src/schemas/watch.ts` (`MIN_WATCH_DATE`) |
| Rating is an integer 1–10. Out-of-range values give 400 in the Error Handling format | `Rating`, `Validation Schemas`, `Error Handling` |
| Genre is many-to-many with Movie (`movie_genres`) and is used as a filter in Watch History | `Genre`, `Database` |
| Movie has `title`, `year` (release year, ≥ 1888, ≤ next year), `genres`, `director` | `Movie`, `src/schemas/movie.ts` (`MIN_YEAR`, `maxYear()`) |
| Case-insensitive text matching uses `*_key` columns built with `textKey()` (`toLocaleLowerCase('uk')`). Never use NOCASE/LIKE | `ADR-008 Unicode Case-Insensitive Keys in App Layer` |
| Pagination is `limit`/`offset`, done in SQL in the Repositories Layer. Params are positive integers with an upper bound | `Pagination`, `Validation Schemas`, `Repositories Layer` |
| Filters, sorting and pagination run in SQL, never in memory. Queries are parameterized only | `Repositories Layer` (NFR-1, NFR-3) |
| Layers go routes → services → repositories. Only repositories touch the DB. Wiring happens only in `src/container.ts` | `ADR-001 Layered Architecture` |
| Zod is the single source for validation, TS types and OpenAPI | `ADR-004 Zod as Single Source of Truth` |
| Validation error → 400 `VALIDATION_ERROR` with `details[{path,message}]` | `Error Handling`, `src/errors/errors.ts` |
| p95 ≤ 200 ms on up to 10 000 movies (local) | `docs/app-requirements.md` NFR-1 |

## Current code
| File | What is there now | Change needed |
|---|---|---|
| `src/schemas/watch.ts` | `WatchListQuery = PaginationQuery`. `WatchPage = page(WatchEntry)`. `Rating`, `MIN_WATCH_DATE` | Extend `WatchListQuery` with the filter, sort and order params plus cross-field refinements. Add `WatchHistoryItem` and `WatchSort`/`SortOrder` enums. `WatchPage = page(WatchHistoryItem)` |
| `src/repositories/watch-repository.ts` | `list()` runs `SELECT … FROM watches ORDER BY watched_at DESC, movie_id LIMIT/OFFSET` and an unfiltered `COUNT(*)` | Rewrite `list()`: join `movies`, use one shared WHERE constant, ORDER BY from a whitelist map, LIMIT/OFFSET, filtered COUNT, and attach genres per page |
| `src/repositories/movie-repository.ts` | Private `withGenres(rows)` loads the genres of one page via `json_each` | Extract the genre query into an exported `genresByMovie(db, movieIds): Map<number, string[]>`. `withGenres` uses it with unchanged behaviour |
| `src/services/watch-service.ts` | `list(query)` spreads the repo result and `limit`/`offset` | Resolve the default `order` (see D5) and pass the resolved query to the repo. Response still echoes `limit`/`offset` |
| `src/routes/watches.ts` | `GET /watches` with `querystring: WatchListQuery`, `200: WatchPage, 400: ErrorResponse` | None in code. The new schemas flow through the same imports. Update the header comment to mention FR-4 |
| `src/container.ts` | Wires `WatchService(watches, movies, today)` | No change |
| `src/db/migrations.ts` | Migration 1 (movies, genres, movie_genres + `movie_genres_genre` index) and migration 2 (watches + `watches_watched_at` index) | **No change** (D8) |
| `test/watches.test.ts` | Existing `GET /watches` test checks newest first and `limit=1` | Keep it passing as-is. Add the new `describe('watch history (FR-4)')` |
| `test/app.test.ts` | Checks that the OpenAPI document exists | Add an assertion that `/watches` GET lists the new query parameters (NFR-6) |
| `test/watch-history.perf.test.ts` | does not exist | New NFR-1 test (D9) |

Baseline: `npm test` gives 45 passed, 3 files.

## Decisions
| # | Decision | Why | Rejected alternatives |
|---|---|---|---|
| D1 | Extend `GET /watches` in place. Don't add a new `/history` route | Task says "filters on `GET /watches`". There is one resource and one OpenAPI path | New `GET /history` endpoint: duplicates the list and the task names `/watches` |
| D2 | Query params, all optional: `genre` (string, trim, 1–50, the same bounds as a genre in `MovieInput`), `yearFrom`/`yearTo` (`z.coerce.number().int().min(MIN_YEAR).max(maxYear())`), `ratingMin`/`ratingMax` (`z.coerce.number().int().min(1).max(10)`), `watchedFrom`/`watchedTo` (`z.iso.date()`, inclusive), `sort` (`z.enum(['watchedAt','rating','year','title']).default('watchedAt')`), `order` (`z.enum(['asc','desc']).optional()`), plus the existing `limit` (1–100, default 20) and `offset` (≥0, default 0) | Bounds reuse the existing domain constants (Rating 1–10, `MIN_YEAR`, `maxYear()`), so validation matches the write side. Inclusive bounds are what a person means by "from 2020 to 2022". An exact year is `yearFrom=yearTo` | `year` single value (FR-4 says "release year", and a range covers both cases, see Q2). `from`/`to` without prefixes (ambiguous between year and date). `rating` as `min..max` string (needs custom parsing and is worse in OpenAPI) |
| D3 | Cross-field rules in Zod: `.refine` on the object for `yearFrom ≤ yearTo`, `ratingMin ≤ ratingMax` and `watchedFrom ≤ watchedTo`, each with `path: ['yearTo']`/`['ratingMax']`/`['watchedTo']` and a message like `must be ≥ yearFrom`. Violations → 400 `VALIDATION_ERROR` | NFR-2: input errors go through Zod into the common format. An inverted range is almost certainly a client bug, and a silent empty page hides it (Q6) | Return an empty list (hides bugs). Swap the bounds silently (surprising) |
| D4 | Genre filter matches by `genres.name_key = textKey(genre)` inside `EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = w.movie_id AND g.name_key = @genreKey)`. Unknown genre → 200 with empty items, `total: 0` | ADR-008: case-insensitive for Cyrillic. `EXISTS` cannot duplicate rows when a movie has several genres, so `total` stays correct without `DISTINCT`. An unknown genre is a valid filter with no matches, not a missing resource | `JOIN movie_genres` (duplicates and needs DISTINCT). `LIKE`/`NOCASE` (ASCII only, ADR-008). 404 for an unknown genre (it's a filter, not a path resource) |
| D5 | Sorting: `sort` maps to a fixed ORDER BY clause from a constant map, and direction comes from a constant `{asc:'ASC',desc:'DESC'}`. Default `sort=watchedAt`. `order` defaults per sort in `WatchService.list`: `title` → `asc`, all others → `desc`. Full clauses: watchedAt: `w.watched_at {D}, w.movie_id ASC`. rating: `w.rating {D}, w.watched_at DESC, w.movie_id ASC`. year: `m.year {D}, w.watched_at DESC, w.movie_id ASC`. title: `m.title_key {D}, m.year ASC, w.movie_id ASC` | SQLite cannot bind identifiers or ASC/DESC as parameters. A closed Zod enum mapped to constant literals keeps user text out of SQL (NFR-3). Tie-breakers make paging stable. The defaults keep today's behaviour (newest first) and the natural A→Z for titles. Title sorts on `title_key` so Cyrillic orders case-insensitively (ADR-008) | `CASE WHEN @sort=… END` in ORDER BY (unreadable, defeats indexes). Interpolating `query.sort` directly (injection risk if the enum ever loosens). One universal default `desc` (Z→A titles by default) |
| D6 | Each item is the WatchEntry plus the movie. `WatchHistoryItem = WatchEntry.extend({ movie: Movie })`, i.e. `{movieId, watchedAt, rating, note, movie:{id,title,year,genres,director}}`. Genres for the page come in one extra query via `genresByMovie` (`json_each`), not N+1 (**pending Q1**) | A history that filters and sorts by title, year and genre is not usable if the client can't see those values. The change only adds a field, so existing clients and the current test keep working. Reusing the `Movie` schema keeps one source of truth (ADR-004) | Keep bare WatchEntry (the client needs N extra `/movies/:id` calls to show the history). Flatten `title`/`year` into the item (duplicates `Movie` fields and drops genres). Call `MovieRepository.findById` per row (N+1, up to 100 queries per page) |
| D7 | `genresByMovie(db, ids)` becomes an exported function in `src/repositories/movie-repository.ts`, used by `MovieRepository.withGenres` and `WatchRepository.list` | One place owns the genre-loading SQL. Repositories may share helpers, and ADR-001 only forbids non-repository DB access | Copy the query into `WatchRepository` (two copies drift apart). Have `WatchService` call a `MovieRepository` method to enrich items (a service merging rows is in-memory assembly, and the call still needs a new public method) |
| D8 | **No migration.** Existing indexes are enough: `watches_watched_at`, `movie_genres_genre`, `genres.name_key UNIQUE`, the PK join on `movies.id` | At most 10 000 movies means at most 10 000 watches (ADR-009). A full scan, join and sort over 10k rows in SQLite takes a few milliseconds, far under 200 ms. This avoids W3 and schema churn. D9 checks the claim | Add `CREATE INDEX movies_year`, `watches_rating` in migration 3 (W3 approval and schema changes for no measured need). Revisit only if D9 fails |
| D9 | Add an NFR-1 test `test/watch-history.perf.test.ts`. It seeds 10 000 movies (3 genres from a pool of 20) and 10 000 watches straight into an `openDatabase(':memory:')` DB in one transaction, builds `buildApp({ db, today })`, runs a mix of 60 requests (no filters; all filters; `sort=title&order=desc&offset=9000`; `genre=` + rating range + period; `sort=rating`), and asserts p95 < 200 ms. Use `it(..., 30_000)` as the test timeout | NFR-1 is a number. Proving it beats asserting it. Seeding through `app.inject` would need 20k requests and be slow. Seeding SQL inside a test file is test fixture code, not app code, so ADR-001 governs `src/` only | Skip the perf check (NFR-1 unverified). A separate benchmark script (not run by `npm test`) |
| D10 | One WHERE string constant `HISTORY_WHERE` is used by both the page query and the COUNT query. Every filter has the form `(@p IS NULL OR <cond>)` with named params, and `undefined` maps to `null` | Same pattern as `MovieRepository.list` (`@q IS NULL OR …`). Using one constant for both queries means `total` can never disagree with the filters. better-sqlite3 requires every named param to be bound, hence the `null` | Build the WHERE from fragments only for the params present (string assembly, more grep hits, harder to review). Several prepared variants (combinatorial) |
| D11 | Single `genre` value per request (**pending Q3**) | FR-4 says "genre" (singular). A single value keeps the contract and OpenAPI simple. Adding repeated `genre` later is backward-compatible | Multi-genre with AND/OR now: semantics not specified by the vault |

ADR candidate for the Reviewer and orchestrator: "Watch History query contract": param names, inclusive ranges, 400 on inverted ranges, per-sort default order, movie embedded in items.

## Steps
1. **Shared genre loader.** Files: `src/repositories/movie-repository.ts`. Add `export function genresByMovie(db: Database.Database, movieIds: number[]): Map<number, string[]>`. It returns an empty Map for `[]`, uses the same SQL as today (`… WHERE mg.movie_id IN (SELECT value FROM json_each(?)) ORDER BY g.name_key`, param `JSON.stringify(ids)`), and keeps the genre order by `name_key`. Rewrite private `withGenres` to use it. Done when `test/movies.test.ts` passes unchanged.
2. **Schemas.** Files: `src/schemas/watch.ts`. Import `Movie`, `MIN_YEAR`, `maxYear` from `./movie.ts`. Add `export const WatchSort = z.enum(['watchedAt','rating','year','title'])` and `export const SortOrder = z.enum(['asc','desc'])`. Redefine `WatchListQuery = PaginationQuery.extend({ genre, yearFrom, yearTo, ratingMin, ratingMax, watchedFrom, watchedTo, sort, order })` exactly as in D2, then the three `.refine`s from D3. Each refine passes only when either bound is undefined or `from ≤ to`, and dates compare as strings. Add `WatchHistoryItem = WatchEntry.extend({ movie: Movie })` with its type, and `WatchPage = page(WatchHistoryItem)`. Export the types via `z.infer`. Done when `npm run typecheck` passes.
3. **Repository.** Files: `src/repositories/watch-repository.ts`. Define `type WatchHistoryQuery = WatchListQuery & { order: 'asc' | 'desc' }`. Add the constants:
   - `HISTORY_FROM = 'FROM watches w JOIN movies m ON m.id = w.movie_id'`
   - `HISTORY_WHERE` =
     ```
     WHERE (@genreKey IS NULL OR EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
                                         WHERE mg.movie_id = w.movie_id AND g.name_key = @genreKey))
       AND (@yearFrom IS NULL OR m.year >= @yearFrom)
       AND (@yearTo IS NULL OR m.year <= @yearTo)
       AND (@ratingMin IS NULL OR w.rating >= @ratingMin)
       AND (@ratingMax IS NULL OR w.rating <= @ratingMax)
       AND (@watchedFrom IS NULL OR w.watched_at >= @watchedFrom)
       AND (@watchedTo IS NULL OR w.watched_at <= @watchedTo)
     ```
   - `ORDER_BY: Record<WatchSort, Record<'asc'|'desc', string>>` holds the 8 full literal clauses from D5. Write them as literals, not built from parts.

   `list(query: WatchHistoryQuery): { items: WatchHistoryItem[]; total: number }`. Build params `{ genreKey: query.genre === undefined ? null : textKey(query.genre), yearFrom: query.yearFrom ?? null, … , limit, offset }`. Page SQL: `SELECT w.movie_id, w.watched_at, w.rating, w.note, m.title, m.year, m.director ` + HISTORY_FROM + HISTORY_WHERE + ` ORDER BY ` + ORDER_BY[sort][order] + ` LIMIT @limit OFFSET @offset`. Count SQL: `SELECT COUNT(*) AS total ` + HISTORY_FROM + HISTORY_WHERE with the same params minus limit/offset. better-sqlite3 throws on unused named params, so pass a params object without `limit`/`offset`. Map rows through `genresByMovie(this.db, ids)` to `{ movieId, watchedAt, rating, note, movie: { id, title, year, director, genres } }`. Import `textKey`, `genresByMovie` from `./movie-repository.ts`. Done when typecheck passes and the only SQL concatenations are of the constants above.
4. **Service.** Files: `src/services/watch-service.ts`. `list(query: WatchListQuery)` computes `order = query.order ?? (query.sort === 'title' ? 'asc' : 'desc')`, calls `this.watches.list({ ...query, order })` and returns `{ ...result, limit: query.limit, offset: query.offset }`. Done when typecheck passes and the service has no SQL or Fastify imports.
5. **Routes.** Files: `src/routes/watches.ts`. Update the header comment to mention FR-4 (Watch History). The route declaration stays as it is (`querystring: WatchListQuery`, `200: WatchPage`, `400: ErrorResponse`). Done when `GET /openapi.json` shows `genre, yearFrom, yearTo, ratingMin, ratingMax, watchedFrom, watchedTo, sort, order, limit, offset` under `paths['/watches'].get.parameters`.
6. **Functional tests.** Files: `test/watches.test.ts`. Add `describe('watch history (FR-4)')` with a fixture of 4–5 movies across genres (incl. Cyrillic `Драма`), years and ratings, marked on different dates via the API. Cover the cases in the Test plan. Done when all new tests pass and the existing `GET /watches` test passes unchanged.
7. **OpenAPI test.** Files: `test/app.test.ts`. Assert that the parameter names in step 5 are present for `/watches` GET. Done when it passes.
8. **Perf test.** Files: `test/watch-history.perf.test.ts` (new). Implement D9. Insert with prepared statements in `db.transaction`: `movies (title, title_key, year, director)` with `title_key = textKey(title)`, `genres (name, name_key)`, `movie_genres`, and `watches` with dates between `2000-01-01` and `TODAY` and ratings 1–10, chosen deterministically (e.g. `i % 10 + 1`, no `Math.random`). Measure with `performance.now()` around `app.inject`, sort the durations and take index `Math.ceil(0.95*n)-1`. Done when p95 < 200 ms and the whole file takes under 30 s.
9. **Verify.** Run `npm run typecheck && npm test`, then the three layer greps from `.claude/skills/new-module/SKILL.md` §5. Done when typecheck is clean, all tests pass (45 old + new), the route/service greps print nothing, and every repository grep hit is a concatenation of `HISTORY_FROM`/`HISTORY_WHERE`/`ORDER_BY[…]`, listed in `02-implementation.md`.

## Guardrails
| File / action | Rule | Expected reaction |
|---|---|---|
| Edit `src/schemas/watch.ts`, `src/repositories/watch-repository.ts`, `src/repositories/movie-repository.ts`, `src/services/watch-service.ts`, `src/routes/watches.ts` | A2 | Allowed without asking |
| Edit `test/watches.test.ts`, `test/app.test.ts`; create `test/watch-history.perf.test.ts` | A2 | Allowed without asking |
| `src/db/migrations.ts`, `src/db/**` | W3 | **Not touched** (D8). If the Coder thinks an index is needed, stop and report to the orchestrator; don't edit |
| `package.json`, lock file, `tsconfig.json`, vitest config | W4 | Not touched. No new dependencies are needed (`performance` is global in Node 24) |
| `src/recommendation/**` | W5 | Not touched (out of scope) |
| `npm run typecheck`, `npm test`, `npx vitest`, `grep -nE …` (non-recursive) | A3 | Allowed |
| Vault writes (ADR candidate) | W6 | Orchestrator only, via `record-adr` |
| `git commit`/`push` | W2 | Orchestrator only |
| Reading `../movie-tracker-vault` directly | B4 | Denied. Use the vault MCP |

## Test plan
| Case | Expected |
|---|---|
| No params (existing test) | 200, newest first, `limit` 20, `offset` 0. Items now include `movie` |
| Item shape | `{movieId, watchedAt, rating, note, movie:{id,title,year,genres,director}}`. `movie.genres` sorted like `/movies` |
| `genre=sci-fi` when stored as `Sci-Fi` | Only Sci-Fi movies. `total` = their count |
| `genre=ДРАМА` when stored as `Драма` | Matches (Cyrillic case-insensitive, ADR-008) |
| Movie with 2 genres, filtered by one of them | Appears once. `total` is not inflated |
| `genre=Western` (unknown) | 200, `items: []`, `total: 0` |
| `yearFrom=2015&yearTo=2016` | Only movies released in 2015–2016, bounds inclusive |
| `yearFrom=2016&yearTo=2016` | Exactly the 2016 movies |
| `ratingMin=8` / `ratingMax=5` / `ratingMin=7&ratingMax=7` | Correct subsets, inclusive |
| `watchedFrom=2026-03-01&watchedTo=2026-05-01` | Entries watched in that period, bounds inclusive |
| Combined `genre`, `yearFrom`, `ratingMin`, `watchedFrom` | Intersection. `total` matches the filtered count, not all rows |
| `sort=rating&order=asc` | Ascending rating. Ties broken by `watchedAt` desc, then `movieId` |
| `sort=rating` (no order) | Descending |
| `sort=year` | Release year descending |
| `sort=title` (no order) | A→Z by case-insensitive title. `order=desc` reverses it |
| Pagination with filters: `ratingMin=5&limit=2&offset=2` | The 3rd–4th of the filtered and sorted list. `total` is the full filtered count. Pages don't overlap |
| `offset` beyond `total` | 200, empty `items`, correct `total` |
| `ratingMin=0`, `ratingMax=11`, `ratingMin=7.5`, `ratingMin=abc` | 400 `VALIDATION_ERROR` |
| `yearFrom=1887`, `yearTo=<maxYear()+1>` | 400 |
| `watchedFrom=16.10.2026`, `watchedTo=2026-02-30` | 400 |
| `sort=director`, `order=up` | 400 |
| `genre=` (empty / whitespace), `genre` of 51 chars | 400 |
| `ratingMin=8&ratingMax=5`, `yearFrom=2020&yearTo=2010`, `watchedFrom=2026-05-01&watchedTo=2026-01-01` | 400 `VALIDATION_ERROR`, `details[0].path` points to the upper bound field |
| `limit=0`, `limit=101`, `offset=-1` | 400 (existing rules still apply) |
| OpenAPI | `/watches` GET lists all 11 query params |
| NFR-1 perf (10k movies, 10k watches) | p95 < 200 ms over 60 mixed requests |
| Regression | All 45 existing tests pass unchanged |

## Open questions
| # | Question | Recommended answer | Why it matters |
|---|---|---|---|
| Q1 | Should history items embed the movie (`movie: {id,title,year,genres,director}`), or stay bare `WatchEntry`? | Embed (D6). The change only adds a field | Changes the public response shape and OpenAPI. Without it, filters and sorts on title, year and genre cannot be seen in the result. If the answer is "bare", drop D6/D7 and step 1, and keep `WatchPage = page(WatchEntry)`. Sorting by title/year still works via the JOIN |
| Q2 | Release-year filter: a range (`yearFrom`/`yearTo`) or a single `year`? | Range. A single year is `yearFrom=yearTo` | Fixes the parameter names in the API contract |
| Q3 | Genre filter: one genre, or several (`genre=a&genre=b`), and if several, AND or OR? | One genre now (D11). Multiple can be added later without breaking anything | The vault doesn't define multi-genre semantics |
| Q4 | Sort fields and default direction: `watchedAt` (default), `rating`, `year`, `title`. Default `desc`, except `title` → `asc`? | Yes, as in D5 | Defines the API contract and the default listing order (keeps today's newest-first) |
| Q5 | Inverted range (`ratingMin > ratingMax`, etc.): 400, or an empty result? | 400 `VALIDATION_ERROR` (D3) | Error behaviour of the API (NFR-2) |
| Q6 | OK to skip a migration/indexes and rely on the perf test to prove NFR-1? | Yes (D8, D9). Add indexes in a separate W3-approved migration only if the perf test fails | Avoids a W3 schema change unless it's measured to be needed |

## Out of scope
- Preference Profile (FR-6), Viewing Statistics (FR-8), Recommendations (FR-7), `src/recommendation/**`.
- Changes to Movie and Watch Entry write endpoints (`POST/PUT/DELETE /movies…`, `/movies/:id/watch`) and to `GET /movies`.
- Schema changes or new indexes (unless Q6 is answered otherwise after a failing perf test).
- Cursor pagination, multi-genre filters, filtering by director or title text.
- Recording the ADR in the vault (orchestrator via `record-adr`, W6).

## Answers
Answered by the human through the orchestrator (AskUserQuestion), 2026-10-16. All six recommendations were accepted.

| # | Answer |
|---|---|
| Q1 | **Include the movie** in each item (D6, D7 and step 1 stand) |
| Q2 | **Year range**: `yearFrom`/`yearTo`, inclusive |
| Q3 | **One genre** per request (D11) |
| Q4 | **Sorting as proposed**: `watchedAt` (default), `rating`, `year`, `title`; default `desc`, `title` → `asc` (D5) |
| Q5 | **Inverted range → 400** `VALIDATION_ERROR`, path on the upper bound (D3) |
| Q6 | **No migration**; NFR-1 proven by the perf test (D8, D9). If it fails: stop and report, do not add a migration |
