# Implementation: Movie posters via TMDB (round 1)

## Plan steps
| Step | Status (done / changed / skipped) | Notes |
|---|---|---|
| 1 Migration 3 | done | Added the D2 SQL as a new entry with the comment from the plan. Entries 1 and 2 are unchanged. W3 was approved. |
| 2 Repository | changed | Added `attachImdbId`, `posterInfo` and `setPosterPath`. The plan's SQL used `?`, but I used `@named` parameters as NFR-3 and the Coder rules require. `posterInfo` maps columns to camelCase with `AS` aliases. |
| 3 MovieService.attachImdbId | done | Passes straight through to the repository. |
| 4 TMDB client | done | `src/clients/tmdb.ts` follows D6: Bearer header, 5 s timeout, Zod parse with the strict path regex, throws on non-2xx, and the error message is only `TMDB answered <status>`. It also runs `encodeURIComponent` on the imdbId in the URL. |
| 5 PosterService | done | Follows D5. Fields are set by hand, with no parameter properties. Nothing is saved when the source throws. |
| 6 Wiring | done | `createServices` takes a 4th parameter `posterSource?`. `AppOptions.posterSource` is new. `server.ts` passes `tmdbPosterSource(process.env.<token var>)`. |
| 7 Route | done | `z.null().describe(...)` works as the 302 body, so no fallback was needed. OpenAPI documents 302, 400, 404 and 503. |
| 8 Importer | done | `ImdbMovie = MovieInput & { imdbId }`. A tconst that fails `/^tt\d+$/` counts as `invalid`. `importMovies` returns `{ imported, duplicates, linked }`. The cli line now ends with `, linked N to IMDb`. |
| 9 Tests | done | New: `test/posters.test.ts` (9), `test/tmdb.test.ts` (5). Updated: `test/app.test.ts` (+4), `test/imdb-import.test.ts` (+1, plus changed expectations). `testApp()` now accepts any `AppOptions` except `db`. |
| 10 UI | done | `poster()` helper in app.js. Catalog rows get `row with-poster` with a 46 px thumbnail. The detail card wraps the poster and title block in `.detail-head` (160 px). Each recommendation has a 40 px thumbnail. Footer with the TMDB attribution. History rows are unchanged. |
| 11 FR-9 | done | New row in `docs/app-requirements.md`. |
| 12 package.json | done | `"start": "node --env-file-if-exists=.env src/server.ts"`. W4 was approved. |
| 13 format + check | done | Both pass. |

## Files changed
| File | Change |
|---|---|
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/migrations.ts | Migration 3 added |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/movie-repository.ts | `attachImdbId`, `posterInfo`, `setPosterPath` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/services/movie-service.ts | `attachImdbId` pass-through |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/services/poster-service.ts | new: `PosterService` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/clients/tmdb.ts | new: `PosterSource`, `tmdbPosterSource`, `TMDB_IMAGE_BASE` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/posters.ts | new: `GET /movies/:id/poster` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/index.ts | registers `posterRoutes` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/container.ts | `posters` service, 4th parameter `posterSource?` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/app.ts | `AppOptions.posterSource` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/server.ts | builds the TMDB source from the env |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/import/imdb.ts | `ImdbMovie`, tconst check, `linked` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/import/cli.ts | prints `linked` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/posters.test.ts | new |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/tmdb.test.ts | new |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/app.test.ts | attribution check, poster OpenAPI test, migration tests (fresh database, v2 to v3 upgrade, CHECK constraints) |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/imdb-import.test.ts | `bad7` fixture row, `imdbId` and `linked` expectations, test for a movie added by hand |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/helpers.ts | `testApp(options: Omit<AppOptions,'db'>)` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js | `poster()` helper, used in catalog, detail and recommendations |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/style.css | `.poster`, `.poster.missing`, `.row.with-poster` (plus a 640 px rule), `.detail-head`, `.recs` thumbnail, `.attribution` |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/index.html | attribution footer |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/docs/app-requirements.md | FR-9 row |
| /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/package.json | `start` script |

## Decisions beyond the plan
| Decision | Why |
|---|---|
| The route also documents a `400: ErrorResponse` | `IdParams` validation can return 400, and NFR-6 wants every status documented. |
| On a phone, the catalog row grid puts the poster in column 1 spanning 3 rows; the other cells go in column 2 | The plan's `46px 1fr` alone would make the cells wrap into the 46 px column. |
| Recommendation thumbnail is floated, and `li` gets `overflow: hidden` | Making `li` a grid or flow-root would remove the `<ol>` numbers. |
| `.poster.missing` uses `color: transparent; font-size: 0` | Hides the browser's broken-image icon and alt text, while `width`/`height` and the background keep the box. |
| The client runs `encodeURIComponent(imdbId)` | Cheap defence. The DB CHECK already limits it to `tt[0-9]*`. |

## Deviations from the plan
| Plan said | Did instead | Why |
|---|---|---|
| Repository SQL with `?` (step 2) | `@named` parameters | The Coder rules (NFR-3) require `@named` parameters only. Same behaviour. |

## Review findings addressed (round 2+)
| Finding | Change / reply |
|---|---|
| n/a (round 1) | |

## Checks
- npm run check: typecheck ok / lint ok / format ok / coverage ok
- tests: `Test Files 14 passed (14)  Tests 171 passed (171)` (19 new); coverage: lines 98.54 % / branches 86.45 %
- layer check: clean (all three greps print nothing)
- Smoke test: `npm start` with a temp `DATABASE_PATH` and port, with no token passed in the command. `GET /movies` gave 200 with an empty page, and `GET /movies/1/poster` gave 404. If a local `.env` exists it was loaded, but no poster lookup ran because the movie did not exist, so TMDB was never called.

## Guardrail events
- W3: asked to append migration 3. Approved.
- W4: asked to change the `package.json` `start` script. Approved.
- B7: denied an `rm` of my own smoke-test DB in the session scratchpad. I did not work around it. The file is left at `/private/tmp/claude-501/-Users-koristuvac-Projects-LVET-----------------movie-tracker/11132020-8114-4099-9672-dcb3f673e712/scratchpad/smoke.db`.
- No `.env` reads, no token name or value in any Bash command, no real TMDB calls, `src/recommendation/` untouched.

## Known gaps / questions for the reviewer
- I did not look at the UI in a browser: the placeholder look, the 640 px layout and whether the broken-image icon is really hidden are unverified.
- Section 3 (out of scope) of `docs/app-requirements.md` still lists "Веб-інтерфейс" and "TMDB integration — possible extension" as out of scope. I left them alone; FR-9 now partly contradicts the TMDB line. The orchestrator or human should decide whether to edit it.
- PUT can change a movie's title or year and leave a stale `imdb_id`/poster. The plan lists this as out of scope.
- A Zod parse error from an unexpected TMDB payload may include the received value in its message. It never includes the token, and the service turns it into a generic 503 in any case.
- The vault MCP disconnected during the run. I did not need it.
