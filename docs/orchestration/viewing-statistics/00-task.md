# Task: Viewing Statistics (FR-8)

## In the human's words
"Finish the app": FR-6 (`docs/orchestration/preference-profile/`) and FR-7 (`docs/orchestration/recommendations/`) are done; this is the last one, FR-8. Statistics: number of watched movies, average rating, distribution by genre and by year. Slug: `viewing-statistics`.

## Requirements
- **FR-8** (`docs/app-requirements.md`): statistics — number of watched movies, average rating, distribution by genres and by years.
- **NFR-1:** p95 ≤ 200 ms on a catalog of up to 10 000 movies; aggregate SQL queries (vault: Viewing Statistics).
- **NFR-2:** all input validated by Zod; errors in the common format.
- **NFR-3:** parameterized SQL only.
- **NFR-4:** `npm run format`, then `npm run check` (typecheck, ESLint, Prettier check, tests with the 80 % coverage floor).
- **NFR-5:** deterministic output, including the order of the distributions.
- **NFR-6:** OpenAPI matches the endpoints.

## Starting point
- Implemented: Movies (FR-1, FR-5), Watch Entry (FR-2, FR-3), Watch History (FR-4), Preference Profile (FR-6, `GET /profile`), Recommendations (FR-7, `GET /recommendations`).
- Vault: `Viewing Statistics`, `Watch History`, `Rating`, `Genre`, `Movie`; ADR-009 (FR-8 counts `watches` rows without DISTINCT), ADR-010 (in FR-4 "year" means the movie's release year), ADR-011, ADR-013 (how the profile groups genres, rounds averages and orders lists — the closest precedent), ADR-001, ADR-004.
- `/profile` already returns per-genre counts and averages. Deciding how `/stats` relates to it (reuse, overlap, or a different meaning) is part of this plan.

## Constraints
- The `orchestrate` skill: the Planner and Reviewer are read-only; only the Coder edits `src/` and `test/`; the orchestrator owns commits and vault writes.
- Guardrails per `docs/guardrails.md`. A migration is W3; `src/recommendation/` is W5 and out of scope here.

## Out of scope
- Changes to existing endpoints.
- Charts, exports, or statistics filters beyond what FR-8 names.
