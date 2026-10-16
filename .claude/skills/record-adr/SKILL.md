---
name: record-adr
description: Use when a significant design decision is made or changed in movie-tracker — choosing a library or pattern, a data-model or uniqueness rule, an API convention, or replacing an earlier decision. Records it as an ADR note in the Obsidian vault through the vault MCP connector, links the affected components with typed relations, and checks for duplicates first.
---

# record-adr — record an architecture decision in the knowledge base

Turns a decision into an ADR note in the vault's `Decisions/` folder, in Nygard's format: Context, Decision, Alternatives, Consequences. The skill then connects it to the ontology: it marks which components the decision governs and which older decision it replaces.

**Input:** the decision, in a sentence or as a pointer to code or a commit.

## 0. Is it an ADR?

Record it if at least one is true:

- It is hard or costly to reverse: a library, the storage, the schema shape, a public API convention.
- It constrains future code: a uniqueness rule, a delete behaviour, an error convention.
- A reviewer would ask "why is it like this?" and the answer is not in the code.

Otherwise do not create an ADR. A detail of one function belongs in a code comment, and a domain fact belongs in a concept note (`ingest_note` of type `concept`).

## 1. Look before writing — no duplicates, no contradictions

Use only the vault MCP tools. Direct access to `../movie-tracker-vault` is blocked (guardrail B4).

1. `mcp__vault__search_notes("<key words>", type: "decision")`. If an ADR already covers this, either:
   - **update** it with `ingest_note`, same title, new content; or
   - **supersede** it with a new ADR (step 3).

   Never create a second ADR for the same decision.
2. `mcp__vault__get_note` for each related ADR. Check that the new decision does not contradict an accepted one without superseding it.
3. Find the next number: `mcp__vault__search_notes("ADR", type: "decision", limit: 50)`, then take the highest `ADR-NNN` + 1. Numbers are never reused.
4. Find the affected components and concepts: `get_note` on the components the decision touches (e.g. `Repositories Layer`, `Database`). Read their `relations` to see what they already follow.

## 2. Compose the note

| Field | Value |
|---|---|
| `title` | `ADR-NNN Short English Title Case` (the connector rejects other forms) |
| `type` | `decision` |
| `aliases` | Ukrainian name |
| `tags` | `adr` + area: `data`, `api`, `harness`, `validation`, … |
| `properties.status` | `accepted` if already applied in code, otherwise `proposed` |
| `requirements` | FR-/NFR- IDs the decision serves |
| `source` | commit SHA (`github:movie-tracker@abc1234`) or `PR5: <task>` |
| `content` | the four sections below, in Ukrainian like the rest of the vault |

```markdown
## Контекст
What problem and which forces: requirements, constraints. Link notes as [[Note]].

## Рішення
What was decided, concretely enough to check in code (file, rule, value).

## Альтернативи
At least two real alternatives and why they lost.

## Наслідки
What becomes easier or harder; what code or tests now rely on it; what would trigger revisiting.
```

Write only facts you know. If the context or the alternatives are unknown, ask the user instead of inventing them.

## 3. Write through the connector and link the ontology

Every `ingest_note` asks the user for approval (guardrail **W6**). Before the first call, say how many writes will follow.

1. `mcp__vault__ingest_note(<ADR>)`. If it replaces an older ADR, pass `relations: { supersedes: ["ADR-00X …"] }`.
2. Mark the old ADR when superseding: `ingest_note(title: "ADR-00X …", type: "decision", properties: { status: "superseded", superseded_by: ["[[ADR-NNN …]]"] })`, with no `content`, so the body is kept.
3. For each affected component: `ingest_note(title: "<Component>", type: "component", relations: { governed_by: ["ADR-NNN …"] })`, again with no `content`. The connector checks domain and range: `governed_by` must point to a decision.

Rules:

- A rejected call (wrong relation, bad title) changes nothing in the vault. Fix the input and retry; never route around the connector.
- `pushed: false` means the vault branch has no upstream. Tell the user to run `git -C ../movie-tracker-vault push -u origin <branch>`; the agent cannot do it itself (B4).
- Notes are never deleted. A wrong ADR is superseded, not removed.
- Re-running the same call is safe: it returns `unchanged`.

## 4. Verify

- `mcp__vault__get_note("ADR-NNN …")`: `relations.incoming.governs` lists the components from step 3, and the ingest `warnings` were empty. A warning means a wiki-link points to a missing note: fix the link or create the note.
- If the ADR names a rule enforced in code, there should be a test for it. Name the test in the result, or list it as a follow-up.

## 5. Result format

```
## ADR-NNN <Title> — created | updated | unchanged
Status: accepted | proposed   Supersedes: — | ADR-00X

| Vault write | Status | Commit |
|---|---|---|
| Decisions/ADR-NNN … | created | abc1234 |
| Components/<X> governed_by | updated | def5678 |

Enforced by: <file / test> (or "not yet — follow-up")
Follow-ups: …
```
