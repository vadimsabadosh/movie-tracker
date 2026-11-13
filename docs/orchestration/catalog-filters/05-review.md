# Review: catalog-filters (round 2)

## Verdict: APPROVE

All three round-1 findings (F1–F3) are fixed. `npm run check` exits 0 with 205 tests passing, and coverage is the same as round 1. Nothing open needs to go to the human.

## Checks (re-run by reviewer)
- **npm run check:** exit 0. I captured the exit code directly, not through a pipe. Typecheck, ESLint, Prettier and the coverage floor all pass.
- **Tests:** `Test Files 15 passed (15)`, `Tests 205 passed (205)`.
- **Coverage:** statements 98.09 %, branches 88.26 %, functions 100 %, lines 98.63 %. This is identical to round 1, as expected because `src/` did not change in this round.
- **Layer check (SKILL step 5):** all three greps print nothing.
  - Routes do not import db or repositories.
  - Services do not import fastify, better-sqlite3 or db.
  - Repositories contain no `${` and no string concatenation.
- **Guardrails:**
  - `git diff HEAD --stat` on `src/recommendation`, `src/schemas/recommendation.ts`, `src/services/poster-service.ts`, `package.json` and `tsconfig.json` is empty.
  - Round 2 touched only `public/style.css`, `public/app.js` and `test/movies.test.ts`.
  - No migration, config or W4/W5/B6 files changed.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates | Suggested fix |
|---|---|---|---|---|---|---|
| — | — | — | No new findings | — | — | — |

Status of the round-1 findings:
- **F1: resolved.**
  - `genreSelect(genreError)` now writes to its own `errorLine()` on both screens (`public/app.js` ~l.26/29 and ~l.137/140).
  - `load()` clears only `error`, so a genre failure stays on screen.
  - The text "Could not load genres: …" says which request failed.
  - The orchestrator's Chrome recheck (04b) confirmed it: with `fetch` forced to return 500, "Could not load genres: boom" stayed visible after 20 rows loaded.
- **F2: resolved.**
  - `input, select { height: 2.4rem }` makes the heights equal.
  - `.filters` now uses `minmax(180px, 1fr)`.
  - `.filters > * + * { margin-top: 0 }` removes an 8 px margin from every field after the first. That margin came from `.card > * + *` (style.css l.122) and was a second cause of the uneven labels. The Coder found it and it is a real cause.
  - The new rule has the same specificity (0,1,0) as `.card > * + *` but comes later in the file, so it wins. It only affects the two `card grid filters` forms (app.js l.195, l.428).
  - In 04b's Chrome measurements every field is 38.4 px, labels line up per row at full width and at 600 px, "Popularity (votes)" fits in a 212.5 px select, and there is no horizontal overflow.
- **F3: resolved.**
  - `afterEach(() => app.close())` is at the top level (test/movies.test.ts l.13).
  - The "catalog sorting" `beforeEach` runs `await app.close()` before it reassigns `app` (l.241–242), so each app is closed exactly once.

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| Round-1 decisions D1–D18, Q10 | Yes (unchanged) | No `src/` diff this round. The full suite still passes, so nothing regressed. |
| Step 14 back-fill | Skipped by design | Left to the human (`npm run import:imdb`). |
| Round-2 fixes F1–F3 | Yes | They follow the round-1 suggestions (F1 option 1, F2 equal heights plus wider minimum, F3 `afterEach`). The one extra decision, the margin reset, is justified and scoped. |

## Context check
No reason was lost.
- F1 exists so that the genre failure stays visible (D16's intent), and a separate error line achieves exactly that.
- F2's height value of 2.4rem matches the 38.4 px Chrome already gave inputs, so only selects change size. The add-movie and watch-form selects now match the inputs next to them, which is consistent.
- The margin reset is limited to `.filters`, so other cards keep their spacing.

## Good
- The Coder found the second cause of the label misalignment (the card margin) instead of only matching heights.
- Each CSS rule has a one-line comment saying why it exists.
- The orchestrator checked the result in Chrome (04b) at both widths and forced the F1 failure case, which is real evidence rather than arithmetic.

## ADR candidates (for record-adr)
- No new candidates from round 2.
- The round-1 list in `03-review.md` still stands: the ADR-011 follow-up on CASE ORDER BY at 20 000 rows; IMDb rating/votes as nullable imported data; `CatalogMovie` extending `Movie`; back-filling data in migrations through a JS SQL function; the `GET /genres` contract; and boolean flags as `z.enum(['true','false'])`.

Files:
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/style.css
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js
- /Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/movies.test.ts

What I did not check:
- The UI in a browser myself. I relied on 04b.
- ADRs against the vault, because the vault MCP failed to connect again in this session.

Risks:
- The round-1 note still applies. Movies added through the old server after the accidental v4 migration may have an empty `director_key`, and re-running the import does not fix it. A read-only `SELECT count(*) FROM movies WHERE director_key = '' AND director <> ''` will show whether any exist.
- The 180 px minimum overflows on viewports narrower than about 250 px. The old 130 px minimum also overflowed on very narrow screens, just a little later.
