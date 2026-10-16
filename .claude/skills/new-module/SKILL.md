---
name: new-module
description: Use when adding a new entity or resource to the movie-tracker API (harness task T1), e.g. "add a movies module", "scaffold watch entries", "create CRUD for X". Creates the Zod schema, repository, service, route, migration and tests across the ADR-001 layers, using the vault for domain rules and checking each file against the guardrails.
---

# new-module — scaffold an API module across the layers

Creates one entity module the same way every time:

| Layer | File |
|---|---|
| Schemas | `src/schemas/<entity>.ts` |
| Repository | `src/repositories/<entity>-repository.ts` |
| Service | `src/services/<entity>-service.ts` |
| Routes | `src/routes/<entities>.ts` |
| Database | migration in `src/db/migrations.ts` |
| Wiring | `src/container.ts` + one line in `src/routes/index.ts` |
| Tests | `test/<entities>.test.ts` |

The architecture comes from ADR-001: routes → services → repositories → database.

**Input:** the entity name (it should match a vault concept such as `Movie` or `Watch Entry`) and, if known, the requirement IDs.

**Not for:** recommendation logic (`src/recommendation/`, guardrail W5 — design it separately), or changes that only touch an existing module.

## 1. Load the domain from the knowledge base — never invent it

Use the vault MCP tools. Direct reads of `../movie-tracker-vault` are blocked (guardrail B4).

1. `mcp__vault__get_note("<Entity>")`: take attributes, rules and requirement IDs from the concept note. Follow its `relations` (`part_of`, `implemented_by`) and the wiki-links to related concepts.
2. `mcp__vault__get_note` for `ADR-001 Layered Architecture`, `ADR-004 Zod as Single Source of Truth`, `Validation Schemas`, `Error Handling`, `Database`.
3. `mcp__vault__search_notes("<entity> <key attribute>")` for anything else that mentions the entity, such as other ADRs or glossary terms.

**If there is no concept note, stop.** Ask the user for the domain rules, or propose a concept note first. Do not guess fields, ranges or uniqueness rules.

Write down the domain facts you will encode, each with its source note. They go into the result (step 7).

## 2. Check the plan against the guardrails before writing

Guardrails are defined in `docs/guardrails.md` and enforced by the PreToolUse hook. Classify every file you will touch:

| File | Rule | What happens |
|---|---|---|
| `src/schemas/`, `src/repositories/`, `src/services/`, `src/routes/`, `test/` | A2 | Written without asking |
| `src/db/migrations.ts` | **W3** | The user is asked. Say in one line why the schema changes. |
| `src/recommendation/**` | **W5** | Out of scope for this skill: stop and say so |
| `package.json`, configs | **W4** | Avoid. The scaffold needs no new dependencies; if it seems to, stop and ask. |
| `harness/hooks/**`, `.claude/settings.json`, `docs/guardrails.md` | **B6** | Never. If a guardrail blocks the work, report it — do not work around it. |

A denied tool call is a finding, not an obstacle: report the rule ID and continue with what is allowed.

## 3. Write the files from the templates

Templates are in `templates/` next to this file. `__Entity__`, `__entity__`, `__entities__` and `__table__` stand for the names, e.g. `Movie` / `movie` / `movies` / `movies`. The templates are a starting point; the domain facts from step 1 decide the fields and rules.

Conventions, all checked in step 5:

- **Schemas (ADR-004).** Every input and output has a Zod schema; TypeScript types come from `z.infer`, never written by hand. Ranges and required fields mirror the concept note, for example Rating is an integer 1–10. Use `IdParams`, `PaginationQuery`, `page()` and `ErrorResponse` from `src/schemas/common.ts`.
- **Repository.** The only place with SQL. Use prepared statements with parameters only (NFR-3), and never interpolate values or build SQL from template strings. Use named parameters (`@q`) when one value appears twice; better-sqlite3 rejects numbered `?1`. Compare text through a lowercased `*_key` column (`textKey()` in `movie-repository.ts`), because SQLite `NOCASE`/`LIKE` fold ASCII only. Filtering, sorting and pagination happen in SQL (NFR-1). Map snake_case columns to camelCase fields here.
- **Service.** Business rules and domain errors (`NotFoundError`, `ConflictError` from `src/errors/errors.ts`). No Fastify imports and no SQL.
- **Routes.** Declare `schema` on every route (params, querystring, body, every response status) so OpenAPI stays complete (NFR-6). Handlers only call the service.
- **Migration.** Append one SQL string to `MIGRATIONS`; never edit an existing entry. Add `NOT NULL`, `CHECK` and `UNIQUE` constraints for the domain rules, `FOREIGN KEY ... ON DELETE` for references, and indexes for the filter columns.
- **Register.** Add the service to `Services` and `createServices` in `src/container.ts`, the composition root and the only place that wires a repository into a service. Then add one line to `src/routes/index.ts` that passes `services.<entities>` to the routes. Routes never construct repositories, because that would break the layer check in step 5.
- **Tests.** Write black-box tests through `app.inject` on `testApp()`. Cover the happy path, validation 400, 404, 409 where uniqueness applies, and the domain edge cases from step 1: boundary values, empty list, pagination.

## 4. Verify

```bash
npm run typecheck && npm test
```

Both run without asking (A3). Fix the code until they pass. Do not delete or weaken a test to make it pass; if a test seems wrong, say so in the result.

## 5. Check the layers

```bash
grep -nE "from '\.\./(db|repositories)/" src/routes/*.ts          # must print nothing
grep -nE "from 'fastify'|better-sqlite3|from '\.\./db/" src/services/*.ts  # must print nothing
grep -nE "\\$\\{|\+ *['\"]" src/repositories/*.ts                  # SQL built from strings: review every hit
```

Each hit is a violation of ADR-001 or NFR-3 and must be fixed, not explained away.

## 6. Leave the knowledge base consistent

If you made a design choice that the vault does not cover — a uniqueness rule, a delete behaviour, a new convention — run the **record-adr** skill for it. Do not bury it in code comments.

## 7. Result format

Reply with exactly these sections:

```
## Module <Entity>
Requirements: FR-…

### Domain facts used
| Fact | Source note |

### Files
| File | Layer | Guardrail |

### Endpoints
| Method | Path | Success | Errors |

### Checks
- typecheck: ok / errors
- tests: N passed (M new)
- layer check: clean / hits

### Follow-ups
- decisions for record-adr, open questions, manual fixes needed
```
