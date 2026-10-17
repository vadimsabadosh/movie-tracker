# Review: Viewing Statistics (FR-8) (round 1)

## Verdict: APPROVE

I found no blockers and no majors. The two minors below are optional.

## Checks (re-run by reviewer)
- **npm run check:** exit 0. Typecheck, ESLint and the Prettier check ("All matched files use Prettier code style!") all pass, and coverage is above the 80 % floor.
- **tests:** `Test Files 11 passed (11)`, `Tests 144 passed (144)`. Coverage: statements 97.38 %, branches 86.31 %, functions 99.05 %, lines 98.15 %. None of the new stats files appear in the uncovered rows; the remaining gaps are in `database.ts`, `errors.ts` and the older repositories.
- **layer check:** I ran all three greps from `.claude/skills/new-module/SKILL.md` step 5 and none printed anything. That covers routes importing db or repositories, services importing fastify, better-sqlite3 or db, and SQL built from strings in repositories.
- **guardrail files:** `git diff HEAD` shows no change to `package.json`, the lock file, `vitest.config.ts`, `tsconfig.json`, the ESLint or Prettier config, `src/db/`, `src/recommendation/`, `docs/guardrails.md` or `.claude/`. There is no migration (W3), no W4 or W5 change, and no B6 change.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates | Suggested fix |
|---|---|---|---|---|---|---|
| m1 | minor | src/repositories/stats-repository.ts:42 | `this.totalsStmt.get()!` uses a non-null assertion. | It is safe: an aggregate with no GROUP BY always returns one row, and the comment on line 41 says so. It is still the only `!` in a production repository on this path. | None | Optional: keep it as is, or replace it with a `?? { watchedCount: 0, averageRating: null }` fallback. |
| m2 | minor | test/stats.test.ts:210 | `const ids = [];` has no type, so TypeScript infers an evolving `any[]`, and line 212 then needs `ids[i]!`. | Typecheck passes; it is a style point only. | None | `const ids: number[] = [];` |

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 separate module, `GET /stats` | Yes | Adds `src/schemas/stats.ts`, `stats-repository.ts`, `stats-service.ts` and `routes/stats.ts`. `container.ts` and `routes/index.ts` are wired, with stats registered after recommendations. |
| D2 independent of the profile, counts only | Yes | It has its own SQL and imports nothing from the profile. `GenreCount` is `{name, count}` and has no `averageRating`. |
| D3 / Q1 year means the release year | Yes | `GROUP BY m.year`. A test with `watchedAt '2024-05-01'` on a 1999 movie puts it under 1999. |
| D4 response shape | Yes | Matches the plan's schema exactly. `MIN_YEAR` (1888, `schemas/movie.ts:6`) replaces the literal, which is justified because it uses one source for the value. There is no upper bound, as the plan says. |
| D5 `ROUND(AVG,2)`, `null` when empty | Yes | SQL line 11. Both the empty case and the 7.67 rounding case are tested. |
| D6 genres ordered count desc, then `name_key` | Yes | Groups by `g.id`, shows `g.name` and orders by `name_key`. Tested with the Cyrillic tie, count beating name, and spelling merge. |
| D7 years ascending, no zero-filled gaps | Yes | Tested with insertion order 2020/1950/2001 and with a year disappearing after a cancel. |
| D8 counting semantics, no DISTINCT | Yes | Matches ADR-009 ("Агрегати FR-6 і FR-8 рахують рядки `watches` без `DISTINCT`"), which I checked in the vault. The rule is described in the schema's `.describe()`. Both sum assertions are present. |
| D9 no migration or index | Yes | The perf test passes on 10 000 movies with all of them watched. |
| D10 three fixed literal statements, prepared once | Yes | Each is prepared in the constructor and none takes parameters. The SQL matches the plan character for character. |
| D11 no query params | Yes | `?x=1` returns 200 with the same body. |
| D12 sequential synchronous reads | Yes | The doc comment cites D12. |
| D13 empty history returns 200 with empty statistics | Yes | Tested on an empty DB and on a catalog with no watches. |
| Steps 1–7 | Yes | `StatsTotals` comes from `ViewingStatistics.pick(...)` with `z.infer`, one of the two options the plan allowed. |
| Test plan | Yes | Every row is covered, including the optional `watchEvery: 3` perf case, which asserts `floor(10000/3)` and passes. The reuse case compares `createServices().stats.get()` with the HTTP body on the same db. The OpenAPI case checks the four property keys. |

## Context check
The Coder's choices keep the plan's reasons intact:
- **Independent of the profile (D2).** The genre order does not use an average tie-break, so nothing in the order depends on data `/stats` does not show.
- **Case-insensitive order (D6).** The tie-break is on `name_key` rather than `g.name`. This is the reason ADR-008 and ADR-013 give, and the Cyrillic test proves it.
- **Release year (D3).** The ADR-010 reason holds: `watched_at` is not used anywhere.
- **NFR-5 determinism.** It is tested with reverse insertion order and with all movies added before any watches, so the ids differ between the two apps. The expected genre order `Drama, Comedy, Crime, Western` exercises the Comedy/Crime tie at count 2.
- **Test for a rating change.** It compares the whole body before and after, not only `averageRating`, which is stronger than the plan asked for.

I found no place where a reason was lost.

## Good
- The SQL is exactly what the plan specified, and the header comment cites FR-8, NFR-1, NFR-3, ADR-008, ADR-009, ADR-010, ADR-011 and D6/D7.
- The service is three lines, with no business logic leaking into routes and no SQL leaking into the service (ADR-001).
- The types come only from Zod (ADR-004), and the repository statements are typed with the inferred types.
- The tests are black-box tests that check behaviour, and the expected values are worked out independently (for example 8.5, 7.67 and 5.5 at scale).
- The perf sanity checks also confirm the semantics at scale: genre counts sum to 3 × movies, year counts sum to the number of movies, and years are strictly ascending.

## ADR candidates (for record-adr)
- **ADR-015 Viewing Statistics Contract.** It should record:
  - "year" means the release year (`movies.year`), in line with ADR-010;
  - the flat shape `{watchedCount, averageRating, byGenre[{name,count}], byYear[{year,count}]}`;
  - `averageRating` is `ROUND(AVG,2)` and is `null` when the history is empty, with 200 rather than 404;
  - `byGenre` is ordered by count desc, then `name_key`, and `byYear` by year ascending with no zero-filled gaps;
  - a movie counts once in each of its genres, so the genre sum can exceed `watchedCount`, and there is no DISTINCT, per ADR-009;
  - no percentages and no filters;
  - its own SQL, independent of the `/profile` contract (ADR-013).

  The orchestrator should also set `Viewing Statistics` → `governed_by` ADR-015 and update the Services Layer and Routes Layer notes to show that `StatsService` and `/stats` are implemented.

Relevant files:
- src/schemas/stats.ts
- src/repositories/stats-repository.ts
- src/services/stats-service.ts
- src/routes/stats.ts
- src/container.ts
- src/routes/index.ts
- test/stats.test.ts
- test/stats.perf.test.ts
- test/app.test.ts
