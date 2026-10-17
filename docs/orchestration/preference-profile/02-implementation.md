# Implementation: Preference Profile (FR-6) (round 1)

## Plan steps
| Step | Status (done / changed / skipped) | Notes |
|---|---|---|
| 1. Schemas | done | `PreferenceItem` and `PreferenceProfile` in Zod, with types from `z.infer` and `.describe()` text for OpenAPI. No hand-written types. |
| 2. Repository | done | `ProfileRepository(db)` has `genres()` and `directors()`. It uses the two literal statements from the plan, character for character, with no parameters and no DISTINCT. The header cites FR-6, NFR-1, NFR-3, ADR-011, ADR-009, ADR-008, D3 and D5. Statements are prepared once in the constructor and typed `Statement<[], PreferenceItem>`. The rows already match `PreferenceItem`, so there is no mapping. |
| 3. Service | done | `ProfileService.get()` returns `{ genres, directors }`. Its doc comment marks it as the entry point for FR-7 and states NFR-5. It imports no Fastify, better-sqlite3 or db code. |
| 4. Wiring | done | `Services.profile` is set to `new ProfileService(new ProfileRepository(db))` in `createServices`. |
| 5. Route | done | `GET /profile` with `tags: ['profile']` and `response: { 200: PreferenceProfile }`, registered in `src/routes/index.ts`. |
| 6. Test fixture | done | `seed` moved to `test/helpers.ts` as `seedCatalog(db)`, plus exported `CATALOG_MOVIES`, `CATALOG_GENRES` and `CATALOG_DIRECTORS`. The watch-history perf test imports them with aliases (`MOVIES`, `GENRES`). Its test logic is unchanged. |
| 7. Tests | done | `test/profile.test.ts` (15 tests), `test/profile.perf.test.ts` (1 test), plus 1 OpenAPI test in `test/app.test.ts`. |
| 8. Checks | done | `npm run format`, then `npm run check`, then the layer greps (results under Checks). |

## Files changed
| File | Change |
|---|---|
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/schemas/profile.ts | new: Zod schemas `PreferenceItem` and `PreferenceProfile`, plus types |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/profile-repository.ts | new: `GENRE_PROFILE_SQL` and `DIRECTOR_PROFILE_SQL` (fixed literals), class `ProfileRepository` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/services/profile-service.ts | new: `ProfileService.get()` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/profile.ts | new: `profileRoutes`, `GET /profile` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/index.ts | one import, plus `await profileRoutes(app, services.profile);` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/container.ts | `profile: ProfileService` added to `Services` and built in `createServices` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/helpers.ts | `seedCatalog(db)` and the `CATALOG_*` constants moved here from the watch-history perf test |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/watch-history.perf.test.ts | private `seed` and its constants removed; now imports `seedCatalog` (behaviour unchanged) |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/profile.test.ts | new: functional, determinism and FR-7 reuse tests |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/profile.perf.test.ts | new: NFR-1 p95 < 200 ms over 60 requests, with sanity checks (20 genres, genre counts sum to 30 000, 500 directors) |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/app.test.ts | new test: `paths['/profile'].get.responses['200']` exists and has `genres` and `directors` properties |

## Decisions beyond the plan
| Decision | Why |
|---|---|
| The genre tie-break test uses `драма` against `Комедія`, not the plan's `Драма` against `комедія` | With the plan's pair, binary order and `name_key` order agree (Д U+0414 sorts before к U+043A), so the test could not catch a regression to `ORDER BY g.name`. In my pair, binary order gives К (U+041A) first and `name_key` order gives д first, so the test only passes if ordering uses `name_key`. |
| An extra test: directors with equal count and average are ordered by name | It covers the last tie-break in the director ordering, which the plan's A/B/C case does not reach. |
| The determinism test also changes the id/rowid layout | The second database adds every movie in reverse order before marking any of them as watched. Both ids and watch rowids therefore differ from the first database. |
| The p95 calculation is inline in the new perf test, not a shared helper | It stays the same as the existing perf test, which the plan says not to change. |

## Deviations from the plan
| Plan said | Did instead | Why |
|---|---|---|
| Tie-break case "комедія" vs "Драма" | "Комедія" vs "драма" | See the first row of *Decisions beyond the plan*: the plan's pair cannot tell `name_key` order from binary order. The intent of the case (Cyrillic, mixed case, original spelling shown) is unchanged. |

## Review findings addressed (round 2+)
n/a (round 1)

## Checks
- npm run check: typecheck ok, lint ok, format ok ("All matched files use Prettier code style!"), coverage ok. `npm run format` changed no files.
- tests: `Test Files  6 passed (6)` / `Tests  97 passed (97)`, of which 17 are new (15 in profile.test.ts, 1 in profile.perf.test.ts, 1 in app.test.ts). Coverage: lines 97.65 %, branches 84.14 %, statements 96.62 %, functions 98.78 %. The new profile files are fully covered, so they do not appear in the report's per-file list.
- layer check: clean. All three greps print nothing.

## Guardrail events
- None. No migration (W3, Q2 answered "no"), no change to `src/recommendation/` (W5), no config change (W4). `npm run format` ran without a prompt.

## Known gaps / questions for the reviewer
- Directors are grouped by the exact string (D5, Q2). "Nolan" and "nolan" give two entries; this is intended for now.
- The OpenAPI test checks that the 200 response exists and has `genres` and `directors` properties. It does not deep-compare the whole schema.
- ADR-013 (the Preference Profile contract: order, rounding, director grouping, no parameters) still needs to be recorded in the vault by the orchestrator. Nothing was committed.
