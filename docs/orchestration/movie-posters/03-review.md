# Review: movie-posters (round 1)

## Verdict: APPROVE

## Checks (re-run by reviewer)
- npm run check: passes. Typecheck, ESLint and the Prettier check ("All matched files use Prettier code style!") all ran clean, and coverage is above the 80 % floor.
- tests: `Test Files 14 passed (14)  Tests 171 passed (171)`. Coverage: statements 97.73 %, branches 86.45 %, functions 99.18 %, lines 98.54 %.
- layer check: clean. All three greps from `.claude/skills/new-module/SKILL.md` step 5 print nothing. An extra grep on `src/clients/` for db, repositories, better-sqlite3 or fastify imports also prints nothing.
- Protected files: no changes under `src/recommendation/`, `.claude/hooks`, `docs/guardrails.md`, `CLAUDE.md`, tsconfig, eslint or vitest configs. The only config change is the `package.json` `start` script, which was W4-approved and planned in D7.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates | Suggested fix |
|---|---|---|---|---|---|---|
| m1 | minor | docs/app-requirements.md:16 | The scope section still says TMDB integration is "можливе розширення, не базова вимога", but FR-9 (line 31) now makes it a requirement. | `grep -n TMDB docs/app-requirements.md` → lines 16 and 31 | D11 consistency | Orchestrator or human: reword line 16 (e.g. "only posters, FR-9; other metadata out of scope"). |
| m2 | minor | src/db/migrations.ts:276 | `CHECK (imdb_id GLOB 'tt[0-9]*')` also accepts `tt1abc`, because `*` matches anything. The app regex `/^tt\d+$/` is stricter, so the DB check is weaker than it looks. | GLOB semantics; the plan dictated this exact SQL | — (follows D2) | Optional while the migration is still uncommitted: `imdb_id GLOB 'tt[0-9]*' AND imdb_id NOT GLOB 'tt*[^0-9]*'`. Otherwise accept it as is, since only the validated importer writes the column. |
| m3 | minor | test/tmdb.test.ts:13-19 | Tests do not check the `accept` header or the 5 s timeout `signal` from D6. | The test only checks the URL and `authorization` | test plan (partial, not a listed case) | Optional: `expect(init.signal).toBeInstanceOf(AbortSignal)`. |

No blockers or majors.

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 match via `/find/{imdbId}` | yes | `src/clients/tmdb.ts:28`. `encodeURIComponent` was added as extra defence. |
| D2 migration 3 | yes | Appended. Entries 1–2 untouched. W3 approved. |
| D3 imdbId not in API or MovieInput | yes | `Movie` shape unchanged; test at posters.test.ts "leaves the Movie response shape unchanged". |
| D4 302 + cache-control, 404, 503 | yes | Also documents 400 (justified by NFR-6). `z.null()` works for the 302 body. |
| D5 PosterService | yes | A failure is not saved. `''` is saved for "no poster". NotFound and AppError 503 as specified. |
| D6 client | yes | Bearer header, timeout, Zod with the strict regex, the error message is only the status code, `undefined` when there is no token. |
| D7 env and `--env-file-if-exists` | yes | The env var is read only in `server.ts`. |
| D8 hot-link w342 | yes | `TMDB_IMAGE_BASE`. |
| D9 importer back-fill | yes | `UPDATE OR IGNORE … imdb_id IS NULL` with named params. Bad tconst → invalid. `linked` printed. |
| D10 UI | yes, with justified tweaks | 640 px grid span and floated recs thumbnail are explained in the notes. History unchanged. `alt=''`, lazy loading, fixed width/height, `.missing` placeholder. |
| D11 FR-9 | yes | See m1. |
| D12 ADR by orchestrator | pending | See candidates below. |
| Step 2: `?` → `@named` params | changed, justified | Same behaviour, follows the Coder rules. |
| Steps 6, 9, 12, 13 | yes | `testApp` now accepts `Omit<AppOptions,'db'>`. |
| Test plan | all cases covered | Fresh and v2→v3 migration, CHECKs, 404 / 400 / no-imdb (source not called) / 302 cached once / null remembered / throw → 503 with nothing saved / no source → 503 / no source but saved → 302 / OpenAPI / client cases / importer linked counts and the hand-added movie / attribution in `GET /`. |

## Context check
The Coder kept the plan's reasons intact:
- A failure is not cached, so a network blip cannot hide a poster permanently.
- A path is stored, not a URL, so the image size stays in code.
- The strict regex keeps odd values out of `<img src>`.
- The token is read only in the entry point and never appears in error messages.
- History `.row` is untouched because the change uses a new `with-poster` class.
- The importer goes through the service, not around it.

I found no place where a reason was lost. The `onerror` listener is attached after `src` in `el()`, but image error events fire asynchronously, so it still works.

## Good
- The 503 vs 404 split is clean, and the tests show it, including that the source is called exactly once for both the success and the null case.
- External JSON is validated at the boundary with Zod (NFR-2), and the client takes an injected `fetch`, so tests need no network.
- The importer re-run is idempotent and safe: `IS NULL` never overwrites and `OR IGNORE` skips a unique clash. The test for a hand-added movie proves the case-insensitive link via `title_key` (ADR-008).
- The 302 response is documented in OpenAPI rather than left out (NFR-6).

## ADR candidates (for record-adr)
- ADR-016 (planned in D12): posters from TMDB matched by IMDb ID, fetched lazily on first request, path stored in `movies.poster_path` (NULL = not looked up, `''` = none), images hot-linked from the CDN at w342, served via a 302 from `GET /movies/:id/poster`.
- External-ID convention: `movies.imdb_id` is storage-only, set only by the importer, never exposed in the API, and left as is when title or year changes via PUT.
- Convention for optional external services: the client returns `undefined` with no credential, failures map to 503 `POSTER_UNAVAILABLE`, and the credential comes from env through `--env-file-if-exists` in the entry point only. This is the NFR-7 pattern for any future integration.
- The Movie concept note gains `imdb_id` and poster as storage-only attributes.

---
What I did not check:
- I could not reach the vault MCP, so I did not read the ADR or concept notes there. I compared against the plan's cited vault facts and the code instead.
- I did not view the UI in a browser: the placeholder look, the 640 px layout and the broken-image hiding are unverified.

I made no real TMDB calls and did not read `.env`. Risk to know: posters appear only after the human re-runs `npm run import:imdb` (back-fill) and sets the token.
