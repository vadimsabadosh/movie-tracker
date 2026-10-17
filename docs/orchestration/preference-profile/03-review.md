# Review: Preference Profile (FR-6) (round 1)

## Verdict: APPROVE

I found no blockers and no majors. There are three minor findings, and none of them needs fixing before commit.

## Checks (re-run by reviewer)
- **npm run check:** exit 0. Typecheck (`tsc --noEmit`) ok, ESLint ok, Prettier check ok ("All matched files use Prettier code style!"), coverage ok.
- **tests:** `Test Files 6 passed (6)` / `Tests 97 passed (97)`. Coverage: statements 96.62 %, branches 84.14 %, functions 98.78 %, lines 97.65 %. Every metric is at or above the 80 % floor. The new profile files are 100 % covered (they are not in the uncovered list). The gaps that remain are older code: `errors.ts` and `database.ts`.
- **layer check:** clean. All three greps from `.claude/skills/new-module/SKILL.md` step 5 print nothing, for routes, services and repositories.
- **Guardrails:** `git diff HEAD --stat` shows only `src/container.ts`, `src/routes/index.ts`, `test/app.test.ts`, `test/helpers.ts` and `test/watch-history.perf.test.ts`. These were not touched: `src/db/migrations.ts` (W3), `src/recommendation/` (W5), `package.json`, `vitest.config.ts`, the ESLint and Prettier configs (W4), and `docs/guardrails.md`.

## Findings
| ID | Severity | File:line | Problem | Evidence | Violates | Suggested fix |
|---|---|---|---|---|---|---|
| F1 | minor | src/repositories/profile-repository.ts:23 | Director tie-breaks sort by binary order (`m.director ASC`), but genre tie-breaks use the case-insensitive `name_key`. With Cyrillic, tied directors "андрій" and "Борис" come out as Борис, андрій: uppercase Cyrillic (U+0400–042F) sorts before lowercase. Genres use the case-insensitive order in the same situation. The result is still deterministic, so NFR-5 holds. | The plan's D3 and D5 say this explicitly, and the human approved it in Q2. | none (plan conformant) | No code change. Record the asymmetry in ADR-013 so FR-7 and FR-8 do not assume the director order is case-insensitive. |
| F2 | minor | test/profile.test.ts:192 | `const ids = [];` is an evolving implicit-`any[]`, which is why line 194 needs the non-null assertion in `ids[i]!`. | Typecheck passes, but the type is weak. | style | Write `const ids: number[] = [];`. |
| F3 | minor | test/app.test.ts:25-31 | The OpenAPI test checks that `genres` and `directors` exist. It does not check the `profile` tag or the `PreferenceItem` fields. | The Coder lists this as a known gap. | NFR-6 (only partly asserted; the plan asked only for "exists with a 200 response", so this is met) | Optional: also assert `items.properties` has `name`, `count` and `averageRating`. |

## Plan conformance
| Plan decision / step | Implemented as planned? | Comment |
|---|---|---|
| D1 separate module | yes | Schemas, repository, service and route are separate modules. Nothing was added to `WatchRepository`. |
| D2 response shape | yes | `PreferenceItem` and `PreferenceProfile` in Zod; types come from `z.infer`, with no hand-written types. The `.describe()` texts state the order and the rounding. |
| D3 order | yes | Both statements: `COUNT(*) DESC, AVG(w.rating) DESC`, then `g.name_key` / `m.director`. Tests cover each tie-break level, for genres and for directors. |
| D4 rounding | yes | `ROUND(AVG, 2)` in the output, unrounded `AVG` in ORDER BY. The test with ratings 7, 8, 8 gives 7.67. |
| D5 director grouping | yes | `GROUP BY m.director`, no migration. `movies.director` is `NOT NULL CHECK(length(trim)>0)`, so `name: z.string()` never meets null. |
| D6 genre grouping | yes | `GROUP BY g.id`, shows `g.name`. The Sci-Fi/sci-fi test confirms one entry with the first spelling. |
| D7 no params | yes | No querystring schema. `?x=1` is ignored (tested). |
| D8 empty → 200 | yes | Tested twice: empty database, and movies with no watches. |
| D9 shared seed + perf test | yes | `seedCatalog` and the `CATALOG_*` constants were moved byte-for-byte, including director modulo 500. The watch-history perf test logic is unchanged. The new perf test has the sanity checks (20 genres, counts summing to 30 000, 500 directors). |
| D10 reuse point | yes | `services.profile.get()` is wired in the container and tested against the HTTP body. No `src/recommendation/` files were added. |
| D11 literal SQL | yes | Two fixed literals, prepared once, no parameters. The `${`/`+` grep prints nothing. |
| Steps 1-8 | yes | Each step's "done when" condition holds; I verified them myself, as listed under Checks. |
| Test plan | yes, with one justified deviation | The Cyrillic tie case uses "Комедія" vs "драма" instead of "комедія" vs "Драма". This is justified: with the plan's pair, binary order and `name_key` order agree, so the test could not tell them apart. The Coder's pair does tell them apart, so it is stronger. The extra director name tie-break test is welcome. |

## Context check
The Coder kept the reasons behind each choice.
- **NFR-5:** the determinism test reverses the insertion order and adds all movies before any watch, so both ids and rowids differ between the two databases. This is the case the D3 "tie-break by id" rejection was about. The fixture also produces real director ties (Nolan/Allen at 2×7, Coen/Leone at 1×7), so the name tie-break is actually exercised.
- **D5 (avoid W3):** kept; no schema change.
- **ADR-009 (no DISTINCT):** kept and cited in the header. `watches.movie_id` is the PK, `rating` is `NOT NULL`, and the `movie_genres` PK prevents duplicate links, so `COUNT(*)` without DISTINCT is correct.
- **Vault:** the code matches the Preference Profile note (computed, not stored; genres by count and rating; directors; average per genre) and the `Recommender.recommend(profile: PreferenceProfile, …)` signature.

## Good
- The Coder strengthened the Cyrillic tie test on purpose, so a regression to `ORDER BY g.name` would now fail it. This is a precise, justified deviation.
- The repository prepares its statements once and types them `Statement<[], PreferenceItem>`. Because the rows already match the schema, no mapping layer is needed.
- The FR-7 reuse test runs through the real container and compares the result with the HTTP output. This pins down the contract FR-7 will consume.
- Moving the perf fixture removed duplication without changing the existing NFR-1 test.

## ADR candidates (for record-adr)
- **ADR-013 Preference Profile Contract** (FR-6, NFR-5; consumed by FR-7). It should cover:
  - **Shape:** `{ genres, directors }`, each a list of `{ name, count, averageRating }`.
  - **Contents:** both lists are complete, with no top-N and no query parameters.
  - **Order:** `count` desc, then the exact average desc. The final tie-break is `name_key` for genres and the binary director string for directors; record this asymmetry explicitly (F1).
  - **Precision:** `averageRating` is rounded to 2 decimals in SQL.
  - **Grouping:** genres by id (ADR-008 key); directors by the exact string, with no `director_key` (Q2). A future migration would supersede this.
  - **Edge cases and scope:** empty history gives 200 with empty lists. No totals; those belong to FR-8.
  - **Reuse:** `ProfileService.get()` is the FR-7 entry point.

Relevant files:
- src/schemas/profile.ts
- src/repositories/profile-repository.ts
- src/services/profile-service.ts
- src/routes/profile.ts
- src/container.ts
- src/routes/index.ts
- test/profile.test.ts
- test/profile.perf.test.ts
- test/helpers.ts
- test/watch-history.perf.test.ts
- test/app.test.ts
