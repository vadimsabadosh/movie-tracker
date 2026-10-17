# Task: Recommendations (FR-7)

## In the human's words
"Finish the app": FR-6 is done (`docs/orchestration/preference-profile/`), now FR-7, then FR-8. Recommendations: a list of unwatched catalog movies ordered by a deterministic score based on the preference profile (FR-6); each recommendation has an explanation. The recommender sits behind a `Recommender` interface so another algorithm can be swapped in. Slug: `recommendations`.

## Requirements
- **FR-7** (`docs/app-requirements.md`): recommendations — unwatched catalog movies, ordered by a deterministic score from the preference profile (FR-6); every recommendation contains an explanation. Implemented behind the `Recommender` interface.
- **NFR-1:** p95 ≤ 200 ms on a catalog of up to 10 000 movies.
- **NFR-2:** all input validated by Zod; errors in the common format.
- **NFR-3:** parameterized SQL only.
- **NFR-4:** `npm run format`, then `npm run check` (typecheck, ESLint, Prettier check, tests with the 80 % coverage floor).
- **NFR-5:** the same database state gives the same recommendations, including order — tests can assert the exact order.
- **NFR-6:** OpenAPI matches the endpoints.

## Starting point
- `ProfileService.get(): PreferenceProfile` (`src/services/profile-service.ts`, `services.profile` in the container) is the FR-7 entry point. Its contract — order, rounding, grouping — is ADR-013.
- Vault: `Recommendation`, `Recommender`, `Recommendation Score`, `Preference Profile`, `Genre`, `Director`, `Movie`; ADR-003 (deterministic recommender behind an interface; ties by movie id; weights fixed in code and tests), ADR-013, ADR-001, ADR-004, ADR-009, ADR-011.

## Constraints
- The `orchestrate` skill: the Planner and Reviewer are read-only; only the Coder edits `src/` and `test/`; the orchestrator owns commits and vault writes.
- Guardrails per `docs/guardrails.md`. Files in `src/recommendation/` are **W5** (the human approves each change: it changes deterministic output). A migration is W3.

## Out of scope
- Statistics (FR-8) — the next orchestration.
- LLM-based recommendations (ADR-003: an optional extension behind the same interface, not now).
- Changes to existing endpoints, including `/profile`.
