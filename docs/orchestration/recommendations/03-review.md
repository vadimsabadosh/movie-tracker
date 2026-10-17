# Review: Recommendations (FR-7) (round 1)

## Verdict: APPROVE

I found no blockers and no major findings. Both W5 files implement the plan's D3–D8 formula and tie rules exactly as the human approved them. I checked this with my own hand calculation, not only with the Coder's tests.

## Checks (re-run by reviewer)
- **npm run check:** exit 0. Typecheck ok, ESLint ok, Prettier check ok ("All matched files use Prettier code style!"), and coverage is above the floor.
- **tests:** `Test Files 9 passed (9)`, `Tests 126 passed (126)`. The baseline was 97, so 29 tests are new.
- **coverage:** Statements 97.21 %, Branches 86.31 %, Functions 98.97 %, Lines 98.02 %.
  - The report hides fully covered files.
  - `src/recommendation/*`, `src/services/recommendation-service.ts`, `src/routes/recommendations.ts` and `src/schemas/recommendation.ts` are absent from it, so they are at 100 %.
- **layer check (new-module step 5):**
  - The routes grep, the services grep and the repositories grep (`${` / `+ '`) all print nothing.
  - An extra grep for db, repositories, services, fastify or better-sqlite3 imports in `src/recommendation/*.ts` also prints nothing.
- **Guardrail files:** `git diff --stat HEAD -- src/db package.json` is empty. `git status` shows no changes to migrations, `package.json`, `vitest.config.ts`, ESLint, Prettier or tsconfig configs, `docs/guardrails.md`, `harness/**` or `.claude/settings*`. W3, W4 and B6 were not touched.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates | Suggested fix |
|---|---|---|---|---|---|---|
| m1 | minor | src/recommendation/profile-score-recommender.ts:21,40 | `round2` uses `Math.round`, which rounds halves toward +∞. Points that round to `-0` are therefore shown as `(+0.00)`. This happens for small negative values such as a genre with count 1 and average 5.49 (−0.005 → −0), not only at an average of exactly 5.5 as the handoff says. Halves are also asymmetric: `round2(-0.665) = -0.66`, while `round2(2.675) = 2.68`. | I checked with node: `r(-0.665)` → `-0.66`. `-0 >= 0` is true, so the sign is `+`. JSON serializes `-0` as `0`. | none. The result is deterministic (NFR-5), and the text matches the value. | No code change needed. Mention half-up toward +∞ when the formula is recorded as an ADR. Fixing it would be a W5 change, and it is not worth one. |
| m2 | minor | test/recommendations.test.ts:159 | Only invalid limits are tested. The boundaries `limit=1` and `limit=100` are not tested as accepted. | — | Not in the plan's test plan (skill: boundary values) | Optional: add `it.each(['1','100'])` → 200. |
| m3 | minor | docs/orchestration/recommendations/02-implementation.md, "Known gaps" | The claim "−0 only happens when the average is exactly 5.5" is inaccurate (see m1). | — | — | Correct the note. |

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 interface | yes | `recommender.ts:8-11` matches the vault signature exactly, with `import type` only |
| D2 constants, `affinity`, no infra imports | yes | `round2` is also exported. This is a justified addition (pure tests pin the rounding). |
| D3 formula | yes | `affinity = count*(avg-5.5)/(count+1)`. Score = round2 of the unrounded weighted sum, with director plus genres in the movie's genre order. My hand check for movie 10: 2·(2·3.5/3)=4.6667, plus 2.4, plus 2.3333, gives 9.40. For movie 13: 2.4 − 0.6667 = 1.73. For movie 14: −1.75 − 3.5 = −5.25. All match Q1. |
| D4 matching | yes | Genres match by `genres.name`, so `sci-fi` becomes `Sci-Fi` (tested). Directors match by the exact string, so `nolan` gets no reason (tested). |
| D5 score > 0 | yes | The filter is on the rounded score (`:57-58`), which agrees with `z.number().positive()` in the schema. |
| D6 order | yes | `:64` sorts by rounded score desc, then by id asc, then slices. The 11/16 tie is tested. |
| D7 reasons | yes | Director is pushed first, then genres in movie order, then a stable sort by unrounded points. Reason points are `round2(weight×affinity)`. Negative reasons are kept. The director-first tie is tested with exact 2.0/2.0 points. |
| D8 explanation | yes | The template matches character for character, and both plan strings (movies 10 and 13) are asserted. |
| D9 response/query | yes | `{ items }`, `PaginationQuery.pick({limit})`, no offset. OpenAPI test confirms `limit` is the only query param. |
| D10 `listUnwatched` | yes | Literal SQL as in the plan, plus `withGenres` |
| D11 service | yes | — |
| D12 composition root | yes | One `ProfileService` is shared. The default is `new ProfileScoreRecommender()`. `buildApp` is unchanged. |
| D13 rounded profile input | yes | — |
| Step 8 `seedCatalog` `watchEvery` | yes | The default of 1 keeps the existing perf tests unchanged. |
| Test plan | yes | Every row is covered. The perf test has p95 < 200 ms with 6 667 candidates, plus extra sanity checks. |

## Context check
The Coder followed the plan's reasons throughout. In particular:
- **Sorting:** sorting happens on the returned rounded score, so visually equal scores never tie-break on hidden float noise (D6's reason).
- **Positive-score filter:** the `score > 0` filter uses the same rounded value that the schema validates.
- **Explanation:** the explanation is built from the exact `reasons` array that is returned (ADR-003: "the same components as the score").
- **Director matching:** directors are matched case-sensitively, consistent with ADR-013, and the plan's reason is quoted in the header comment.
- **Decisions beyond the plan:** the per-app title counter in the test fixture is justified. It avoids an NFR-5 test that would fail because of the fixture rather than the code.

I found no place where a decision's reason was lost.

## Good
- The W5 files are small and pure, and each was written once. The header comment states the full formula, the tie rules and the ADR links.
- The swap test proves the ADR-003 seam through the composition root. It checks the profile, the candidates and their id order, and the limit.
- The fixture expectations were computed independently in the plan and are asserted in two layers: the pure recommender and HTTP black-box tests.
- The perf test also checks that watched movies are excluded at scale and that scores are non-increasing.

## ADR candidates (for record-adr)
- **ADR-014 Recommendation Score Formula** (refines ADR-003). It should record:
  - shrunk affinity `count×(avg−5.5)/(count+1)`;
  - weights genre 1, director 2;
  - score = round2 of the unrounded sum, with `Math.round` half toward +∞;
  - only score > 0 is returned;
  - order: rounded score desc, then movie id asc;
  - reason order: points desc, then director before genre, then the movie's genre order;
  - the English explanation template.
- A possible note or addition to ADR-013's consequences: recommendations inherit case-sensitive director matching, so `director_key` would be needed if this changes.
- Vault update: `Recommender` status should change from `planned` to implemented, with source files `src/recommendation/recommender.ts` and `profile-score-recommender.ts`.

Files reviewed:
- src/recommendation/recommender.ts
- src/recommendation/profile-score-recommender.ts
- src/schemas/recommendation.ts
- src/services/recommendation-service.ts
- src/routes/recommendations.ts
- src/repositories/movie-repository.ts
- src/container.ts
- src/routes/index.ts
- test/recommender.test.ts
- test/recommendations.test.ts
- test/recommendations.perf.test.ts
- test/helpers.ts
- test/app.test.ts
