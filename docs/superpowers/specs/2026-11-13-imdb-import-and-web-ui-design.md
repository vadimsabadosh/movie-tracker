# IMDb catalog import and web UI — design

Date: 2026-11-13 · Status: draft, awaiting approval

## Intent

The owner wants to use movie-tracker for real, to track the movies they watch. Two things are missing:
a catalog to pick movies from (typing them in by hand doesn't scale) and a UI (curl isn't a product).
The everyday flow is: **find the movie I just watched → rate it → see my history, profile, recommendations
and stats update.**

## Goals

- `npm run import:imdb` fills the catalog with every IMDb movie that has ≥ 5000 votes (~20–30k titles).
- `npm start` serves the API and a web UI on the same origin at `http://127.0.0.1:3000/`.
- The UI covers every existing feature: search the catalog, add a movie by hand, log/edit/delete a watch
  (rating + date + note), browse history with its filters, and see the profile, recommendations and stats.

## Non-goals

- Posters, plot, cast, runtime. Posters come later as their own feature (TMDB, schema change + ADR).
- Fake or sample watch history. History starts empty.
- Auth, multiple users, deployment beyond localhost.
- Importing an existing IMDb/Letterboxd ratings export.

## Anti-goals (it fails even if it "works")

- Import bypasses `MovieInput` validation or the title+year uniqueness rule.
- A frontend toolchain (bundler, framework, build step) the owner has to maintain.
- The UI is slow to open or search on a 25k-movie catalog.

## Constraints (from the project)

- Movie = `title`, `year`, `genres[]` (1–20), `director` (single string, ≤ 200). Unique by
  case-insensitive title + year (`MovieRepository`, `ConflictError`).
- One watch entry per movie: `POST|PUT|DELETE /movies/:id/watch`, rating 1–10, `watchedAt` not in the future.
- Pagination `limit` ≤ 100. Search is `GET /movies?q=` (substring, case-insensitive, Cyrillic too).
- ADR-001 layers, ADR-004 Zod as the single source of truth. Changes pass `npm run check` and the guardrail hook.
- Node ≥ 22.18 runs `.ts` directly. No new dependency for things a few lines of Node can do.

## Approaches considered

**Data source**
- **A. IMDb non-commercial datasets (picked).** Free, offline after download, contains exactly our four fields.
  No posters.
- B. TMDB API. Has posters but needs a key, a schema change and an external service. Deferred.

**Frontend**
- **1. No-build static frontend served by Fastify (picked).** `public/` with HTML/CSS/vanilla JS (ES modules),
  served by `@fastify/static`. Same origin, so no CORS. One process, no toolchain.
- 2. Vite + React in `web/`. A second dependency tree, a build step and two dev processes. Overkill for one user.
- 3. Separate repo. Adds CORS and keeping two repos in sync. Dropped.

## Design

### Import — `scripts/import-imdb.ts`, `npm run import:imdb`

1. Download (or reuse a cache in `data/imdb/`, git-ignored) `title.basics`, `title.ratings`, `title.crew`
   and `name.basics` `.tsv.gz` from `https://datasets.imdbws.com/`.
2. Stream each file through `zlib.createGunzip()` + `readline`. Never load a whole file into memory.
   Order: ratings → set of tconsts with `numVotes ≥ MIN_VOTES` (default 5000, overridable via env)
   → basics filtered to `titleType = movie`, the vote set, non-`\N` year and genres → crew directors
   for those tconsts → names only for the needed nconsts.
3. Map each movie to `MovieInput`: `primaryTitle`, `startYear`, genres split on `,`, directors' names joined
   with `", "`. Skip rows with no director. Truncate the director string to 200 characters at a name boundary.
4. Save through `MovieService.create` (validation + uniqueness) inside one SQLite transaction, using the same
   `openDatabase(DATABASE_PATH)` as the server. Count and skip `ConflictError`s and validation failures, so
   re-running only adds what's new.
5. Print a summary: read, imported, skipped (duplicate), skipped (invalid), time taken.

### Serving the UI — `src/app.ts`

- Register `@fastify/static` with `root: public/` and `prefix: '/'`. API routes keep their paths.
  `/openapi.json` stays as it is.
- The JSON 404 handler stays for API paths. Unknown paths under the UI are fine as 404 too, since the UI uses
  hash routing (`#/movies/42`) and never needs server-side fallback.

### UI — `public/index.html`, `public/app.js`, `public/style.css`

Hash-routed single page, plain `fetch` against the existing API.

```
┌ movie-tracker ───────── [Catalog] [History] [Dashboard] ┐
│ Catalog:  [ search title…          ]   + Add movie        │
│   Arrival (2016) · Denis Villeneuve · Sci-Fi Drama  ★ 9   │
│   Dune (2021)    · Denis Villeneuve · Sci-Fi              │
│   ‹ prev   1–20 of 24 113   next ›                         │
├───────────────────────────────────────────────────────────┤
│ Movie:  title, year, director, genre chips                 │
│         Watch: rating 1–10 · date · note · [Save] [Delete]│
├───────────────────────────────────────────────────────────┤
│ History: filters (genre, rating, date range, sort) + list  │
│ Dashboard: profile (top genres/directors) ·                │
│            recommendations with explanations · stats       │
└───────────────────────────────────────────────────────────┘
```

- Search is debounced (~250 ms). Results are paginated at 20 per page.
- API errors (`{ error: { code, message } }`) are shown inline next to the form that caused them.
- Light/dark via `prefers-color-scheme`, keyboard-usable forms, labelled inputs.

## Builder check (done inline)

- *Do recommendations stay fast with ~25k unwatched movies?* Unknown. The Recommender scores candidates in
  memory. **Builder:** time `GET /recommendations` after the import. If it's over ~300 ms, raise it as a
  follow-up instead of optimizing in this change.
- *Is the import fast enough through the service layer?* 25k inserts in one transaction with better-sqlite3
  should take seconds. If it doesn't, batching inside the repository is the builder's call.
- *Dataset licence:* IMDb data is for personal, non-commercial use only. That fits a personal tracker. Don't
  commit the downloaded files (`data/imdb/` git-ignored).
- *Two movies with the same title and year* (rare on IMDb): the second is skipped as a duplicate. Accepted.

## Left to the builder

- Exact layout and styling of the UI, within the sketch above.
- Tests: a unit test for the IMDb row → `MovieInput` mapping (fixture TSV lines, no network) and an
  `app.inject` test that `/` serves `index.html`. No browser tests.
- Whether this goes through `/orchestrate` (recommended, so the vault gets an ADR for "static UI served by the
  API" and "IMDb import").
