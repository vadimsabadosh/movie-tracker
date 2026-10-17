# Plan: Preference Profile (FR-6)

## Goal
Add `GET /profile`. It returns the user's Preference Profile, computed on each request from the Watch History: genres with how many were watched and the average personal rating, ordered favourite first, and the same for directors. Nothing is stored (vault: Preference Profile, "not stored separately, one source of truth"). The computation goes in a Fastify-free `ProfileService.get(): PreferenceProfile`, wired in `src/container.ts`, so the FR-7 recommendation service can reuse it. The `PreferenceProfile` type is the one the vault `Recommender` interface already names. Requirements: FR-6, NFR-1, NFR-2, NFR-3, NFR-4, NFR-5, NFR-6.

## Domain facts
| Fact | Source (vault note / doc) |
|---|---|
| The profile is computed from Watch History and never stored separately | Preference Profile |
| Parts: favourite genres "by count and ratings", favourite directors, average Rating per genre | Preference Profile; `docs/app-requirements.md` FR-6 |
| The profile is the input to `Recommender.recommend(profile: PreferenceProfile, candidates, limit)` | Recommender, Preference Profile |
| FR-7 explanations quote a genre's average, e.g. "жанр Drama — ваш улюблений (середня оцінка 8.4)" | Recommendation |
| Same DB state must give the same result, with ties ordered by a stable key | NFR-5; ADR-003 |
| Rating is an integer 1–10, one per Watch Entry | Rating |
| One Watch Entry per movie. FR-6 aggregates count `watches` rows **without DISTINCT** | ADR-009 (Consequences) |
| A movie has 1..n genres (many-to-many). Genres are unique by `name_key`; the first spelling is kept | Genre; ADR-008 |
| Director is a plain string attribute of Movie, not an entity | Director |
| Case-insensitive text comparison needs a `*_key` column (`textKey()`); NOCASE/LIKE fold ASCII only | ADR-008 |
| Layers are routes → services → repositories; SQL only in repositories; services have no Fastify | ADR-001; Services Layer (plans a `ProfileService`) |
| The `/profile` endpoint group is planned in the Routes Layer | Routes Layer |
| Zod is the single source of types, validation and OpenAPI | ADR-004 |
| No SQL built from strings, not even from constant maps | ADR-011; `new-module` step 5 |
| Aggregation in SQL; p95 ≤ 200 ms on 10 000 movies | NFR-1; 00-task.md |

## Current code
| File | What is there now | Change needed |
|---|---|---|
| `src/container.ts` | `Services { movies, watches }`, `createServices(db, today)` | Add `profile: ProfileService` built on a new `ProfileRepository(db)` |
| `src/routes/index.ts` | Registers health, movies, watches | Add one line: `await profileRoutes(app, services.profile);` |
| `src/repositories/watch-repository.ts` | Watch CRUD and the FR-4 history SQL | No change |
| `src/repositories/movie-repository.ts` | `textKey`, `genresByMovie` | No change |
| `src/schemas/common.ts` | `ErrorResponse`, `page()` | No change; reuse `ErrorResponse` only if needed |
| `src/db/migrations.ts` | Migrations 1–2. `movies.director` has no key column. `movie_genres` PK (movie_id, genre_id) plus an index on genre_id | **No change** (D5) |
| `test/watch-history.perf.test.ts` | Has a private `seed(db)` for 10 000 movies | Move `seed` into `test/helpers.ts` as `seedCatalog(db)` and import it here; the test logic stays the same (D9) |
| `test/app.test.ts` | OpenAPI checks for `/watches` | Add a check that `/profile` GET is documented with a 200 schema |
| (new) `src/schemas/profile.ts`, `src/repositories/profile-repository.ts`, `src/services/profile-service.ts`, `src/routes/profile.ts`, `test/profile.test.ts`, `test/profile.perf.test.ts` | — | Create |

## Decisions
| # | Decision | Why | Rejected alternatives |
|---|---|---|---|
| D1 | Separate module: `ProfileRepository`, `ProfileService`, `profileRoutes`, `src/schemas/profile.ts` | The vault Services Layer plans a `ProfileService`. Keeps WatchRepository focused. ADR-011 allows repositories to share helpers | Add the aggregates to `WatchRepository`/`WatchService`: it mixes FR-4 and FR-6 and makes the FR-7 dependency less clear |
| D2 | Response shape (Zod, `src/schemas/profile.ts`): `PreferenceItem = z.object({ name: z.string(), count: z.number().int().positive(), averageRating: z.number().min(1).max(10) })`; `PreferenceProfile = z.object({ genres: z.array(PreferenceItem), directors: z.array(PreferenceItem) })`; export types with `z.infer`. Optional `.describe()` text for OpenAPI | One list per dimension covers favourite genres, average rating per genre (every genre the user watched is listed) and favourite directors in one structure. The type name matches `Recommender.recommend(profile: PreferenceProfile, …)` | Separate `favouriteGenres` (top N) and `averageRatingByGenre` (map) fields: they duplicate data, and a map has no order, which matters for NFR-5. `topGenres: string[]` without stats: FR-7 explanations need the average |
| D3 | **Favourite order** (both lists): `count DESC`, then exact `AVG(rating) DESC`, then name ascending (genres by `g.name_key`, directors by `m.director`). Position in the list is the rank (see Q1) | "By count and ratings": count first, rating breaks ties. The name tie-break makes the order total, so the same DB gives the same output (NFR-5, ADR-003) | Average first (one 10-rated film beats twenty 8s). Product `count × avg` = rating sum (an invented formula). Tie-break by id: depends on insertion order, so the same data entered differently would give a different profile |
| D4 | `averageRating = ROUND(AVG(w.rating), 2)` in SQL; ordering uses the unrounded `AVG(w.rating)` | Ratings are integers, so the double sum is exact and AVG is deterministic. Two decimals stays readable, and FR-7 can format to one decimal ("8.4"). Ordering by the exact value keeps ties honest | Sum and count to JS with division in the service: aggregation would leave SQL (NFR-1 says aggregate in SQL). One decimal in the API loses information that FR-7 scoring may want (Q3) |
| D5 | Directors are grouped by the exact `m.director` string (already trimmed by Zod on input). No `director_key` migration | Director is a plain string in the base version. Avoids a W3 schema change. Exact grouping is deterministic | `GROUP BY lower(director)`: ASCII-only, breaks ADR-008 for Cyrillic. Grouping in JS with `textKey`: aggregation leaves SQL. Migration 3 adding `director_key`: correct for case variants but needs W3 approval and a backfill (Q2) |
| D6 | Genres are grouped by `g.id` (unique `name_key`) and display `g.name` (the first spelling) | Case-insensitive grouping is already guaranteed by ADR-008 | — |
| D7 | No query parameters. Both lists are complete (all genres and all directors the user watched) | FR-7 scoring needs the full profile, and the vault defines no "top N". With no input there is nothing to validate (NFR-2 holds trivially). Response size at 10k movies is bounded by the number of distinct directors | `?top=1..50` limit: invents a domain rule; can be added later without breaking anything (Q4) |
| D8 | Empty history gives `200 {"genres":[],"directors":[]}`, not 404 | The profile exists but is empty. FR-7 can fall back cleanly | 404: the resource is not "missing" |
| D9 | Move the perf seed into `test/helpers.ts` as `export function seedCatalog(db)`; add `test/profile.perf.test.ts` with the same p95 < 200 ms check on `/profile` | NFR-1 must be shown for the new aggregate. One fixture, not two copies | Copy-paste the seed: the copies drift. Skip the perf test: NFR-1 unproven |
| D10 | `ProfileService.get()` is the reuse point for FR-7. The container exposes `services.profile`. Add no `src/recommendation/` files | FR-7 will inject `ProfileService` (or call it from its own service). This orchestration needs no W5 | Pre-create a `Recommender` stub now: W5, and outside this task's scope |
| D11 | Each list is one fixed literal SQL statement with no parameters (nothing to bind) | NFR-3 / ADR-011: no assembled SQL | Building ORDER BY dynamically: forbidden |

### SQL (exact shapes, in `src/repositories/profile-repository.ts`)
```sql
-- GENRE_PROFILE_SQL
SELECT g.name AS name, COUNT(*) AS count, ROUND(AVG(w.rating), 2) AS averageRating
FROM watches w
JOIN movie_genres mg ON mg.movie_id = w.movie_id
JOIN genres g ON g.id = mg.genre_id
GROUP BY g.id
ORDER BY COUNT(*) DESC, AVG(w.rating) DESC, g.name_key ASC;

-- DIRECTOR_PROFILE_SQL
SELECT m.director AS name, COUNT(*) AS count, ROUND(AVG(w.rating), 2) AS averageRating
FROM watches w
JOIN movies m ON m.id = w.movie_id
GROUP BY m.director
ORDER BY COUNT(*) DESC, AVG(w.rating) DESC, m.director ASC;
```
No `DISTINCT`: ADR-009 allows one watch per movie, and the `movie_genres` PK prevents duplicate links. `ProfileRepository` has `genres(): PreferenceItem[]` and `directors(): PreferenceItem[]`. The rows already match `PreferenceItem` (camelCase aliases), so no mapping is needed.

## Steps
1. Schemas: `src/schemas/profile.ts` with `PreferenceItem` and `PreferenceProfile` (D2), plus `z.infer` types. Done when: typecheck passes and no hand-written types exist.
2. Repository: `src/repositories/profile-repository.ts`, class `ProfileRepository(db)` with `genres()` and `directors()` using the literal SQL above. Header comment cites FR-6, NFR-1, NFR-3, ADR-009 (no DISTINCT) and D3 (order). Done when: the third layer grep (`\$\{|\+ *['"]`) finds nothing new in this file.
3. Service: `src/services/profile-service.ts`, class `ProfileService(repo: ProfileRepository)` with `get(): PreferenceProfile` returning `{ genres: repo.genres(), directors: repo.directors() }`. A doc comment says it is the FR-7 entry point. Done when: the file has no imports of fastify, better-sqlite3 or `../db/`.
4. Wiring: `src/container.ts` adds `profile: ProfileService` to `Services` and `createServices` (`new ProfileService(new ProfileRepository(db))`). Done when: `createServices(db).profile.get()` works in a test.
5. Route: `src/routes/profile.ts` exports `profileRoutes(app, service: ProfileService)` with `r.get('/profile', { schema: { tags: ['profile'], response: { 200: PreferenceProfile } } }, () => service.get())`. Register it in `src/routes/index.ts`. Done when: `/openapi.json` has `paths['/profile'].get.responses['200']`.
6. Test fixture: move `seed` from `test/watch-history.perf.test.ts` into `test/helpers.ts` as `seedCatalog(db)` (with its constants). The watch-history perf test imports it, unchanged otherwise. Done when: that test still passes.
7. Tests: `test/profile.test.ts` (functional, see Test plan), `test/profile.perf.test.ts` (NFR-1), and the OpenAPI check in `test/app.test.ts`. Done when: all pass.
8. Checks: `npm run format`, then `npm run check` (typecheck, ESLint, Prettier check, vitest with the 80 % coverage floor), then the three layer greps from `.claude/skills/new-module/SKILL.md` step 5. Done when: `npm run check` exits 0, coverage is ≥ 80 % on every metric, and the greps print nothing.

## Guardrails
| File / action | Rule | Expected reaction |
|---|---|---|
| `src/schemas/profile.ts`, `src/repositories/profile-repository.ts`, `src/services/profile-service.ts`, `src/routes/profile.ts`, `src/routes/index.ts`, `src/container.ts` | A2 | Written without asking |
| `test/profile.test.ts`, `test/profile.perf.test.ts`, `test/helpers.ts`, `test/watch-history.perf.test.ts`, `test/app.test.ts` | A2 | Written without asking |
| `src/db/migrations.ts` | W3 | **Not touched** (D5). Only if the human answers Q2 with "add director_key": then W3 asks, append-only migration 3 |
| `src/recommendation/**` | W5 | **Not touched** (D10) |
| `package.json`, `vitest.config.ts`, ESLint or Prettier configs | W4 | Not touched; no new dependencies |
| `npm run check`, `npx vitest`, `git diff/status`, the greps | A3 | Run without asking |
| `npm run format` (Prettier rewrites files) | no auto-allow (not in A3) | Normal permission prompt; expected |
| Commits and the vault ADR | W2 / W6 | Orchestrator only, not the Coder |

## Test plan
| Case | Expected |
|---|---|
| Empty DB, `GET /profile` | 200 `{ genres: [], directors: [] }` |
| Catalog movies exist but none are watched | Empty lists (only watched movies count) |
| 3 Drama movies watched (ratings 8, 9, 7) and 1 Comedy (10) | `genres[0] = {name:'Drama', count:3, averageRating:8}`, then `{Comedy,1,10}` (count beats rating) |
| Equal count, different average | Higher average first |
| Equal count and average, names "комедія" vs "Драма" (Cyrillic, mixed case) | Ordered by `name_key` (д < к); original spelling shown |
| A movie with two genres | Counted in both genres; directors count it once |
| Rounding: ratings 7, 8, 8 | `averageRating: 7.67` |
| Directors: 2 by A (6, 6), 2 by B (9, 7), 1 by C (10) | Order B (2, 8), A (2, 6), C (1, 10) |
| Genre spelling: movie 1 has "Sci-Fi", movie 2 has "sci-fi" | One entry `Sci-Fi`, count 2 |
| `PUT /movies/:id/watch` changes a rating | Profile reflects the new rating (computed, not stored) |
| `DELETE /movies/:id/watch` | Movie no longer counted; a genre with no watches left disappears |
| Determinism (NFR-5): build two DBs with the same movies and watches inserted in different orders | Deep-equal `/profile` bodies; two calls on one DB are also equal |
| Reuse (FR-7): `createServices(openDatabase(':memory:')).profile.get()` after seeding through the services | Equals the HTTP body |
| Unknown query parameter `GET /profile?x=1` | 200 (ignored, as other routes do) |
| OpenAPI (NFR-6, `test/app.test.ts`) | `paths['/profile'].get` exists with a 200 response |
| Perf (NFR-1, `test/profile.perf.test.ts`): `seedCatalog` with 10 000 watched movies, 20 genres × 3 per movie, 500 directors; 60 requests | p95 < 200 ms; sanity: `genres.length === 20`, sum of genre counts = 30 000, `directors.length === 500` |
| `npm run check` | Passes, coverage ≥ 80 % |

## Open questions
| # | Question | Recommended answer | Why it matters |
|---|---|---|---|
| Q1 | What does "favourite … by count and ratings" mean for the order? | Count desc, then average rating desc, then name (D3). The list position is the favourite rank; no extra "favourite" flag | Fixes the public contract and the input order FR-7 relies on (NFR-5). The vault does not define the formula |
| Q2 | Group directors case-insensitively ("Christopher Nolan" = "christopher nolan")? | No for now: exact string (D5), no migration. If yes, a W3-approved migration 3 adds `movies.director_key` (backfilled with `textKey` in JS) and grouping uses it | Case-insensitive grouping would follow ADR-008 but needs a schema change and W3 approval |
| Q3 | Precision of `averageRating` in the response? | 2 decimals (`ROUND(AVG, 2)`); ordering uses exact values; FR-7 formats to 1 decimal in explanations | The API contract; how precise FR-7 scoring can be |
| Q4 | Limit the lists (e.g. `?top=N`) or return everything? | Return everything, no parameters (D7). A `top` param can be added later without breaking anything | Response size compared with FR-7 needing the full profile; invents no domain rule |
| Q5 | Should the profile also include a total watched count or an overall average rating? | No: those belong to Viewing Statistics (FR-8) | Keeps FR-6 and FR-8 separate |

## Out of scope
- Recommendations (FR-7), `src/recommendation/**` (W5), Viewing Statistics (FR-8, `/stats`).
- Changes to existing endpoints (`/movies…`, `/movies/:id/watch`, `GET /watches`).
- Schema changes or migrations, unless Q2 is answered "yes".
- Profile filters (by period, rating range), caching or storing the profile.
- Recording ADR-013 "Preference Profile contract" (order, rounding, director grouping, no parameters) in the vault: the orchestrator does this through `record-adr` (W6) after the human answers.

Files referenced:
- docs/orchestration/preference-profile/00-task.md
- src/container.ts
- src/routes/index.ts
- src/repositories/watch-repository.ts
- src/repositories/movie-repository.ts
- src/db/migrations.ts
- test/helpers.ts
- test/watch-history.perf.test.ts
- test/app.test.ts
- .claude/skills/new-module/SKILL.md
- docs/guardrails.md

Note: I did not run `npm test`, so the plan assumes the PR7 baseline passes `npm run check`.

## Answers
Given by the human through the orchestrator (AskUserQuestion), 2026-10-17. All five match the Planner's recommendations.

| # | Answer |
|---|---|
| Q1 | Count desc, then average rating desc, then name (D3). List position is the rank. |
| Q2 | No: group directors by the exact string (D5). No migration. |
| Q3 | 2 decimals (`ROUND(AVG, 2)`); ordering uses exact values (D4). |
| Q4 | Return everything, no query parameters (D7). |
| Q5 | No totals in the profile; they belong to FR-8. |
