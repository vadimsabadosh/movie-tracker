# Orchestrator UI check: movie-details (after implementation round 1, before review)

Setup:
- Test server started as `DATABASE_PATH=data/posters-test.db PORT=3077 node src/server.ts`, with no token. The server applied migration 5 to the **test** DB (`user_version` 5).
- Details seeded in SQL for Arrival (id 14629):
  - a long overview (the same sentence 3 times), each copy containing `<b>not bold</b>`;
  - 10 actors in billing order, the last one (Frank Schorpion) with an empty character.
- Movie 1 (The Birth of a Nation) has no saved details, so `/details` answers 503 `DETAILS_UNAVAILABLE`.

| Check | Result |
|---|---|
| Plot (D9) | Shown under the genre chips in the head card, wrapping normally. `<b>not bold</b>` appears literally, and there is no `<b>` element in the page |
| Cast card (D9, Q3, Q5) | "Cast" card between the head card and "Your watch". 10 entries in seeded order, shown as "Amy Adams as Louise Banks". The empty character shows the name only ("Frank Schorpion"). 2 columns at full width |
| No details (Q6) | On movie 1, after the 503, there is no `.overview`, no `.cast` and no error line. The page has its 2 usual cards, as before |
| Narrow (600 px same-origin iframe) | The cast list becomes 1 column (`grid-template-columns: 511px`). No horizontal overflow |
| Endpoint | `GET /movies/14629/details` returns the seeded data. `GET /movies/1/details` gives 503 `{"code":"DETAILS_UNAVAILABLE","message":"TMDB is not configured"}` |

No UI observations.

## Guardrail note for the transcript
The Coder reports (02, "B5 slip") that it rewrote `src/server.ts` with a Bash heredoc that had the env var **name** `TMDB_ACCESS_TOKEN` in the command text. B5 lists `*_TOKEN` variables in a command as a deny (`docs/guardrails.md` line 37). `.claude/guardrails.log` has **no** B5 entry for it, so the hook does not scan heredoc bodies. No value was exposed. This is the second Bash-content gap found after the posters W3 gap. Fixing it belongs in `harness/hooks/**` (B6), which only the human can change.
