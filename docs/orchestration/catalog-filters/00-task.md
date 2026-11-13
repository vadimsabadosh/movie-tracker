# Task: Catalog filters and sorting, posters in history

## In the human's words
"Can we add filters, sorting?" The orchestrator explained that History already has filters and sorting and the catalog does not. The human confirmed the catalog ("yes, + add poster to history list") and then chose:
- **Sorting:** "Add IMDb rating + popularity". Sort by title, year, IMDb rating or number of votes. This needs a migration to store the rating and vote count, which the importer already reads, plus a re-run of `npm run import:imdb` to fill them.
- **Filters:** genre, year range and director. The orchestrator said these come with either sorting option, and the human did not object.
- **Process:** `/orchestrate`.

The human uses the app for real to track movies (~19 000 IMDb movies, localhost, one person). The catalog currently lists everything alphabetically, so it starts with titles like `#Alive` and `'71`.

Slug: `catalog-filters`.

## Requirements
- **FR-5** (`docs/app-requirements.md`): catalog search. This task extends it with filters and sorting. Whether the extension goes into FR-5 or a new FR is a plan decision.
- **FR-9:** posters (`docs/orchestration/movie-posters/`). History rows get posters too. The posters plan (Q7) left them out at the time.
- **NFR-1:** p95 ≤ 200 ms on a catalog of up to 10 000 movies. The real catalog is ~19 000 movies; keep filtered and sorted queries fast (indexes are a plan decision).
- **NFR-2:** all input validated by Zod; errors in the common format.
- **NFR-3:** parameterized SQL only.
- **NFR-4:** `npm run format`, then `npm run check`.
- **NFR-5:** deterministic order, including tie-breaks for every sort.
- **NFR-6:** OpenAPI matches the endpoints.
- **NFR-7:** works with no TMDB key or network. Movies added by hand have no IMDb rating; how they sort is a plan decision.

## Starting point (branch `pr8`)
- `GET /movies` accepts only `q` (title substring, case-insensitive), `limit` and `offset`, and orders by `title_key, year, id` (`src/repositories/movie-repository.ts` `list`, `src/schemas/movie.ts` `MovieListQuery`).
- `GET /watches` (History, FR-4) already has filters and sorting. Its `WatchListQuery` in `src/schemas/watch.ts` and its repository are the closest precedent; vault ADR-010 and ADR-011 may apply.
- **Importer** (`src/import/imdb.ts`): it reads `title.ratings` (`averageRating`, `numVotes`) only to filter by `minVotes`, and stores neither. Re-running it back-fills `imdb_id` through `MovieService.attachImdbId` (posters D9); that is the precedent for back-filling.
- **Migrations:** 3 so far (`src/db/migrations.ts`; migration 3 = `imdb_id`, `poster_path`).
- **Web UI** (`public/app.js`, no build step):
  - The catalog has a debounced title search and paging.
  - The history screen already has a filter form and paging.
  - `poster(movieId, cls)` makes a lazy poster `<img>` that turns into a same-sized `span` placeholder on error.
  - History rows use the shared `.row` grid plus `.history-row`.
- **Uncommitted change already in the working tree:** `src/services/poster-service.ts` and `test/posters.test.ts`. The poster 404s now have distinct codes, `POSTER_NOT_LINKED` and `POSTER_NOT_FOUND`. The human asked for this just before the task, and it is not part of it. Leave it as it is.

## Constraints
- The `orchestrate` skill: the Planner and Reviewer are read-only. Only the Coder edits `src/`, `test/` and `public/`. The orchestrator owns commits and vault writes.
- Guardrails per `docs/guardrails.md`. A migration is W3, and **every edit to `src/db/migrations.ts` must go through the Edit/Write tools, never through Bash or an interpreter**: the posters task found that W3 misses Bash writes. `src/recommendation/` is W5 and out of scope.
- Neither the Coder nor the Reviewer has a browser. After implementation, the orchestrator checks the UI in Chrome before the review counts as complete; this lesson comes from the posters task.
- Never read `.env`; never put a token name or value in a Bash command (B5); tests never call TMDB or the network.

## Out of scope
- Changes to the History filters themselves (only posters are added to history rows).
- Filters or sorting on recommendations or statistics.
- Storing more IMDb data than rating and vote count.
- A personal "already watched" filter in the catalog, unless the plan finds it falls out for free (then it is an open question).
