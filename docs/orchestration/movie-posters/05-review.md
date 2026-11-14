# Review: movie-posters (round 2)

## Verdict: APPROVE

## Checks (re-run by reviewer)
- `npm run check`: exit code 0. Typecheck, ESLint and Prettier all pass ("All matched files use Prettier code style!"), and coverage is above the 80 % floor.
- Tests: `Test Files 14 passed (14)  Tests 171 passed (171)`. Coverage: statements 97.73 %, branches 86.45 %, functions 99.18 %, lines 98.54 %.
- Layer check (`.claude/skills/new-module/SKILL.md`, step 5): all three greps print nothing.
  - An extra grep on `src/clients/` only matches the letters "db" inside `tmdb` and `imdbId`. There are no imports of db, repositories, better-sqlite3 or fastify.
- Protected files:
  - No diff under `src/recommendation/`, `.claude/hooks`, `harness/hooks`, `docs/guardrails.md`, `CLAUDE.md`, or the tsconfig, eslint and vitest configs.
  - `package.json` changes only the `start` script (D7, approved under W4).

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates | Suggested fix |
|---|---|---|---|---|---|---|
| U2 | minor | `public/style.css:326-328` (`.recs li { overflow: hidden; }`) | The "1.", "2.", … ranking numbers of the recommendation list are no longer drawn in Chrome. Setting `overflow: hidden` on the `li` clips its outside `::marker`. The comment on that line says it "keeps the list numbers", which is now false. So the Coder's own round-1 reason for floating the thumbnail is lost, and the comment misleads. | `04b` re-check shows a zoomed screenshot with no numbers. Computed styles there: `li overflow: hidden`, `ol list-style-type: decimal`, `padding-left: 20px`. At HEAD, `.recs` had only `padding-left: 20px`, so the numbers were visible before this change. | D10 (the round-1 "keeps the `<ol>` numbers" justification) | A follow-up for the human or orchestrator, not a rework round. Replace `overflow: hidden` with `display: list-item flow-root;`, or `display: flow-root list-item`. Both contain the float and keep the marker. I did not try this in a browser. Also fix or remove the comment. |

### Why U2 is minor, not a blocker
- FR-7 still holds. FR-7 asks for an ordered list of unwatched movies, each with an explanation. The items still render top-to-bottom in rank order, each with its `score N` and its explanation.
- The `<ol>` semantics are unchanged, so screen readers still announce the positions.
- Only the visual number cue is lost. It is cosmetic, and the fix is one CSS line.

### Round-1 items
| Item | Status | How I checked |
|---|---|---|
| U1 | resolved | Read the code at `public/app.js:45-56`: on `onerror` the failed `<img>` is replaced by an empty `span.poster <cls> missing` with `aria-hidden="true"`. That span gets its size from existing CSS: `.poster` (`display: block`, `aspect-ratio: 2/3`, background), the 46 px grid column, `.detail-head .poster` 160 px and `.recs .poster` 40 px. The dead `.poster.missing` rule is gone. The orchestrator's browser re-check (`04b`) confirms no icon and no layout shift in the catalog, the detail page (160 × 240) and the recommendations (40 px). |
| m2 | resolved | `src/db/migrations.ts:39` now has `CHECK (imdb_id GLOB 'tt[0-9]*' AND imdb_id NOT GLOB 'tt*[^0-9]*')`. I traced it by hand: `tt1` passes, `tt1abc` fails the second clause, `tt` fails the first. `test/app.test.ts` asserts `x1`, `tt1abc` and `tt` throw `/CHECK/`, and that `''` is accepted for `poster_path`. Entries 1 and 2 are unchanged. The migration is still uncommitted, so editing it in place is acceptable. |
| m3 | resolved | `test/tmdb.test.ts:20-21` asserts `accept: application/json` and `init.signal instanceof AbortSignal`. |

### Guardrail note (from `04b`, for the human, not a code finding)
- W3 did not catch the Coder's first edit to `src/db/migrations.ts`, which went through a Bash/python interpreter. `.claude/guardrails.log` has no entry for it.
- The Coder reverted it and redid the edit with the Edit tool, which hit the W3 `ask` at 2026-11-13T15:30:01Z.
- The final content matches the m2 suggestion. Fixing the gap belongs in `harness/hooks/**` (B6), which only the human can change.

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 match via `/find/{imdbId}` | yes | Unchanged since round 1. |
| D2 migration 3 | changed, justified | The CHECK is tightened (m2), so the database now matches the app regex `/^tt\d+$/`. Append-only relative to committed history. |
| D3 imdbId not in API or MovieInput | yes | Unchanged. |
| D4 302 + cache-control, 404, 503 | yes | Unchanged. `src/routes/posters.ts` also documents 400 (NFR-6). |
| D5 PosterService | yes | Re-read `src/services/poster-service.ts`: a failure is not saved, `''` is saved for "no poster", and 503 vs 404 are split as planned. |
| D6 client | yes | All header and timeout parts are now under test (m3). |
| D7 env and `--env-file-if-exists` | yes | |
| D8 hot-link w342 | yes | |
| D9 importer back-fill | yes | `UPDATE OR IGNORE … imdb_id IS NULL` with `@named` parameters (NFR-3). |
| D10 UI | changed, justified, with one regression | The span swap is better than the plan's "add a class", for the reason given (U1). The recommendation thumbnail's float plus `overflow: hidden` hides the list numbers (U2). |
| D11 FR-9 | yes | The orchestrator handled m1: `docs/app-requirements.md:16` now names posters (FR-9) as the TMDB exception. |
| D12 ADR by orchestrator | pending | See candidates below. |
| Test plan | all cases covered | Same as round 1, plus the m2 and m3 assertions. |

## Context check
- Round 2 kept the plan's reasons.
- The span swap keeps D10's "rows do not jump" goal and its decorative intent: `alt=''` becomes `aria-hidden`.
- The tightened CHECK serves D2's aim of keeping odd values out of the column.
- One reason was lost, from round 1: the float plus `overflow: hidden` on `.recs li` was justified as "keeps the `<ol>` numbers", but in practice it removes them, and the CSS comment still claims otherwise (U2).

## Good
- U1 is fixed at the root. The placeholder is a span, so no browser can draw a broken-image icon on it. It reuses the existing sizing rules and adds no new CSS.
- The fix deleted code: the `color: transparent; font-size: 0` workaround is gone.
- The Coder reported its own W3 bypass attempt honestly and redid the edit through the hooked path. That is how the guardrail gap came to light.
- Migration CHECK tests pin down both edges (`tt`, `tt1abc`) and the allowed `''`.

## ADR candidates (for record-adr)
- **ADR-016 (D12):** posters come from TMDB, matched by IMDb ID through `/find`. They are fetched lazily on the first `GET /movies/:id/poster` and the result is stored in `movies.poster_path` (NULL = not looked up, `''` = TMDB has none, otherwise the TMDB path). Failures are never cached. Images are hot-linked from `image.tmdb.org` at w342 through a 302 redirect.
- **External-ID convention:** `movies.imdb_id` is storage-only. Only the importer sets it, through `MovieService.attachImdbId`. It is never exposed in the API and is not updated when PUT changes the title or year. The database CHECK mirrors the app regex.
- **Optional external services under NFR-7:**
  - The client factory returns `undefined` when there is no credential.
  - Failures map to 503 with a feature-specific code.
  - The credential is read from env only in the entry point, loaded through `--env-file-if-exists`.
  - Clients take an injected `fetch` so tests run without network.
- **UI convention for decorative images:** use `alt=''`, `loading=lazy` and fixed dimensions. On error, swap the image for a same-class `aria-hidden` placeholder rather than styling the broken `<img>`.
- **Movie concept note:** add `imdb_id` and the poster as storage-only attributes.

---
Paths: `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/style.css` (U2, lines 326-328), `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js`, `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/migrations.ts`, `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/app.test.ts`, `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/tmdb.test.ts`.

What I did not check:
- I did not open a browser. The U1 and U2 visuals rest on the orchestrator's re-check in `04b`, and the suggested `display: list-item flow-root` fix for U2 is untried.
- The vault MCP failed to connect this session, so I compared against the plan's cited vault facts rather than the notes themselves.

I made no TMDB calls, did not read `.env`, and used no token names in Bash. Risk to know: a dev database already at user_version 3 keeps the weaker round-1 CHECK. Fresh databases and v2 databases get the tightened one.
