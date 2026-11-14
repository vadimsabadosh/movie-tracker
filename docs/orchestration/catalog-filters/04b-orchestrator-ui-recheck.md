# Orchestrator UI re-check: catalog-filters (after implementation round 2)

Same setup as `02b`: Chrome, `data/posters-test.db` at version 4 with IMDb data, server on port 3077 with no token. The narrow layout was checked in a 600 px same-origin iframe.

| Finding | Check | Result |
|---|---|---|
| F2 / V1: heights | Height of every `input` and `select` in `.filters`, on both Catalog and History, at full width and at 600 px | All **38.4 px**; only one value appears |
| F2 / V1: labels | Labels grouped by their top coordinate | Each visual row lines up. Full width: Catalog has `Genre, Year from, Year to, Director` and then `Watched, Sort by, Order`; History has `Genre, Rating from, Rating to, Watched from` and then `Watched to, Sort by, Order`. At 600 px both forms are 2 columns, with every pair aligned |
| F2 / V1: option text | Zoomed screenshot of the Catalog form at full width | "Popularity (votes)" is fully visible (the select is 212.5 px wide) |
| F2: overflow | `scrollWidth > clientWidth` on both pages at both widths | None |
| F1 | `/genres` made to fail with a 500 inside the page by wrapping `fetch`, then the Catalog was re-rendered | "Could not load genres: boom" stays visible after the movie list (20 rows) has loaded. After `fetch` was restored, the dropdown filled normally |

No new observations.
