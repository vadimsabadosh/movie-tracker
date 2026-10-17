# Implementation: Viewing Statistics (FR-8) (round 1)

## Plan steps
| Step | Status (done / changed / skipped) | Notes |
|---|---|---|
| 1. Schemas | done | `GenreCount`, `YearCount` and `ViewingStatistics` are defined as in D4, with `z.infer` types. I also added `StatsTotals = ViewingStatistics.pick({ watchedCount, averageRating })` and its inferred type, which is the option the plan offered. No types are written by hand. |
| 2. Repository | done | Three fixed SQL statements with no parameters, exactly the ones in the plan, each prepared once in the constructor. The header comment cites FR-8, NFR-1, NFR-3, ADR-008, ADR-009, ADR-010, ADR-011, D6 and D7. The string-building grep prints nothing. |
| 3. Service | done | `get()` returns `{ ...totals(), byGenre, byYear }` in that key order. The doc comment says the result is computed and never stored, explains D12 and NFR-5. No fastify, better-sqlite3 or db imports. |
| 4. Wiring | done | `stats: StatsService` is in `Services` and is built in `createServices`. The container test checks that `createServices(openDatabase(':memory:')).stats.get()` returns the empty statistics. |
| 5. Route | done | `GET /stats` with tag `stats` and a 200 response of `ViewingStatistics`. It is registered after `recommendationRoutes`. |
| 6. Tests | done | `test/stats.test.ts` (15 cases), `test/stats.perf.test.ts` (2 cases) and one OpenAPI case in `test/app.test.ts`. |
| 7. Checks | done | `npm run format`, then `npm run check` (exit 0), then the three layer greps, which print nothing. |

## Files changed
| File | Change |
|---|---|
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/schemas/stats.ts | new: Zod schemas and inferred types |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/stats-repository.ts | new: `StatsRepository` with `totals()`, `byGenre()`, `byYear()` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/services/stats-service.ts | new: `StatsService.get()` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/stats.ts | new: `statsRoutes`, which serves `GET /stats` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/container.ts | adds `stats` to `Services` and to `createServices` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/index.ts | registers `statsRoutes` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/stats.test.ts | new: functional tests for every row of the test plan |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/stats.perf.test.ts | new: NFR-1 timing plus sanity checks on the full catalog; second case uses `watchEvery: 3` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/app.test.ts | adds the OpenAPI check for `/stats` |

## Decisions beyond the plan
| Decision | Why |
|---|---|
| `YearCount.year` uses `.min(MIN_YEAR)`, imported from `schemas/movie.ts`, instead of the literal 1888 | Same value from a single source. There is still no upper bound, as the plan says. |
| `StatsTotals` is exported from `schemas/stats.ts` as a picked Zod schema | It is one of the two options the plan allowed. The repository types its statement with it. |
| `totals()` uses `this.totalsStmt.get()!` | An aggregate with no GROUP BY always returns exactly one row. The comment in the code says so. |
| `CATALOG_YEARS = 127` is a local constant in the perf test, and `test/helpers.ts` is unchanged | The plan allowed this and it keeps the diff smaller. The comment ties it to the `1900 + i % 127` formula. |
| The rating-change test also checks that the counts and both distributions are unchanged | The plan's case says "counts unchanged". I checked this by comparing the whole body to the earlier one, apart from `averageRating`. |
| The `watchEvery: 3` perf case also checks `sum(byYear) === watchedCount` | Cheap extra consistency check at scale. |

## Deviations from the plan
| Plan said | Did instead | Why |
|---|---|---|
| — | none | — |

## Review findings addressed (round 2+)
| Finding | Change / reply |
|---|---|
| n/a (round 1) | — |

## Checks
- `npm run check`: typecheck, lint, Prettier check and coverage all pass (exit 0).
- tests: `Test Files  11 passed (11)` and `Tests  144 passed (144)`, of which 18 are new (15 in `stats.test.ts`, 2 in `stats.perf.test.ts`, 1 in `app.test.ts`).
- coverage: statements 97.38 %, branches 86.31 %, functions 99.05 %, lines 98.15 %. The new stats files are fully covered; none appear in the uncovered rows of the coverage table.
- layer check: clean. All three greps from `new-module` step 5 print nothing.

## Guardrail events
- None. No migration (W3), no config files (W4), nothing in `src/recommendation/` (W5), no guardrail files (B6). `npm run format` ran without a prompt. Nothing was committed and nothing was written to the vault.

## Known gaps / questions for the reviewer
- Unknown query parameters such as `GET /stats?x=1` are ignored and the request succeeds, the same as on `/profile` (D11). This is tested, but there is no strict querystring schema, so the OpenAPI spec lists no parameters for `/stats`.
- For the orchestrator: ADR-015 (the Viewing Statistics contract) and the vault updates (`Viewing Statistics` gets `governed_by` ADR-015; the Services Layer and Routes Layer notes) are still to do, as the plan's Out of scope section says.
