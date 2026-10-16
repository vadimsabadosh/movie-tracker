# Review: Watch History (FR-4) (round 1)

## Verdict: CHANGES_REQUESTED

## Checks (re-run by reviewer)
- typecheck: clean (`tsc --noEmit`, no output)
- tests: `Test Files  4 passed (4)` / `Tests  80 passed (80)`. The perf file passes on its own as well (`test/watch-history.perf.test.ts`, 1 passed). Vitest swallowed the console.log, so I did not see the p95 number myself.
- layer check (`.claude/skills/new-module/SKILL.md` §5): all three greps print nothing. There are no route→repo/db imports, no fastify/sqlite/db imports in services, and no `${` or `+ '` in `src/repositories/*.ts`.
- Scope: `git status` shows only the 5 planned `src/` files and 2 test files modified, plus the new perf test and `docs/orchestration/`. `src/db/**`, `package.json`, the configs and `src/recommendation/**` are untouched (W3/W4/W5/B6 respected).
- Not done: I tried a mutation test on a scratch copy (flip the COUNT WHERE bounds and see whether the tests notice). The B6 hook blocked it and I did not work around it. F1 is therefore based on reading the test file line by line, not on running the mutation.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates (FR / ADR / guardrail / plan step) | Suggested fix |
|---|---|---|---|---|---|---|
| F1 | major | `src/repositories/watch-repository.ts:29-65` (two copies of the WHERE); `test/watches.test.ts:189-205` | The Coder dropped D10's shared WHERE constant. The stated safety net is: "The tests check `total` against filtered counts for every filter type… so a drift between the two would be caught". That is not true. `total` is asserted only for `genre`, `ratingMin`, the combined `genre+yearFrom+ratingMin+watchedFrom` case, and pagination/offset with `ratingMin`. The tests for `yearTo` (l.189-194), `ratingMax` (l.196-200) and `watchedTo` (l.202-205) use `titles()` only and never look at `total`. Example: if someone changes `m.year <= @yearTo` to `>=` in `HISTORY_COUNT_SQL` only, `GET /watches?yearTo=1999` still returns `['eXistenZ','Тіні забутих предків']`. `total` silently becomes 5 instead of 2, and every test stays green. | Read from the test bodies: `titles(...)` returns only `items[].movie.title`. The only `total` assertions are on lines with `sciFi.total`, `drama.total`, `(await history('ratingMin=8')).total`, the combined test and the two pagination tests. | Plan D10's why ("one constant… `total` can never disagree with the filters") is lost and nothing replaces it. Also the plan test plan row "total = filtered count". | Pick one. (a) Cheapest: assert `total` for every filter case, at least `yearFrom`, `yearTo`, `ratingMax`, `watchedFrom`, `watchedTo` alone. For example, change `titles()` to also check `total === items.length` when `limit` is not hit, or use `history()` and check both fields. (b) Or remove the duplication with no concatenation: a single statement `WITH f AS (SELECT … WHERE …) SELECT c.total, p.* FROM (SELECT COUNT(*) AS total FROM f) c LEFT JOIN (SELECT … FROM f ORDER BY … LIMIT @limit OFFSET @offset) p ON 1` (the LEFT JOIN keeps `total` when the page is empty). I prefer (a) plus keeping today's shape. It is the smaller change, and the WHERE then has real drift detection. |
| F2 | minor | `src/repositories/watch-repository.ts:24-28` (comment) | The comment says the two statements "keep the WHERE clauses identical", but nothing enforces it. After F1 is fixed, point the comment at the tests that guard it, so a future editor knows where the safety net is. | — | Maintainability (D10) | Add "guarded by the per-filter `total` assertions in `test/watches.test.ts`". |
| F3 | minor | `test/watch-history.perf.test.ts:63` | `console.log` in a test is noise in normal runs. Vitest also suppressed it in my run, so it does not actually "show up for the record" as the notes claim. | Running the perf file alone printed no p95 line. | — | Optional. Keep it but don't rely on it as evidence, or put the number in the assertion message, e.g. `expect(p95, \`p95=${p95}\`).toBeLessThan(200)`. |

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 extend `GET /watches` in place | Yes | Route declaration unchanged; only the header comment changed. |
| D2 query params and bounds | Yes | Reuses `MIN_YEAR`/`maxYear()`, Rating 1–10, genre trim 1–50, `z.iso.date()`, `sort` default `watchedAt`, `order` optional. |
| D3 cross-field refines, path on the upper bound | Yes | One `inverted()` helper. Tests check `details[0].path` = `/ratingMax`, `/yearTo`, `/watchedTo`. |
| D4 genre via `EXISTS` and `name_key = textKey(genre)` | Yes | Covers the Cyrillic `ДРАМА`, multi-genre no-duplication and unknown-genre cases. |
| D5 sort map and tie-breakers, per-sort default order | Changed (justified) | Bound `@sort`/`@order` with CASE terms instead of `ORDER_BY[sort][order]` concatenation. The tie-break chains match D5 exactly: watchedAt → movie_id; rating/year → watched_at DESC, movie_id; title → year ASC, movie_id. Default order is resolved in the service. Accepted, see Context check. |
| D6/Q1 embed `movie` in items | Yes | `WatchHistoryItem = WatchEntry.extend({ movie: Movie })`, so ADR-004 holds (one source of truth). |
| D7 shared `genresByMovie` | Yes | Same SQL and same `name_key` order. The O(n) grouping is a harmless improvement. `test/movies.test.ts` passes unchanged. |
| D8/Q6 no migration | Yes | `src/db/migrations.ts` untouched. |
| D9 perf test | Yes | 10k movies/watches, deterministic, one transaction, 60 requests, `Math.ceil(0.95n)-1`, 30 s timeout, plus sanity totals. |
| D10 one shared WHERE constant | Changed. The deviation is justified, but its mitigation is not real | See F1. |
| D11 single genre | Yes | |
| Steps 1–8 | Yes | |
| Step 9 "grep hits explained" | Changed (correctly) | Step 9 wanted to "explain away" grep hits. SKILL §5 says hits "must be fixed, not explained away", and the Coder's NFR-3 rule forbids concatenation "not even for ORDER BY". The Coder resolved this in favour of the guardrail, which is right. |
| Test plan | Mostly | Every row has a test. The gap is F1: `total` is unverified for the single-bound `yearTo`/`ratingMax`/`watchedTo`/`watchedFrom`/`yearFrom` filters. |

## Context check
- **Answer to the Coder's first question (the duplicated WHERE versus NFR-3).** Choosing fixed literal statements over concatenation is right, and it does not violate NFR-3. The plan itself conflicted with the Coder rule ("no concatenation, not even for ORDER BY") and with SKILL §5, and the guardrail wins. The trade-off is acceptable on one condition: D10's reason ("`total` can never disagree with the filters") must be protected some other way. The notes claim the tests protect it, but they do not (F1). Either strengthen the tests (preferred) or switch to the single CTE + LEFT JOIN statement suggested in F1. With the current tests the reason is lost.
- **CASE-based ORDER BY versus D5's "unreadable, defeats indexes".** Both parts of the plan's reason were weighed. Readability: the 8-row CASE table plus 3 tie-break lines is readable and keeps all user input in bound parameters. If `WatchSort` ever loosened, an unknown value would only fall back to `movie_id` order, never inject SQL, which is safer than the plan's map. Index cost: measured, with the Coder reporting p95 6.6 ms against 200 ms and the perf test passing in my run. NFR-1 caps the catalog at 10k, so the reason no longer applies within scope. The Coder's note about the temp B-tree beyond 10k is accurate and belongs in the ADR.
- **The Coder's other notes.** Title sorting by binary `title_key` (і/ї/є/ґ after the rest of Cyrillic) is existing ADR-008 behaviour, so no finding. Trimming the genre before `textKey` matches `MovieInput`, which also trims genres, so `%20Adventure%20` matching is correct.
- D6/D7 (the service does no in-memory merging, no N+1) and D4 (EXISTS, so no DISTINCT is needed) are implemented exactly for their stated reasons.

## Good
- No SQL text is built anywhere. All filters are `@p IS NULL OR …` with named parameters, and the three layer greps are fully clean.
- The genre filter uses `name_key`/`textKey` (ADR-008). It never uses LIKE or NOCASE.
- The fixture is chosen well: `Драма`/`драма` spellings, `eXistenZ` for case-insensitive title sorting, same-day entries to test the `movie_id` tie-break, and a 2-genre movie to show no duplication.
- The OpenAPI test checks the exact set of 11 query parameter names (NFR-6).
- The perf test is deterministic, fast (about 0.3 s) and sanity-checks the seeded totals, so a broken filter cannot make it pass by returning nothing.
- The existing `GET /watches` test is unchanged and passes. The response change only adds a field.

## ADR candidates (for record-adr)
- **Watch History query contract (FR-4):** param names `genre`, `yearFrom`/`yearTo`, `ratingMin`/`ratingMax`, `watchedFrom`/`watchedTo`, `sort` (`watchedAt|rating|year|title`), `order`; inclusive ranges; inverted range → 400 on the upper-bound path; per-sort default order (title asc, others desc); tie-break chains; single genre; movie embedded in each item.
- **Dynamic ORDER BY without SQL assembly (NFR-3):** the sort field and direction come from a closed Zod enum, are bound as parameters and picked by `CASE` terms in one fixed statement. The accepted cost is no index use for sorting, measured as fine up to the NFR-1 bound of 10k. Revisit if the catalog bound grows. This sets a project-wide convention that overrides the plan's "constant map + concatenation" idea and makes SKILL §5 concrete.
- **Shared repository helpers:** `genresByMovie` is exported from `movie-repository.ts` and used by another repository. ADR-001 allows it but does not say so explicitly. This could be a short addendum rather than a new ADR.
