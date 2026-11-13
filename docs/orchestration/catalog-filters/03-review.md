# Review: catalog-filters (round 1)

## Verdict: APPROVE

## Checks (re-run by reviewer)
- **npm run check:** exit 0. Typecheck, ESLint and Prettier all pass, and coverage is above the 80 % floor.
- **Tests:** `Test Files 15 passed (15)`, `Tests 205 passed (205)`. Coverage is 98.63 % lines, 88.26 % branches, 98.09 % statements and 100 % functions. These numbers match the Coder's claims.
- **Layer check** (SKILL step 5):
  - All three greps print nothing: routes do not import db or repositories, services do not import fastify, better-sqlite3 or db, and the repositories contain no `${` and no string concatenation. The SQL constants are template literals with no interpolation.
  - `movie-repository.ts` imports `textKey` from `../db/database.ts`. That points repositories → db, which is the allowed direction.
- **Guardrails:**
  - `.claude/guardrails.log` shows W3 `Edit` asks at 16:09:00Z for `src/db/migrations.ts` and at 16:10:18Z for `src/db/database.ts`. No Bash write to either file appears after those entries.
  - The migration diff is append-only: the new entry goes at the end, and entries 1–3 are unchanged.
  - `git diff HEAD --stat -- src/recommendation src/schemas/recommendation.ts src/services/poster-service.ts` is empty, so W5 is untouched and the poster change from commit 9ad27a5 is left alone.
  - No config or package changes come from this task. The `.claude/settings.json`, `docs/rag-evaluation/*` and `harness/vault-mcp/package-lock.json` changes were already there and I ignored them as instructed.
- **Vault:** the MCP server failed to connect in this session. I could not call `get_note` on the concepts or on ADR-004, ADR-008, ADR-010 or ADR-011. My comparison with those ADRs relies on the code comments and the earlier orchestration records, as the plan's did.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates | Suggested fix |
|---|---|---|---|---|---|---|
| F1 | minor | `public/app.js` `genreSelect` (~l.58) + `catalog().load()` / `history().load()` | If `GET /genres` fails, its message goes into the same `error` line that each successful `load()` clears with `showError(error, null)`. Both requests start at render time. If `/genres` fails before `/movies` succeeds, the message is wiped right away and the dropdown silently offers only "Any genre". | `genreSelect(error)` → `.catch((e) => showError(error, e))`; `load()` → `showError(error, null)` on success | D16 ("show the error through `showError`"): the intent is only partly met | Give the genre failure its own `errorLine()`, or chain the first `load()` after the genres promise settles. Optional, since the screen still works. |
| F2 | minor (V1, agree with the orchestrator) | `public/style.css` l.148–156 (`input, select` share padding and no height) and `.filters` `minmax(130px, 1fr)` | In Chrome, `select` renders 36 px tall and `input` 38.4 px, so the labels above dropdowns sit higher and each form row looks ragged. "Popularity (votes)" is cut off at 130 px. The problem already existed in History's Sort/Order. Q10 makes it more visible because Genre is now the first field. | Measured by the orchestrator in `02b-orchestrator-ui-check.md`. In the CSS, padding is the only box sizing, and native selects size differently | None: cosmetic, not a plan requirement | Follow-up: give both the same height (e.g. `min-height: 2.4rem` on `input, select`, or `align-items: end` on `.filters`), and shorten the option to "Popularity" or widen the `.filters` minimum. Not worth a round 2. |
| F3 | minor | `test/movies.test.ts` "catalog sorting" `beforeEach` | It builds a fresh `buildApp({ db })` per test and reassigns the shared `app` without closing it. The same pattern exists elsewhere, so nothing breaks. | `app = await buildApp({ db })` | Hygiene | Optional `afterEach(() => app.close())`. |

No blockers and no majors.

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 migration 4 columns + CHECKs | Yes | Exact SQL, plus the comment from step 1. CHECK tests cover 0.5, 10.5 and −1, and accept 1, 10 and 0. |
| D2 importer overwrite by `imdb_id`, invalid rating/votes counted | Yes | `setImdbRating` runs after `attachImdbId` for new and duplicate rows. The return shape is unchanged. Overwrite, hand-added back-fill and `n/a` rating tests all exist. `popular.get(tconst)!` is safe because `basics` only holds tconsts from `popular`. |
| D3 `director_key` + `text_key` in `migrate()`, `textKey` moved to db and re-exported | Yes | The v3→v4 test checks the Cyrillic back-fill (`'сергій параджанов'`). The PUT test checks that `director_key` is rewritten. |
| D4 query contract | Yes | Every invalid case returns 400 with `VALIDATION_ERROR`: the inverted range at path `yearTo`, the out-of-range years, `sort=popularity`, `order=up`, and empty `director`, `genre` and `watched`. An unknown genre returns 200 with an empty page. |
| D5/D6 fixed SQL, CASE ordering, NULLS LAST, tie-breaks | Yes | Matches D6 word for word. The `total === items.length` guard in `titles()` protects the duplicated WHERE clause. |
| D7 move `SortOrder`/`inverted`/`QueryYear` | Yes | There is no import cycle, and the History tests pass unchanged. |
| D8/D12 `CatalogMovie`, `Movie` unchanged | Yes | GET/POST/PUT return `CatalogMovie`, while `listUnwatched` still returns `Movie`. The recommendations test checks the exact key set. `WatchService.assertMovie` only checks truthiness, so it is unaffected. |
| D9 FR-5 text | Yes | Identical to D9. |
| D10 no indexes, perf at 20 000 | Yes | `test/catalog.perf.test.ts` covers every planned URL plus `/genres` and the sanity totals. The Coder reported p95 at about 13.5 ms. I did not measure it separately, but the suite passed inside its timing assertion. |
| D11 `GET /genres` | Yes | Tests cover the empty catalog, first spelling kept, Cyrillic `name_key` order, and a genre disappearing after its movie is deleted. The OpenAPI test exists. |
| D13 generic `withGenres`, `toCatalog` | Yes | The key-set test proves no snake_case keys leak. |
| D14 `watched` enum | Yes | `true`/`false` filter works, and `yes`, `1` and empty return 400. |
| D15–D18 UI | Yes | The orchestrator checked it in Chrome at full width and in a 600 px iframe. `.history-row` has 4 columns, and `.imdb`/`.seen` sit inside `.title`, so the 3-child rule at 640 px still holds. |
| Q10 History genre dropdown | Yes | UI-only change. `WatchListQuery` is untouched. |
| Step 9 test fixes | Yes, plus one extra | The recommender-swap test (~196) changed too. The deviation is justified: `create()` now returns `CatalogMovie`, and the assertion is just as strict. |
| Step 14 back-fill | Skipped by design | Left to the human. |

## Context check
The Coder followed the plan's reasons; I found no place where the reason behind a decision was lost.
- D8/D12 exist to keep W5 untouched. The Coder kept the recommender on `listUnwatched` and also tightened the recommendations test to an exact key check, so a leak into `Movie` would now fail the build.
- D3's reason for registering `text_key` in `migrate()` (tests call it on a bare connection) is written in a comment where the function is registered.
- The `instr`/`*_key` rationale (ADR-008) and the "identical WHERE, tests guard total" rule are both documented and enforced by tests.
- The "Default" order option sends no `order`, so the service's per-sort default from D5 still applies.
- One process risk sits outside the code, from 02b. A stray server migrated the human's real DB to v4 while the old code was still running. Any movie added through that old server before its restart has `director_key = ''`. A re-run of `npm run import:imdb` does not repair that column, because `setImdbRating` only writes rating and votes. Such movies are invisible to the director filter until they are edited.
  - Suggestion for the orchestrator: have the human run a read-only `SELECT count(*) FROM movies WHERE director_key = '' AND director <> ''`. If it is not 0, re-saving those movies (PUT) fixes them.

## Good
- The SQL follows ADR-011 and NFR-3 exactly: one fixed statement each, all values bound, and no interpolation anywhere.
- The `titles()` helper checks `total === items.length` on every filter test. That makes drift between the two copied WHERE clauses detectable instead of relying on reviewer vigilance.
- Edge cases are covered:
  - the literal `%` and `_` in the director filter
  - a co-director substring (`roe`)
  - Cyrillic genres and directors
  - equal titles ordered by year in the Z→A sort
  - nulls last in both directions for rating and votes
- The importer's validation mirrors the migration CHECK bounds, with a comment saying so.
- Small, readable UI change that reuses `field`, `poster` and the History form pattern.
- The extra handoff (02b) gave real-browser evidence before the review, as the posters task taught.

## ADR candidates (for record-adr)
- **ADR-011 follow-up: CASE-based ORDER BY measured at 20 000 rows.** No index is used, p95 is about 14 ms, and `NULLS LAST` keeps rows without data last in both directions. The ADR's "revisit if the bound grows" is answered for now.
- **IMDb rating/votes as imported, nullable catalog data.** The importer overwrites them on every run, keyed by `imdb_id`. `NULL` means no IMDb data (hand-added movies, NFR-7), and "Popularity" is defined as `numVotes`.
- **Catalog response shape: `CatalogMovie` extends `Movie`.** All `/movies` responses carry `imdbRating`, `imdbVotes` and `watched`. `Movie` stays the domain or recommendation shape, so W5 is untouched.
- **Data back-fill inside migrations through a JS SQL function** (`text_key` registered in `migrate()`). This sets the rule that migrations may depend on functions `migrate()` registers, with the caveat that anything applying migrations another way fails.
- **`GET /genres` contract.** It lists only genres in use, ordered by `name_key` then `id`, with an `{ items }` shape and no paging. Both genre filters (Catalog and History) are dropdowns fed from it.
- **Boolean query flags as `z.enum(['true','false'])`, not `z.coerce.boolean`.** The reason is that coerce reads `"false"` as true.

Key paths:
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/movie-repository.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/migrations.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/database.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/style.css
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/movies.test.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/catalog.perf.test.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/.claude/guardrails.log

What I did not check: ADR wording against the vault (MCP disconnected), the UI in a browser (I relied on 02b), and the perf numbers in a separate run. I did not open the real `data/movie-tracker.db`. Risk: movies added through the old server after the accidental v4 migration may have an empty `director_key` that re-running the import will not fix.
