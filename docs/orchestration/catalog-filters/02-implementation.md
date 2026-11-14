# Implementation: Catalog filters and sorting, posters in history (round 1)

All plan steps are done except step 14 (the import back-fill, which is yours to run). `npm run check` passes: 205 tests pass, line coverage is 98.63 % and branch coverage is 88.26 %. At 20 000 movies the catalog p95 is 13.5 ms. Neither W3 edit was denied.

## Plan steps
| Step | Status (done / changed / skipped) | Notes |
|---|---|---|
| 1 Migration 4 | done | Edit tool only. The W3 ask is in `.claude/guardrails.log` (16:09:00Z) and was approved. Fresh DB reaches `user_version` = `MIGRATIONS.length` (4). |
| 2 `textKey` / `text_key` | done | Edit tool only. W3 ask logged at 16:10:18Z and approved. `textKey` now lives in `src/db/database.ts`; `movie-repository.ts` imports and re-exports it, so the existing imports compile unchanged. `text_key` is registered first thing in `migrate()`. |
| 3 Schemas | done | `SortOrder` and `inverted` moved to `common.ts`. `QueryYear`, `MovieSort`, the extended `MovieListQuery`, `CatalogMovie`, `MoviePage = page(CatalogMovie)` and `GenreList` are in `movie.ts`. `watch.ts` and `watch-repository.ts` only import from the new places. |
| 4 Repository | done | `CATALOG_PAGE_SQL` and `CATALOG_COUNT_SQL` follow D6 word for word. Also: `MovieCatalogQuery`, `toCatalog`, a generic `withGenres`, `findById` returning `CatalogMovie`, `director_key` written on create and update, `setImdbRating` and `listGenres` (uses `.pluck()`). |
| 5 Service | done | Default order per sort is resolved in the service. Added `genres()` and `setImdbRating()`; get, create and update return `CatalogMovie`. |
| 6 Routes | done | `CatalogMovie` is the 200/201 response. Added `GET /genres` and updated the header comment. |
| 7 Importer | done | Keeps a `Map` of `{ rating, votes }`. A rating outside [1, 10] or bad votes count as invalid. Calls `setImdbRating` after `attachImdbId`. Header and JSDoc updated. |
| 8 Fixture | done | `seedCatalog` takes a `movies` option and writes `director_key` and the deterministic IMDb data; every 50th movie gets NULL. The existing perf tests still pass. |
| 9 Fix tests that break | changed | Made the listed edits (movies CRUD, posters ~109, recommendations ~123, imdb-import, app v2→v3), plus one unlisted line (see Deviations). |
| 10 New tests | done | Every Test plan case, plus `test/catalog.perf.test.ts`. |
| 11 UI | done | Covers D15–D18 and Q10 (History genre dropdown). Not checked in a browser. |
| 12 Docs | done | FR-5 now matches the D9 text exactly. |
| 13 Verify | done | See Checks. |
| 14 Back-fill | skipped (human) | I did not run `npm run import:imdb`. |

## Files changed
| File | Change |
|---|---|
| src/db/migrations.ts | Migration 4 added at the end |
| src/db/database.ts | `textKey` moved here; `text_key` registered in `migrate()` |
| src/schemas/common.ts | Gains `SortOrder` and `inverted` |
| src/schemas/movie.ts | `QueryYear`, `MovieSort`, filters, sort and `watched` in `MovieListQuery`; `CatalogMovie`, `MoviePage`, `GenreList` |
| src/schemas/watch.ts | Imports moved; behaviour unchanged |
| src/repositories/movie-repository.ts | Catalog SQL, `findById` returns the catalog shape, `director_key`, `setImdbRating`, `listGenres`, generic `withGenres` |
| src/repositories/watch-repository.ts | `SortOrder` import path only |
| src/services/movie-service.ts | Default order, `genres()`, `setImdbRating()`, `CatalogMovie` return types |
| src/routes/movies.ts | `CatalogMovie` responses; `GET /genres` |
| src/import/imdb.ts | Stores IMDb rating and votes (D2) |
| public/app.js | `imdbText` and `genreSelect` helpers. Catalog: filter form, Watched mark and IMDb line. Detail page: IMDb line. History: poster plus genre dropdown |
| public/style.css | `.imdb` and `.seen`; `.history-row` now `40px 32px minmax(0,1fr) auto` |
| docs/app-requirements.md | FR-5 (D9) |
| test/helpers.ts | `seedCatalog`: `movies` option, `director_key`, IMDb data |
| test/app.test.ts | `MIGRATIONS.length`; fresh-DB and v3→v4 migration tests, CHECK tests; OpenAPI tests for `/movies` and `/genres` |
| test/movies.test.ts | CRUD expectation updated; new describes: catalog filters, catalog sorting, GET /genres |
| test/imdb-import.test.ts | New fields; `tt8` fixture with a non-numeric rating; overwrite-on-re-run test; hand-added movie gets its rating; `sort: 'title'` |
| test/posters.test.ts | Line ~109 only (allowed by Q9) |
| test/recommendations.test.ts | ~123 now `toMatchObject` plus an exact key check on `top.movie`; swap test (~196), see Deviations |
| test/catalog.perf.test.ts | New: NFR-1 at 20 000 movies |

## Decisions beyond the plan
| Decision | Why |
|---|---|
| One `genreSelect(error)` helper in app.js serves both Catalog and History | Q10 asks for the same dropdown on both screens. One helper avoids writing it twice. |
| Catalog empty text is "No movies match these filters." whenever `q` is set, too. The old `No movies match “q”` text is gone | D16 says this text applies when `q` or any filter is set. |
| `?genre=` (empty) is also tested as a 400 | It falls out of `min(1)` and costs one line in the `it.each`. |
| Extra line in the recommendations test: `Object.keys(top.movie)` must be exactly `director, genres, id, title, year` | The plan's case "the recommendation `movie` gets no new keys" needs an exact check, and `toMatchObject` alone would not catch extra keys. |

## Deviations from the plan
| Plan said | Did instead | Why |
|---|---|---|
| Step 9 lists the test lines that break | Also changed `test/recommendations.test.ts` ~196 (Recommender swap): the expected candidates are now `[b, a].map(plain)`, with the three catalog fields removed | `b` and `a` come from `services.movies.create`, which now returns `CatalogMovie`, while the recommender correctly still gets plain `Movie`s from `listUnwatched`. The assertion is just as strict as before. The test file is not W5. |
| Test plan: hand-added "ARRIVAL" gets `imdb_id`, rating and votes | Done by extending the existing "links the IMDb ID" test, not a new one | Same case. |
| Test plan: non-numeric `averageRating` counts as invalid | Added fixture row `tt8` to the shared fixtures. The existing `invalid` counts went from 2 to 3 and from 3 to 4, with a comment saying why | A separate fixture directory for one row would be more code. These are exact counts, not looser ones. |

## Review findings addressed (round 2+)
n/a (round 1)

## Checks
- npm run check: typecheck ok, lint ok, Prettier check ok, coverage ok (run after `npm run format`; exit 0).
- tests: `Test Files  15 passed (15)`, `Tests  205 passed (205)` (28 new; 177 passed before the new tests were added). Coverage (all files): lines 98.63 %, branches 88.26 %, statements 98.09 %, functions 100 %.
- Perf (D10): p95 = 13.5 ms, max 14.2 ms over 60 requests on 20 000 movies, measured with a temporary copy of the test that I deleted afterwards. Far under 200 ms, so the sort design stays as planned.
- layer check: clean. All three greps from SKILL step 5 print nothing (no `${` or string concatenation in the repositories).
- `git diff` shows nothing under `src/recommendation/`, `src/schemas/recommendation.ts` or `src/services/poster-service.ts`.

## Guardrail events
- W3 asked for `src/db/migrations.ts` (migration 4) through the Edit tool — approved.
- W3 asked for `src/db/database.ts` (`textKey` / `text_key`) through the Edit tool — approved.
- No denials. Neither W3 file was written through Bash or an interpreter.

## Known gaps / questions for the reviewer
- No browser was available, so none of the UI is checked. The orchestrator needs the Chrome check from step 11 at full width and at 640 px: genre dropdowns on both screens are filled, each filter changes the list, the Watched mark shows, the IMDb line shows in the catalog and on the movie page, and history posters or placeholders appear with no broken-image icon.
- The catalog filter form uses `onchange` and has no submit button, the same as History. Pressing Enter in a text field may not submit, so the director filter applies on blur or Enter-triggered change.
- `.history-row` no longer collapses to one column at 640 px, which is the D18 intent. Please check that the 4 columns fit on a narrow screen.
- The `.claude/settings.json`, `docs/rag-evaluation/*` and `harness/vault-mcp/package-lock.json` changes were already in the working tree before I started; I did not touch them.
- Nothing is committed. The human needs to run `npm run import:imdb` after merge to fill in the ratings.

Key paths:
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/movie-repository.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/migrations.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/catalog.perf.test.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js
