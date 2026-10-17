# Plan: Recommendations (FR-7)

## Goal
Add `GET /recommendations`. It returns the unwatched catalog movies, ranked by a deterministic score computed from the Preference Profile (FR-6). Each item carries its score, the structured reasons behind the score, and a human-readable explanation built from those same reasons. The scoring lives behind a `Recommender` interface in `src/recommendation/`, so another algorithm (for example an LLM, per ADR-003) can be plugged in through the composition root without touching the service or the route. The same database state gives byte-identical output, including order. Equal scores are ordered by movie id. Requirements: FR-7, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5, NFR-6.

## Domain facts
| Fact | Source (vault note / doc) |
|---|---|
| A Recommendation is an unwatched Movie from the catalog, proposed from the Preference Profile, with a score and an explanation | `Recommendation` |
| Only movies without a Watch Entry are candidates | `Recommendation`, `Movie` |
| Order is by Recommendation Score; equal scores are ordered stably (NFR-5) | `Recommendation` |
| Example explanation: «жанр Drama — ваш улюблений (середня оцінка 8.4)» | `Recommendation` |
| Interface: `recommend(profile: PreferenceProfile, candidates: Movie[], limit: number): Recommendation[]` | `Recommender` |
| The Recommender does not touch the Database; it gets its data from the Services Layer. `source_path: src/recommendation/` | `Recommender` |
| The score is computed deterministically from how well the movie's Genre and Director match the Preference Profile | `Recommendation Score`, `Genre`, `Director` |
| Fixed formula; ties broken by movie id; weights are fixed in code and tests during implementation; the explanation is built from the same components as the score | ADR-003 |
| Collaborative filtering is rejected; LLM is an optional extension behind the same interface | ADR-003 |
| The profile is `{ genres, directors }` of `{ name, count, averageRating }`. Lists are complete. `averageRating` is rounded to 2 dp. Genres are grouped by id (first spelling shown); directors by the exact string. FR-7 entry point is `ProfileService.get()`. FR-7 explanations format averages to 1 decimal themselves | ADR-013 |
| "Nolan" and "nolan" are two profile entries (no `director_key`) | ADR-013, Consequences |
| One watch per movie; `watches.movie_id` is the PK | ADR-009 |
| Routes → services → repositories; recommendation logic is a separate module; DB access only from repositories | ADR-001, `Services Layer` |
| Zod is the single source of truth for types, validation and OpenAPI | ADR-004 |
| No SQL built from strings; fixed literal statements | ADR-011, NFR-3, new-module skill step 5 |
| Endpoint group `/recommendations` is planned | `Routes Layer` |
| p95 ≤ 200 ms on a catalog of up to 10 000 movies | NFR-1, `docs/app-requirements.md` |

## Current code
| File | What is there now | Change needed |
|---|---|---|
| `src/recommendation/` | does not exist | New: `recommender.ts` (interface) and `profile-score-recommender.ts` (base implementation). **W5** |
| `src/schemas/profile.ts` | `PreferenceItem`, `PreferenceProfile` (Zod + `z.infer`) | none (imported as the input type) |
| `src/schemas/movie.ts` | `Movie` schema/type | none (reused inside `Recommendation`) |
| `src/schemas/common.ts` | `PaginationQuery` (limit 1–100, default 20; offset), `ErrorResponse` | none (reuse `PaginationQuery.pick({ limit: true })`) |
| `src/schemas/recommendation.ts` | does not exist | New: `RecommendationReason`, `Recommendation`, `RecommendationQuery`, `RecommendationList` |
| `src/repositories/movie-repository.ts` | `MovieRepository` (findById, list, …), `genresByMovie(db, ids)` (genre names per movie, sorted by `name_key`, via `json_each`) | Add `listUnwatched(): Movie[]` |
| `src/services/profile-service.ts` | `ProfileService.get(): PreferenceProfile` | none |
| `src/services/recommendation-service.ts` | does not exist | New: `RecommendationService.recommend(query)` |
| `src/routes/recommendations.ts` | does not exist | New: `GET /recommendations` |
| `src/routes/index.ts` | registers movies, watches, profile | One new line: `await recommendationRoutes(app, services.recommendations);` |
| `src/container.ts` | `createServices(db, today?)` builds movies, watches, profile | Share one `ProfileService` instance, add `recommendations`, add an optional third param `recommender: Recommender = new ProfileScoreRecommender()` |
| `src/db/migrations.ts` | migrations 1–2 | **no change** (W3 avoided) |
| `test/helpers.ts` | `testApp`, `seedCatalog(db)` (all 10 000 movies watched), `CATALOG_*` constants | `seedCatalog(db, { watchEvery = 1 } = {})`: watch movie `i` only when `i % watchEvery === 0`. The default keeps the current behaviour |
| `test/app.test.ts` | OpenAPI tests for `/watches` params and `/profile` | Add a `/recommendations` OpenAPI test |
| `test/recommendations.test.ts`, `test/recommendations.perf.test.ts`, `test/recommender.test.ts` | do not exist | New |

Baseline: `npm test` gives 6 files / 97 tests passing.

## Decisions
| # | Decision | Why | Rejected alternatives |
|---|---|---|---|
| D1 | Interface file `src/recommendation/recommender.ts`, exactly as in the vault: `export interface Recommender { recommend(profile: PreferenceProfile, candidates: Movie[], limit: number): Recommendation[]; }`. Types are imported (`import type`) from `src/schemas/profile.ts`, `movie.ts` and `recommendation.ts` | Vault `Recommender` gives this signature; ADR-004 says types come from Zod | Defining the types inside `src/recommendation/`: duplicates the Zod schemas and breaks ADR-004 |
| D2 | Base implementation `ProfileScoreRecommender` in `src/recommendation/profile-score-recommender.ts`. It exports the constants `NEUTRAL_RATING = 5.5`, `GENRE_WEIGHT = 1` and `DIRECTOR_WEIGHT = 2`, plus a pure `affinity(item: PreferenceItem): number`. It has no imports from db, repositories, services or fastify | ADR-003: the weights are fixed in code and in tests. The vault says the Recommender does not touch the DB. Two files mean two W5 approvals; the interface rarely changes, while the formula file is the one the human reviews | One file for both (fewer W5 prompts, but it mixes the swappable contract with one algorithm). Scoring in SQL: breaks "Recommender does not touch the Database" and makes the interface pointless |
| D3 | **Score formula (pending Q1).** For each profile item, `affinity = count × (averageRating − 5.5) / (count + 1)`. This is the profile average with one imaginary neutral 5.5 rating added, minus 5.5, so it is a Bayesian average shrunk toward neutral. `genrePoints = 1 × affinity(genre)` for each movie genre found in `profile.genres`. `directorPoints = 2 × affinity(director)` if the movie's director is in `profile.directors`. `score = round2(directorPoints + Σ genrePoints)`, with genres summed in the movie's genre order (`name_key`). `round2(x) = Math.round(x * 100) / 100`. Worked examples are under Q1 | It uses both components FR-6/ADR-013 provide (count and rating). 5.5 is the midpoint of the 1–10 rating scale, so low-rated genres and directors push a movie down instead of up. Shrinkage means a single 10 does not beat a consistent 8.5 over 4 films, the same spirit as ADR-013's rejection of "average first". Director weight 2: one director is a narrow, specific signal, while a movie has up to 20 broad genres | `count × avg` (ADR-013 already rejected this as an invented formula; it also rewards often-watched but disliked genres). Plain average (one 10 dominates). Rank-based points from profile position (ignores how much better the favourite is; positions shift on unrelated data). Mean over a movie's genres instead of sum (a movie with one favourite and two unknown genres would be penalised for the unknowns) |
| D4 | Matching: genres by exact `name` (both the profile and `genresByMovie` return the same `genres.name` column, and genres are unique by `name_key`, so this is effectively case-insensitive per ADR-008). Directors by the exact stored string | ADR-013: directors are grouped by the exact string, so "nolan" has no profile entry when only "Nolan" was watched. Matching case-insensitively here would contradict the profile the explanation cites | Lowercased director match: inconsistent with `/profile`; needs `director_key` (W3, a new ADR) |
| D5 | **Only movies with `score > 0` are returned (pending Q2).** Empty history or no matches gives `200 { items: [] }` | A recommendation should rest on a positive preference, and its explanation must be truthful. Score 0 means "nothing in common"; a negative score means "made of things you rate low" | Returning all unwatched movies, with zero/negative scores at the bottom (the explanation for those would be "no match", which is not a recommendation) |
| D6 | Order: `score` (the rounded value that is returned) desc, then `movie.id` asc. `Array.prototype.sort` with comparator `(a, b) => b.score - a.score \|\| a.movie.id - b.movie.id`, then `.slice(0, limit)` | ADR-003: ties by movie id. Sorting by the displayed value means two items that show the same score always tie-break by id, never by a floating-point ulp the client cannot see | Sorting by the unrounded sum (ADR-013 style): deterministic, but visually equal scores could be ordered by invisible float noise |
| D7 | Each `RecommendationReason = { kind: 'director' \| 'genre', name, count, averageRating, points }` (`points` = `round2(weight × affinity)`). `reasons` holds all matched items, including negative ones. Reason order: unrounded points desc, then director before genre, then the movie's genre order (stable sort) | ADR-003: the explanation is built from the same components as the score. Structured reasons let tests and clients check it without parsing text | Explanation string only (untestable without parsing); listing only positive reasons (hides why a score is lower) |
| D8 | **`explanation` (pending Q3):** `reasons.map(r => \`${r.kind === 'director' ? 'Director' : 'Genre'} ${r.name}: ${r.count} watched, average ${r.averageRating.toFixed(1)} (${r.points >= 0 ? '+' : '-'}${Math.abs(r.points).toFixed(2)})\`).join('; ')`. Example: `Director Nolan: 2 watched, average 9.0 (+4.67); Genre Drama: 4 watched, average 8.5 (+2.40); Genre Sci-Fi: 2 watched, average 9.0 (+2.33)` | English, like the rest of the API (error messages, OpenAPI descriptions). The average uses 1 decimal, as ADR-013 anticipated. Points are shown so the text is checkable against the score | Ukrainian text as in the vault example (see Q3); free-form sentences ("your favourite") need extra rules about what "favourite" means |
| D9 | Response `200 { items: Recommendation[] }`, with `Recommendation = { movie: Movie, score: number, explanation: string, reasons: RecommendationReason[] }`. Query: only `limit` = `PaginationQuery.pick({ limit: true })` (int 1–100, default 20, coerced). No `offset`; unknown params are stripped as elsewhere | The interface takes only `limit`; a ranked top-N list does not need paging. Reusing `PaginationQuery` keeps the range consistent with `/movies` and `/watches`. An object wrapper (not a bare array) can grow later without breaking clients | `page()` with `total`/`offset` (the interface has no offset; `total` would require scoring everything anyway and exposes the score>0 count for no FR need) |
| D10 | Candidates come from a new `MovieRepository.listUnwatched(): Movie[]`, one fixed literal statement without parameters plus the existing `withGenres` (`genresByMovie`, `json_each`):<br>`SELECT m.id, m.title, m.year, m.director FROM movies m WHERE NOT EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = m.id) ORDER BY m.id` | NFR-3/ADR-011: literal SQL. Reuses the genre loading and the genre order of `/movies`. All candidates must be scored before the limit is applied, so loading them is inherent to the interface; with 10 000 rows this stays well inside NFR-1 (verified by the perf test) | A new `RecommendationRepository` (one method that belongs to the movie catalog); pre-filtering candidates in SQL to profile genres (couples SQL to the scoring rule, which W5 should own) |
| D11 | `RecommendationService` (`src/services/recommendation-service.ts`) takes `(profile: ProfileService, movies: MovieRepository, recommender: Recommender)`. `recommend({ limit })` returns `{ items: this.recommender.recommend(this.profile.get(), this.movies.listUnwatched(), limit) }`. No fastify, no SQL | ADR-013 names `ProfileService.get()` as the FR-7 entry point. The `Services Layer` note says recommendations are delegated to the Recommender | Calling `ProfileRepository` directly (would duplicate `get()`) |
| D12 | `createServices(db, today?, recommender: Recommender = new ProfileScoreRecommender())`. One `ProfileService` instance is shared by `profile` and `recommendations`. `buildApp` is unchanged | This proves the "swap another algorithm" requirement in a test (stub Recommender) without changing app options. The composition root is the only wiring place (ADR-001) | A new `AppOptions.recommender` (not needed by FR-7; can be added later); module-level singleton |
| D13 | The recommender reads the profile as given (averages already rounded to 2 dp by ADR-013) | The interface receives `PreferenceProfile`, and the explanation quotes those same numbers | Re-querying exact averages: breaks "no DB in Recommender" |

## Steps
1. **Schemas** — files: `src/schemas/recommendation.ts` (A2).
   - `RecommendationReason = z.object({ kind: z.enum(['director', 'genre']), name: z.string(), count: z.number().int().positive(), averageRating: z.number().min(1).max(10), points: z.number() })`.
   - `Recommendation = z.object({ movie: Movie, score: z.number().positive(), explanation: z.string().min(1), reasons: z.array(RecommendationReason).min(1) })`.
   - `RecommendationQuery = PaginationQuery.pick({ limit: true })`.
   - `RecommendationList = z.object({ items: z.array(Recommendation) })`.
   - Add `.describe()` texts stating the order (score desc, then movie id) and the meaning of points. Types come from `z.infer`.
   - Done when: `npm run typecheck` passes.
2. **Recommender interface** — files: `src/recommendation/recommender.ts` (**W5**, write once, complete). Done when: it exports only `interface Recommender` per D1, with `import type` only.
3. **Base recommender** — files: `src/recommendation/profile-score-recommender.ts` (**W5**, write once, complete).
   - Header comment citing ADR-003, NFR-5 and the formula.
   - Exported constants per D2, `affinity()`, `round2()`, and `class ProfileScoreRecommender implements Recommender`.
   - Build `Map<string, PreferenceItem>` for genres and for directors. For each candidate: collect reasons (D4, D7), compute the score (D3), keep only `score > 0` (D5), build the explanation (D8), sort and slice (D6).
   - Done when: no imports from `../db`, `../repositories`, `../services`, `fastify` or `better-sqlite3`, and `test/recommender.test.ts` passes.
4. **Repository** — files: `src/repositories/movie-repository.ts` (A2). Add `listUnwatched(): Movie[]` per D10 (literal SQL, `this.withGenres(rows)`). Done when: the `${`/`+` grep from new-module step 5 prints nothing new.
5. **Service** — files: `src/services/recommendation-service.ts` (A2), per D11. Done when: the services grep prints nothing.
6. **Route** — files: `src/routes/recommendations.ts` (A2).
   - `recommendationRoutes(app, service)`: `r.get('/recommendations', { schema: { tags: ['recommendations'], querystring: RecommendationQuery, response: { 200: RecommendationList, 400: ErrorResponse } } }, (req) => service.recommend(req.query))`.
   - Header comment as in `profile.ts`.
   - Done when: the routes grep prints nothing.
7. **Wiring** — files: `src/container.ts`, `src/routes/index.ts` (A2), per D12. Add `recommendations: RecommendationService` to `Services`. Done when: `/profile` tests still pass unchanged.
8. **Test helper** — files: `test/helpers.ts` (A2). Add the `watchEvery` option to `seedCatalog`, without changing default output. Done when: both existing perf tests pass unchanged.
9. **Tests** — files: `test/recommender.test.ts`, `test/recommendations.test.ts`, `test/recommendations.perf.test.ts`, `test/app.test.ts` (A2). See the Test plan.
10. **Verify** — `npm run format`, then `npm run check`, plus the three greps from `.claude/skills/new-module/SKILL.md` step 5. Done when: exit 0, coverage ≥ 80 % on every metric, both new `src/recommendation/` files are 100 % covered, and the greps are clean.

## Guardrails
| File / action | Rule | Expected reaction |
|---|---|---|
| `src/recommendation/recommender.ts`, `src/recommendation/profile-score-recommender.ts` | **W5** | Human asked on every Edit/Write. The Coder writes each file in one complete Write after Q1–Q3 are answered, and avoids iterative edits |
| `src/schemas/recommendation.ts`, `src/repositories/movie-repository.ts`, `src/services/recommendation-service.ts`, `src/routes/recommendations.ts`, `src/routes/index.ts`, `src/container.ts` | A2 | allowed |
| `test/*.ts` | A2 | allowed |
| `src/db/migrations.ts` | W3 | **not touched**; no schema change needed |
| `package.json`, `vitest.config.ts`, ESLint/Prettier/tsconfig | W4 | **not touched**; no new dependencies |
| `npm run check`, `npm test` | A3 | allowed |
| `npm run format` | not on the A3 list | normal permission prompt (it rewrites files) |
| `docs/guardrails.md`, `harness/**`, `.claude/settings*.json` | B6 | never |
| Vault reads | A4 via MCP only; B4 for direct access | the Coder needs no vault access; everything is in this plan |
| Commits, vault writes (ADR-014) | W2 / W6 | orchestrator only |

## Test plan
Shared fixture for `test/recommendations.test.ts`: create movies via `POST /movies` (year 2000) and mark watched via `POST /movies/:id/watch`, in this order, so ids are 1..17. Use helpers like those in `test/profile.test.ts`.

Watched (id: genres; director; rating):
- 1: Sci-Fi, Drama; Nolan; 9
- 2: Sci-Fi; Nolan; 9
- 3: Drama; Other; 8
- 4: Drama; Other; 8
- 5: Drama; Other; 9
- 6: Comedy; Other; 4
- 7: Comedy; Other; 5
- 8: Horror; Bay; 2
- 9: Thriller; Other; 10

Resulting profile: Drama 4/8.5, Sci-Fi 2/9, Comedy 2/4.5, Horror 1/2, Thriller 1/10; Nolan 2/9, Bay 1/2, Other 6/7.33.

Unwatched candidates:
- 10: Drama, Sci-Fi; Nolan
- 11: Sci-Fi; Villeneuve
- 12: Drama; Kurosawa
- 13: Comedy, Drama; Allen
- 14: Horror; Bay
- 15: Western; Leone
- 16: Sci-Fi; Scott
- 17: Thriller; Fincher

| Case | Expected |
|---|---|
| Empty database | 200 `{ items: [] }` |
| Movies but no watches (empty profile) | 200 `{ items: [] }` (D5) |
| Fixture: exact order and scores | ids `[10, 12, 11, 16, 17, 13]`, scores `[9.4, 2.4, 2.33, 2.33, 2.25, 1.73]` |
| Watched movies never appear | ids 1–9 absent |
| Score ≤ 0 excluded | 14 (−5.25) and 15 (0) absent |
| Tie by id | 11 before 16 (both 2.33) |
| Shrinkage | 12 (Drama 4×8.5 → 2.40) before 17 (Thriller 1×10 → 2.25) |
| Reasons of 10 | `[{director Nolan 2 9 4.67}, {genre Drama 4 8.5 2.4}, {genre Sci-Fi 2 9 2.33}]` |
| Explanation of 10 | `Director Nolan: 2 watched, average 9.0 (+4.67); Genre Drama: 4 watched, average 8.5 (+2.40); Genre Sci-Fi: 2 watched, average 9.0 (+2.33)` |
| Explanation of 13 (negative reason kept) | `Genre Drama: 4 watched, average 8.5 (+2.40); Genre Comedy: 2 watched, average 4.5 (-0.67)` |
| `movie` field | equals `GET /movies/:id` body for that id |
| `?limit=2` | ids `[10, 12]` |
| Default limit 20 | seed 25 positive candidates; 20 items returned |
| `?limit=0`, `?limit=101`, `?limit=abc` | 400, `error.code === 'VALIDATION_ERROR'` |
| Genre case: movie created with genre `sci-fi` after `Sci-Fi` exists | matched; the reason name is `Sci-Fi` |
| Director case: candidate with director `nolan` when the profile has `Nolan` | no director reason (ADR-013, D4) |
| After `POST /movies/10/watch` | 10 disappears from the list |
| NFR-5: same seed in two fresh apps | identical JSON bodies |
| Swap (`createServices(openDatabase(':memory:'), () => TODAY, stub)`) | `services.recommendations.recommend({ limit: 5 })` returns the stub's output; the stub got `profile` deep-equal to `services.profile.get()`, only unwatched candidates (ordered by id), and `limit` 5 |
| `test/recommender.test.ts` (pure, no DB): `affinity` | `{count 4, avg 8.5}` → 2.4; `{1, 10}` → 2.25; `{2, 4.5}` → −0.666…; `{n, 5.5}` → 0 |
| Pure recommender: empty profile | `[]` |
| Pure recommender: input candidates order shuffled | same output |
| Pure recommender: `limit` below the positive count | sliced |
| Pure recommender: exported constants | `NEUTRAL_RATING === 5.5`, `GENRE_WEIGHT === 1`, `DIRECTOR_WEIGHT === 2` (pins the weights per ADR-003) |
| `test/app.test.ts` | `paths['/recommendations'].get` has query param `limit` (only), and the 200 schema has `items` whose item has `movie`, `score`, `explanation` and `reasons` |
| `test/recommendations.perf.test.ts` | `seedCatalog(db, { watchEvery: 3 })` gives 3 333 watched and 6 667 candidates; directors match because gcd(3, 500) = 1. Run 60× `GET /recommendations?limit=100`. p95 < 200 ms; sanity: `0 < items.length ≤ 100` and scores non-increasing. Timeout 30 s, like `profile.perf.test.ts` |
| Regression | the existing 97 tests are unchanged and pass |

## Open questions
| # | Question | Recommended answer | Why it matters |
|---|---|---|---|
| Q1 | **Score formula and weights** (ADR-003 leaves them to implementation) | `affinity = count × (avg − 5.5) / (count + 1)`; `score = 2 × affinity(director) + Σ 1 × affinity(genre)`, rounded to 2 dp. Worked examples on the test fixture: Drama 4×8.5 → 4·3/5 = **2.40**; Sci-Fi 2×9 → 2·3.5/3 = **2.33**; Comedy 2×4.5 → 2·(−1)/3 = **−0.67**; Thriller 1×10 → 4.5/2 = **2.25** (a single 10 loses to a steady 8.5 over four films); Horror 1×2 → **−1.75**; Nolan 2×9 → 2 × 2.33 = **4.67**; Bay 1×2 → 2 × (−1.75) = **−3.50**. Movie scores: 10 (Drama, Sci-Fi, Nolan) = 2.40 + 2.33 + 4.67 = **9.40**; 12 (Drama) = **2.40**; 11 and 16 (Sci-Fi) = **2.33** each (tie, id order); 17 (Thriller) = **2.25**; 13 (Comedy, Drama) = 2.40 − 0.67 = **1.73**; 14 (Horror, Bay) = **−5.25**; 15 (Western) = **0** | It fixes the exact output the tests assert (NFR-5), and every later change is a W5 change. Alternatives: director weight 1 (equal to one genre) or 3; prior strength 2 instead of 1 (stronger shrinkage); neutral 5.0 instead of 5.5 |
| Q2 | Show movies with score ≤ 0 (no match, or only disliked genres/director)? | No: only `score > 0`; empty history gives `[]` | It decides whether the endpoint is "ranked catalog" or "things you will probably like", and whether every explanation is a real reason |
| Q3 | Language and template of `explanation` | English, `Director Nolan: 2 watched, average 9.0 (+4.67); Genre Drama: …` (D8) | The vault example is Ukrainian («жанр Drama — ваш улюблений (середня оцінка 8.4)»), but all other API text is English. Tests assert the exact string |
| Q4 | Default `limit` | 20, range 1–100 (same as `PaginationQuery`) | Minor; consistent with other lists. 10 is the alternative |

## Out of scope
- FR-8 Statistics.
- LLM recommender (only the interface seam and a stub test).
- Any change to `/profile`, `/movies` or `/watches` behaviour, or to migrations (`director_key` would be W3 plus a new ADR).
- `offset` paging of recommendations.
- Recording the formula as **ADR-014 Recommendation Score Formula** (supersedes nothing; refines ADR-003) and updating the `Recommender` note status from `planned`. These are the orchestrator's job after the review (W6).

Relevant files:
- docs/orchestration/recommendations/00-task.md
- src/container.ts
- src/services/profile-service.ts
- src/schemas/profile.ts
- src/schemas/common.ts
- src/repositories/movie-repository.ts
- src/routes/index.ts
- test/helpers.ts
- test/app.test.ts
- docs/guardrails.md
- .claude/skills/new-module/SKILL.md

## Answers
Given by the human through the orchestrator (AskUserQuestion), 2026-10-17. All four match the Planner's recommendations.

| # | Answer |
|---|---|
| Q1 | Shrunk average, director weight 2: `affinity = count × (avg − 5.5) / (count + 1)`; `score = round2(2 × affinity(director) + Σ affinity(genre))` (D3). |
| Q2 | Only `score > 0`; empty history gives `[]` (D5). |
| Q3 | English template with numbers (D8): `Director Nolan: 2 watched, average 9.0 (+4.67); Genre Drama: …` |
| Q4 | Default `limit` 20, range 1–100 (D9). |
