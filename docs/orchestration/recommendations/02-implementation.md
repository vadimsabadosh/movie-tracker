# Implementation: Recommendations (FR-7) (round 1)

## Plan steps
| Step | Status | Notes |
|---|---|---|
| 1 Schemas | done | `RecommendationReason`, `Recommendation`, `RecommendationQuery` (`PaginationQuery.pick({ limit: true })`), `RecommendationList`, with `.describe()` texts for order and points. Types come from `z.infer` |
| 2 Recommender interface (W5) | done | Written once, complete. Uses `import type` only and exports only `interface Recommender` (D1) |
| 3 Base recommender (W5) | done | Written once, complete. Exports `NEUTRAL_RATING`, `GENRE_WEIGHT`, `DIRECTOR_WEIGHT`, `round2`, `affinity` and `ProfileScoreRecommender`. Imports only schema types and the interface. It follows D3–D8: score > 0 filter on the rounded score, sort by rounded score desc then id, stable reason sort by unrounded points |
| 4 Repository | done | `MovieRepository.listUnwatched()`: one literal statement as in D10, plus `withGenres` |
| 5 Service | done | `RecommendationService(profile, movies, recommender).recommend({ limit })` (D11) |
| 6 Route | done | `GET /recommendations`, tag `recommendations`, querystring `RecommendationQuery`, 200 `RecommendationList`, 400 `ErrorResponse` |
| 7 Wiring | done | `createServices(db, today?, recommender = new ProfileScoreRecommender())`. One shared `ProfileService`. `Services.recommendations` added. One line added to `routes/index.ts`. `buildApp` unchanged |
| 8 Test helper | done | `seedCatalog(db, { watchEvery = 1 } = {})`. By default every movie is still watched, so the existing perf tests are unchanged |
| 9 Tests | done | Every case in the plan's test plan has a test (see Checks) |
| 10 Verify | done | format, check and greps are clean |

## Files changed
| File | Change |
|---|---|
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/schemas/recommendation.ts | new |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/recommendation/recommender.ts | new (W5) |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/recommendation/profile-score-recommender.ts | new (W5) |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/movie-repository.ts | + `listUnwatched()` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/services/recommendation-service.ts | new |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/recommendations.ts | new |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/index.ts | + import and one registration line |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/container.ts | shared ProfileService, `recommendations`, optional `recommender` param |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/helpers.ts | `watchEvery` option on `seedCatalog` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/app.test.ts | + OpenAPI test for `/recommendations` (only the `limit` query param; item keys `explanation, movie, reasons, score`) |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/recommender.test.ts | new: pure tests with no DB |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/recommendations.test.ts | new: black-box tests and the stub swap test |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/recommendations.perf.test.ts | new: NFR-1 p95 test |

## Decisions beyond the plan
| Decision | Why |
|---|---|
| `round2` is exported from the recommender file | The pure tests pin the rounding, including negatives (−2/3 → −0.67) |
| Added a pure test where the director and a genre have equal unrounded points (both 2.0) | Proves the "director before genre" tie rule from D7, which the fixture does not exercise |
| Perf sanity also asserts every returned id is not a multiple of 3 (all of those are watched) | Cheap check that watched movies stay excluded at scale |
| In `recommendations.test.ts`, titles come from a per-app counter (`WeakMap<FastifyInstance, number>`) | A global counter gave different titles in the two apps of the NFR-5 test, so the bodies differed for a fixture reason, not a real one. A fixed title per index collided with the title+year uniqueness rule (409) when a test seeded extra movies |

## Deviations from the plan
| Plan said | Did instead | Why |
|---|---|---|
| — | none | — |

## Review findings addressed (round 2+)
| Finding | Change / reply |
|---|---|
| n/a (round 1) | |

## Checks
- npm run check: typecheck ok / lint ok / format ok / coverage ok (exit 0)
- tests: `Test Files 9 passed (9)`, `Tests 126 passed (126)`, of which 29 are new (baseline 97 unchanged). Coverage: lines 98.02 % / branches 86.31 % (statements 97.21 %, functions 98.97 %). Both `src/recommendation/` files are 100 %: the report hides fully covered files, and neither appears in it
- Fixture results match the plan: ids `[10, 12, 11, 16, 17, 13]`, scores `[9.4, 2.4, 2.33, 2.33, 2.25, 1.73]`. The explanations for 10 and 13 match the plan strings exactly. The perf test passes under 200 ms p95 with 6 667 candidates and limit=100
- layer check: clean. The routes, services and repositories greps print nothing, and `src/recommendation/` has no db, repositories, services, fastify or sqlite imports

## Guardrail events
- W5: `src/recommendation/recommender.ts` and `src/recommendation/profile-score-recommender.ts` were each written once, in one complete Write. Both Writes succeeded and neither file was edited afterwards. `npm run format` left both files unchanged (Prettier check is clean)
- W3 / W4 / B6: not touched. No migration, config or dependency changes
- No commits and no vault writes

## Known gaps / questions for the reviewer
- `round2` uses `Math.round(x * 100) / 100`, so in rare float cases such as x.xx5 the half-up result depends on the binary representation. It is still deterministic (NFR-5), but documented decimal rounding could differ by 0.01 in such cases
- A reason whose rounded points are −0 would show as `(+0.00)`. This only happens when the average is exactly 5.5, which gives exactly 0, so `+0.00` is correct
- The ADR-014 "Recommendation Score Formula" record and the `Recommender` vault note status update remain the orchestrator's job (W6)
