# Review: Watch History (FR-4) (round 2)

## Verdict: APPROVE

## Checks (re-run by reviewer)
- **typecheck:** clean. `tsc --noEmit` printed nothing.
- **tests:** `Test Files  4 passed (4)` / `Tests  80 passed (80)`. The perf file also passes on its own (`test/watch-history.perf.test.ts`, 1 passed, about 0.4 s).
- **layer check** (`.claude/skills/new-module/SKILL.md` §5): all three greps print nothing.
  - No route imports from `../db` or `../repositories`.
  - No fastify, better-sqlite3 or db imports in `src/services`.
  - No `${` or `+ '` in `src/repositories/*.ts`.
- **Leftover mutation check** on `src/repositories/watch-repository.ts`:
  - I diffed the WHERE block of `HISTORY_PAGE_SQL` (l.33-40) against `HISTORY_COUNT_SQL` (l.58-65). They are identical.
  - All 7 comparisons have the intended direction: `>=` for `yearFrom`/`ratingMin`/`watchedFrom`, `<=` for `yearTo`/`ratingMax`/`watchedTo`.
  - `cmp` against the Coder's backup `/private/tmp/claude-501/-Users-koristuvac-Projects-LVET-----------------movie-tracker/d3320b04-0342-4549-8118-aa58afde5968/scratchpad/wr.bak` reports the files are identical.
  - No mutation is left.
- **Scope:** `git diff --stat` shows the same 7 files as round 1, plus the untracked perf test and `docs/orchestration/`. `git diff --stat` on `src/db`, `package.json`, `tsconfig.json` and `src/recommendation` is empty, so W3, W4, W5 and B6 were respected.
- **Not reproduced:** I did not re-run the Coder's mutation check. Reproducing it means editing a `src/` file, and the Reviewer role does not allow that. In round 1 the B6 hook blocked the scratch-copy route, so I did not try it again. Instead I confirmed by reading the code that every mutation the Coder reports would now fail a test:
  - `titles()` (`test/watches.test.ts:157-161`) asserts `total === items.length`.
  - These single-bound cases go through `titles()`: `yearFrom=2021` and `yearTo=1999` (l.~74-77), `ratingMax=5` (l.~82), and `watchedTo=2026-01-01` and `watchedFrom=2026-07-01` (l.~88-89).
  - `ratingMin` and `genre` keep their explicit `total` assertions (`total` 4 and 3).
  - So flipping any one comparison in the COUNT statement only would make `total` differ from the item count for at least one of these calls.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates (FR / ADR / guardrail / plan step) | Suggested fix |
|---|---|---|---|---|---|---|
| — | — | — | No blocker, major or minor findings in round 2 | — | — | — |

## Round-1 findings: resolution verified
| Finding | Status | Evidence |
|---|---|---|
| F1 (major) `total` unchecked for single-bound filters | Resolved | `titles()` now checks `total` on every call (l.159). That covers `yearFrom`, `yearTo`, `ratingMax`, `ratingMin=7&ratingMax=7`, `watchedFrom` together with `watchedTo`, lone `watchedTo`, the new lone `watchedFrom`, `genre=%20Adventure%20`, and all sort cases. The guard cannot pass by accident: the fixture has 6 rows, below the default limit of 20, and if the fixture ever outgrows the limit the assertion fails loudly. |
| F2 (minor) comment claims identity with nothing enforcing it | Resolved | `watch-repository.ts:24-26` now names the `titles()` total assertions in `test/watches.test.ts` as the drift guard. |
| F3 (minor) `console.log` in the perf test | Resolved | `test/watch-history.perf.test.ts:63` puts the p95 in the assertion message. No `console` calls remain. |

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 extend `GET /watches` in place | Yes | Unchanged since round 1. |
| D2 query params and bounds | Yes | Unchanged. |
| D3 cross-field refines, path on the upper bound | Yes | Unchanged. Tests check `/ratingMax`, `/yearTo` and `/watchedTo`. |
| D4 genre via `EXISTS` and `name_key` | Yes | Unchanged. |
| D5 sort, tie-breakers, per-sort default order | Changed (justified, accepted in round 1) | Bound `@sort`/`@order` with CASE terms. No SQL is concatenated. |
| D6/D7 embedded movie, shared `genresByMovie` | Yes | Unchanged. |
| D8/Q6 no migration | Yes | `src/db/**` untouched. |
| D9 perf test | Yes | Passes. The p95 is now in the assertion message. |
| D10 one shared WHERE | Changed (justified). The mitigation is now real | Two literal statements with identical WHERE blocks. Drift is caught by the per-filter `total` checks (F1). |
| D11 single genre | Yes | |
| Steps 1–9 | Yes | Round 2 touched only tests, a comment and the perf assertion message. |
| Test plan | Yes | Every row is covered, including `total` for every filter type. |

## Context check
- **D10's reason** ("`total` can never disagree with the filters") was lost in round 1. It is now restored by a test-level guard instead of a shared constant. The guard covers every filter dimension and checks behaviour (the response's `total` against its items), not implementation. The Coder kept the two-statement shape for the reason I gave in round 1: option (a) was the smaller change.
- **D5's reasons** (no user text in SQL; stable paging) still hold. Nothing in round 2 changed the ORDER BY.
- **Nothing new in round 2.** I found no other behaviour change, no new files beyond those already reviewed, and no guardrail-relevant edits.

## Good
- The fix sits in the shared `titles()` helper, so any future `titles(...)` filter test gets the drift guard automatically.
- The Coder ran the mutation check that round 1 could not run. They restored the file from a backup and stated how to verify the restore. I confirmed the restore with `cmp`.
- The perf assertion message now carries the measured number exactly where it matters, which is when the test fails.
- All round-1 strengths remain:
  - All filters use bound parameters and the layer greps are clean.
  - The genre filter uses `name_key`/`textKey` (ADR-008).
  - Item types are derived from Zod (ADR-004).
  - The OpenAPI test checks the exact set of 11 parameters.
  - The perf test is deterministic.

## ADR candidates (for record-adr)
- **Watch History query contract (FR-4):** parameter names `genre`, `yearFrom`/`yearTo`, `ratingMin`/`ratingMax`, `watchedFrom`/`watchedTo`, `sort` (`watchedAt|rating|year|title`) and `order`. Ranges are inclusive. An inverted range returns 400 with the path on the upper bound. Default order depends on the sort: title asc, all others desc. The ADR should also record the tie-break chains, the single-genre rule and the movie embedded in each item.
- **Dynamic ORDER BY without SQL assembly (NFR-3):** the sort field and direction come from a closed Zod enum. They are bound as parameters and picked by `CASE` terms in one fixed statement. The accepted cost is that sorting cannot use an index, which was measured as fine up to the NFR-1 bound of 10k rows. Revisit if that bound grows.
- **Page and COUNT statements without a shared fragment:** the WHERE block is written out twice in two literal statements. Drift is guarded by tests that assert `total` per filter. The rejected alternatives were concatenating a shared constant (forbidden by NFR-3 and SKILL §5) and a single CTE with a LEFT JOIN. This could be folded into the previous ADR.
- **Shared repository helpers:** `genresByMovie` is exported from `movie-repository.ts` and used by another repository. ADR-001 allows this but does not say so explicitly. It would fit as a short addendum to ADR-001.
