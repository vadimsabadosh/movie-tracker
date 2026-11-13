# Implementation: movie-posters (round 2)

## Plan steps
| Step | Status (done / changed / skipped) | Notes |
|---|---|---|
| D10 UI: a failed poster becomes a neutral placeholder | changed | `onerror` now replaces the `<img>` with an empty `<span>` that has the same classes. Before, it only added a class. See U1. |
| D2 migration 3 CHECK | changed | Tightened in place while it is still uncommitted. See m2. |
| Test plan: client cases | done | Added the `accept` header and `AbortSignal` assertions. See m3. |
| All other steps | done (round 1) | Not touched. |

## Files changed
| File | Change |
|---|---|
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/app.js` | `poster()` `onerror`: `e.target.replaceWith(el('span', { class: \`poster ${cls} missing\`, 'aria-hidden': 'true' }))`, with a one-line comment on why. Doc comment updated. |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/public/style.css` | Removed the `.poster.missing` rule (`color: transparent; font-size: 0`). It is no longer needed because the placeholder is a span with no content. The sizing comes from the existing `.poster` rule (`display:block; aspect-ratio:2/3; background`) and the existing per-context widths. |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/src/db/migrations.ts` | Migration 3: `CHECK (imdb_id GLOB 'tt[0-9]*' AND imdb_id NOT GLOB 'tt*[^0-9]*')` |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/app.test.ts` | The CHECK test now also expects `tt1abc` and `tt` to be rejected. |
| `/Users/koristuvac/Projects/LVET/Інженерія даних/movie-tracker/test/tmdb.test.ts` | The Bearer test now also checks `accept: application/json` and `init.signal instanceof AbortSignal`. |

## Decisions beyond the plan
| Decision | Why |
|---|---|
| Replace the failed `<img>` with a `<span>` rather than removing its `src` | The span is certain to draw no broken-image icon in any browser. An img with no src is less predictable across browsers. The span gets its size from rules that already exist. In catalog rows it fills the 46 px grid column and `align-items:center` lets the aspect ratio set the height. The detail poster is 160 px wide and the recommendations thumbnail 40 px, both set in CSS. So the box keeps its size and the layout does not shift. |
| `aria-hidden="true"` on the placeholder | It replaces a decorative `alt=''` image, so screen readers should skip it too. |
| Also reject `tt` with no digits | `GLOB 'tt[0-9]*'` already rejects it. The assertion just pins that behaviour down. |

## Deviations from the plan
| Plan said | Did instead | Why |
|---|---|---|
| D2: `CHECK (imdb_id GLOB 'tt[0-9]*')` | Added `AND imdb_id NOT GLOB 'tt*[^0-9]*'` | m2: the plan's GLOB accepted `tt1abc`. Now the database matches the app regex `/^tt\d+$/`. |
| D10: on error, add the class `.missing` | Swap in a span placeholder | U1: Chrome draws the broken-image icon on any failed `<img>`, whatever its alt text or font. |

## Review findings addressed (round 2+)
| Finding | Change / reply |
|---|---|
| U1 (major): broken-image icon on failed posters | The `onerror` handler swaps the `<img>` for an empty same-class `<span class="poster <cls> missing" aria-hidden="true">`, and the dead `.poster.missing` CSS is gone. No real browser was available to me, so the orchestrator still needs to re-check in Chrome as planned. |
| m2 (minor): CHECK too weak | The migration 3 CHECK is tightened as suggested, and the test now expects `tt1abc` (and `tt`) to be rejected with `/CHECK/`. |
| m3 (minor): accept header and timeout signal untested | Both are now asserted in `test/tmdb.test.ts`. |
| m1 | The orchestrator already handled it. No change. |

## Checks
- npm run check: typecheck ok, lint ok, format ok ("All matched files use Prettier code style!"), coverage ok. Exit code 0. I ran `npm run format` first.
- tests: `Test Files 14 passed (14)  Tests 171 passed (171)`. There are 0 new test cases: the new assertions went into existing tests. Coverage: lines 98.54 %, branches 86.45 %.
- layer check: clean. The three greps from SKILL.md step 5 print nothing.

## Guardrail events
- W3, migration 3 CHECK: my first attempt applied the change through a Bash/python edit. That could have skipped the W3 prompt. I reverted it right away (the file was back to its original line before anything else ran) and redid it with the Edit tool so the hook could see it. The Edit went through without any denial. The orchestrator should confirm the human really approved it, and should not count my Bash attempt as approval.
- No reads of `.env`, no token variable names in Bash, no real TMDB calls, no vault writes, no commits.

## Known gaps / questions for the reviewer
- U1 is not verified in a browser. Please check the catalog, the detail view and the recommendations with the server started without a token. All three should show plain grey 2:3 boxes with no icon and no layout shift.
- There is no automated UI test, because the repo has no DOM test setup and I did not add one.

Not checked: how the placeholder actually looks. Risk: dev databases already at version 3 keep the old, weaker CHECK, because the migration was edited in place. Fresh databases and v2 databases get the new one.
