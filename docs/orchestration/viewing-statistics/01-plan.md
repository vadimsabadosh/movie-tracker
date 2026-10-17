# Plan: Viewing Statistics (FR-8)

## Goal
Add `GET /stats`, which returns the Viewing Statistics. They are computed on each request from the Watch History and never stored:
- how many movies have been watched;
- the overall average personal rating;
- how many watched movies fall into each genre;
- how many watched movies fall into each year (release year, see Q1).

The work follows the existing module pattern:
- `src/schemas/stats.ts` (Zod);
- `StatsRepository`, which holds three fixed literal aggregate SQL statements;
- `StatsService.get()`, with no Fastify;
- `statsRoutes`;
- wiring in `src/container.ts` and `src/routes/index.ts`.

No migration, no config change and no `src/recommendation/` change.

Requirements: FR-8, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5, NFR-6.

## Domain facts
| Fact | Source (vault note / doc) |
|---|---|
| Viewing Statistics are summary indicators over the Watch History: watched count, average Rating, distribution by Genre and by years | Viewing Statistics; `docs/app-requirements.md` FR-8 |
| Implementation: aggregate SQL in the Repositories Layer, orchestration in the Services Layer | Viewing Statistics § Реалізація |
| A `StatsService` is planned in the Services Layer, and a `/stats` endpoint group is planned in the Routes Layer | Services Layer; Routes Layer |
| Viewing Statistics are derived from the Watch History, the same as the Preference Profile | Watch History § Похідні дані |
| Rating is an integer 1–10, part of a Watch Entry, and is aggregated as "the overall average" in Viewing Statistics. The DB column is `rating INTEGER NOT NULL CHECK 1..10` | Rating; `src/db/migrations.ts` migration 2 |
| One Watch Entry per movie, so FR-8 counts `watches` rows **without DISTINCT** and takes one rating per movie | ADR-009 (Наслідки) |
| A movie has 1..n genres (many-to-many). Genres are unique by `name_key`, and the first spelling is shown | Genre; ADR-008; migration 1 |
| Every movie has a release year: `movies.year INTEGER NOT NULL >= 1888`, and the API accepts at most next year | Movie; migration 1; `src/schemas/movie.ts` |
| In the Watch History contract, "year" means the movie's release year. The watch period is a separate `watchedFrom/watchedTo` | ADR-010 |
| Precedent for aggregates: `ROUND(AVG(rating), 2)` in SQL, ordering by exact values, a genre tie-break on `name_key`, an empty history gives 200 with empty lists, and totals belong to FR-8 rather than the profile | ADR-013 |
| No SQL built from strings, not even from constant maps. Fixed literal statements only | ADR-011; NFR-3; `new-module` step 5 |
| Layers are routes → services → repositories. SQL lives only in repositories, and services have no Fastify | ADR-001 |
| Zod is the single source of types, validation and OpenAPI | ADR-004 |
| p95 ≤ 200 ms on 10 000 movies | NFR-1 |
| Same DB state, same output, including the order of the distributions | NFR-5; 00-task.md |

## Current code
| File | What is there now | Change needed |
|---|---|---|
| `src/container.ts` | `Services { movies, watches, profile, recommendations }` | Add `stats: StatsService` = `new StatsService(new StatsRepository(db))` |
| `src/routes/index.ts` | Registers health, movies, watches, profile, recommendations | Add `await statsRoutes(app, services.stats);` |
| `src/repositories/profile-repository.ts` | FR-6 genre and director aggregates (count, average) | **No change** (D2) |
| `src/services/profile-service.ts`, `src/routes/profile.ts`, `src/schemas/profile.ts` | `/profile` contract (ADR-013) | **No change** (out of scope: existing endpoints) |
| `src/db/migrations.ts` | Migrations 1–2. `watches` PK is `movie_id`, with an index on `watched_at`. `movie_genres` has PK `(movie_id, genre_id)` and an index on `genre_id` | **No change** (D9) |
| `src/schemas/common.ts` | `ErrorResponse`, `page()`, `PaginationQuery` | No change. Nothing to reuse: no pagination and no input |
| `test/helpers.ts` | `testApp()`, `seedCatalog(db, { watchEvery })` with constants `CATALOG_MOVIES/GENRES/DIRECTORS`. Years are `1900 + i % 127`, ratings are `i % 10 + 1` | No change needed. Optionally export a `CATALOG_YEARS = 127` constant for the perf sanity check, otherwise inline 127 in the test |
| `test/app.test.ts` | OpenAPI checks for `/watches`, `/profile`, `/recommendations` | Add a `/stats` check |
| (new) `src/schemas/stats.ts`, `src/repositories/stats-repository.ts`, `src/services/stats-service.ts`, `src/routes/stats.ts`, `test/stats.test.ts`, `test/stats.perf.test.ts` | — | Create |

## Decisions
| # | Decision | Why | Rejected alternatives |
|---|---|---|---|
| D1 | Separate module named after the vault: `StatsRepository`, `StatsService`, `statsRoutes`, `src/schemas/stats.ts`, endpoint `GET /stats` | The Services Layer plans `StatsService` and the Routes Layer plans `/stats`. This mirrors the FR-6 module layout | Adding aggregates to `ProfileRepository` or `WatchRepository` mixes FR-6/FR-4 with FR-8. `GET /watches/stats` deviates from the vault's planned route group |
| D2 | **Do not derive `/stats` from `ProfileService`.** Use its own SQL. The genre distribution is `{ name, count }` only, with no `averageRating` | The meanings differ. The profile ranks preferences (ordering uses the average as a tie-break, ADR-013), while the distribution only counts. Coupling FR-8 to the FR-6 contract would make a profile change silently change statistics. The genre aggregate is one cheap query. The per-genre average already exists in `/profile`, so repeating it would duplicate the FR-6 contract | (a) `StatsService` calls `ProfileService.get().genres` and drops `averageRating`: the order would include an average tie-break that is invisible in `/stats`, and the two modules would be coupled. (b) Copy `{name,count,averageRating}` into `/stats`: duplicates `/profile` and is not required by FR-8 (Q3) |
| D3 | **"By years" = the movie's release year** (`movies.year`) | ADR-010 already fixed "year" = release year in this API. `movies.year` is a domain attribute (Movie). The watch date is a separate concept, the "period" | Watch year `substr(watched_at,1,4)`: also plausible ("how many I watched in 2024"), but it gives "year" a second meaning that ADR-010 avoided. Both distributions: doubles the contract beyond what FR-8 literally names (Q1 lets the human pick) |
| D4 | Response shape (Zod, `src/schemas/stats.ts`). See the schema below this table | One flat object maps one-to-one to FR-8's four items. Arrays keep an explicit order (NFR-5). A JSON map (`{"Drama": 3}`) has no guaranteed order and cannot hold the first-spelling rule cleanly | `{ totals: {...}, distributions: {...} }`: extra nesting for no gain. A map `byYear: Record<string, number>`: unordered, and the keys become strings. Adding percentages: derived data that the client can compute (Q4) |
| D5 | `averageRating = ROUND(AVG(w.rating), 2)` in SQL, and **`null` when the history is empty** | 2 decimals as in ADR-013, for consistency between `/profile` and `/stats`. AVG over zero rows is SQL NULL. `0` would be a lie because ratings are 1–10, and omitting the field makes the shape vary | `0` for empty: indistinguishable from a real value and outside 1–10. 404 for empty: the statistics exist and are simply zero (ADR-013 D8 precedent). 1 decimal: inconsistent with `/profile` |
| D6 | **`byGenre` order:** `COUNT(*) DESC`, then `g.name_key ASC`. Group by `g.id` and show `g.name` (first spelling) | Largest share first is the natural reading of a distribution. The `name_key` tie-break makes the order total and case-insensitive, also for Cyrillic (ADR-008), the same last tie-break as ADR-013. It does not depend on insertion order (NFR-5) | Alphabetical only: hides the "largest share" reading, though it is equally deterministic. Tie-break by `g.id`: depends on insertion order. Binary `g.name`: "Комедія" before "драма", inconsistent with ADR-013 |
| D7 | **`byYear` order:** `m.year ASC` (chronological). Only years with ≥ 1 watched movie appear, with no zero-filled gaps | A year axis is read chronologically. The group key is unique, so the order is total. Zero-filling would invent a range (from 1888? from the first watch?) | Count desc: unnatural for a time axis. Zero-fill between min and max: arbitrary bounds, and the response grows with gaps |
| D8 | Counting semantics: `watchedCount = COUNT(*) FROM watches`. Each watched movie counts once in `byYear` and once in **each** of its genres, so `sum(byGenre.count) ≥ watchedCount`. State this in the schema `.describe()` | ADR-009 means no DISTINCT is needed. The genre semantics match `/profile` | Splitting a movie fractionally across genres: an invented rule. Counting only the "first" genre: genres are unordered sets in the domain |
| D9 | No migration and no new index | Grouping 10 000 rows in memory is far below 200 ms. The `/profile` genre aggregate over 30 000 links is already measured under budget (`test/profile.perf.test.ts`), and the perf test proves it for `/stats` | An index on `movies(year)`: W3, and unproven need. Revisit only if the perf test fails |
| D10 | Three fixed literal statements with no parameters (exact SQL is in the SQL section below this table). Each is prepared once in the constructor | NFR-3/ADR-011. Nothing to bind because there is no input | One statement with `UNION ALL` and JSON: harder to read and to type. Assembling SQL is forbidden |
| D11 | **No query parameters.** Unknown query params are ignored (as on `/profile`). NFR-2 holds trivially | FR-8 names no filters, and the task puts "statistics filters" out of scope | `?watchedFrom/To` or `?genre`: out of scope. They can be added later as optional params without breaking anything |
| D12 | Consistency: `StatsService.get()` runs the three statements one after another, synchronously | better-sqlite3 is synchronous on a single connection, so no write can interleave within one handler call. A transaction adds nothing | `db.transaction` wrapping the reads: no effect here, and it would push DB concerns into the service |
| D13 | Empty history → `200 { watchedCount: 0, averageRating: null, byGenre: [], byYear: [] }` | Consistent with ADR-013 | 404 |

### Response schema (D4)

```ts
export const GenreCount = z.object({
  name: z.string().describe('Genre name, first spelling kept'),
  count: z.number().int().positive().describe('Watched movies having this genre'),
});
export const YearCount = z.object({
  year: z.number().int().min(1888).describe('Release year of the movie (ADR-010 meaning of "year")'),
  count: z.number().int().positive().describe('Watched movies released that year'),
});
export const ViewingStatistics = z.object({
  watchedCount: z.number().int().min(0).describe('Number of watched movies (one watch entry per movie, ADR-009)'),
  averageRating: z.number().min(1).max(10).nullable().describe('Average personal rating over all watched movies, rounded to 2 decimals; null when nothing is watched'),
  byGenre: z.array(GenreCount).describe('Watched movies per genre: count desc, then name (case-insensitive). A movie counts once in each of its genres'),
  byYear: z.array(YearCount).describe('Watched movies per release year, ascending; only years with at least one watched movie'),
});
```

Export the `z.infer` types `GenreCount`, `YearCount` and `ViewingStatistics`. Do not use an upper bound on `year`. `maxYear()` depends on the clock and is enforced on input already, so it adds nothing to an output schema.

### SQL (D10, exact shapes, in `src/repositories/stats-repository.ts`)

```sql
-- STATS_TOTALS_SQL  (always exactly one row; AVG over 0 rows is NULL)
SELECT COUNT(*) AS watchedCount, ROUND(AVG(rating), 2) AS averageRating
FROM watches;

-- STATS_BY_GENRE_SQL
SELECT g.name AS name, COUNT(*) AS count
FROM watches w
JOIN movie_genres mg ON mg.movie_id = w.movie_id
JOIN genres g ON g.id = mg.genre_id
GROUP BY g.id
ORDER BY COUNT(*) DESC, g.name_key ASC;

-- STATS_BY_YEAR_SQL
SELECT m.year AS year, COUNT(*) AS count
FROM watches w
JOIN movies m ON m.id = w.movie_id
GROUP BY m.year
ORDER BY m.year ASC;
```

Repository API:
- `totals(): { watchedCount: number; averageRating: number | null }`, using `.get()` and typing the statement as `Database.Statement<[], StatsTotals>`. Define `StatsTotals` as `ViewingStatistics.pick({ watchedCount: true, averageRating: true })` inferred, or as a local `z.infer`-based `Pick<ViewingStatistics, 'watchedCount' | 'averageRating'>`. No hand-written interface.
- `byGenre(): GenreCount[]` and `byYear(): YearCount[]`, using `.all()`.

The camelCase aliases already match the schema, so no mapping is needed. In the header comment, cite FR-8, NFR-1, NFR-3, ADR-009 (no DISTINCT), ADR-010 (year = release year), ADR-011 and D6/D7 (order).

## Steps
1. **Schemas.** Create `src/schemas/stats.ts` with `GenreCount`, `YearCount`, `ViewingStatistics` (D4) and their `z.infer` types. Done when: typecheck passes and there are no hand-written types.
2. **Repository.** Create `src/repositories/stats-repository.ts` with class `StatsRepository(db)` and the three literal statements and methods `totals()`, `byGenre()`, `byYear()` above. Done when: `grep -nE "\\$\\{|\+ *['\"]" src/repositories/stats-repository.ts` prints nothing.
3. **Service.** Create `src/services/stats-service.ts` with class `StatsService(repo: StatsRepository)` and `get(): ViewingStatistics`, which returns `{ ...this.repo.totals(), byGenre: this.repo.byGenre(), byYear: this.repo.byYear() }` (keys in this order). Add a doc comment: computed, never stored; deterministic (NFR-5). Done when: the file imports no fastify, better-sqlite3 or `../db/`.
4. **Wiring.** In `src/container.ts`, add `stats: StatsService` to `Services` and `stats: new StatsService(new StatsRepository(db))` to the returned object. Done when: `createServices(openDatabase(':memory:')).stats.get()` returns the empty statistics.
5. **Route.** Create `src/routes/stats.ts` with `statsRoutes(app, service: StatsService)`. It calls `r.get('/stats', { schema: { tags: ['stats'], response: { 200: ViewingStatistics } } }, () => service.get())`, written the same way as `src/routes/profile.ts`. Register it in `src/routes/index.ts` after `recommendationRoutes`. Done when: `/openapi.json` has `paths['/stats'].get.responses['200']`.
6. **Tests.** Add `test/stats.test.ts` (functional, see the Test plan), `test/stats.perf.test.ts` (NFR-1) and one OpenAPI case in `test/app.test.ts`. Done when: all pass.
7. **Checks.** Run `npm run format`, then `npm run check`, then the three layer greps from `.claude/skills/new-module/SKILL.md` step 5. Done when: `npm run check` exits 0, coverage is ≥ 80 % on every metric and the greps print nothing.

## Guardrails
| File / action | Rule | Expected reaction |
|---|---|---|
| `src/schemas/stats.ts`, `src/repositories/stats-repository.ts`, `src/services/stats-service.ts`, `src/routes/stats.ts`, `src/routes/index.ts`, `src/container.ts` | A2 | Written without asking |
| `test/stats.test.ts`, `test/stats.perf.test.ts`, `test/app.test.ts`, optionally `test/helpers.ts` (`CATALOG_YEARS`) | A2 | Written without asking |
| `src/db/migrations.ts` | W3 | **Not touched** (D9). If the perf test unexpectedly fails, stop and report. Do not add an index without W3 approval |
| `src/recommendation/**` | W5 | **Not touched** |
| `src/*/profile*`, `src/*/recommendation*`, `src/*/watch*`, `src/*/movie*` | A2, but out of scope | Not modified (no changes to existing endpoints) |
| `package.json`, lock files, `vitest.config.ts`, ESLint, Prettier, tsconfig | W4 | Not touched; no new dependencies |
| `npm run check`, `npx vitest`, `git status/diff`, the greps | A3 | Run without asking |
| `npm run format` (Prettier `--write`) | Not in A3 | May prompt. In FR-6 it ran without a prompt. Either is expected |
| Commit, vault ADR | W2 / W6 | Orchestrator only |

## Test plan
`test/stats.test.ts` seeds through the API with `addMovie`/`watch` helpers like `test/profile.test.ts`, with `today` pinned to `'2026-10-16'` and explicit `year` per film.

| Case | Expected |
|---|---|
| Empty DB, `GET /stats` | 200 `{ watchedCount: 0, averageRating: null, byGenre: [], byYear: [] }` |
| Movies in the catalog, none watched | Same empty statistics (only watched movies count) |
| 4 watched: Drama 2010 (8), Drama 2010 (9), Drama+Comedy 2015 (7), Comedy 1999 (10), plus 1 unwatched Horror 2020 | `watchedCount: 4`, `averageRating: 8.5`, `byGenre: [{Drama,3},{Comedy,2}]`, `byYear: [{1999,1},{2010,2},{2015,1}]`. Horror and 2020 are absent |
| Multi-genre movie | Counted once in `byYear` and in each genre. Assert `sum(byGenre.count) > watchedCount` and `sum(byYear.count) === watchedCount` |
| Rounding: ratings 7, 8, 8 | `averageRating: 7.67` |
| `byGenre` tie: equal counts, genres "Комедія" and "драма" (the pair where binary and `name_key` order differ, as in the FR-6 tests) | "драма" before "Комедія" (`name_key` д < к); original spelling shown |
| `byGenre` count beats name: "Zeta" ×2, "Alpha" ×1 | Zeta first |
| Genre spelling: "Sci-Fi" and "sci-fi" on two movies | One entry `Sci-Fi`, count 2 |
| `byYear` order: watched movies from 2020, 1950, 2001, inserted in that order | `[1950, 2001, 2020]` |
| Year means the release year (D3): a 1999 movie watched with `watchedAt: '2024-05-01'` | `byYear` has 1999, not 2024 |
| `PUT /movies/:id/watch` changes a rating | `averageRating` reflects the new value; counts unchanged |
| `DELETE /movies/:id/watch` | `watchedCount` drops; a genre or year with no watches left disappears |
| Determinism (NFR-5): two apps with the same films inserted in reverse order | Deep-equal `/stats` bodies; two calls on one app are equal |
| Reuse: `createServices(db).stats.get()` after seeding through `createServices(db).movies/watches` | Equals the HTTP body of `buildApp({ db })` on the same db |
| Unknown query param `GET /stats?x=1` | 200 (ignored) |
| OpenAPI (`test/app.test.ts`) | `Object.keys(paths['/stats'].get.responses['200'].content['application/json'].schema.properties).sort()` equals `['averageRating','byGenre','byYear','watchedCount']` |
| Perf (`test/stats.perf.test.ts`, a copy of the `profile.perf.test.ts` pattern): `seedCatalog(db)`, 60 requests | p95 < 200 ms. Sanity: `watchedCount === CATALOG_MOVIES`, `averageRating === 5.5` (ratings `i%10+1` are uniform over 10 000), `byGenre.length === CATALOG_GENRES`, genre counts sum to `CATALOG_MOVIES * 3`, `byYear.length === 127`, year counts sum to `CATALOG_MOVIES`, `byYear[0].year === 1900`, years strictly ascending |
| Perf, partial history (optional, same file or a second `it`): `seedCatalog(db, { watchEvery: 3 })` | `watchedCount === 3333` (unwatched are excluded at scale) |
| `npm run check` | Passes; coverage ≥ 80 % |

## Open questions
| # | Question | Recommended answer | Why it matters |
|---|---|---|---|
| Q1 | Does "distribution by years" mean the movie's release year or the year it was watched? | **Release year** (`movies.year`), consistent with ADR-010. If the human wants watch years, replace the SQL with `GROUP BY substr(w.watched_at, 1, 4)` (cast to integer) and rename the field to `byWatchYear`. If they want both, add `byReleaseYear` and `byWatchYear` instead of `byYear` | Fixes the public contract (NFR-6). It is the one real ambiguity in FR-8 |
| Q2 | Response shape and names: is `{ watchedCount, averageRating, byGenre: [{name,count}], byYear: [{year,count}] }` acceptable, with `averageRating: null` when empty, genres ordered count desc → `name_key`, and years ascending without zero-filled gaps? | Yes (D4–D7, D13) | The contract and the NFR-5 order of the distributions |
| Q3 | How should `/stats` relate to `/profile`? Should `byGenre` also carry the per-genre `averageRating`? | No. `/stats` gets its own SQL and a counts-only distribution (D2). The per-genre average stays in `/profile` (ADR-013). FR-8 reads only totals from the history, not from the profile | Avoids duplicating, and coupling to, the FR-6 contract. If yes, `byGenre` items gain `averageRating` (still ordered count desc → `name_key`) |
| Q4 | Should percentages or shares be included in the distributions? | No. The client derives them from `count / watchedCount`, and genre shares do not sum to 100 % because of multi-genre movies | Prevents a misleading field and keeps the contract minimal |
| Q5 | Should `/stats` take filters (e.g. period)? | No (D11). The task puts filters out of scope, and they can be added later as optional params | Scope |

## Out of scope
- Changes to `/movies`, `/movies/:id/watch`, `/watches`, `/profile`, `/recommendations` and their modules.
- Migrations or indexes (W3), `src/recommendation/**` (W5), configs and dependencies (W4).
- Filters, charts, exports, percentages, per-bucket averages (unless Q3 or Q4 is answered otherwise).
- Recording **ADR-015 Viewing Statistics Contract** in the vault. It should cover year meaning, shape, null average, order, counting semantics and no relation to the profile. The orchestrator records it through `record-adr` (W6) after the human answers. The orchestrator should also update `Viewing Statistics` → `governed_by` ADR-015 and the Services/Routes Layer notes, where `StatsService` and `/stats` are now implemented.

---
Planner notes for the orchestrator:
- I did not run `npm test` or `npm run check`, so the plan assumes the current `pr7` HEAD (5177d8d) passes.
- All domain facts come from vault notes: Viewing Statistics, Rating, Genre, Movie, Watch History, Services Layer, Routes Layer, ADR-009, ADR-010, ADR-011 and ADR-013.

Relevant files:
- docs/orchestration/viewing-statistics/00-task.md
- src/container.ts
- src/routes/index.ts
- src/routes/profile.ts (route pattern to mirror)
- src/repositories/profile-repository.ts (SQL pattern to mirror)
- src/db/migrations.ts (read-only reference)
- test/helpers.ts
- test/profile.test.ts, test/profile.perf.test.ts (test patterns)
- test/app.test.ts
- .claude/skills/new-module/SKILL.md
- docs/guardrails.md

## Answers
Given by the human through the orchestrator (AskUserQuestion), 2026-10-17. All five match the Planner's recommendations.

| # | Answer |
|---|---|
| Q1 | Release year (`movies.year`), field `byYear` (D3). |
| Q2 | Shape as proposed: `{ watchedCount, averageRating, byGenre: [{name,count}], byYear: [{year,count}] }`; `averageRating: null` when empty; genres count desc → `name_key`; years ascending, no gaps (D4–D7, D13). |
| Q3 | Counts only; `/stats` has its own SQL, independent of `/profile` (D2). |
| Q4 | No percentages. |
| Q5 | No filters (D11). |
