# Review: movie-details (round 1)

## Verdict: APPROVE

No blockers and no majors. Every plan decision (D1 to D10) is implemented as planned, with no deviations, and all checks pass when re-run.

**Vault:** the vault MCP server failed to connect in this session, so I made no `get_note` calls. I checked ADR-001, ADR-004 and ADR-008 against how the plan, the code comments and `.claude/skills/new-module/SKILL.md` describe them, not against the vault notes.

## Checks (re-run by reviewer)
- **npm run check:** passed. Typecheck, ESLint and Prettier ("All matched files use Prettier code style!") are clean, and coverage is above the 80 % floor.
- **Tests:** `Test Files 16 passed (16)`, `Tests 224 passed (224)`.
  - Coverage overall: statements 98.25 %, branches 89.32 %, functions 100 %, lines 98.75 %.
  - `details-service.ts`: 100 % lines, 94.44 % branches. The only uncovered branch is line 20, the `?? '[]'` fallback.
- **Layer check** (SKILL step 5 greps):
  - routes that import db or repositories: none;
  - services that import fastify, better-sqlite3 or db: none;
  - SQL built from strings (`${` or `+ '`) in repositories: none;
  - `src/clients/` does not import schemas.
- **Guardrails:**
  - `.claude/guardrails.log` has a W3 `Edit` (ask) entry at 2026-11-13T16:45:37Z for migration 5. Its `new_string` is the same as the diff. Migrations 1 to 4 are byte-identical (append-only).
  - `git diff HEAD --stat` is empty for `src/recommendation/`, `src/schemas/recommendation.ts`, `package.json`, `package-lock.json`, the configs, `harness/`, `docs/guardrails.md`, `src/services/poster-service.ts`, `test/posters.test.ts` and `test/movies.test.ts`.
  - The diff of `src/schemas/movie.ts` only adds lines, so `Movie`, `CatalogMovie` and `MoviePage` are untouched.
  - The only line removed from `test/tmdb.test.ts` is the import line, which now also imports the new names. The poster test bodies are unchanged.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates | Suggested fix |
|---|---|---|---|---|---|---|
| m1 | minor | `src/clients/tmdb.ts:12` and `src/schemas/movie.ts:66` | Two different types are both called `MovieDetails`. The client's interface has `overview: string`, where `''` means none. The schema type has `overview: string \| null`. `details-service.ts` imports only the schema one, but a later import from the wrong module would still typecheck in most places and change what "empty" means. | Two exports named `MovieDetails` with different `overview` types | Maintainability (the plan allowed a plain interface but did not pick the name) | Rename the client interface to `TmdbDetails` or `FoundDetails` when the file is next touched. |
| m2 | minor | `src/repositories/movie-repository.ts:186-188` | The row type `{ imdbId; overview; castJson }` is written twice: once as the return type and once in the `as` cast. | diff lines 186-188 | Style | Use one local `type DetailsRow = …`. |
| m3 | minor | `src/services/details-service.ts:20` | The saved `cast_json` is read with `JSON.parse(...) as CastMember[]`, with no Zod parse. The DB CHECK only guarantees that it is an array. If someone edits it by hand to `[1]`, the Zod response serializer fails and the endpoint returns a 500, not a clean result. The UI swallows the error, so the page still renders. | CHECK in migration 5 tests `json_type = 'array'` only | NFR-2 (an edge case; data written by the app itself is always valid) | Optional: `z.array(CastMember).parse(...)`, or accept the current behaviour as is. |
| p1 | process (not a code finding) | `src/server.ts` (how it was written) | The Coder wrote this file through a Bash heredoc, so the env var name `TMDB_ACCESS_TOKEN` appeared in the Bash command text. That breaks B5 by the letter. `guardrails.log` has no B5 entry, so the hook does not scan heredoc bodies. No value was exposed. The resulting file is correct: one `const token` passed to both factories. | 02-implementation.md "Guardrail events"; 02b note; no B5 line in the log | B5 | Fixing the hook belongs to the human (B6, `harness/hooks/**`). Nothing to change in this diff. |

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 FR-10 and section 3 | Yes | Wording matches D1 exactly in `docs/app-requirements.md`. |
| D2 two documented calls, `language=en-US` | Yes | `/find?external_source=imdb_id&language=en-US`, then `/movie/{id}/credits?language=en-US`. With no match, the second call is not made (a test checks `toHaveBeenCalledTimes(1)`). |
| D3 migration 5 | Yes | SQL and comment are verbatim. `cast_json` avoids the `CAST` keyword. Written by Edit (log entry present). |
| D4 `get` helper, `DetailsSource`, `tmdbDetailsSource` | Yes | `get(fetchFn, token, url)` is a module-level function rather than a closure; the Coder gave the reason. The poster refactor does not change behaviour: same URL, headers, 5 s timeout, `!ok` throw message and `FindResponse.parse`. The old poster tests pass unmodified. |
| D5 Zod at the boundary and the mapping | Yes | `id` is a positive int and goes through `encodeURIComponent`. The schemas use `nullish` and `name.trim().min(1)`. The cast is sorted with `toSorted` by `order`, cut at `slice(0, CAST_LIMIT)`, and character is `?? ''`. |
| D6 `GET /movies/:id/details` | Yes | Responses 200/400/404/503 are in the schema. "None" gives 200 `{overview:null,cast:[]}`. |
| D7 `DetailsService` | Yes | Order: NOT_FOUND, then saved data, then DETAILS_NOT_LINKED, then no source (503), then a TMDB throw (503, nothing saved), then one save. Saved data is served without a token. |
| D8 repository | Yes | Named parameters, one UPDATE, `JSON.stringify` inside the repository. It uses `CastMember[]` instead of an inline type; the Coder gave the reason. |
| D9 UI | Yes | The page renders first, then details are fetched without awaiting. All text goes through `el()`. The Cast card comes before the watch form. Errors add nothing. The orchestrator's Chrome check (02b) confirmed that `<b>` shows literally, 10 actors, an empty character, 1 and 2 columns, and no extra content on a 503. |
| D10 no package, importer or recommendation changes | Yes | Verified with `git diff --stat`. |
| Test plan | Yes | All rows are covered. The "fresh DB has the columns" row is covered implicitly: the CHECK test runs on `openDatabase(':memory:')` and `user_version === MIGRATIONS.length`. `GET /movies/:id` is unchanged, checked in details.test.ts and by the untouched movies.test.ts. |

## Context check
The Coder kept the plan's reasons intact:
- The "failure is never cached" reason holds: the 503 test checks that the DB is still NULL and that the source is called again.
- The "page never waits on TMDB" reason holds: there is a separate endpoint and the UI does not await it.
- The "untrusted text" reason holds: everything is rendered as text.
- The "do not rewrite working poster code" reason holds: the poster change is limited to the `get` extraction, and the poster tests are byte-identical.
- The `?? '[]'` fallback is defensive and harmless.

I found no place where a reason was lost.

## Good
- `DetailsService` lines up with `PosterService`, so the two are easy to diff, and its 404 code (`DETAILS_NOT_LINKED`) is distinct from "TMDB has none".
- The client test checks both URLs, both headers, the `AbortSignal`, billing order with shuffled `order` values, the null character, and that the token does not leak on both 401 and 500.
- The `get` helper removes the copy-pasted header and timeout code without touching poster behaviour.
- The UI change is small. Keeping `info` and `head` as references avoids DOM queries. If the user navigates away first, the late fill writes into detached nodes, which is harmless.

## ADR candidates (for record-adr)
- **TMDB enrichment pattern** (FR-9 and FR-10): a lazy lookup on first view, saved in a column where `NULL` means not asked and `''` or `'[]'` means none, failures never cached, 503 for "cannot ask", a separate 404 code for "no IMDb link", and works offline after the first view. There are now two consumers, so it is worth recording.
- **Storing a display-only list as a JSON column with a CHECK** (`cast_json`, `json_valid` plus `json_type = 'array'`) instead of a normalized table, with the condition for moving to a `movie_cast` table later: an actor filter.
- **Separate sub-resource endpoints for slow external data** (`/movies/:id/details`, `/movies/:id/poster`) instead of growing `CatalogMovie`. This keeps `GET /movies/:id` fast and free of network failures.

Files reviewed (absolute paths):
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/clients/tmdb.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/services/details-service.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/routes/details.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/repositories/movie-repository.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/migrations.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/details.test.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/tmdb.test.ts
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/app.test.ts

Not checked: the vault (MCP disconnected); live TMDB behaviour (the `language` parameter on `/find` and the real `/credits` shape) is tested only against fakes, so the human should do one live lookup after merge. I did not run a browser myself and relied on the orchestrator's 02b Chrome check for the UI. Risk: the B5 heredoc gap in the hook is still open until the human fixes `harness/hooks/**`.
