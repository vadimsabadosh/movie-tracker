// PreToolUse hook for Claude Code: enforces docs/guardrails.md before a tool runs.
// stdin: hook input JSON; stdout: permission decision JSON (or nothing → normal permission flow).
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Types only: rules.ts is imported lazily in main(), so a broken rule module cannot crash the hook.
import type { Decision, Env, ToolCall } from './rules.ts';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function defaultEnv(projectDir = PROJECT_DIR): Env {
  return {
    projectDir,
    vaultDir: path.resolve(projectDir, process.env.VAULT_PATH ?? '../movie-tracker-vault'),
    branchOf: (dir) => {
      try {
        return execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return null;
      }
    },
  };
}

function output(decision: Decision): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.level,
      permissionDecisionReason: decision.reason,
    },
  });
}

// Audit trail of every deny/ask for the harness metrics in PR7 (gitignored).
function audit(call: ToolCall, decision: Decision, projectDir: string): void {
  if (decision.level === 'allow') return;
  try {
    const dir = path.join(projectDir, '.claude');
    mkdirSync(dir, { recursive: true });
    const entry = { at: new Date().toISOString(), tool: call.tool_name, rule: decision.rule, level: decision.level, input: call.tool_input };
    appendFileSync(path.join(dir, 'guardrails.log'), `${JSON.stringify(entry)}\n`);
  } catch {
    // auditing never blocks the agent
  }
}

async function main(): Promise<void> {
  let call: ToolCall;
  try {
    call = JSON.parse(readFileSync(0, 'utf8')) as ToolCall;
  } catch {
    return; // not a hook payload: no decision
  }
  const env = defaultEnv();
  let decision: Decision | null;
  try {
    const { evaluate } = await import('./rules.ts');
    decision = evaluate(call, env);
  } catch (error) {
    // A bug in the guard must not silently allow a dangerous call, nor brick the session: ask the human.
    decision = { level: 'ask', rule: 'ERR', reason: `guardrail hook failed (${(error as Error).message}); confirm manually` };
  }
  if (!decision) return;
  audit(call, decision, env.projectDir);
  process.stdout.write(output(decision));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
