# Task: Movie posters via TMDB

## In the human's words
"Let's do it now with orchestrate to add posters." Posters were deferred from the IMDb-import + web-UI work (`docs/superpowers/specs/2026-11-13-imdb-import-and-web-ui-design.md`, Non-goals: "Posters come later as their own feature (TMDB, schema change + ADR)"). Orchestrator's framing of the request: store a poster per movie, get it from TMDB, show posters in the web UI (catalog, movie detail, dashboard recommendations). Slug: `movie-posters`.

The human uses the app for real, to track movies they watch. It runs on localhost for one person.

## Requirements
- No FR covers posters; this extends **FR-1** (Movie) and the web UI. Name it in the plan; whether `docs/app-requirements.md` gets a new FR is a plan decision.
- **NFR-2:** all input validated by Zod; errors in the common format.
- **NFR-3:** parameterized SQL only.
- **NFR-4:** `npm run format`, then `npm run check` (typecheck, ESLint, Prettier check, tests with the 80 % coverage floor).
- **NFR-6:** OpenAPI matches the endpoints.
- **NFR-7:** `npm start` keeps working with one command and no external services. The app must stay fully usable with no TMDB key and no network (posters are optional decoration).

## Starting point (branch `pr8`)
- Movie = `title`, `year`, `genres[]`, `director` (`src/schemas/movie.ts`), unique by case-insensitive title + year. No external IDs are stored.
- Catalog: ~19 000 movies imported from IMDb by `npm run import:imdb` (`src/import/imdb.ts`, `src/import/cli.ts`). The IMDb `tconst` (e.g. `tt1160419`) is read during import but not stored.
- Web UI: no-build vanilla JS in `public/` (`app.js`, `style.css`, `index.html`), served by `@fastify/static`; catalog rows, movie detail, history, dashboard with recommendations. All data rendered as text via `el()`, never as HTML.
- Migrations: `src/db/migrations.ts`, `PRAGMA user_version`.
- `.env` exists in `.gitignore`; agents cannot read `.env` (permission deny). A TMDB key, if needed, comes from an environment variable the human sets; agents never handle the key value.

## Constraints
- The `orchestrate` skill: the Planner and Reviewer are read-only; only the Coder edits `src/`, `test/` and `public/`; the orchestrator owns commits and vault writes.
- Guardrails per `docs/guardrails.md`. A migration is W3; `src/recommendation/` is W5 and out of scope here.
- Tests never call the real TMDB API (no network in tests).
- TMDB terms: attribution ("This product uses the TMDB API but is not endorsed or certified by TMDB") must appear in the UI.

## Out of scope
- Plot, cast, runtime, trailers or other TMDB metadata beyond the poster.
- Replacing IMDb as the catalog source.
- Changing recommendation or statistics logic.
