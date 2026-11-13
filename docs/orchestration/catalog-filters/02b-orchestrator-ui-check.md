# Orchestrator UI check: catalog-filters (after implementation round 1, before review)

The posters task taught us to check in a browser before the review, so the Reviewer sees the results in round 1. Setup:
- Chrome, with `data/posters-test.db` migrated to version 4 and back-filled with `npm run import:imdb`. 19 259 movies, all with an IMDb rating, votes and `director_key`.
- The server was started as `DATABASE_PATH=data/posters-test.db PORT=3077 node src/server.ts`, with no token, so posters are placeholders.
- Interstellar and Arrival are marked watched.

## Works as planned (step 11)
| Check | Result |
|---|---|
| Default catalog sort `votes` desc (Q1) | The list opens on The Shawshank Redemption (3 264 230 votes), The Dark Knight, Inception… instead of `#Alive` |
| IMDb line in rows (D17) | "IMDb 9.3 · 3 264 230 votes" under the title |
| Genre dropdown, catalog (D16) | 25 options ("Any genre" + 24 from `GET /genres`). Western → 222 movies |
| Year range | Western, 1960–1969 → 51 movies (The Good, the Bad and the Ugly…) |
| Inverted year range | Inline error "yearTo: must be ≥ yearFrom" |
| Director substring (Q4) | "nolan" → The Dark Knight, Inception, Interstellar… |
| Watched filter (D14, D15) | With "nolan": Watched → only Interstellar, with the "Watched" mark. Not watched → the rest |
| Sorts | IMDb rating desc, Title A→Z (back to `#Alive`), Release year ascending (Les Vampires, The Birth of a Nation…) all work |
| Movie page IMDb line (D17) | "Directed by Christopher Nolan" / "IMDb 8.7 · 2 633 501 votes" |
| History poster (D18) | First child is a `span.poster.thumb.missing` placeholder (no token). Grid `40px 32px 1fr auto`. No broken-image icon (`img.poster` count 0) |
| History genre dropdown (Q10) | A `SELECT` with 25 options |
| Narrow layout | The window could not be resized, so the app was loaded in a 600 px same-origin iframe, which triggers the 640 px media query. Catalog rows become `46px 1fr` and History rows keep their 4 columns. No horizontal overflow on either page; the rows fit within 551 and 566 px |

## Observation for the reviewer
| ID | Severity (orchestrator's view) | Files | Problem | Evidence |
|---|---|---|---|---|
| V1 | minor | `public/style.css` (form controls), `public/app.js` (filter forms) | In the filter grids on both Catalog and History, dropdowns (`select`) are 36 px tall and text, number and date inputs are 38.4 px. The label above each dropdown also sits higher than the labels above the inputs, so each row of the form looks ragged. The Catalog "Sort by" dropdown cuts its first option to "Popularity (vote…" at full width. The mismatch is not new, since History's Sort/Order dropdowns already had it. Q10 makes it more visible, because Genre is now the first field in both forms | Measured in Chrome: `select` height 36, `input` height 38.398. Screenshots of both forms at full width and at 600 px |

## Process note (for the transcript)
While preparing this check, a mistyped orchestrator command started a stray `node src/server.ts` with the default settings. It could not bind port 3000, which the human's own `npm start` was using, and exited. Before exiting it opened `data/movie-tracker.db` and applied **migration 4 to the human's real database** (`user_version` 3 → 4). The migration is additive (three columns plus the `director_key` back-fill) and is the same one the human's next `npm start` would apply. The orchestrator reported this to the human, together with the advice to restart `npm start`: the running server is older code on a version-4 database, and movies added through it before the restart would get an empty `director_key`.
