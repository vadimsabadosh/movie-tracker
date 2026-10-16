# Task: Watch History (FR-4)

## In the human's words
Implement Watch History: filters on `GET /watches` by genre, movie release year, rating range and watch period; sorting; pagination. Slug: `watch-history`.

## Requirements
- **FR-4** (`docs/app-requirements.md`): history of watched movies with filters (genre, release year, rating range, watch period), sorting and pagination.
- **NFR-1:** p95 ≤ 200 ms on a catalog of up to 10 000 movies; filtering, sorting and pagination happen in SQL.
- **NFR-2:** all input validated by Zod; errors in the common format.
- **NFR-3:** parameterized SQL only.
- **NFR-6:** OpenAPI matches the endpoints.

## Starting point
- `GET /watches` exists (PR5, `src/routes/watches.ts`). It returns `WatchEntry` items (`movieId`, `watchedAt`, `rating`, `note`), newest first, with `limit`/`offset` and no filters.
- Vault concepts: `Watch History`, `Watch Entry`, `Rating`, `Genre`, `Movie`, `Pagination`. ADRs: ADR-001, ADR-004, ADR-008, ADR-009.

## Constraints
- The `orchestrate` skill: the Planner and Reviewer are read-only; only the Coder edits `src/` and `test/`; the orchestrator owns commits and vault writes.
- Guardrails per `docs/guardrails.md`. A migration (W3) needs the human's approval.

## Out of scope
- Preference Profile (FR-6), Statistics (FR-8), Recommendations (FR-7).
- Changes to the Movie and Watch Entry write endpoints.
