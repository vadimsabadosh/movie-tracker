# Implementation: Watch History (FR-4) (round 1)

## Plan steps
| Step | Status (done / changed / skipped) | Notes |
|---|---|---|
| 1. Shared genre loader | done | `export function genresByMovie(db, movieIds): Map<number, string[]>` in `src/repositories/movie-repository.ts`. Same `json_each` SQL, same `ORDER BY g.name_key`, returns an empty Map for `[]`. Private `withGenres` now uses it. `test/movies.test.ts` passes unchanged |
| 2. Schemas | done | `WatchSort`, `SortOrder`, extended `WatchListQuery` (D2) with the three `.refine`s (D3; paths `yearTo`/`ratingMax`/`watchedTo`), `WatchHistoryItem = WatchEntry.extend({ movie: Movie })`, `WatchPage = page(WatchHistoryItem)`. One small helper `inverted(from, to)` handles all three refines |
| 3. Repository | changed | Filters, `@p IS NULL OR …` params, EXISTS genre filter, JOIN movies, filtered COUNT and per-page `genresByMovie` are all as planned. **No SQL concatenation**: the plan's `HISTORY_FROM + HISTORY_WHERE + ORDER_BY[sort][order]` became two fixed literal statements (`HISTORY_PAGE_SQL`, `HISTORY_COUNT_SQL`). Sort field and direction are bound as `@sort`/`@order` and picked by `CASE` terms in ORDER BY. See Deviations |
| 4. Service | done | `order = query.order ?? (query.sort === 'title' ? 'asc' : 'desc')`, then `this.watches.list({ ...query, order })`. Still echoes `limit`/`offset` |
| 5. Routes | done | Only the header comment changed (mentions FR-4). The route declaration is unchanged. OpenAPI lists all 11 query params (covered by the test in step 7) |
| 6. Functional tests | done | New `describe('watch history (FR-4)')` in `test/watches.test.ts`: 6 watched movies (Dune + 5 fixture movies, including Cyrillic titles and the genre spellings `Драма`/`драма`, and `eXistenZ` to show case-insensitive title sorting). Covers every row of the test plan. The existing `GET /watches` test is unchanged and passes |
| 7. OpenAPI test | done | `test/app.test.ts` checks that the `in: query` parameter names of `/watches` GET are exactly the 11 expected names |
| 8. Perf test | done | `test/watch-history.perf.test.ts`: 10 000 movies, 20 genres, 3 genres per movie, 10 000 watches, all deterministic and seeded in one transaction. Runs 60 requests across 6 URL shapes (none, all filters, `sort=title&order=desc&offset=9000`, genre+rating+period, `sort=rating&offset=5000`, `order=asc&offset=9980`). Includes sanity asserts on `total`. **p95 = 6.6 ms**. The file runs in about 0.3 s, with a 30 s timeout |
| 9. Verify | done | See Checks |

## Files changed
| File | Change |
|---|---|
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/movie-repository.ts` | Extracted exported `genresByMovie()`; `withGenres` delegates to it |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/schemas/watch.ts` | `WatchSort`, `SortOrder`, extended `WatchListQuery` with refines, `WatchHistoryItem`, `WatchPage` now pages `WatchHistoryItem` |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/watch-repository.ts` | New `WatchHistoryQuery` type, `HISTORY_PAGE_SQL` / `HISTORY_COUNT_SQL` fixed statements, rewritten `list()` returning items with embedded movie |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/services/watch-service.ts` | `list()` resolves the per-sort default order |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/watches.ts` | Header comment only |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/watches.test.ts` | New FR-4 describe block (14 tests + 16 + 3 parameterized cases) |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/app.test.ts` | OpenAPI query-param test (NFR-6) |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/watch-history.perf.test.ts` | New NFR-1 perf test |

## Decisions beyond the plan
| Decision | Why |
|---|---|
| Tie-breakers are also chosen by bound-param `CASE` terms: `CASE WHEN @sort IN ('rating','year') THEN w.watched_at END DESC`, `CASE WHEN @sort='title' THEN m.year END ASC`, then always `w.movie_id ASC` | Gives the exact D5 tie-break chains in one fixed statement. For a non-matching sort, a `CASE` yields NULL for every row, so it has no effect on the order |
| Absent filters are bound as `null` through one `filters` object. The page query gets `{...filters, sort, order, limit, offset}` and the count query gets `filters` only | better-sqlite3 rejects unused named params. One shared object keeps the two statements' params in sync |
| `genresByMovie` groups rows into a Map in one pass instead of the old `links.filter` per row | Behaviour is the same (order by `name_key` is preserved). It is O(n) instead of O(n·m) |
| Perf test seeds with explicit ids and prints the p95 via `console.log` | Deterministic data, and the measured number shows up in verbose output for the record |

## Deviations from the plan
| Plan said | Did instead | Why |
|---|---|---|
| D5/D10/step 3: build the page and count SQL by concatenating `HISTORY_FROM + HISTORY_WHERE + ' ORDER BY ' + ORDER_BY[sort][order]`, and accept the resulting repository grep hits as "constant-only concatenation" | Two complete literal statements with no concatenation. ORDER BY uses 8 `CASE WHEN @sort=… AND @order=… THEN <col> END ASC|DESC` terms, with `@sort`/`@order` bound from the Zod enums. The WHERE block is written out in both statements, next to a comment that they must stay identical | My role rules (NFR-3) say: "Never build SQL from template strings or concatenation, not even for ORDER BY. Choose between fixed statements instead." `SKILL.md` §5 also says each grep hit "must be fixed, not explained away." The plan rejected CASE for readability and index use. The perf test shows the index cost doesn't matter here (p95 6.6 ms on 10k rows, against a 200 ms budget). The alternative of 8 full fixed statements would copy the WHERE 8 times. The cost of this choice is the WHERE text duplicated across the page and count statements, the same pattern `MovieRepository.list` already uses. The tests check `total` against filtered counts for every filter type (including offset past the end), so a drift between the two would be caught |

## Review findings addressed (round 2+)
| Finding | Change / reply |
|---|---|
| n/a (round 1) | |

## Checks
- typecheck: clean (`tsc --noEmit`, no output)
- tests: 80 passed (35 new), `Test Files  4 passed (4)` / `Tests  80 passed (80)`. The baseline was 45. New: 33 in `watches.test.ts`, 1 in `app.test.ts`, 1 perf test. Perf: `GET /watches p95 = 6.6 ms over 60 requests`
- layer check: clean. All three greps from `SKILL.md` §5 (routes, services, repositories) print nothing

## Guardrail events
- None. No W3/W4/W5/B6 files touched, no denied calls. `src/db/migrations.ts` is unchanged (D8/Q6: the perf test passes, so no index was needed).

## Known gaps / questions for the reviewer
- The WHERE block is written out twice (page and count) instead of shared through a constant (see Deviations). Please judge whether this trade-off is acceptable against NFR-3 and the "no concatenation" rule, or whether you'd prefer a different shape that still uses no concatenation, such as a single CTE statement returning the total via a LEFT JOIN.
- CASE-based ORDER BY can't use the `watches_watched_at` index for the default sort, so SQLite sorts in a temp B-tree. That is fine at 10k rows (it was measured), but it would matter if the catalog bound grew far past NFR-1.
- Title sort uses binary order of `title_key`. Like `GET /movies`, it doesn't follow the Ukrainian alphabet for і/ї/є/ґ (U+0456 etc. sort after the rest of the Cyrillic range). This is existing ADR-008 behaviour and not in scope. The tests avoid relying on those letters.
- The genre filter is checked against `trim()`/`textKey`. `genre=%20Adventure%20` matches `Adventure`, which is tested.
- ADR candidate ("Watch History query contract") is still for the orchestrator via `record-adr`. It should also mention the bound-parameter CASE sort approach.
