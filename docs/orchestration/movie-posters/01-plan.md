# Plan: Movie posters via TMDB (`movie-posters`)

## Goal
Each catalog movie can show a poster from TMDB in the web UI: in catalog rows, on the movie detail page and in the dashboard recommendations. To find the poster, the movie is matched by its IMDb ID (`tconst`). Today the importer reads that ID and throws it away. The plan stores it, looks the poster up on TMDB the first time someone asks for it, and saves the TMDB `poster_path`. A new endpoint `GET /movies/:id/poster` answers with a redirect to TMDB's image CDN. Posters are decoration only. With no TMDB token, no network or no match, the endpoint answers 404 or 503, the UI hides the image, and everything else works as before. Requirements: this extends **FR-1** (Movie), and a new **FR-9** "poster" is proposed in `docs/app-requirements.md` (D11). Also NFR-2, NFR-3, NFR-4, NFR-6 and NFR-7 (`npm start` needs no TMDB). FR-7 and NFR-5 are not touched: `src/recommendation/` does not change.

## Domain facts
| Fact | Source |
|---|---|
| Movie has `title`, `year`, `genres[]`, `director`. There are no external IDs and no poster today. | vault `Movie`; `src/schemas/movie.ts` |
| A movie is unique by case-insensitive title + year, using the `title_key` column lowercased in JS. | vault `ADR-008`; `src/repositories/movie-repository.ts` |
| Schema changes go only through append-only migrations, and the human confirms them. | vault `Database`; `src/db/migrations.ts` header; guardrail W3 |
| Zod is the single source for validation, types and OpenAPI. | vault `ADR-004` |
| Only repositories run SQL. Services have no Fastify and no SQL. `container.ts` is the only place that wires things together. | vault `ADR-001`; `src/container.ts` |
| SQLite file, one command to start, no external services. | vault `ADR-002`; NFR-7 |
| Posters were left out of the previous work on purpose. The note there: "TMDB, schema change + ADR". | `docs/superpowers/specs/2026-11-13-imdb-import-and-web-ui-design.md` (Non-goals) |
| The UI must show the TMDB attribution sentence. Tests must not use the network. Agents never handle the key. | `docs/orchestration/movie-posters/00-task.md` |
| The vault has no note on posters, TMDB or external IDs (I searched for "poster TMDB IMDb import web UI static"). | vault search |

## Current code
| File | What is there now | Change needed |
|---|---|---|
| `src/db/migrations.ts` | 2 migrations. `movies` has no `imdb_id` and no `poster_path`. | Append migration 3 (D2) |
| `src/import/imdb.ts` | `readImdbMovies` returns `MovieInput[]` and drops `tconst`. `importMovies` counts ConflictError as a duplicate. | Carry `imdbId` with each input and validate it. Attach it to new and existing rows. Return `linked`. |
| `src/import/cli.ts` | Prints read/imported/duplicates | Also print `linked` (one line) |
| `src/repositories/movie-repository.ts` | CRUD, list, `listUnwatched` | Add `attachImdbId`, `posterInfo`, `setPosterPath`. The `Movie` row shape does not change. |
| `src/services/movie-service.ts` | CRUD rules | Add `attachImdbId(title, year, imdbId): boolean` that passes through to the repository |
| (new) `src/services/poster-service.ts` | — | `PosterService.url(id)` (D5) |
| (new) `src/clients/tmdb.ts` | — | `PosterSource` type and `tmdbPosterSource(token, fetchFn)` (D6) |
| (new) `src/routes/posters.ts` | — | `GET /movies/:id/poster` (D4) |
| `src/routes/index.ts` | Registers 5 route modules | Add one line: `await posterRoutes(app, services.posters)` |
| `src/container.ts` | `createServices(db, today?, recommender?)` | Add a 4th parameter `posterSource?: PosterSource` and a `posters: PosterService` field |
| `src/app.ts` | `AppOptions { db, logger, today }` | Add `posterSource?: PosterSource` and pass it to `createServices` |
| `src/server.ts` | Reads `DATABASE_PATH` and `PORT` | Pass `posterSource: tmdbPosterSource(process.env.TMDB_ACCESS_TOKEN)` |
| `package.json` | `"start": "node src/server.ts"` | `"start": "node --env-file-if-exists=.env src/server.ts"` (D7, W4) |
| `public/app.js` | Text-only rendering through `el()` | Add a `poster(movieId, cls)` helper and use it in `catalog()`, `movieDetail()` and the recommendations in `dashboard()` |
| `public/style.css` | `.row` is a 3-column grid, shared with the history rows | Add `.poster`, `.row.with-poster`, `.detail-head` and a `.recs` thumbnail rule. Do not change `.row` itself. |
| `public/index.html` | Header, `<main>` | Add a `<footer>` with the TMDB attribution |
| `test/imdb-import.test.ts` | Expects `MovieInput` objects and `{ imported, duplicates }` | Update the expectations to include `imdbId` and `linked` |
| `test/app.test.ts` | OpenAPI and migration tests | OpenAPI test for the poster route; upgrade test v2 → v3 |
| (new) `test/posters.test.ts` | — | Endpoint and service with a fake `PosterSource` |
| (new) `test/tmdb.test.ts` | — | Client with a fake `fetch` |
| `docs/app-requirements.md` | FR-1…FR-8 | Add an FR-9 row (D11) |

## Decisions
| # | Decision | Why | Rejected alternatives |
|---|---|---|---|
| D1 | Match a movie to TMDB by its IMDb ID: `GET https://api.themoviedb.org/3/find/{imdbId}?external_source=imdb_id`, then `movie_results[0].poster_path`. Movies added by hand (no `imdb_id`) get no poster. | The match is exact. 99 % of the catalog comes from IMDb, and the importer already reads the ID. | TMDB `search/movie?query=title&year=` (fuzzy: remakes, translated titles; can quietly show the wrong poster). Search as a fallback for hand-added movies (extra code and wrong-match risk; see Q1). |
| D2 | Migration 3: `ALTER TABLE movies ADD COLUMN imdb_id TEXT CHECK (imdb_id GLOB 'tt[0-9]*'); ALTER TABLE movies ADD COLUMN poster_path TEXT CHECK (poster_path = '' OR poster_path GLOB '/*'); CREATE UNIQUE INDEX movies_imdb_id ON movies (imdb_id);` `poster_path`: NULL means TMDB has not been asked yet, `''` means TMDB has no poster, `/x.jpg` is the TMDB path. | It adds columns without rebuilding the table, so the existing ~19k rows stay. NULLs are allowed many times under UNIQUE. Saving "no poster" stops the app from asking TMDB again. It stores the TMDB path, not a full URL, so the image size and CDN base stay in code. | A separate `posters` table (a join for nothing; 1:1 with movies). A `poster_checked_at` column (a second column only to tell NULL from none). Storing a full URL. |
| D3 | `imdbId` is **not** part of `MovieInput`, the `Movie` response or the API. Only the importer sets it, through `MovieService.attachImdbId`. | Smallest change. POST/PUT `/movies` and their tests stay the same. No new uniqueness error for the API to report. | An optional `imdbId` in `MovieInput` (a 409 path for a duplicate imdbId, and PUT would wipe it when left out; see Q1). |
| D4 | Endpoint `GET /movies/:id/poster` answers **302** with `Location: https://image.tmdb.org/t/p/w342{poster_path}` and `cache-control: public, max-age=604800`. **404** `NOT_FOUND` if the movie does not exist or has no poster (no imdbId, or TMDB has none). **503** `POSTER_UNAVAILABLE` if the poster is not known yet and TMDB cannot be asked (no token, network error, timeout, non-2xx, unexpected JSON). Params: `IdParams`. | The UI just uses `<img src="/movies/{id}/poster">`. `Movie`, `MoviePage`, `WatchHistoryItem` and `Recommendation` stay the same, so the hand-built movie objects in `watch-repository.ts` and the W5 code are untouched. TMDB is only asked for posters that are actually shown (at most 20 per page). | `posterUrl` in the `Movie` JSON (every `Movie` builder would change, and posters would have to be fetched in a batch or inside `GET /movies`). Proxying the image bytes (see D8). |
| D5 | `PosterService.url(id): Promise<string>`: `repo.posterInfo(id)`, or `NotFoundError('Movie', id)` if missing. If `posterPath === null && imdbId !== null`: without a source → `AppError(503,'POSTER_UNAVAILABLE','TMDB is not configured')`. Otherwise `path = (await source.findPosterPath(imdbId)) ?? ''`; a throw becomes `AppError(503,'POSTER_UNAVAILABLE','TMDB is unreachable')` and **nothing is saved**. Then `repo.setPosterPath(id, path)`. If `!path` → `NotFoundError('Poster of movie', id)`. Return `TMDB_IMAGE_BASE + path`. | A temporary failure must not be saved as "no poster". The 503 vs 404 split shows why there is no image. The class goes in the services layer: no Fastify, no SQL. | Caching failures (one network blip would hide a poster for good). Putting the method in `MovieService` (would add a third constructor dependency to a CRUD service). |
| D6 | `src/clients/tmdb.ts`: `export interface PosterSource { findPosterPath(imdbId: string): Promise<string \| null> }` and `export function tmdbPosterSource(token: string \| undefined, fetchFn: typeof fetch = fetch): PosterSource \| undefined`. It returns `undefined` when the token is missing or empty. The request carries `Authorization: Bearer ${token}`, `accept: application/json` and `signal: AbortSignal.timeout(5000)`. It throws on `!res.ok`. It parses the response with Zod: `z.object({ movie_results: z.array(z.object({ poster_path: z.string().regex(/^\/[A-Za-z0-9_-]+\.(jpg\|png)$/).nullable() })) })`, which drops unknown keys. It returns `movie_results[0]?.poster_path ?? null`. Error messages never contain the token or the headers. | TMDB's JSON comes from outside, so it is validated (NFR-2 at the boundary). The strict pattern keeps anything odd out of an `<img src>` URL. Injecting `fetchFn` lets tests run without network. | Calling `fetch` directly from the service (cannot test without network). The v3 `?api_key=` query parameter (the key would end up in URLs). A new HTTP library (Node has `fetch`). |
| D7 | The token comes from the env variable `TMDB_ACCESS_TOKEN` (TMDB's "API Read Access Token"). `server.ts` reads it, not the service. `npm start` becomes `node --env-file-if-exists=.env src/server.ts`, so the human can put it in the git-ignored `.env`. | Env reading stays in the entry point, like `DATABASE_PATH`. `--env-file-if-exists` is built into Node 24 and does nothing when `.env` is missing, so NFR-7 holds. | `dotenv` (a dependency for one flag). Requiring the human to export it in the shell (still works; see Q4). |
| D8 | Hot-link the images from `image.tmdb.org` and do not store files locally. One size: `w342`, scaled down with CSS. | No disk management (all posters would be about 0.3–1 GB). TMDB allows CDN hot-linking. If the network is down, the `<img>` fails and is hidden, which is fine for decoration. | A local cache in `data/posters/` (file writes, cleanup and an image-proxy route). A `?size=` parameter (an option nobody asked for). |
| D9 | Back-fill `imdb_id` by **re-running `npm run import:imdb`**. `readImdbMovies` returns `ImdbMovie = MovieInput & { imdbId: string }` and checks `tconst` against `/^tt\d+$/` (a bad one counts as `invalid`). `importMovies` does `create` (counts duplicates as now), then always `movies.attachImdbId(title, year, imdbId)` and counts `linked` when it returns true. The repository uses `UPDATE OR IGNORE movies SET imdb_id = @imdbId WHERE title_key = @key AND year = @year AND imdb_id IS NULL`. | There is one code path for new and existing rows. Re-runs are safe: `IS NULL` never overwrites, and `OR IGNORE` skips a rare unique clash. It reuses the cached `data/imdb/*.tsv.gz`. | A separate back-fill script (repeats the reader). Making the importer bypass the service. |
| D10 | UI: `poster(movieId, cls)` returns `el('img', { class: 'poster ' + cls, src: '/movies/' + id + '/poster', alt: '', loading: 'lazy', width, height, onerror: (e) => e.target.classList.add('missing') })`. `.poster.missing` keeps its size and shows a neutral background, so rows do not jump. Catalog rows get a `with-poster` class (4-column grid). The detail card puts the poster next to the title. Recommendations get a small thumbnail. History rows do not change. | `alt=''` is correct: the image is decorative and the title is next to it. `loading=lazy` saves requests. The new class keeps the shared history `.row` grid untouched. | Hiding the `<img>` on error (layout shift). Putting the title in `alt` (screen readers would read the title twice). |
| D11 | Add **FR-9** to `docs/app-requirements.md`: "Постер фільму з TMDB за IMDb ID: необов'язкове оформлення; без ключа чи мережі застосунок працює повністю." | Gives the endpoint, the tests and the coming ADR a requirement ID to point to (vault `Requirement ID`). | Leaving it implied under FR-1 (FR-1 lists exactly four fields). |
| D12 | The ADR is the orchestrator's job after review: "ADR-016 Posters from TMDB by IMDb ID, hot-linked, fetched lazily". The Movie concept note gets `imdb_id` / poster as storage-only attributes. | The planner and the coder are read-only for the vault (W6). | — |

## Steps
1. **Migration 3** in `src/db/migrations.ts`: append the SQL from D2 with a comment `// 3. Posters (FR-9): imdb_id links to TMDB; poster_path NULL = not looked up, '' = TMDB has none.` Do not change entries 1–2. Done when `openDatabase(':memory:')` gives `user_version = 3` and an existing v2 database upgrades with all rows kept (test in step 9).
2. **Repository** `src/repositories/movie-repository.ts`. Use parameters only:
   - `attachImdbId(title: string, year: number, imdbId: string): boolean` runs the SQL from D9 with `textKey(title)` and returns `changes > 0`.
   - `posterInfo(id: number): { imdbId: string | null; posterPath: string | null } | undefined` runs `SELECT imdb_id, poster_path FROM movies WHERE id = ?` and maps the columns to camelCase.
   - `setPosterPath(id: number, path: string): void` runs `UPDATE movies SET poster_path = ? WHERE id = ?`.
   Done when the layer-check greps from the skill (step 5) print nothing new.
3. **MovieService.attachImdbId**, passing through to the repository. Done when it typechecks.
4. **TMDB client** `src/clients/tmdb.ts` as in D6. Export `TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342'`. Done when `test/tmdb.test.ts` passes.
5. **PosterService** `src/services/poster-service.ts` as in D5. Constructor: `(repo: MovieRepository, source: PosterSource | undefined)`. Assign the fields explicitly: **no TypeScript parameter properties and no enums** (`erasableSyntaxOnly`, because Node strips types). Done when the service has no `fastify`/`better-sqlite3` import.
6. **Wiring**:
   - `src/container.ts`: add `posters: PosterService` to `Services`. Add a 4th parameter `posterSource?: PosterSource` and pass the same `MovieRepository` instance.
   - `src/app.ts`: add `posterSource?: PosterSource` to `AppOptions` and call `createServices(db, today, undefined, posterSource)`.
   - `src/server.ts`: pass `tmdbPosterSource(process.env.TMDB_ACCESS_TOKEN)`.
   Done when `npm start` without the variable starts and `GET /movies` works as before.
7. **Route** `src/routes/posters.ts`: `r.get('/movies/:id/poster', { schema: { tags: ['movies'], params: IdParams, response: { 302: <documented empty body>, 404: ErrorResponse, 503: ErrorResponse } } }, async (req, reply) => reply.header('cache-control', 'public, max-age=604800').redirect(await service.url(req.params.id), 302))`. Register it in `src/routes/index.ts`. If the zod serializer rejects `z.null()` for a redirect body, use `z.void()` or `z.any().describe('Redirect to the TMDB image')`, whichever passes the inject test. Do not leave 302 undocumented. Done when the OpenAPI test lists 302/404/503.
8. **Importer** `src/import/imdb.ts` / `src/import/cli.ts` as in D9. `importMovies(db, movies, inputs: ImdbMovie[]): { imported; duplicates; linked }`. Pass `movies.create` only the `MovieInput` fields: destructure `{ imdbId, ...input }`. The cli summary appends `, linked ${linked} to IMDb`. Done when the updated `test/imdb-import.test.ts` passes.
9. **Tests** (see the test plan) in `test/posters.test.ts`, `test/tmdb.test.ts`, `test/app.test.ts` and `test/imdb-import.test.ts`. Seed `imdb_id` in endpoint tests with a direct SQL fixture on the test db, like `seedCatalog` in `test/helpers.ts`, or through `services.movies.attachImdbId`. Build the app with `buildApp({ db, posterSource: fake })`; `testApp()` may get an optional `posterSource` passthrough. Done when every case is green.
10. **UI**:
    - `public/app.js`: add the `poster()` helper (D10) and use it in the catalog row (`class: 'row with-poster'`, poster first), in the `movieDetail` card (wrap the poster and the title block in `.detail-head`) and in each `.recs li`.
    - `public/style.css`: `.poster` is 2:3, `object-fit: cover`, rounded, `background: var(--line)`. `.row.with-poster` uses `grid-template-columns: 46px minmax(0,2fr) minmax(0,1.3fr) minmax(0,1fr)`, and in the existing 640 px media query it becomes `46px 1fr`. `.detail-head` is flex, with the poster about 160 px wide. The recs thumbnail is about 40 px.
    - `public/index.html`: add `<footer class="attribution"><a href="https://www.themoviedb.org/">TMDB</a>: This product uses the TMDB API but is not endorsed or certified by TMDB.</footer>`.
    Done when, with no token, the catalog looks like today plus neutral placeholders, and no layout breaks at 640 px.
11. **Docs**: add the FR-9 row to `docs/app-requirements.md` (D11). Done when it is present.
12. **package.json** `start` script (D7). Done when `npm start` works with and without a `.env`.
13. `npm run format`, then `npm run check`. Done when both pass with coverage ≥ 80 %.

## Guardrails
| File / action | Rule | Expected reaction |
|---|---|---|
| `src/db/migrations.ts` | **W3** | The hook asks the human. Reason: "add imdb_id + poster_path columns (FR-9)". Append only. |
| `package.json` (`start` script) | **W4** | The hook asks the human |
| `src/clients/**`, `src/services/**`, `src/repositories/**`, `src/routes/**`, `src/import/**`, `src/container.ts`, `src/app.ts`, `src/server.ts`, `test/**`, `docs/app-requirements.md` | A2 | Allowed |
| `public/**` | Not covered by A2 or any W rule | Normal Claude Code permissions apply, so it may prompt. That is expected, not a guardrail finding. |
| `src/recommendation/**` | W5 | **Must not be touched.** The plan does not need it. |
| Any Bash command with `TMDB_ACCESS_TOKEN` or another `*_TOKEN` / `*API_KEY*` in its text (e.g. `grep TMDB_ACCESS_TOKEN …`, `TMDB_ACCESS_TOKEN=… npm start`) | **B5** | Denied. Use the Grep tool for code search. Never set or echo the token, and never read `.env`. |
| `npm run format` / `npm run check` | A3 (check); format writes files | As in earlier tasks |
| Real TMDB calls (`curl api.themoviedb.org`, running the server with a token) | W7 / task constraint | The Coder does not do this. The human checks it live after merge. |
| Vault ADR / Movie note update | W6 | Orchestrator only, after review |

## Test plan
| Case | Expected |
|---|---|
| Fresh DB | `user_version` 3; `imdb_id` and `poster_path` columns exist |
| v2 DB with one movie, upgraded (`migrate` with the first 2 migrations, insert, then `migrate(MIGRATIONS)`) | Row kept; `imdb_id`/`poster_path` NULL |
| DB CHECK: `imdb_id = 'x1'` / `poster_path = 'http://evil'` | Insert or update throws (constraint) |
| `GET /movies/999/poster` | 404 `NOT_FOUND` |
| Movie without `imdb_id`; source present | 404; the fake source is **not** called |
| `imdb_id` set, source returns `/abc.jpg` | 302, `location` = `https://image.tmdb.org/t/p/w342/abc.jpg`, `cache-control` has `max-age`; the second request returns 302 and the source was called **once** (cached) |
| Source returns `null` | 404; the second request does not call the source (`''` saved) |
| Source throws | 503 `POSTER_UNAVAILABLE`; `poster_path` stays NULL, so the next call asks again |
| No source (app built without `posterSource`) and the movie has `imdb_id` with NULL path | 503 `POSTER_UNAVAILABLE` |
| No source, but `poster_path` already saved | 302 (works offline after the first lookup) |
| `GET /movies/abc/poster` | 400 `VALIDATION_ERROR` |
| `GET /movies/:id` / `GET /movies` | Response shape unchanged (existing `toEqual` in `test/movies.test.ts` still passes) |
| OpenAPI `/movies/{id}/poster` get | Documents the `id` path param and responses 302, 404, 503 |
| `tmdbPosterSource(undefined)` / `('')` | `undefined` |
| Client with fake fetch, 200 `{movie_results:[{poster_path:'/a.jpg'}]}` | `'/a.jpg'`; the URL called is `.../3/find/tt1?external_source=imdb_id`; header `authorization: Bearer t` |
| Fake fetch: `movie_results: []` or `poster_path: null` | `null` |
| Fake fetch: 401 / 500 | Rejects; the message has no token |
| Fake fetch: `poster_path: '"><script>'` | Rejects (Zod) |
| `readImdbMovies` fixture | Each input has `imdbId` (`tt1` for Arrival); a fixture row with a bad tconst counts as `invalid` |
| `importMovies` twice | First `{ imported: 3, duplicates: 0, linked: 3 }`, second `{ imported: 0, duplicates: 3, linked: 0 }` |
| `importMovies` over a movie created by hand earlier with the same title + year | `duplicates: 1, linked: 1`; the row now has `imdb_id` |
| `GET /` | Still serves `index.html`; the body contains "not endorsed or certified by TMDB" |

## Open questions
| # | Question | Recommended answer | Why it matters |
|---|---|---|---|
| Q1 | How is a movie matched to TMDB, and what happens to movies added by hand? | Match by IMDb ID through `/find` only. Hand-added movies show a placeholder. Later, an optional `imdbId` field in the add form could cover them. | Title + year search can show the wrong poster without anyone noticing. Hand-added movies are rare next to an IMDb catalog of ~19k. |
| Q2 | When are posters fetched: at import, lazily, or by a separate command? | Lazily, on the first `GET /movies/:id/poster`, then saved in the DB. | Only movies that are actually shown get looked up. A batch for 19k movies at a polite rate would take 30+ minutes, and import would need the network and a token. The first view of a page costs up to 20 TMDB calls; after that everything is local. |
| Q3 | Hot-link from TMDB's CDN or cache the images locally? | Hot-link (`image.tmdb.org/t/p/w342`). The DB stores only the path. | Local caching means about 0.3–1 GB on disk plus a proxy route. Offline, posters just don't load, which the task allows. |
| Q4 | Which credential, and how does it reach the server? | TMDB "API Read Access Token" (v4) as a Bearer header, from `TMDB_ACCESS_TOKEN`. `npm start` loads an optional `.env` with `--env-file-if-exists` (W4 change). | It decides the variable name the human sets and whether `package.json` changes. Exporting it in the shell works either way. |
| Q5 | Should "TMDB has no poster" be saved for good? | Yes, for now. Resetting means `UPDATE movies SET poster_path = NULL …` by hand; there is no retry feature in this change. | Without it, posterless movies hit TMDB on every view. A retry feature is extra scope. |
| Q6 | Add FR-9 to `docs/app-requirements.md`? | Yes (D11). | Traceability for the ADR, the endpoint and the tests. |
| Q7 | Posters in history rows too? | No. The task names catalog, detail and dashboard. | Keeps the shared `.row` layout for history unchanged. |
| Q8 | Re-running `npm run import:imdb` is the way to fill `imdb_id` for the existing 19k rows. Is that acceptable? | Yes. It reuses `data/imdb/*.tsv.gz` if they are still on disk, or downloads them again (about 1 GB). | Without the back-fill, no current movie gets a poster. |

## Out of scope
- Plot, cast, runtime, trailers or any TMDB data besides `poster_path`.
- TMDB title search, and an `imdbId` field in the API or the add form (Q1).
- Batch pre-fetching, local image caching, multiple image sizes, a retry command for missing posters.
- Changes to recommendations or statistics (`src/recommendation/` is W5 and stays untouched), and to the history UI.
- Live tests against TMDB. The human checks with a real token after merge.
- Updating `imdb_id` when a movie's title or year is edited through PUT (the link stays as it is).

---
I did not check: whether `fastify-type-provider-zod` accepts a 302 response schema on a redirect (step 7 gives the fallback), or TMDB's current rate limits and terms beyond the attribution sentence from the task.
Risks: `npm start` changes (W4), and back-filling the IMDb IDs needs the importer re-run. Separately, `public/` edits are not on the A2 allow-list, so the Coder may get permission prompts there. Relevant paths: `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/docs/orchestration/movie-posters/00-task.md`, `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/migrations.ts`, `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/import/imdb.ts`, `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js`.

## Answers
Human's answers (2026-11-13), given through the orchestrator:
- **Q1:** IMDb ID only (recommended). Hand-added movies get a placeholder.
- **Q2:** Lazily on first view (recommended).
- **Q3:** Hot-link the TMDB CDN (recommended).
- **Q4–Q8:** All accepted as recommended: `TMDB_ACCESS_TOKEN` via the optional `.env` loaded by `npm start`; "TMDB has no poster" is remembered with no retry feature; add FR-9; no posters in history rows; back-fill IMDb IDs by re-running `npm run import:imdb`.
