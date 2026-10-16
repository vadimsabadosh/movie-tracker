# Implementation: Watch History (FR-4) (round 2)

## Plan steps
| Step | Status (done / changed / skipped) | Notes |
|---|---|---|
| 1. Shared genre loader | done | Same as round 1. No change |
| 2. Schemas | done | Same as round 1. No change |
| 3. Repository | changed | Same as round 1: two fixed literal statements with bound `@sort`/`@order` CASE ORDER BY and no concatenation. Round 2 changes only the comment (F2). The D10 safety net now comes from the tests (F1) |
| 4. Service | done | No change |
| 5. Routes | done | No change |
| 6. Functional tests | done | `titles()` now also checks `total === items.length` on every call (F1). Added a check for `watchedFrom` on its own |
| 7. OpenAPI test | done | No change |
| 8. Perf test | done | The p95 number is now in the assertion message instead of `console.log` (F3) |
| 9. Verify | done | See Checks. Also ran a mutation check on the COUNT WHERE (see F1) |

## Files changed
| File | Change |
|---|---|
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/watches.test.ts` | Round 2: the `titles()` helper checks `expect(page.total, \`total for "${qs}"\`).toBe(page.items.length)`. Every fixture result fits on one default page (6 rows, limit 20). New assertion `titles('watchedFrom=2026-07-01')` → `['Мавка']` |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/watch-repository.ts` | Round 2: comment only. It now points at the per-filter `total` assertions in `test/watches.test.ts` as the guard against drift |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/watch-history.perf.test.ts` | Round 2: removed `console.log`. The p95 goes in the message: `expect(p95, \`GET /watches p95 = … ms over … requests\`).toBeLessThan(200)` |
| (unchanged since round 1) `src/repositories/movie-repository.ts`, `src/schemas/watch.ts`, `src/services/watch-service.ts`, `src/routes/watches.ts`, `test/app.test.ts` | See round-1 notes |

## Decisions beyond the plan
| Decision | Why |
|---|---|
| The `total` check lives in the shared `titles()` helper, not in separate assertions | Every current and future `titles(...)` call in the FR-4 block checks the COUNT statement against the page statement for that exact filter. A new filter test gets the guard automatically |
| Kept the round-1 shape (two fixed statements). Did not switch to the single CTE + LEFT JOIN | The Reviewer preferred option (a). It is the smaller change, and the mutation check below shows it detects drift |

## Deviations from the plan
| Plan said | Did instead | Why |
|---|---|---|
| D5/D10/step 3: concatenate `HISTORY_FROM + HISTORY_WHERE + ORDER_BY[sort][order]` | Two fixed literal statements with bound-param CASE ORDER BY (unchanged from round 1) | Same reason as round 1: NFR-3 forbids concatenation, "not even for ORDER BY". The Reviewer accepted this deviation. The missing mitigation is now in place (F1) |

## Review findings addressed (round 2+)
| Finding | Change / reply |
|---|---|
| F1 (major): the tests did not guard D10 (`total` unchecked for single-bound filters) | Applied option (a). `titles()` now asserts `total === items.length`, so `total` is checked for `yearFrom`, `yearTo`, `ratingMax`, `ratingMin=7&ratingMax=7`, `watchedFrom`+`watchedTo`, `watchedTo`, the new lone `watchedFrom`, the genre `%20Adventure%20` case, and all sort cases. **Mutation check, which the Reviewer could not run:** in the working copy (A2) I flipped one comparison in `HISTORY_COUNT_SQL` only, ran `test/watches.test.ts`, and restored the file from a scratchpad backup each time (`cmp` confirmed it was identical afterwards). Each mutation (`m.year <= @yearTo`, `w.rating <= @ratingMax`, `w.watched_at <= @watchedTo`, `m.year >= @yearFrom`, `w.watched_at >= @watchedFrom`) gave `Tests 1 failed \| 53 passed (54)`. Drift is now detected |
| F2 (minor): the comment claims the statements stay identical with nothing enforcing it | The comment now reads: "Drift is caught by the per-filter total assertions in test/watches.test.ts ('watch history (FR-4)': the titles() helper checks total)." |
| F3 (minor): `console.log` noise in the perf test | Removed. The p95 value is now the assertion's custom message, so it shows up if the assertion fails |

## Checks
- typecheck: clean (`tsc --noEmit`, no output)
- tests: 80 passed (35 new vs. the baseline of 45; round 2 strengthened existing tests and added no new `it`): `Test Files  4 passed (4)` / `Tests  80 passed (80)`
- layer check: clean. All three greps from `SKILL.md` §5 (routes, services, repositories `\$\{|\+ *['"]`) print nothing

## Guardrail events
- None. No W3/W4/W5/B6 files touched, no denied calls. The mutation check edited only `src/repositories/watch-repository.ts` (A2), and the file was restored byte-for-byte. The backup is at `/private/tmp/claude-501/-Users-koristuvac-Projects-LVET-----------------movie-tracker/d3320b04-0342-4549-8118-aa58afde5968/scratchpad/wr.bak`.

## Known gaps / questions for the reviewer
- The `titles()` guard relies on every fixture result fitting on one page. If the fixture grows past 20 rows, the helper's assertion fails loudly, so the guard cannot pass by accident.
- CASE ORDER BY can't use an index for sorting beyond the NFR-1 bound of 10k rows. Title sorting by binary `title_key` (і/ї/є/ґ) is existing behaviour. Both are unchanged from round 1 and belong in the ADR candidates.
