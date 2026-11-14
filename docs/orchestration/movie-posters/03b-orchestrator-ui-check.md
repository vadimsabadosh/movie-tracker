# Orchestrator UI check: movie-posters (after review round 1)

Both the Coder (02) and the Reviewer (03) said nobody had checked the UI in a browser. The orchestrator checked it in Chrome against a fresh catalog import (`data/posters-test.db`, 19 259 movies, all linked to IMDb), with the server started as `node src/server.ts` so no `.env` was loaded and `GET /movies/:id/poster` answers 503 `POSTER_UNAVAILABLE`.

## Finding sent back to the Coder
| ID | Severity | File | Problem | Evidence | Expected |
|---|---|---|---|---|---|
| U1 | major | `public/app.js` (`poster()`), `public/style.css` (`.poster.missing`) | When the poster request fails, Chrome still draws its broken-image icon in the top-left corner of every placeholder in the catalog rows. `color: transparent; font-size: 0` does not hide it: Chrome draws the icon for any `<img>` whose load failed, whatever its alt text or font. | Screenshot of the catalog: every row shows the icon. In the page: `img.className = "poster thumb missing"`, `complete = true`, `naturalWidth = 0`, computed `font-size: 0px`, `color: rgba(0,0,0,0)`. | A failed poster shows only the neutral placeholder box, with the same size and no layout shift (D10). Likely fix: in `onerror`, stop showing a failed image at all, e.g. replace the `<img>` with a same-sized placeholder element, or remove its `src` and keep the box with CSS. The orchestrator re-checks in the browser after the fix. |

## Reviewer minors to fold into this round (migration still uncommitted)
- **m2:** tighten the migration-3 CHECK so `imdb_id` must be `tt` followed by digits only, matching the app's `/^tt\d+$/`. Extend the existing CHECK test with `tt1abc` rejected.
- **m3:** in `test/tmdb.test.ts`, also check that the request sends `accept: application/json` and passes an `AbortSignal`.

## Already handled by the orchestrator
- **m1:** reworded section 3 of `docs/app-requirements.md`. Posters (FR-9) are now an exception to the TMDB exclusion, and the line about the web UI notes that a simple UI with no build step now exists in `public/`.
