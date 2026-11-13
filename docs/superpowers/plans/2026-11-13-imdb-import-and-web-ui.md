# IMDb Catalog Import and Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the catalog from the IMDb datasets with one command, and serve a no-build web UI over the existing API.

**Architecture:** A pure, tested import module (`src/import/imdb.ts`) streams the gzipped TSVs and saves movies through `MovieService`. A thin CLI (`src/import/cli.ts`) downloads, caches and runs it. `@fastify/static` serves `public/` from `buildApp`. The UI is hash-routed vanilla JS calling the existing JSON API.

**Tech Stack:** Node ≥ 22.18 (runs `.ts` directly), Fastify 5.12.7, better-sqlite3, Zod, Vitest, `@fastify/static@10.1.7`, `node:zlib` + `node:readline`.

**Spec:** `docs/superpowers/specs/2026-11-13-imdb-import-and-web-ui-design.md`

## Global Constraints

- Work on branch `pr8` created from `main`. Don't touch `pr7`.
- `npm run check` (typecheck, lint, format:check, coverage ≥ 80 %) passes after every task.
- Movies enter the DB only through `MovieInput.safeParse` + `MovieService.create` (validation + title/year uniqueness).
- `MIN_VOTES` default 5000, override with env `IMDB_MIN_VOTES`.
- Dataset base URL `https://datasets.imdbws.com/`. Cache dir `data/imdb/` (already git-ignored via `data/`).
- Directors joined with `", "`, max 200 characters, cut at a name boundary.
- No new dependency except `@fastify/static` pinned to `10.1.7` (exact version, no caret).
- UI: no build step, no framework. Files only in `public/`. Hash routing. Every input has a `<label>`, forms work from the keyboard, light/dark via `prefers-color-scheme`.
- Deviation from the spec: the import lives in `src/import/` instead of `scripts/`, so it gets typecheck, lint and coverage like the rest of `src/`.

## Review Focus

1. Running the import twice: the second run imports 0 and reports every movie as a duplicate, without errors (test in Task 1).
2. IMDb rows with `\N` year, genres or directors are skipped and counted, not crashed on (test in Task 1).
3. A movie with dozens of directors: the director string is ≤ 200 characters and ends on a whole name (test in Task 1).
4. An interrupted download leaves no half-written `.tsv.gz` that the next run trusts. Download to `<file>.part`, then rename (check in Task 2).
5. Titles, notes and genres the user types (or IMDb supplies) must render as text, never as HTML. Use `textContent` and `createElement`, no `innerHTML` with data (check in Task 4).

---

### Task 1: IMDb reader and importer

**Files:**
- Create: `src/import/imdb.ts`
- Test: `test/imdb-import.test.ts`

**Interfaces:**
- Consumes: `MovieInput` (`src/schemas/movie.ts`), `MovieService.create(input: MovieInput): Movie` (throws `ConflictError` on duplicate title+year), `createServices(db)` (`src/container.ts`), `openDatabase(':memory:')`.
- Produces:
  - `export const IMDB_FILES = ['title.ratings', 'title.basics', 'title.crew', 'name.basics'] as const` (file stem; on disk `${stem}.tsv.gz`)
  - `export function joinDirectors(names: string[], max = 200): string`
  - `export async function readImdbMovies(dir: string, minVotes: number): Promise<{ inputs: MovieInput[]; invalid: number }>`
  - `export function importMovies(db: Database.Database, movies: MovieService, inputs: MovieInput[]): { imported: number; duplicates: number }`

- [ ] **Step 1: Write the failing tests**

Fixtures: in `beforeEach`, write four files into an `mkdtemp` dir with `gzipSync(lines.join('\n'))`. Each has the real IMDb header row:
- `title.ratings`: `tconst averageRating numVotes`: tt1 → 6000, tt2 → 6000, tt3 → 100 (below the threshold), tt4 → 9000, tt5 → 7000, tt6 → 8000
- `title.basics`: `tconst titleType primaryTitle originalTitle isAdult startYear endYear runtimeMinutes genres`:
  tt1 movie `Arrival` 2016 `Drama,Sci-Fi`; tt2 tvSeries `Show` 2010 `Drama`; tt3 movie `Obscure` 2000 `Drama`;
  tt4 movie `He Said "Yes"` 2019 `Comedy`; tt5 movie `No Year` `\N` `Drama`; tt6 movie `Anthology` 2001 `Drama`
- `title.crew`: `tconst directors writers`: tt1 → nm1; tt4 → nm2; tt5 → nm1; tt6 → nm10..nm49 (40 directors)
- `name.basics`: `nconst primaryName …`: nm1 `Denis Villeneuve`, nm2 `Jane Doe`, nm10..nm49 `Director Number NN`

```ts
it('reads only movies above the vote threshold, with directors', async () => {
  const { inputs, invalid } = await readImdbMovies(dir, 5000);
  expect(inputs.map((m) => m.title).sort()).toEqual(['Anthology', 'Arrival', 'He Said "Yes"']);
  expect(inputs.find((m) => m.title === 'Arrival')).toEqual({ title: 'Arrival', year: 2016, genres: ['Drama', 'Sci-Fi'], director: 'Denis Villeneuve' });
  expect(invalid).toBe(1); // tt5: \N year
});
it('keeps quotes in titles (TSV has no quoting)', ...);            // 'He Said "Yes"' present verbatim
it('cuts long director lists at a name boundary', async () => {
  const anthology = (await readImdbMovies(dir, 5000)).inputs.find((m) => m.title === 'Anthology')!;
  expect(anthology.director.length).toBeLessThanOrEqual(200);
  expect(anthology.director).toMatch(/^Director Number \d+(, Director Number \d+)*$/);
});
it('joinDirectors joins with ", " and never exceeds max', () => {
  expect(joinDirectors(['A', 'B'])).toBe('A, B');
  expect(joinDirectors(['aaaa', 'bbbb'], 6)).toBe('aaaa');
});
it('imports through the service and is idempotent', async () => {
  const db = openDatabase(':memory:');
  const services = createServices(db);
  const { inputs } = await readImdbMovies(dir, 5000);
  expect(importMovies(db, services.movies, inputs)).toEqual({ imported: 3, duplicates: 0 });
  expect(importMovies(db, services.movies, inputs)).toEqual({ imported: 0, duplicates: 3 });
  expect(services.movies.list({ limit: 20, offset: 0 }).total).toBe(3);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run test/imdb-import.test.ts`
Expected: FAIL. The module `../src/import/imdb.ts` can't be resolved.

- [ ] **Step 3: Implement `src/import/imdb.ts`**

Stream each file with `createReadStream → createGunzip() → readline.createInterface`. Skip the header and `split('\t')` each line. Read the files in the order of `IMDB_FILES`, so every step only keeps what the next one needs:
ratings → `Set<tconst>` with `numVotes ≥ minVotes` → basics where `titleType === 'movie'` and in the set → `Map<tconst, {title, year, genres}>` → crew → `Map<tconst, nconst[]>` for those tconsts → names for the needed nconsts only.
Build each candidate. Count it as `invalid` (and drop it) when the year, genres or directors are `\N`, when no director name resolved, or when `MovieInput.safeParse` fails. `importMovies` runs every `create` inside one `db.transaction(...)()`, catches `ConflictError` as a duplicate and rethrows anything else.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run test/imdb-import.test.ts`, then `npm run check`
Expected: all PASS, coverage ≥ 80 %.

- [ ] **Step 5: Commit**

```bash
git add src/import/imdb.ts test/imdb-import.test.ts
git commit -m "Add IMDb dataset reader and idempotent importer"
```

### Task 2: Import command

**Files:**
- Create: `src/import/cli.ts`
- Modify: `package.json` (script `"import:imdb": "node src/import/cli.ts"`), `vitest.config.ts` (add `src/import/cli.ts` to `coverage.exclude`, with the same comment as `src/server.ts`), `README.md` (a "Populate the catalog" section: the command, `IMDB_MIN_VOTES`, `DATABASE_PATH`, the IMDb non-commercial licence note)

**Interfaces:**
- Consumes: `IMDB_FILES`, `readImdbMovies`, `importMovies` (Task 1); `openDatabase`, `createServices`.
- Produces: `npm run import:imdb`.

- [ ] **Step 1: Implement `src/import/cli.ts`**

For each stem in `IMDB_FILES`: if `data/imdb/${stem}.tsv.gz` is missing, `fetch` it from the base URL and stream it to `${file}.part` (`Readable.fromWeb` + `pipeline`). Rename it to the final name only after the stream finishes. Exit non-zero on a non-2xx response. Then open `process.env.DATABASE_PATH ?? 'data/movie-tracker.db'`, run the import and print:
`read N movies (M invalid) → imported X, duplicates Y in T s`.

- [ ] **Step 2: Run the real import**

Run: `DATABASE_PATH=/tmp/mt-import.db npm run import:imdb`
Expected: the downloads finish, then a summary with imported somewhere in the 15 000–35 000 range. Run it again: `imported 0`, and no new download.

- [ ] **Step 3: Check the partial-download guard (Review Focus 4)**

Run: `rm data/imdb/name.basics.tsv.gz`, start the import, press Ctrl-C during the download, then `ls data/imdb/`
Expected: `name.basics.tsv.gz.part` may exist, and `name.basics.tsv.gz` does not. The next run downloads it again.

- [ ] **Step 4: Time recommendations on the real catalog (spec builder check)**

Run: `DATABASE_PATH=/tmp/mt-import.db PORT=3077 npm start`. Log a watch for any movie, then `curl -w '%{time_total}\n' -o /dev/null -s localhost:3077/recommendations`
Expected: write the time in the commit message. If it's over 0.3 s, note it as a follow-up and don't optimize here.

- [ ] **Step 5: `npm run check`, then commit**

```bash
git add src/import/cli.ts package.json vitest.config.ts README.md
git commit -m "Add npm run import:imdb to populate the catalog from IMDb datasets"
```

### Task 3: Serve `public/` from the API

**Files:**
- Modify: `package.json` (`"@fastify/static": "10.1.7"` via `npm install --save-exact @fastify/static@10.1.7`), `src/app.ts`
- Create: `public/index.html` (shell: `<header>` with nav links `#/`, `#/history`, `#/dashboard`, `<main id="app">`, links to `style.css` and `<script type="module" src="app.js">`), `public/style.css` (empty-but-valid base with light/dark `prefers-color-scheme` tokens), `public/app.js` (placeholder `export {}`)
- Test: `test/app.test.ts` (add cases)

**Interfaces:**
- Produces: `GET /` → `index.html`; `GET /app.js`, `GET /style.css`. All API routes unchanged.

- [ ] **Step 1: Write the failing tests** in `test/app.test.ts`

```ts
it('serves the web UI at /', async () => {
  const res = await (await testApp()).inject('/');
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/html/);
  expect(res.body).toContain('<main id="app">');
});
it('keeps JSON 404 for unknown API paths', async () => {
  const res = await (await testApp()).inject('/nope');
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe('NOT_FOUND');
});
```

- [ ] **Step 2: Run them and confirm the first one fails**

Run: `npx vitest run test/app.test.ts`
Expected: `serves the web UI at /` fails with a 404.

- [ ] **Step 3: Register `@fastify/static` in `buildApp`**

`root` is the absolute `public/` path, resolved from `import.meta.url` (not the cwd, so tests and `npm start` behave the same) with `prefix: '/'`. Register it before `registerRoutes`. The existing `setNotFoundHandler` stays.

- [ ] **Step 4: Run the tests, then `npm run check`**

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app.ts public test/app.test.ts
git commit -m "Serve the static web UI from the API at /"
```

### Task 4: Catalog and movie screens

**Files:**
- Modify: `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: `GET /movies?q=&limit=20&offset=`, `POST /movies`, `GET /movies/:id`, `GET|POST|PUT|DELETE /movies/:id/watch`. Error body `{ error: { code, message } }`.
- Produces (in `app.js`, used by Task 5): `api(path, { method?, body? }): Promise<any>` (throws `Error(error.message)` on non-2xx, returns `null` on 204); `el(tag, props?, ...children): HTMLElement` (sets `textContent`, never `innerHTML`); `route()` dispatching on `location.hash`, re-run on `hashchange`.

- [ ] **Step 1: Implement the catalog at `#/`**

A search input, debounced 250 ms, drives `q`. Each row shows `Title (year) · director · genre chips` and links to `#/movies/:id`. No rating on catalog rows: the API has no per-page "watched" lookup, so the rating lives on the detail screen. Prev/next buttons with "1–20 of N". An "Add movie" form (title, year, genres comma-separated, director) POSTs and shows API errors inline.

- [ ] **Step 2: Implement movie detail at `#/movies/:id`**

The movie's fields and genre chips. A watch form with rating (a 1–10 select), date (`<input type="date">`, max today) and note. It POSTs when there's no watch, PUTs when there is one, and offers Delete. API errors show inline under the form.

- [ ] **Step 3: Check it in the browser against the imported DB**

Run: `DATABASE_PATH=/tmp/mt-import.db npm start` and open `http://127.0.0.1:3000/`
Expected: searching "villeneuve" finds nothing (search is title-only), "dune" finds Dune. A future date or rating 11 shows the API error inline. A note containing `<b>x</b>` displays literally.

- [ ] **Step 4: Check Review Focus 5**

Run: `grep -n innerHTML public/app.js`
Expected: no matches.

- [ ] **Step 5: `npm run check`, then commit**

```bash
git add public
git commit -m "Add catalog search and movie watch screens to the web UI"
```

### Task 5: History and dashboard screens

**Files:**
- Modify: `public/app.js`, `public/style.css`

**Interfaces:**
- Consumes: `api`, `el`, `route` (Task 4); `GET /watches` with its query params (read `WatchListQuery` in `src/schemas/watch.ts` for the exact names), `GET /profile`, `GET /recommendations?limit=10`, `GET /stats`.

- [ ] **Step 1: History at `#/history`**

A filter bar built from `WatchListQuery` (genre, rating range, date range, sort, order) that reloads the list. Rows show date, rating, title (linking to `#/movies/:id`) and note. Pagination works as in the catalog.

- [ ] **Step 2: Dashboard at `#/dashboard`**

Three sections, each rendering every field of its response schema (`src/schemas/profile.ts`, `recommendation.ts`, `stats.ts`):
- **Profile:** top genres and directors with their values
- **Recommendations:** title link, score and explanation text
- **Stats:** counts and the genre/year breakdowns as simple horizontal CSS bars

An empty history shows a "Rate a movie to see this" line instead of empty boxes.

- [ ] **Step 3: Check it in the browser**

Expected: with 0 watches, every section shows its empty line. After rating 3 movies, the profile, recommendations and stats fill in, and the history filters change the list.

- [ ] **Step 4: `npm run check` and `grep -n innerHTML public/app.js` (no matches), then commit**

```bash
git add public
git commit -m "Add history and dashboard screens to the web UI"
```

### Task 6: Record the decisions in the vault

**Files:** none in this repo (the vault goes through MCP only).

- [ ] **Step 1:** Run `/record-adr` for "IMDb datasets as catalog source, imported through MovieService". Link it to the Movie concept and the MovieService component.
- [ ] **Step 2:** Run `/record-adr` for "Static no-build web UI served by the API (@fastify/static, public/)". Link it to ADR-001.
- [ ] **Step 3:** Run `get_note` on each new ADR. Expected: the note exists, the relations resolve, and it's linked from the MOC.
