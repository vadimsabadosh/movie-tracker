# Task: Movie description and actors from TMDB

## In the human's words
"I would also add some description to movies and actors list." The human then chose:
- **Source:** "TMDB, looked up lazily". The first time a movie page is opened, the app asks TMDB for the plot and the top-billed cast and saves them. The first view of each movie needs the token and the network; offline the page just shows nothing extra.
- **Actors:** "See them on the movie page". The plot and about the top 10 actors, with character names, appear on the movie page only. There is no actor filter in the catalog.
- **Process:** `/orchestrate`.

The human uses the app for real (~19 000 IMDb movies, localhost, one person). Their TMDB token is set in `.env` and already works for posters.

Slug: `movie-details`.

## Requirements
- **FR-9** (posters from TMDB by IMDb ID, optional decoration). This task extends the TMDB integration with plot and cast. Whether it extends FR-9 or gets a new FR is a plan decision.
- **NFR-2:** all input validated by Zod, and that includes TMDB's JSON at the boundary (the posters precedent, D6).
- **NFR-3**, **NFR-4**, **NFR-6:** parameterized SQL, `npm run check`, OpenAPI that matches.
- **NFR-7:** works with no TMDB token or network. The movie page still renders fully, just without the plot and cast.

## Starting point (branch `pr8`, HEAD `256613b`)
- Posters are the closest precedent: `docs/orchestration/movie-posters/` (plan D1–D12).
  - `src/clients/tmdb.ts`: `PosterSource`, `tmdbPosterSource(token, fetchFn)`, a Bearer header, a 5 s timeout, Zod parsing and `TMDB /find/{imdbId}`.
  - `src/services/poster-service.ts`: lazy lookup and save. A failure is never cached. `NULL` means not asked yet, `''` means TMDB has none. 404s now carry the codes `POSTER_NOT_LINKED` and `POSTER_NOT_FOUND`.
  - `movies.imdb_id` and `movies.poster_path`.
- Catalog filters (`docs/orchestration/catalog-filters/`):
  - Migration 4: `imdb_rating`, `imdb_votes`, `director_key`.
  - `GET /movies/:id` returns `CatalogMovie`, which is `Movie` + `imdbRating`, `imdbVotes`, `watched`.
  - `Movie` itself must stay unchanged because `src/recommendation/` (W5) depends on it.
- Migrations: 4 so far (`src/db/migrations.ts`).
- Movie page in `public/app.js` (`movieDetail`): poster, title, "Directed by …", the IMDb line, genre chips and the watch form. Everything is rendered as text through `el()`, never as HTML.
- Hand-added movies have no `imdb_id`, so they get no details. That matches posters.

## Constraints
- The `orchestrate` skill: the Planner and Reviewer are read-only. Only the Coder edits `src/`, `test/` and `public/`. The orchestrator owns commits and vault writes.
- Guardrails per `docs/guardrails.md`. Every edit to `src/db/**` (W3) goes through the Edit/Write tools, never Bash or an interpreter; W3 does not see Bash writes. `src/recommendation/` (W5) is out of scope.
- Neither the Coder nor the Reviewer has a browser. The orchestrator checks the UI in Chrome before the review counts.
- Never read `.env`. Never put a token name or value in a Bash command (B5). Tests never call TMDB or the network. The Coder makes no real TMDB calls.
- The orchestrator starts any test server only with an explicit `DATABASE_PATH` and `PORT`, never against `data/movie-tracker.db`. This lesson comes from the catalog-filters task.
- TMDB text is untrusted. It must be rendered as text, never as HTML.

## Out of scope
- Filtering or searching the catalog by actor.
- Actor pages, actor photos, crew other than actors, trailers, runtime and budget.
- Showing the plot or cast anywhere other than the movie page.
- Batch pre-fetching details for all movies.
- Translating the plot. The language TMDB returns (or asking for one) is a plan decision.
