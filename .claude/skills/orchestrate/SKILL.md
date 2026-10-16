---
name: orchestrate
description: Use for a movie-tracker development task too big for one skill run — a feature that spans several files or changes existing modules, e.g. "implement watch history filters (FR-4)". Runs Planner → Coder → Reviewer subagents with full-context handoffs saved in docs/orchestration/, up to two rework rounds, then records decisions and commits.
---

# orchestrate — Planner → Coder → Reviewer with context-preserving handoffs

The main session is the **orchestrator**. It does not plan, code or review itself. It does four things:

1. starts the role subagents (`.claude/agents/planner.md`, `coder.md`, `reviewer.md`);
2. passes context between them;
3. brings the human in for decisions;
4. owns every write outside the code: the handoff files, vault ADRs and commits.

## Why the handoffs are files

Each role starts with an empty context. Whatever it is not given, it does not know. So every handoff is a Markdown document with the result **and the reasons**, saved under `docs/orchestration/<task-slug>/`:

| File | From → to | Contains |
|---|---|---|
| `00-task.md` | human → all | task text, requirements, constraints |
| `01-plan.md` | Planner → Coder, Reviewer | domain facts with sources, decisions with *why* and rejected alternatives, steps, guardrails, test plan, open questions with the human's answers |
| `02-implementation.md` | Coder → Reviewer | step status, deviations with reasons, decisions beyond the plan, checks, guardrail events |
| `03-review.md` | Reviewer → Coder, orchestrator | verdict, findings with evidence, plan conformance, context check |
| `04-…`, `05-…` | rework round 2 | same formats |
| `README.md` | orchestrator → humans | transcript summary: who decided what, what the reviewer caught, where context was lost |

**Rule: pass documents whole, never a summary.** Each subagent gets every earlier handoff it needs in full. Prefer passing the paths of the verbatim saved files, with the instruction "read all of them fully before starting". Retyping long documents into the prompt adds copying errors and saves nothing. What the orchestrator must never do is write its own summary of a handoff, because summarizing is exactly where context gets lost.

**Custom subagents load at session start.** After adding or changing a file in `.claude/agents/`, restart the session (`claude --continue`) before orchestrating.

## Procedure

1. **Task.** Write `00-task.md`: the task in the human's words, the requirement IDs, and what is out of scope.
2. **Plan.** Start `planner` with `00-task.md`. Save its answer verbatim as `01-plan.md`.
   - If it has **open questions**, ask the human with AskUserQuestion, offering the Planner's recommended answers. Append an `## Answers` section to `01-plan.md`.
   - Never answer domain questions yourself.
3. **Code.** Start `coder` with `00-task.md` + `01-plan.md` (with answers). Save its answer as `02-implementation.md`.
   - Expect a W3 prompt if the plan has a migration.
4. **Review.** Start `reviewer` with `00-task.md` + `01-plan.md` + `02-implementation.md`. Save its answer as `03-review.md`.
5. **Rework**, if the verdict is CHANGES_REQUESTED:
   - Start `coder` with **all** previous documents. Save the answer as `04-implementation.md`.
   - Start `reviewer` with all of them. Save the answer as `05-review.md`.
   - At most **two** rounds. If round 2 is still CHANGES_REQUESTED, stop and hand the open findings to the human. Do not loop.
6. **Knowledge base.** For each *ADR candidate* in the approving review, run the `record-adr` skill. Each write asks the human under W6.
7. **Transcript.** Write `README.md`, in Ukrainian like the course docs:
   - a timeline (role → output file → key decision);
   - every finding the Reviewer raised and how it was resolved;
   - where the reasons from the plan survived into code and review, and where they were lost;
   - guardrail events;
   - the human's interventions.
8. **Commit** code and `docs/orchestration/<slug>/` together (W2 asks). Push the `prN` branch.

## Rules

- The orchestrator never edits `src/` or `test/`. If something must change, it goes back to the Coder as a finding. A fix outside the roles breaks the transcript.
- Subagents get the same guardrails: the PreToolUse hook applies to their tool calls too. A denied call in a subagent is reported in the handoff and the README.
- Keep handoffs verbatim. If a subagent's output does not follow its format, ask it once to reformat; do not repair it yourself.
