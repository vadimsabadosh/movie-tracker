# Plan: Movie description and actors from TMDB (`movie-details`)

> **Vault:** the vault MCP server failed to connect in this session, so I made no `get_note` or `search_notes` calls. The domain facts below come from the code, from `docs/app-requirements.md` and from the posters and catalog-filters orchestration docs, which cite ADR-001, ADR-002, ADR-004 and ADR-008. The ADR and the `Movie` note update are still the orchestrator's job (W6) once the vault reconnects.

## Goal
The movie page (`#/movies/:id`) shows the TMDB plot and up to 10 top-billed actors with their character names. They are looked up on TMDB the first time the page is opened for a movie with an `imdb_id`, then saved in SQLite, so later views need no network. A new endpoint `GET /movies/:id/details` returns `{ overview, cast }`, and the page fetches it after it has already drawn the movie. `GET /movies/:id`, `CatalogMovie` and `Movie` stay unchanged. With no token, no network or no TMDB match, the page renders exactly as it does today. Requirements: a new **FR-10** (D1), plus NFR-2 (Zod on TMDB JSON), NFR-3, NFR-4, NFR-6 and NFR-7. FR-9 is the precedent and is not changed. FR-7 and NFR-5 are not touched (W5).

## Domain facts
| Fact | Source |
|---|---|
| TMDB is reached by IMDb ID through `/3/find/{imdbId}?external_source=imdb_id`, with a Bearer token, `accept: application/json`, a 5 s timeout and Zod parsing. The client returns `undefined` without a token. | `src/clients/tmdb.ts`; posters plan D1, D6 |
| Lazy lookup pattern: `NULL` means TMDB was not asked yet, an empty value means TMDB has nothing, and a failure is never saved. A missing source or a TMDB error gives 503. A movie with no `imdb_id` gives a distinct 404 code (`POSTER_NOT_LINKED`). | `src/services/poster-service.ts`; posters plan D2, D5; commit `9ad27a5` |
| `Movie` must not change because `src/recommendation/` (W5) depends on it. `GET /movies/:id` returns `CatalogMovie`. | `src/schemas/movie.ts`; catalog-filters D8/D12; task |
| Hand-added movies have no `imdb_id`, so they get no details. | task; `movies.imdb_id` (migration 3) |
| Section 3 of the requirements currently says TMDB plot and cast are **out of scope** ("крім постерів (FR-9): опис, акторський склад, тривалість тощо"). This must be edited. | `docs/app-requirements.md` line 16 |
| Only repositories run SQL. Services have no Fastify and no SQL. `container.ts` is the only composition root. Zod is the single source for validation, types and OpenAPI. | ADR-001, ADR-004 (cited in `src/container.ts` and the posters plan) |
| Schema changes are append-only migrations (currently 4). W3 sees only Edit/Write, not Bash. | `src/db/migrations.ts`; posters README section 4 |
| No TypeScript parameter properties and no enums (`erasableSyntaxOnly`, because Node strips types). Fields are assigned explicitly. | posters plan step 5; `PosterService` |
| The UI renders everything as text through `el()`. `api()` throws an `Error` on non-2xx. | `public/app.js` lines 1–30 |
| The TMDB attribution footer already exists. | posters plan step 10 / `public/index.html` |
| UI work must be checked in Chrome by the orchestrator before review. Test servers run only with an explicit `DATABASE_PATH` and `PORT`. | both READMEs; task |

## Current code
| File | What is there now | Change needed |
|---|---|---|
| `src/db/migrations.ts` | 4 migrations | Append migration 5 (D3) |
| `src/clients/tmdb.ts` | `PosterSource`, `tmdbPosterSource`, `TMDB_IMAGE_BASE` | Add `DetailsSource`, `MovieDetails` type and `tmdbDetailsSource(token, fetchFn)` (D4, D5) |
| `src/schemas/movie.ts` | `Movie`, `CatalogMovie`, `MoviePage`, `GenreList` | Add `CastMember` and `MovieDetails` Zod schemas (D6). Nothing else changes. |
| `src/repositories/movie-repository.ts` | `posterInfo`, `setPosterPath`, ... | Add `detailsInfo(id)` and `setDetails(id, overview, cast)` |
| (new) `src/services/details-service.ts` | — | `DetailsService.get(id)` (D7) |
| (new) `src/routes/details.ts` | — | `GET /movies/:id/details` (D6) |
| `src/routes/index.ts` | Registers 6 route modules, including `posterRoutes` | Add `await detailsRoutes(app, services.details)` |
| `src/container.ts` | `createServices(db, today?, recommender?, posterSource?)`, `Services.posters` | 5th parameter `detailsSource?: DetailsSource`; `details: DetailsService` field using the same `MovieRepository` instance |
| `src/app.ts` | `AppOptions { db, logger, today, posterSource }` | Add `detailsSource?: DetailsSource` and pass it through |
| `src/server.ts` | Passes `tmdbPosterSource(process.env.TMDB_ACCESS_TOKEN)` | Also pass `detailsSource: tmdbDetailsSource(<same env var>)`. Read the env var once into a local `const token`. |
| `public/app.js` | `movieDetail(id)`: head card (poster, title, director, IMDb line, chips), then `watchForm` | After the render, fetch details without awaiting and fill an overview paragraph and a Cast card (D9) |
| `public/style.css` | `.detail-head`, `.chips`, `.muted` | Add `.overview` and `.cast` rules (D9) |
| `docs/app-requirements.md` | FR-1…FR-9; section 3 excludes plot and cast | Add FR-10. Change section 3 to exclude only runtime, trailers etc. (D1) |
| `test/app.test.ts` | OpenAPI tests; migration tests (fresh DB, v2→v3, v3→v4 with `MIGRATIONS.slice(0, 3)`) | Add the OpenAPI test for `/movies/{id}/details`, a v4→v5 upgrade test and a CHECK test |
| `test/tmdb.test.ts` | Poster client tests with a fake `fetch` | Add details client tests |
| (new) `test/details.test.ts` | — | Endpoint and service tests with a fake `DetailsSource` (same pattern as `test/posters.test.ts` `setup()`) |

## Decisions
| # | Decision | Why | Rejected alternatives |
|---|---|---|---|
| D1 | New **FR-10**: "Опис (сюжет) і до 10 акторів з ролями з TMDB за IMDb ID на сторінці фільму; шукаються ліниво й зберігаються; без ключа чи мережі сторінка працює повністю." Section 3 line 16 becomes "…крім постерів (FR-9), опису й акторів (FR-10): тривалість, трейлери тощо." | FR-9 says "poster" and nothing else. A separate ID lets the endpoint, the tests and the future ADR point to it. Without the section 3 edit, the document contradicts the code (the same kind of issue as m1 in the posters review). | Widening FR-9 (it would mix two features under one ID and need FR-9 itself reworded) |
| D2 | **Two documented TMDB calls per first lookup**, both with `language=en-US`: (1) `GET /3/find/{imdbId}?external_source=imdb_id&language=en-US` returns `movie_results[0].id` (TMDB id) and `.overview`; (2) `GET /3/movie/{tmdbId}/credits?language=en-US` returns `cast[]`. No match from call 1 means no call 2, and the result is "TMDB has none". | Both endpoints are documented. Call 1 is the same lookup posters already use and trust. `/find` already includes `overview`, so `/movie/{id}?append_to_response=credits` would bring a larger payload for nothing. The cost is paid only on the first view of each movie. | `/3/movie/{imdbId}?append_to_response=credits` (1 call; TMDB accepts IMDb IDs there in practice, but it is not documented, and no test or Coder can verify it; see Q1). Storing `tmdb_id` (only one consumer, and it would add a column). Filling `poster_path` from the same `/find` (couples two features; posters already work). |
| D3 | **Migration 5:** `ALTER TABLE movies ADD COLUMN overview TEXT; ALTER TABLE movies ADD COLUMN cast_json TEXT CHECK (cast_json IS NULL OR (json_valid(cast_json) AND json_type(cast_json) = 'array'));` Meaning: `overview IS NULL` means not looked up yet. After a lookup, both are set in **one UPDATE**: `overview` is the text or `''` when TMDB has none or no match, and `cast_json` is a JSON array, `'[]'` when there is none. Comment: `// 5. Movie details (FR-10): overview NULL = not looked up, '' = TMDB has none; cast_json = top-billed cast as a JSON array.` | Same NULL / `''` convention as `poster_path`, so readers already know it. The cast is read and shown only as a whole, and there is no actor filter (out of scope), so one column is the smallest storage and needs no join, cascade or ordering column. `ADD COLUMN` keeps the ~19k rows. The column is named `cast_json` because `CAST` is an SQL keyword. | A `movie_cast(movie_id, ord, name, character)` table (normalized and ready for a later actor filter, but it needs `ON DELETE CASCADE`, a transaction and an ordered join for a feature nobody asked for; see Q4). A `details_checked_at` column (a second column only to tell NULL from none). |
| D4 | `src/clients/tmdb.ts`: `export interface MovieDetails { overview: string; cast: { name: string; character: string }[] }` (type from the schema in D6, or a plain interface if importing schemas into clients is unwanted; the existing client has no schema import, so use a plain interface). `export interface DetailsSource { findDetails(imdbId: string): Promise<MovieDetails \| null> }`. `export function tmdbDetailsSource(token: string \| undefined, fetchFn: typeof fetch = fetch): DetailsSource \| undefined` returns `undefined` without a token. Both requests use the same headers and `AbortSignal.timeout(5000)` as the poster source: extract a small local `get(url)` helper that does fetch, checks `ok` and returns the JSON, and use it from both sources. It throws on `!res.ok`, and messages never include the token. | Same shape as `PosterSource`, so container, app and test wiring follow a known pattern. The shared helper removes the copy-pasted header and timeout code. | One combined `TmdbSource` replacing `PosterSource` (would rewrite working poster code and its tests). Calling `fetch` in the service. |
| D5 | Zod at the TMDB boundary (unknown keys dropped): `Find = z.object({ movie_results: z.array(z.object({ id: z.number().int().positive(), overview: z.string().nullish() })) })`. `Credits = z.object({ cast: z.array(z.object({ name: z.string().trim().min(1), character: z.string().nullish(), order: z.number().int() })) })`. Mapping: `overview = (r.overview ?? '').trim()`; `cast = credits.cast.toSorted((a, b) => a.order - b.order).slice(0, CAST_LIMIT).map(c => ({ name: c.name, character: (c.character ?? '').trim() }))`, with `export const CAST_LIMIT = 10`. | NFR-2 at the boundary, as in posters D6. `nullish` fits TMDB's occasional null or missing fields without failing a whole lookup. Sorting by `order` is TMDB's own billing order, so "top-billed" is defined by TMDB rather than guessed. The `id` is validated as a positive int before it goes into a URL path (and goes through `encodeURIComponent`, as `imdbId` does). | Trusting the JSON shape. Rejecting a whole lookup because one actor has a null character. |
| D6 | **Separate endpoint `GET /movies/:id/details`**, tags `['movies']`, params `IdParams`. Response **200** `MovieDetails = z.object({ overview: z.string().nullable(), cast: z.array(CastMember) })`, where `CastMember = z.object({ name: z.string(), character: z.string() })` in `src/schemas/movie.ts` and `overview` is `null` when TMDB has none. **404** `NOT_FOUND` for an unknown movie, **404** `DETAILS_NOT_LINKED` for no `imdb_id`, **503** `DETAILS_UNAVAILABLE` when not looked up yet and there is no source or TMDB fails, **400** for a bad id. Document all of these in `response`. "TMDB has none" is **200** `{ overview: null, cast: [] }`, not 404. | Putting it inside `GET /movies/:id` would make that endpoint wait on two TMDB calls (up to 10 s) and give it a network failure mode. That endpoint is also used for every edit form response, and `CatalogMovie` would grow fields. With a separate endpoint the page draws immediately and the details fill in. 404 vs 503 keeps the posters' "why is it empty" split. "None" is a valid empty JSON resource, unlike an image, which needed a 404. | Fields on `CatalogMovie` (blocking, and it changes every movie response and test). A `?details=true` flag on `GET /movies/:id` (an option and still blocking). |
| D7 | `src/services/details-service.ts`: class `DetailsService` with constructor `(repo: MovieRepository, source: DetailsSource \| undefined)`, fields assigned explicitly. Logic of `async get(id): Promise<MovieDetails>`: `info = repo.detailsInfo(id)`, or throw `NotFoundError('Movie', id)`. If `info.overview !== null`, return `{ overview: info.overview \|\| null, cast: JSON.parse(info.castJson) }`. If `info.imdbId === null`, throw `AppError(404, 'DETAILS_NOT_LINKED', \`Movie ${id} has no IMDb ID; run npm run import:imdb to link imported movies\`)`. If there is no source, throw `AppError(503, 'DETAILS_UNAVAILABLE', 'TMDB is not configured')`. Otherwise `found = await source.findDetails(imdbId)`; a throw becomes `AppError(503, 'DETAILS_UNAVAILABLE', 'TMDB is unreachable')` and **nothing is saved**. Then `repo.setDetails(id, found?.overview ?? '', found?.cast ?? [])` and return `{ overview: found?.overview \|\| null, cast: found?.cast ?? [] }`. | Same as PosterService D5, so the Reviewer can diff the two. Saved details are served even without a token (works offline after the first view). | Adding a method to `PosterService` (mixes features; its name would lie). Saving failures (one network blip would hide details for good). |
| D8 | Repository: `detailsInfo(id): { imdbId: string \| null; overview: string \| null; castJson: string \| null } \| undefined` runs `SELECT imdb_id AS imdbId, overview, cast_json AS castJson FROM movies WHERE id = @id`. `setDetails(id: number, overview: string, cast: { name: string; character: string }[]): void` runs `UPDATE movies SET overview = @overview, cast_json = @castJson WHERE id = @id` with `castJson: JSON.stringify(cast)`. Named parameters only. | NFR-3. The JSON stays a repository detail: the service passes arrays. | Building JSON in SQL. |
| D9 | UI in `movieDetail`: render the page as today, then without awaiting call `api(\`/movies/${id}/details\`).then(fill).catch(() => {})`. `fill(d)`: if `d.overview`, append `el('p', { class: 'overview', text: d.overview })` to the head `.stack` after the chips. If `d.cast.length`, insert after the head card and **before** the watch form `el('section', { class: 'card stack cast' }, el('h2', { text: 'Cast' }), el('ul', {}, d.cast.map(c => el('li', {}, el('span', { text: c.name }), c.character ? el('span', { class: 'muted', text: \` as ${c.character}\` }) : null))))`. All text goes through `el()` and nothing is HTML. On any error, or when empty, nothing is added: no "Loading" or error text. The fetch must not keep the page in a loading state. CSS: `.overview { line-height: 1.5; }` and a simple `.cast ul` with no bullets, two columns at ≥ 640 px and one column below. | The task: "offline the page just shows nothing extra". TMDB text is untrusted, so it is rendered as text. Not awaiting keeps first paint fast while TMDB answers. The cast goes before the watch form because it belongs with the movie description; the form stays one scroll away on desktop. | A muted "Description unavailable" line (the task says nothing extra; see Q6). Cast after the watch form (splits the movie info; Q5). `innerHTML` (forbidden). |
| D10 | No change to `package.json`, the importer or `src/recommendation/`. | The token, `.env` loading and `imdb_id` back-fill already exist from posters. | — |

## Steps
1. **Migration 5** in `src/db/migrations.ts`: append the SQL and the comment from D3 **with the Edit tool** (W3; never Bash or an interpreter). Entries 1–4 do not change. Done when `openDatabase(':memory:')` gives `user_version = 5` and the v4→v5 test (step 8) passes.
2. **Schemas** in `src/schemas/movie.ts`: `CastMember`, `MovieDetails` (D6) and their `z.infer` types. Done when `Movie` and `CatalogMovie` are byte-identical to before (check with `git diff`).
3. **Repository** `detailsInfo` and `setDetails` (D8). Done when the only new SQL in the diff uses named parameters.
4. **TMDB client** in `src/clients/tmdb.ts`: the `get` helper, then refactor `tmdbPosterSource` to use it with **no behavior change** (existing `test/tmdb.test.ts` stays green unmodified). Add `CAST_LIMIT`, `DetailsSource` and `tmdbDetailsSource` (D4, D5). Done when the old and new tmdb tests pass.
5. **Service** `src/services/details-service.ts` (D7). Done when it imports neither `fastify` nor `better-sqlite3`.
6. **Wiring:** `src/container.ts` (5th param `detailsSource?: DetailsSource`, field `details`), `src/app.ts` (`detailsSource` in `AppOptions`, `createServices(db, today, undefined, posterSource, detailsSource)`), `src/server.ts` (one `const token = process.env.TMDB_ACCESS_TOKEN`, passed to both factories). Done when `npm run typecheck` passes and `buildApp({ db })` still works without either source.
7. **Route** `src/routes/details.ts` (D6), registered in `src/routes/index.ts`. Done when the OpenAPI test lists 200/400/404/503.
8. **Tests** per the test plan: `test/details.test.ts` (new), `test/tmdb.test.ts`, `test/app.test.ts`. Done when all are green.
9. **UI:** `public/app.js` and `public/style.css` (D9). Done when, with no source, the movie page looks exactly as today with no console errors other than the 503 network line. The orchestrator then checks in Chrome with a test server on an explicit `DATABASE_PATH` and `PORT`, with details seeded in SQL (a long overview, 10 actors, one with an empty character, and an overview containing `<b>`, which must show literally).
10. **Docs:** add the FR-10 row and edit section 3 in `docs/app-requirements.md` (D1).
11. `npm run format`, then `npm run check`. Done when both pass with coverage ≥ 80 %.

## Guardrails
| File / action | Rule | Expected reaction |
|---|---|---|
| `src/db/migrations.ts` | **W3** | The hook asks. Reason: "add overview + cast_json columns (FR-10)". Edit tool only; a Bash or Python write bypasses W3 (posters lesson) and is not allowed. |
| `src/clients/**`, `src/schemas/**`, `src/repositories/**`, `src/services/**`, `src/routes/**`, `src/container.ts`, `src/app.ts`, `src/server.ts`, `test/**`, `docs/app-requirements.md` | A2 | Allowed |
| `public/**` | No A/W rule | Normal permissions; a prompt there is not a guardrail finding |
| `src/recommendation/**` | W5 | Must not be touched |
| `package.json`, configs | W4 | Not needed; any edit is a deviation to report |
| A Bash command with `TMDB_ACCESS_TOKEN` or any `*_TOKEN` in its text; reading `.env` | **B5** | Denied. Use the Grep tool. |
| Real TMDB calls (`curl`, a server with the token) | W7 / task | Not by the Coder. The human checks live. |
| `node src/server.ts` without `DATABASE_PATH` and `PORT` | task (catalog-filters lesson) | Never; it would migrate the real DB to v5 |
| Vault ADR / `Movie` note | W6 | Orchestrator, after review |

## Test plan
| Case | Expected |
|---|---|
| Fresh DB | `user_version` = `MIGRATIONS.length` (5); `overview` and `cast_json` columns exist |
| v4 DB (`migrate(db, MIGRATIONS.slice(0, 4))`) with one movie, then `migrate(MIGRATIONS)` | Row kept; `overview` and `cast_json` are NULL |
| `UPDATE movies SET cast_json = 'nope'` / `= '{}'` | Throws CHECK |
| `GET /movies/999/details` | 404 `NOT_FOUND` |
| `GET /movies/abc/details` | 400 `VALIDATION_ERROR` |
| Movie without `imdb_id`, source present | 404 `DETAILS_NOT_LINKED`; source **not** called |
| `imdb_id` set, source returns `{ overview: 'Plot', cast: [{ name: 'Amy Adams', character: 'Louise' }] }` | 200 with the same body; second request 200, source called **once**; DB has `overview = 'Plot'` and `cast_json` parses to the array |
| Source returns `null` | 200 `{ overview: null, cast: [] }`; DB `overview = ''`, `cast_json = '[]'`; second request does not call the source |
| Source returns `{ overview: '', cast: [...] }` | 200 `overview: null`, cast present |
| Source throws | 503 `DETAILS_UNAVAILABLE`; `overview` stays NULL; next request calls the source again |
| No source, not looked up | 503 `DETAILS_UNAVAILABLE` |
| No source, details already saved | 200 with the saved data |
| `GET /movies/:id` | Response unchanged (existing `toEqual` in `test/movies.test.ts` stays green, no new keys) |
| OpenAPI `/movies/{id}/details` get | `id` path param; responses 200, 400, 404, 503; 200 schema has `overview` and `cast` |
| `tmdbDetailsSource(undefined)` / `('')` | `undefined` |
| Fake fetch: find `{ movie_results: [{ id: 42, overview: ' Plot ', title: 'x' }] }`, credits with 12 actors in shuffled `order`, one with `character: null` | `{ overview: 'Plot', cast }` with 10 entries in `order` order, null character as `''`. Call 1 URL is `https://api.themoviedb.org/3/find/tt1?external_source=imdb_id&language=en-US`, call 2 is `https://api.themoviedb.org/3/movie/42/credits?language=en-US`. Both have `authorization: Bearer t`, `accept` and an `AbortSignal`. |
| Fake fetch: `movie_results: []` | `null`; fetch called **once** |
| Fake fetch: find ok, credits 500 / find 401 | Rejects; message does not contain the token |
| Fake fetch: `id: 'x'` or a cast entry without `name` | Rejects (Zod) |
| Existing poster client tests | Unchanged and green after the `get` refactor |

## Open questions
| # | Question | Recommended answer | Why it matters |
|---|---|---|---|
| Q1 | Which TMDB endpoints, and how many calls per first lookup? | Two documented calls: `/find/{imdbId}` (TMDB id + overview), then `/movie/{id}/credits`. Never repeated after a successful lookup. | The one-call `/movie/{imdbId}?append_to_response=credits` works in practice but is undocumented and cannot be verified here. If it broke, all lookups would fail as 503. |
| Q2 | Plot language? | `en-US`, sent explicitly. | Catalog titles and the UI are English. `uk-UA` overviews are often empty on TMDB and would need fallback logic (a third call). Translation is out of scope. |
| Q3 | How many actors? | 10, in TMDB billing `order` (`CAST_LIMIT = 10`). Character shown as "Name as Character", or just the name when TMDB has none. | Matches "about the top 10". One constant to change later. |
| Q4 | Storage shape for the cast? | A JSON array column `movies.cast_json` next to `movies.overview`. | No actor filter is planned, so a table would be unused structure. If an actor filter comes later, a migration can add a `movie_cast` table then. |
| Q5 | Where does the cast go on the page? | A "Cast" card between the head card and the watch form; the plot inside the head card under the genre chips. | Layout choice; the orchestrator checks it in Chrome. |
| Q6 | How does a failed or absent lookup show? | Nothing at all: no placeholder and no error line. Hand-added (404), offline (503) and "TMDB has none" all look the same as today's page. | The task says "offline the page just shows nothing extra". The alternative is a muted "Description unavailable" line. |
| Q7 | How does the page get details: a separate endpoint or inside `GET /movies/:id`? | Separate `GET /movies/:id/details`, fetched after the page renders. | Embedding makes the page wait up to 10 s on TMDB and changes `CatalogMovie` for every caller. |
| Q8 | Is "TMDB has no details" remembered for good? | Yes, like posters. Reset by hand with `UPDATE movies SET overview = NULL, cast_json = NULL …`. No retry feature. | Otherwise every view of such a movie calls TMDB twice. |
| Q9 | New FR-10 rather than extending FR-9? | FR-10, plus the section 3 edit (D1). | Traceability; section 3 currently says plot and cast are out of scope. |

## Out of scope
- Actor filter or search, actor pages or photos, crew, trailers, runtime, budget.
- Plot or cast anywhere other than the movie page (catalog, history, recommendations, `GET /movies` and `GET /movies/:id` stay unchanged).
- Batch pre-fetching, a retry command, translation or non-English plots.
- Filling `poster_path` or storing `tmdb_id` from the details lookup.
- Details for hand-added movies (no `imdb_id`), and an `imdbId` field in the add form.
- `src/recommendation/` (W5), `package.json` (W4), the importer.
- Live TMDB calls by agents; the human checks after merge.

---
Not checked: the vault (the MCP server failed to connect), and TMDB's current docs for whether `/find` returns `overview` with the `language` parameter. I am going from memory of TMDB's v3 API, so the human should confirm with one live lookup after merge. Risks: W3 prompts for migration 5. The `get` helper refactor touches working poster code; the unchanged poster tests are the safety net. Related paths:
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/clients/tmdb.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/services/poster-service.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/migrations.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/docs/app-requirements.md

## Answers
Human's answers (2026-11-13), given through the orchestrator. All are the Planner's recommendations:
- **Q2:** English (`en-US`).
- **Q3:** Top 10 actors in TMDB billing order, shown as "Name as Character".
- **Q6:** Nothing extra when there is no plot or cast.
- **Q1, Q4, Q5, Q7, Q8, Q9:** accepted as recommended: two documented TMDB calls on first view only; a `cast_json` column; plot under the genre chips with the Cast card before the watch form; a separate `GET /movies/:id/details`; "TMDB has nothing" remembered; new FR-10.
