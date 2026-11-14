# Plan rev 2: Catalog filters and sorting, posters in history (`catalog-filters`)

> **Rev 2 is the binding plan.** It includes the human's answers: Q1 sort by `votes` desc, Q2–Q4 as recommended, **Q5 genre dropdown**, **Q6 IMDb rating on the movie page**, **Q7 watched / not-watched filter**, and Q8 no. The vault MCP was not connected while I planned. ADR-008, ADR-010 and ADR-011 are cited from the code comments and the watch-history orchestration records. The orchestrator should check D3, D5, D6 and D14 against the vault once it reconnects.

## Goal
In the catalog (`GET /movies` and the `#/` screen), the user can filter by genre (dropdown), year range, director (substring) and watched status, and sort by title, year, IMDb rating or IMDb vote count ("Popularity (votes)"). Every order is deterministic, and paging and the title search `q` stay as they are. Migration 4 stores the IMDb rating and vote count, which the importer reads today and throws away. A re-run of `npm run import:imdb` fills them in for the existing ~19 000 movies. A new `GET /genres` endpoint feeds the dropdown. Catalog rows show the IMDb rating and a "Watched" mark. The movie page shows the IMDb rating. History rows get the lazy poster used in the catalog. `src/recommendation/` and the `Movie` schema do not change.

Requirements:
- **FR-5**, extended (D9).
- **FR-9**: posters in history.
- **NFR-1**: measured at 20 000 movies.
- **NFR-2**, **NFR-3**, **NFR-4**.
- **NFR-5**: tie-breaks.
- **NFR-6**: OpenAPI.
- **NFR-7**: hand-added movies have no IMDb data, and everything works offline.

## Domain facts
| Fact | Source |
|---|---|
| Movie = `title`, `year` (1888 to next year), `genres[]` (1–20, each ≤ 50 chars), `director` (≤ 200 chars; IMDb co-directors joined with ", "). Unique by `title_key` + `year` | `src/schemas/movie.ts`, migration 1, `src/import/imdb.ts` `joinDirectors` |
| Case-insensitive text uses `*_key` columns built in JS by `textKey()` (`toLocaleLowerCase('uk')`). Never `LIKE`/`NOCASE` | ADR-008 (`movie-repository.ts` header, `watch-history/01-plan.md`) |
| A genre keeps its first spelling in `genres.name`. Genres are unique by `name_key`. Genres stay in the table after their last movie is deleted | `MovieRepository.setGenres`, `delete` comment |
| Query contract: optional filters, inclusive ranges, an inverted range is 400, an unknown genre is 200 with an empty list, `sort` + `order` with a default per sort | ADR-010; `src/schemas/watch.ts` |
| ORDER BY: bound `@sort`/`@order` in `CASE` terms inside one fixed statement, no SQL built from strings. No index helps the sort. "Revisit if the bound grows" | ADR-011; `watch-history/05-review.md` |
| One Watch Entry per movie (`watches.movie_id` is the PK) | migration 2; ADR-009 |
| `src/recommendation/*.ts` imports the `Movie` type, and the recommendation response uses the `Movie` schema | grep `src/recommendation`, `src/schemas/recommendation.ts` |
| The importer is re-run to back-fill existing rows (`attachImdbId`, posters D9) | `src/import/imdb.ts` |
| `title.ratings` = `tconst`, `averageRating`, `numVotes`. The non-commercial datasets have no popularity rank | `src/import/imdb.ts`; test fixtures |
| Migrations are append-only, and changing them is W3 | `src/db/migrations.ts`; `docs/guardrails.md` |
| Real catalog ~19 000 movies; NFR-1 bound 10 000 | `00-task.md`; `docs/app-requirements.md` |

## Current code
| File | What is there now | Change needed |
|---|---|---|
| `src/db/migrations.ts` | 3 migrations | Append migration 4 (D1, D3) |
| `src/db/database.ts` | `openDatabase`, `migrate` | Owns `textKey`; registers the SQL function `text_key` in `migrate()` (D3) |
| `src/schemas/common.ts` | `PaginationQuery`, `page`, `ErrorResponse` | Receives `SortOrder` and `inverted` (D7) |
| `src/schemas/watch.ts` | `WatchListQuery`, local `QueryYear`/`inverted`, `SortOrder` | Import those from the new locations; behaviour unchanged |
| `src/schemas/movie.ts` | `MovieListQuery` (`q` + paging), `MoviePage = page(Movie)` | Filters, sort, `watched`; `CatalogMovie`; `MoviePage = page(CatalogMovie)`; `GenreList`; export `QueryYear`, `MovieSort` |
| `src/repositories/movie-repository.ts` | `findById`/`list` return `Movie`; `create`/`update` write `title_key` | Catalog SQL (D6), `findById` returns `CatalogMovie` (D12), `director_key`, `setImdbRating`, `listGenres` |
| `src/repositories/watch-repository.ts` | imports `SortOrder` from `schemas/watch.ts` | Import path only |
| `src/services/movie-service.ts` | `get`/`list`/`create`/`update` | Resolve the default order; return types become `CatalogMovie`; add `genres()` and `setImdbRating()` |
| `src/routes/movies.ts` | `/movies` CRUD with the `Movie` response | Responses use `CatalogMovie`; new `GET /genres` |
| `src/import/imdb.ts` | ratings kept in a `Set` only for `minVotes` | Store rating and votes (D2) |
| `public/app.js` | catalog: search and pager; detail: title, director, chips; history: rows without a poster | Filter form (with genre dropdown and watched select), IMDb line, "Watched" mark, IMDb line on the detail page, poster in history rows |
| `public/style.css` | `.history-row` with 3 columns | Poster column; `.imdb`, `.seen` |
| `test/helpers.ts` | `seedCatalog` without `director_key` or IMDb data | `movies` option, `director_key`, IMDb data |
| `test/app.test.ts` | migration tests expect version 3 | `MIGRATIONS.length`, migration-4 tests, OpenAPI tests for `/movies` and `/genres` |
| `test/movies.test.ts` | CRUD test compares the create response with `toEqual` (line ~21) | Expect the new fields; add filter, sort and genre tests |
| `test/posters.test.ts` (**has uncommitted changes**) | line ~109 "leaves the Movie response shape unchanged": `toEqual({ id, ...MOVIE })` | Breaks under D12. One-line update, after the orchestrator commits the POSTER_* change (Q9) |
| `test/recommendations.test.ts` | line ~123 `expect(top.movie).toEqual(GET /movies/10)` | Breaks under D12. Change to `toMatchObject` with the recommendation `Movie` as the subset (test only, not W5) |
| `test/imdb-import.test.ts` | compares whole `ImdbMovie` objects; calls `services.movies.list({ limit, offset })` | New fields; add `sort: 'title'` so it type-checks |
| `docs/app-requirements.md` | FR-5 covers title search only | Extend it (D9) |

## Decisions
| # | Decision | Why | Rejected alternatives |
|---|---|---|---|
| D1 | Migration 4 adds `imdb_rating REAL CHECK (imdb_rating BETWEEN 1 AND 10)` and `imdb_votes INTEGER CHECK (imdb_votes >= 0)`. `NULL` means no IMDb data | These are the only two values the task allows. The CHECKs back up the importer's parsing. `NULL` is how NFR-7 movies are stored | A separate table (a join on every query for two 1:1 values). `DEFAULT 0` (would sort like a real value) |
| D2 | The importer **overwrites** both values on every run: `UPDATE movies SET imdb_rating = @rating, imdb_votes = @votes WHERE imdb_id = @imdbId`, called after `attachImdbId` for new and duplicate rows. A rating that is not finite in [1, 10], or votes that are not an integer ≥ 0, count the row as `invalid`. `importMovies` still returns `{ imported, duplicates, linked }` | Ratings change, so a re-run refreshes them. `imdb_id` is the stable key and reaches exactly the movie that owns it. The CLI and its tests stay as they are | Never overwriting (stale values). Matching by title + year. A new counter |
| D3 | The director filter is a case-insensitive substring match on the new column `director_key TEXT NOT NULL DEFAULT ''`. Migration 4 back-fills it with `UPDATE movies SET director_key = text_key(director)`. `migrate()` first registers `db.function('text_key', { deterministic: true }, (s) => textKey(String(s)))`. `textKey` moves to `src/db/database.ts`; `movie-repository.ts` imports it and adds `export { textKey }`. `create` and `update` write `textKey(input.director)` | This is the `title_key` pattern (ADR-008), and Cyrillic folds correctly. The back-fill needs JS lowercasing. The function lives in `migrate()` because tests call `migrate(new Database(...))` directly. Dependencies keep pointing repositories → db | `lower()` (ASCII only). A per-row JS function at query time. A JS back-fill on every start. `database.ts` importing from `repositories/` |
| D4 | `GET /movies` query parameters: <br>• `q` (unchanged) <br>• `genre` (trim, 1–50; exact `name_key` match) <br>• `yearFrom` / `yearTo` (`QueryYear`, 1888 to next year; inverted → 400 at path `yearTo`, "must be ≥ yearFrom") <br>• `director` (trim, 1–200, substring) <br>• **`watched` ∈ `'true' \| 'false'`, optional; absent means all** (D14) <br>• `sort` ∈ `title \| year \| rating \| votes`, default **`votes`** (Q1) <br>• `order` ∈ `asc \| desc`, optional <br>All filters combine with AND | Mirrors `WatchListQuery` (ADR-010). An unknown genre gives 200 with an empty list | Genre substring match. `minRating`/`minVotes` (not asked) |
| D5 | Sorting follows ADR-011: one fixed statement with `CASE` terms. `MovieService.list` resolves the default order: `title` → `asc`, everything else → `desc`. Movies without IMDb data come **last in both directions** (Q2, `NULLS LAST`) | This is the History mechanism, and the tie-breaks give a total order (NFR-5) | ORDER BY concatenated from a map. Nulls first on `asc` |
| D6 | SQL. Copy the WHERE into both statements, as in History; tests check `total` for every filter. <br>`CATALOG_PAGE_SQL` = `SELECT m.id, m.title, m.year, m.director, m.imdb_rating AS imdbRating, m.imdb_votes AS imdbVotes, EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = m.id) AS watched FROM movies m` <br>`WHERE (@q IS NULL OR instr(m.title_key, @q) > 0)` <br>`AND (@genreKey IS NULL OR EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = m.id AND g.name_key = @genreKey))` <br>`AND (@yearFrom IS NULL OR m.year >= @yearFrom) AND (@yearTo IS NULL OR m.year <= @yearTo)` <br>`AND (@directorKey IS NULL OR instr(m.director_key, @directorKey) > 0)` <br>`AND (@watched IS NULL OR EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = m.id) = @watched)` <br>`ORDER BY` <br>`CASE WHEN @sort='title' AND @order='asc' THEN m.title_key END ASC,` <br>`CASE WHEN @sort='title' AND @order='desc' THEN m.title_key END DESC,` <br>`CASE WHEN @sort='year' AND @order='asc' THEN m.year END ASC,` <br>`CASE WHEN @sort='year' AND @order='desc' THEN m.year END DESC,` <br>`CASE WHEN @sort='rating' AND @order='asc' THEN m.imdb_rating END ASC NULLS LAST,` <br>`CASE WHEN @sort='rating' AND @order='desc' THEN m.imdb_rating END DESC NULLS LAST,` <br>`CASE WHEN @sort='votes' AND @order='asc' THEN m.imdb_votes END ASC NULLS LAST,` <br>`CASE WHEN @sort='votes' AND @order='desc' THEN m.imdb_votes END DESC NULLS LAST,` <br>`CASE WHEN @sort='rating' THEN m.imdb_votes END DESC NULLS LAST,` <br>`m.title_key ASC, m.year ASC, m.id ASC` <br>`LIMIT @limit OFFSET @offset` <br>`CATALOG_COUNT_SQL` = `SELECT COUNT(*) AS total FROM movies m` + the same WHERE | Tie-breaks: a rating tie goes to more votes, then title. Title, year and votes ties go to title A→Z, year, id. `EXISTS` never duplicates rows, and the `watches` PK makes the lookup a single index probe. `instr` keeps `%`/`_` literal | A shared WHERE string joined with `${…}` (the skill's grep flags it, and History kept literals). `LEFT JOIN watches` (it would work, but it diverges from the EXISTS pattern) |
| D7 | `SortOrder` and `inverted` move to `schemas/common.ts`, and `QueryYear` to `schemas/movie.ts` (exported) | `movie.ts` cannot import `watch.ts`: that would be a cycle at module load | Copies |
| D8 | `CatalogMovie = Movie.extend({ imdbRating: z.number().min(1).max(10).nullable(), imdbVotes: z.number().int().min(0).nullable(), watched: z.boolean() })`. **`Movie` stays exactly as it is.** The recommendation schema, recommendation code and History items keep using `Movie` | The UI needs IMDb data and watch state; recommendations do not. `CatalogMovie` extends `Movie`, so a `CatalogMovie` value fits wherever a `Movie` is expected (`WatchService.assertMovie`), and nothing in `src/recommendation/` changes (W5) | Adding the fields to `Movie` (W5, plus every place that builds one) |
| D9 | `docs/app-requirements.md` FR-5 becomes: "Пошук фільмів у каталозі за частиною назви; фільтри за жанром (зі списку жанрів), діапазоном років, режисером (частина імені) і статусом перегляду; сортування за назвою, роком, рейтингом IMDb або кількістю голосів IMDb; пагінація. Рейтинг і голоси IMDb заповнює імпорт і показуються в каталозі та на сторінці фільму; фільми без них — у кінці списку." | One endpoint, one screen. FR-4 is the precedent | A new FR |
| D10 | **No new indexes.** NFR-1 is measured at 20 000 movies. If p95 ≥ 200 ms, the Coder **stops and reports** | Under ADR-011, SQLite cannot use a sort or range index here. The test proves the cost at the real size. Dropping ADR-011 needs a human decision | Indexes nobody uses. Dropping ADR-011 without a measurement |
| D11 | **Genre list endpoint (Q5): `GET /genres` → `200 { items: string[] }`.** <br>SQL in `MovieRepository.listGenres()`: `SELECT g.name FROM genres g WHERE EXISTS (SELECT 1 FROM movie_genres mg WHERE mg.genre_id = g.id) ORDER BY g.name_key, g.id`. <br>Schema `GenreList = z.object({ items: z.array(z.string()) })` in `schemas/movie.ts`. <br>Service `MovieService.genres(): { items: string[] }`. <br>Route in `src/routes/movies.ts` with tag `movies`, `schema: { tags, response: { 200: GenreList } }`. <br>No paging and no query parameters (IMDb has about 28 genres) | Genres belong to movie persistence, which `MovieRepository.setGenres` already owns, so no new module. Only genres used by at least one movie are listed, so the dropdown never offers a choice that returns nothing; the `movie_genres_genre` index serves the EXISTS. Sorting by `name_key` gives the case-insensitive Cyrillic order (ADR-008), and `id` breaks ties (NFR-5). `{ items }` matches the shape of every other list response | A separate genre module or `GenreRepository` (scaffolding for one query). Returning every genre, unused ones included (dead options). Paging (unneeded). A plain array response (inconsistent with the other endpoints) |
| D12 | **Movie page IMDb data (Q6):** `MovieRepository.findById` selects `imdb_rating AS imdbRating, imdb_votes AS imdbVotes, EXISTS (SELECT 1 FROM watches w WHERE w.movie_id = movies.id) AS watched` and returns `CatalogMovie`. `GET/POST/PUT /movies[/:id]` declare `CatalogMovie` as the 200/201 response. `listUnwatched()` stays as it is and returns `Movie`, which is all the recommender sees | The recommender gets its candidates from `listUnwatched`, not `findById`, so `src/recommendation/` is untouched. The recommendation response stays `Movie`. One shape for every `/movies` response, so the UI handles one type | A separate `GET /movies/:id/imdb` (an extra request and endpoint for two numbers). Changing `Movie` (W5). Returning extra fields only on `GET /:id` but not on POST/PUT (two response shapes for one resource) |
| D13 | `withGenres` becomes generic (`<T extends { id: number }>(rows: T[]) => (T & { genres: string[] })[]`). Catalog rows are mapped by a private `toCatalog(row)` that turns `watched` from 0/1 into a boolean. The columns are selected with camelCase aliases, so no snake_case keys leak | SQLite returns `EXISTS` as an integer | Hand-written mapping per method |
| D14 | **Watched filter (Q7):** parameter `watched`, `z.enum(['true', 'false']).optional()`. The repository binds `@watched` as `null` when absent, `1` for `'true'` and `0` for `'false'` (the SQL is in D6). Any other value → 400 | It reads naturally in a URL. A closed enum without a transform keeps OpenAPI exact (`enum: [true, false]` as strings). `z.coerce.boolean()` is wrong because it turns `"false"` into `true` | `z.coerce.boolean` (bug). `z.stringbool()` (accepts yes/1/on, and its JSON Schema output in a querystring is unproven here). Names like `status=watched\|unwatched` (longer for the same job) |
| D15 | **Rows show watch state: yes.** A catalog row with `watched: true` gets `el('span', { class: 'seen', text: 'Watched' })` inside the `.title` span, after the year | Without it, the result of the filter cannot be checked, and with "All" the user cannot tell which films are seen. Keeping it inside `.title` preserves the 3 non-poster children that the 640 px rule (`grid-row: span 3`) relies on | Showing the personal rating (needs more data and is not asked for). A fifth grid child (breaks the mobile layout) |
| D16 | **UI catalog form**, built like `history()`. The `inputs` object holds: <br>• `genre`: a `<select>` with first option `value: ''`, text "Any genre"; filled once per `catalog()` render from `api('/genres')`, one `<option value={name}>` per item. If that request fails, show the error through `showError` and keep only "Any genre" <br>• `yearFrom` / `yearTo`: number, min 1888, max next year <br>• `director`: text <br>• `watched`: select All `''` / Not watched `false` / Watched `true` <br>• `sort`: Popularity (votes) `votes` first, then IMDb rating `rating`, Release year `year`, Title `title` <br>• `order`: Default `''` / Descending / Ascending <br>`onchange` and `onsubmit` set `offset` to 0 and call `load()`. The title search stays debounced. `load()` adds every non-empty input. When `q` or any filter (not `sort`/`order`) is set and nothing matches, the empty text is "No movies match these filters." | Same pattern as History. A dropdown sends the exact stored name, which the `name_key` match accepts | Debouncing every field. A free-text genre input (the human chose a dropdown) |
| D17 | **IMDb line.** In catalog rows, inside `.title`: `el('span', { class: 'muted imdb', text: \`IMDb ${m.imdbRating.toFixed(1)} · ${m.imdbVotes.toLocaleString()} votes\` })`, only when `imdbRating !== null`. On the movie page, in the `.stack` after "Directed by …": `el('p', { class: 'muted', text: <same text> })`, also only when it is not null. CSS: `.imdb { display: block; font-weight: 400; font-size: 0.85rem; }` and `.seen { margin-left: 8px; padding: 1px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 0.75rem; font-weight: 600; }` | The same text in both places. Hand-added movies show no line | Showing "IMDb —" for missing data (noise) |
| D18 | **History row poster:** `poster(w.movieId, 'thumb', 40)` as the first child of `.row.history-row`. CSS: `.history-row { grid-template-columns: 40px 32px minmax(0, 1fr) auto; }` | Same position as in the catalog. The 40 px column gives the placeholder `span` its width. `.history-row` comes after the media query, so it also applies at 640 px | Poster after the rating badge |

## Steps
1. **Migration 4 (W3, Edit tool only; never Bash or an interpreter).** Append to `MIGRATIONS` with the comment `// 4. Catalog filters/sort (FR-5): IMDb rating + votes (NULL = no IMDb data); director_key as title_key (ADR-008).`
   ```sql
   ALTER TABLE movies ADD COLUMN imdb_rating REAL CHECK (imdb_rating BETWEEN 1 AND 10);
   ALTER TABLE movies ADD COLUMN imdb_votes INTEGER CHECK (imdb_votes >= 0);
   ALTER TABLE movies ADD COLUMN director_key TEXT NOT NULL DEFAULT '';
   UPDATE movies SET director_key = text_key(director);
   ```
   Done when: the W3 ask appears in `.claude/guardrails.log`, and `openDatabase(':memory:')` reaches `user_version` 4.
2. **`text_key` (W3, Edit tool).** In `src/db/database.ts`, add `export const textKey = (text: string) => text.trim().toLocaleLowerCase('uk');` and register the function as the first statement of `migrate()`. In `movie-repository.ts`, `import { textKey } from '../db/database.ts'` and `export { textKey };`. Done when: existing `textKey` imports compile unchanged.
3. **Schemas.** Make the changes in D7, D4, D8, D11 and D14:
   - `MovieListQuery`: `.refine` for the inverted year range.
   - `MovieSort` and `MoviePage = page(CatalogMovie)`.
   - `watch.ts` imports from the new locations.

   Files: `src/schemas/{common,movie,watch}.ts`, the import line in `src/repositories/watch-repository.ts`. Done when: `npm run typecheck` passes and the History tests are green, unchanged.
4. **Repository.** In `movie-repository.ts`:
   - Add `CATALOG_PAGE_SQL` and `CATALOG_COUNT_SQL` (D6), with a comment saying the two WHERE clauses must stay identical and the tests guard `total`.
   - Add `export type MovieCatalogQuery = MovieListQuery & { order: SortOrder }`.
   - `list(query: MovieCatalogQuery): { items: CatalogMovie[]; total: number }` binds `q`, `genreKey`, `yearFrom`, `yearTo`, `directorKey`, `watched` (each `null` when absent), plus `sort`, `order`, `limit`, `offset`. The count query gets only the filters.
   - `findById` returns `CatalogMovie` (D12), using `toCatalog` and the generic `withGenres` (D13).
   - `create` and `update` write `director_key`.
   - Add `setImdbRating(imdbId, rating, votes)` (D2) and `listGenres(): string[]` (D11).

   Done when: list and detail responses contain `imdbRating`, `imdbVotes` and `watched`, with no snake_case keys.
5. **Service.** In `movie-service.ts`:
   - `get`, `create` and `update` return `CatalogMovie`.
   - `list` resolves the order: `query.order ?? (query.sort === 'title' ? 'asc' : 'desc')`.
   - `genres()` returns `{ items: this.repo.listGenres() }`.
   - `setImdbRating(...)` is an importer-only pass-through.

   Done when: `/movies?sort=title` comes back A→Z and `/movies?sort=year` newest first.
6. **Routes.** In `movies.ts`, use `CatalogMovie` for the 200/201 responses of GET/:id, POST and PUT. Add `r.get('/genres', { schema: { tags, response: { 200: GenreList } } }, () => service.genres())`. Update the header comment (FR-5 search, filters, sort; genre list). No change to `routes/index.ts`, because `movieRoutes` already gets `services.movies`. Done when: OpenAPI lists `/genres` and the new `/movies` parameters.
7. **Importer.** `readImdbMovies` keeps a `Map<tconst, { rating, votes }>` for rows with `votes >= minVotes`. Invalid rating or votes count the row as `invalid`. `ImdbMovie` gains `imdbRating` and `imdbVotes`. `importMovies` calls `movies.setImdbRating(...)` after `attachImdbId`. Update the header comment. Done when: the second run still returns `{ imported: 0, duplicates: 3, linked: 0 }` and the DB rows have ratings.
8. **Test fixture.** `seedCatalog` gets the option `movies = CATALOG_MOVIES`, used for the loop bound and the title modulo. It writes `director_key = textKey(director)`, `imdb_rating = ((i * 37) % 91 + 10) / 10` and `imdb_votes = 5000 + (i * 7919) % 2_000_000`. Every 50th movie (`i % 50 === 0`) gets `NULL` for both. Done when: the existing perf tests pass unchanged.
9. **Fix the tests that break.**
   - `test/movies.test.ts` CRUD: `toEqual({ id: expect.any(Number), ...dune, genres: [...], imdbRating: null, imdbVotes: null, watched: false })`.
   - `test/recommendations.test.ts` ~123: `expect((await app.inject('/movies/10')).json()).toMatchObject(top.movie)`.
   - `test/posters.test.ts` ~109, **only after Q9 is settled**: `toEqual({ id, ...MOVIE, imdbRating: null, imdbVotes: null, watched: false })`. It still proves that `imdbId`/`posterPath` do not leak.
   - `test/imdb-import.test.ts`: add the new fields and `sort: 'title'`.
   - `test/app.test.ts`: the v2→v3 test expects `MIGRATIONS.length`.
10. **New tests.** Write every case in the Test plan, plus the new file `test/catalog.perf.test.ts`.
11. **UI.** `public/app.js`: D15, D16, D17, D18. The filter form goes between the toolbar and `error` in `catalog()`; the IMDb line goes into `movieDetail`. `public/style.css`: `.imdb`, `.seen`, `.history-row`. Done when: the orchestrator checks in Chrome, at full width and at 640 px:
    - the dropdown is filled
    - each filter changes the list
    - the "Watched" mark is visible
    - the IMDb line shows on the catalog and the movie page
    - history posters or placeholders show with no broken-image icon
12. **Docs.** Edit FR-5 (D9).
13. **Verify.** Run `npm run format`, then `npm run check` (coverage ≥ 80 %). Then run the layer greps from `.claude/skills/new-module/SKILL.md` step 5. Done when: all pass and the `${` grep shows nothing new in the repositories.
14. **Back-fill (the human, after merge).** Run `npm run import:imdb`. The Coder never runs it against `data/movie-tracker.db`.

## Guardrails
| File / action | Rule | Expected reaction |
|---|---|---|
| `src/db/migrations.ts` | **W3** | Ask. **Edit/Write only.** Writing through Bash or an interpreter bypasses W3 and counts as a review finding |
| `src/db/database.ts` | **W3** (`src/db/**`) | Ask; Edit tool only |
| `src/schemas/*`, `src/repositories/*`, `src/services/movie-service.ts`, `src/routes/movies.ts`, `src/import/imdb.ts` | A2 | No prompt |
| `test/*`, including the one line in `test/posters.test.ts` | A2 | No prompt. `posters.test.ts` is touched only after Q9 is settled |
| `docs/app-requirements.md` | A2 | No prompt |
| `public/app.js`, `public/style.css` | No rule (not in A2) | Normal permissions, as in the posters task |
| `src/recommendation/**`, `src/schemas/recommendation.ts` | W5 / not needed | **Do not touch.** D8 and D12 keep them unchanged |
| `package.json`, configs | W4 | Not needed. No new dependencies |
| `npm run format` / `check` / `test` | A3 | Runs (`format` may prompt once) |
| `npm run import:imdb` on the real DB | (writes `data/`) | Not run by the Coder |
| `src/services/poster-service.ts` (uncommitted) | none | Do not touch |
| `.env`, token names | B5 | Never. No network in tests |

## Test plan
| Case | Expected |
|---|---|
| Default `GET /movies` on hand-added movies | All have null votes and tie, so the order is title, year, id. The existing "sorted by title then year" test still passes |
| `sort=votes`: votes 100, 9000, 9000 and one null | Desc: the two 9000s (title A→Z), then 100, then null. `order=asc`: 100, 9000, 9000, null |
| `sort=rating`, two equal ratings | More votes first, then title. Nulls last in both directions |
| `sort=year` default / `order=asc` | Newest first / oldest first; ties broken by title |
| `sort=title&order=desc` | Z→A; for the same title, year ascending |
| `genre=sci-fi` (stored "Sci-Fi"); Cyrillic genre in a different case | Matches. `total` is correct. A movie with two genres appears once |
| `genre=nope` | 200, `items: []`, `total: 0` |
| `yearFrom=2000&yearTo=2016` | Both bounds included |
| `yearFrom=2020&yearTo=2010`; `yearFrom=1887`; `yearTo` = next year + 1 | 400, common error format, path `yearTo` / out of range |
| `director=villeneuve`; `director=ПАРАДЖАНОВ`; `director=Doe` matching "Jane Doe, John Roe" | Matches |
| `director=%25`, `director=_` | `total: 0` |
| `PUT` changes the director, then filter by the new director | Found by the new director, not the old one |
| `watched=true` / `watched=false` with 1 of 3 movies watched (via `POST /movies/:id/watch`) | 1 / 2 items, `total` matches. Each item's `watched` flag is correct |
| `watched=yes`, `watched=1`, `watched=` | 400 |
| Combined `q` + `genre` + `yearFrom` + `director` + `watched` + `sort` | The intersection; `total` is the filtered count |
| `sort=popularity`, `order=up`, `director=` | 400 |
| List items and `GET /movies/:id` | Contain `imdbRating`, `imdbVotes`, `watched`. Null/false for a hand-added movie. `watched` turns true after marking it watched |
| `GET /recommendations` item `movie` | Still exactly `id, title, year, genres, director` (no new keys) |
| `GET /genres` on an empty catalog | `{ items: [] }` |
| `GET /genres` with genres "Drama", "sci-fi" (first spelling kept), "Жахи", "абсурд" | Each name once, ordered by `name_key`: `['Drama', 'sci-fi', 'абсурд', 'Жахи']` |
| `GET /genres` after deleting the only movie with genre "X" | "X" is not listed |
| OpenAPI `/movies` query parameters | Exactly `q, genre, yearFrom, yearTo, director, watched, sort, order, limit, offset`. The item schema has `imdbRating`, `imdbVotes`, `watched` |
| OpenAPI `/genres` | A `get` with a 200 schema that has `items` (array of string) |
| Migration on a fresh DB | `user_version` = `MIGRATIONS.length`; the new columns exist |
| Migration from v3 with director "Сергій Параджанов" | `director_key = 'сергій параджанов'`; rating and votes null |
| CHECK constraints | `imdb_rating` 0.5 or 10.5 and `imdb_votes` −1 throw `/CHECK/`. 1.0, 10.0 and 0 are accepted |
| Import fixture, Arrival | The object includes `imdbRating: 7.9, imdbVotes: 6000`, and the DB row has the same values |
| Import re-run with tt1 changed to 8.1 | The row now has 8.1. The return value is unchanged |
| Import: "ARRIVAL" 2016 added by hand first | Gets `imdb_id`, rating and votes |
| Import: non-numeric `averageRating` | Counted as `invalid` |
| `test/catalog.perf.test.ts`: `seedCatalog(db, { movies: 20_000, watchEvery: 3 })`, 60 requests rotating over `/movies`, `?sort=rating&order=asc&offset=19000&limit=100`, `?director=director%2012&sort=year`, `?genre=…&yearFrom=1950&yearTo=2010&sort=votes&limit=100`, `?q=1&sort=title&order=desc&offset=5000`, `?watched=false&director=director&genre=…&yearFrom=1990`, `/genres` | All 200; p95 < 200 ms. Sanity: unfiltered `total` = 20 000; `watched=true` total = ⌊20 000/3⌋ |
| UI (no automated test) | Checked by the orchestrator in Chrome, as in step 11 |
| Existing History, posters and recommendation tests | Green; only the lines listed in step 9 change |

## Open questions
| # | Question | Recommended answer | Why it matters |
|---|---|---|---|
| Q9 | Under D12, `GET /movies/:id` gains three fields. That breaks one assertion in `test/posters.test.ts` (~line 109), a file that holds uncommitted work the task says to leave alone. May the Coder change that one line? | **Yes. The orchestrator first commits the POSTER_NOT_LINKED/POSTER_NOT_FOUND change on its own, then the Coder updates line ~109 as in step 9.** It still checks that `imdbId`/`posterPath` do not leak | Otherwise the Coder would either mix this task into the uncommitted poster change or leave a failing test. The alternative, a separate endpoint for the movie page, adds an API just to avoid editing one test line |
| Q10 | Should History's genre filter also become a dropdown, now that `GET /genres` exists? | **No, not in this task.** It is a one-line follow-up | The task says History filters do not change. The human might still want the two screens to match |

## Out of scope
- Changes to the History filters (History rows only get posters; see Q10).
- Filters or sorting on recommendations or statistics. No changes to `src/recommendation/`, `src/schemas/recommendation.ts` or the `Movie` schema.
- Other IMDb fields; `minRating`/`minVotes` filters; showing the personal rating in catalog rows.
- Keeping filters when navigating back (Q8: no).
- Catalog indexes (D10), unless the perf test fails. Then the Coder stops and the human decides.
- Running `npm run import:imdb` on the real DB.
- ADRs (for example a follow-up on ADR-011 at 19 000 rows, "IMDb rating as imported catalog data", the `GET /genres` contract). The orchestrator records them through `ingest_note` once the vault reconnects.

---
I did not run `npm test` for a baseline, and I could not read the vault, so the ADR wording comes second-hand from code comments and earlier orchestration records. Risks:
- **Q9 has to be settled before the Coder starts.**
- Migration 4 depends on the `text_key` function registered in `migrate()`. Anything that applies migrations another way fails with "no such function".
- I wrote the SQL in D6 in full but have not run it.

## Answers
Human's answers (2026-11-13), given through the orchestrator:
- **Q9:** Commit the 404 change first (recommended). The orchestrator committed it on `pr8` as its own commit before the Coder started, so `test/posters.test.ts` (~line 109) may now be updated as in step 9.
- **Q10:** **Yes: History's genre filter also becomes a dropdown** (not the recommendation). Orchestrator's note for the Coder: History's `genre` parameter already matches the exact name via `name_key`, so this is a UI-only change in `history()` in `public/app.js`. Its genre input becomes a `<select>` filled from `GET /genres` exactly as in D16 (first option "Any genre" with value `''`, error through `showError`). `WatchListQuery` and the History API stay unchanged. Add it to the orchestrator's Chrome check in step 11.
