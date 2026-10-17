# Task: Preference Profile (FR-6)

## In the human's words
"Finish the app": implement FR-6, then FR-7 and FR-8 in separate orchestrations. This one is FR-6 — an endpoint (`GET /profile`) computed from the watch history: favourite genres (by count and ratings), favourite directors, average rating per genre. Not stored separately (vault: Preference Profile). It is the input for FR-7 recommendations, which follow next, so the service should expose the profile computation for reuse. Slug: `preference-profile`.

## Requirements
- **FR-6** (`docs/app-requirements.md`): preference profile — favourite genres and directors, average personal rating per genre.
- **NFR-1:** p95 ≤ 200 ms on a catalog of up to 10 000 movies; aggregation in SQL.
- **NFR-2:** all input validated by Zod; errors in the common format.
- **NFR-3:** parameterized SQL only.
- **NFR-4:** `npm run check` must pass — typecheck, ESLint, Prettier check, tests with the 80 % coverage floor. Run `npm run format` before it.
- **NFR-5:** deterministic — the same database state gives the same profile (FR-7 depends on it).
- **NFR-6:** OpenAPI matches the endpoints.

## Starting point
- Implemented: Movies (FR-1, FR-5), Watch Entry (FR-2, FR-3), Watch History (FR-4, `docs/orchestration/watch-history/`).
- Vault concepts: `Preference Profile`, `Watch History`, `Watch Entry`, `Rating`, `Genre`, `Director`, `Recommender`. ADRs: ADR-001, ADR-003, ADR-004, ADR-008, ADR-009, ADR-011. `search_notes` is semantic since PR7 (ADR-012).
- New since PR6: `npm run check` (ESLint in `tools/lint`, Prettier, coverage floor).

## Constraints
- The `orchestrate` skill: the Planner and Reviewer are read-only; only the Coder edits `src/` and `test/`; the orchestrator owns commits and vault writes.
- Guardrails per `docs/guardrails.md`. A migration (W3) or a change in `src/recommendation/` (W5) needs the human's approval.

## Out of scope
- Recommendations (FR-7) and Statistics (FR-8) — next orchestrations. Only make the profile computation reusable for FR-7.
- Changes to existing endpoints.
