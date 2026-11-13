# Orchestrator UI re-check: movie-posters (after implementation round 2)

Same setup as `03b`: Chrome, `data/posters-test.db` (19 259 movies linked to IMDb), and the server started as `node src/server.ts` with no `.env`, so every poster request answers 503. One movie (Arrival) was rated 9 so the dashboard has recommendations.

## U1: fixed
- **Catalog:** every row shows a plain grey 2:3 box with no broken-image icon. Row height and columns are as before. No `img.poster` elements are left after loading, because all of them were replaced by `span.poster`.
- **Detail:** the placeholder is a `SPAN` of 160 × 240 px, with no icon.
- **Dashboard:** all 10 recommendation thumbnails are `SPAN`, 40 px wide, with no icon.

## New observation for the reviewer (round 2)
| ID | Severity (orchestrator's view) | File | Problem | Evidence |
|---|---|---|---|---|
| U2 | minor | `public/style.css` (`.recs li` / thumbnail float, from round 1) | The ranking numbers of the recommendations list ("1.", "2.", …) are no longer visible. They were visible before posters were added. The `<ol>` still has `list-style-type: decimal`, `list-style-position: outside` and `padding-left: 20px`, but each `li` now has `overflow: hidden` (the round-1 decision "Recommendation thumbnail is floated, and `li` gets `overflow: hidden`"). In Chrome the outside markers are not painted. | Zoomed screenshot of the dashboard: no numbers to the left of the thumbnails. Computed styles: `li overflow: hidden`, `ol list-style-type: decimal`. |

The procedure allows at most two rework rounds. If the Reviewer judges U2 a blocker, the orchestrator stops and gives the open findings to the human instead of starting a third round.

## Guardrail note for the transcript
The Coder's round-2 report says its first attempt at the migration-3 edit was made through Bash/python and then reverted. `.claude/guardrails.log` has **no** entry for that Bash command. The only migration event is the W3 `ask` for the later Edit (2026-11-13T15:30:01Z). So a write to `src/db/migrations.ts` made through a Bash interpreter is not caught by W3. This is a gap in the guardrails. The orchestrator cannot change `harness/hooks/**` (B6), so the gap is reported to the human.
