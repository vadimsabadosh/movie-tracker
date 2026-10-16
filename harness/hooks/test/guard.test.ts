// Guardrail test cases (docs/guardrails.md, section 4). Run: node --test harness/hooks/test/*.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluate, type Env, type Level } from '../rules.ts';

const PROJECT = '/work/movie-tracker';
const branches: Record<string, string> = { [PROJECT]: 'pr4', '/work/other-on-main': 'main' };
const env: Env = { projectDir: PROJECT, vaultDir: '/work/movie-tracker-vault', branchOf: (dir) => branches[dir] ?? null };

const bash = (command: string, cwd = PROJECT) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const tool = (tool_name: string, tool_input: Record<string, unknown>) => ({ tool_name, tool_input, cwd: PROJECT });

type Call = ReturnType<typeof bash>;
function expectDecision(call: Call, level: Level | null, rule?: string, withEnv: Env = env) {
  const decision = evaluate(call, withEnv);
  assert.equal(decision?.level ?? null, level, `${JSON.stringify(call.tool_input)} → ${decision?.reason ?? 'no decision'}`);
  if (rule) assert.equal(decision?.rule, rule);
}

describe('block (deny)', () => {
  it('B1 push to main or force-push', () => {
    expectDecision(bash('git push origin main'), 'deny', 'B1');
    expectDecision(bash('git push origin HEAD:refs/heads/main'), 'deny', 'B1');
    expectDecision(bash('git push --force origin pr4'), 'deny', 'B1');
    expectDecision(bash('git push -f'), 'deny', 'B1');
    expectDecision(bash('git push origin +pr4'), 'deny', 'B1');
    expectDecision(bash('git push', '/work/other-on-main'), 'deny', 'B1');
    expectDecision(bash('cd /work/other-on-main && git push'), 'deny', 'B1');
  });

  it('B2 commit, merge or rebase on main', () => {
    expectDecision(bash('git commit -m "fix"', '/work/other-on-main'), 'deny', 'B2');
    expectDecision(bash('git -C /work/other-on-main commit -am x'), 'deny', 'B2');
    expectDecision(bash('git merge pr4', '/work/other-on-main'), 'deny', 'B2');
  });

  it('B3 reset --hard, clean -f, deleting prN or main branches', () => {
    expectDecision(bash('git reset --hard HEAD~1'), 'deny', 'B3');
    expectDecision(bash('git clean -fd'), 'deny', 'B3');
    expectDecision(bash('git push origin --delete pr3'), 'deny', 'B3');
    expectDecision(bash('git push origin :pr3'), 'deny', 'B3');
    expectDecision(bash('git branch -D pr2'), 'deny', 'B3');
  });

  it('B4 direct vault access, from any tool', () => {
    expectDecision(tool('Read', { file_path: '/work/movie-tracker-vault/Decisions/ADR-001 Layered Architecture.md' }), 'deny', 'B4');
    expectDecision(tool('Edit', { file_path: '../movie-tracker-vault/README.md', old_string: 'a', new_string: 'b' }), 'deny', 'B4');
    expectDecision(tool('Glob', { pattern: '../movie-tracker-vault/**/*.md' }), 'deny', 'B4');
    expectDecision(tool('Grep', { pattern: 'ADR', path: '/work/movie-tracker-vault' }), 'deny', 'B4');
    expectDecision(bash('rm "../movie-tracker-vault/Decisions/ADR-005 Separate Vault Repository with MCP Access.md"'), 'deny', 'B4');
    expectDecision(bash('cd .. && cd movie-tracker-vault && git log'), 'deny', 'B4');
    expectDecision(bash('ls', '/work/movie-tracker-vault/Concepts'), 'deny', 'B4');
  });

  it('B5 secrets', () => {
    expectDecision(tool('Read', { file_path: '.env' }), 'deny', 'B5');
    expectDecision(tool('Read', { file_path: '/home/u/.ssh/id_ed25519' }), 'deny', 'B5');
    expectDecision(bash('cat .env.local'), 'deny', 'B5');
    expectDecision(bash('echo $GITHUB_PAT'), 'deny', 'B5');
    expectDecision(bash('printenv'), 'deny', 'B5');
    expectDecision(bash('git add .env'), 'deny', 'B5');
  });

  it('B6 changing guardrails or bypassing hooks', () => {
    expectDecision(tool('Edit', { file_path: `${PROJECT}/.claude/settings.json`, old_string: 'a', new_string: 'b' }), 'deny', 'B6');
    expectDecision(tool('Write', { file_path: `${PROJECT}/harness/hooks/rules.ts`, content: '' }), 'deny', 'B6');
    expectDecision(tool('Edit', { file_path: 'docs/guardrails.md', old_string: 'a', new_string: 'b' }), 'deny', 'B6');
    expectDecision(bash("sed -i '' 's/deny/allow/' harness/hooks/rules.ts"), 'deny', 'B6');
    expectDecision(bash('echo {} > .claude/settings.json'), 'deny', 'B6');
    expectDecision(bash('rm -rf harness/git-hooks'), 'deny', 'B6');
    expectDecision(bash('mv harness /tmp/x'), 'deny', 'B6');
    expectDecision(bash('git commit --no-verify -m wip'), 'deny', 'B6');
    expectDecision(bash('git config core.hooksPath /dev/null'), 'deny', 'B6');
  });

  it('B7 deleting data or anything outside the project', () => {
    expectDecision(bash('rm -rf /'), 'deny', 'B7');
    expectDecision(bash('rm -rf ~/projects'), 'deny', 'B7');
    expectDecision(bash('rm -rf ..'), 'deny', 'B7');
    expectDecision(bash('rm data/movies.db'), 'deny', 'B7');
    expectDecision(bash('rm -rf .git'), 'deny', 'B7');
  });

  it('B8 publishing packages', () => {
    expectDecision(bash('npm publish'), 'deny', 'B8');
    expectDecision(bash('npm test && npm publish --access public'), 'deny', 'B8');
  });

  it('a block wins over everything else in the same call', () => {
    expectDecision(bash('npm test && git status && git push origin main'), 'deny', 'B1');
  });
});

describe('warn (ask)', () => {
  it('W1 dependency changes', () => {
    expectDecision(bash('npm install fastify'), 'ask', 'W1');
    expectDecision(bash('npm i -D vitest'), 'ask', 'W1');
    expectDecision(bash('cd harness/vault-mcp && npm uninstall yaml'), 'ask', 'W1');
  });

  it('W2 git writes on a prN branch', () => {
    expectDecision(bash('git add -A && git commit -m "Add movies route"'), 'ask', 'W2');
    expectDecision(bash('git push -u origin pr4'), 'ask', 'W2');
    expectDecision(bash('git checkout -b pr5'), 'ask', 'W2');
    expectDecision(bash('git switch -c pr5'), 'ask', 'W2');
  });

  it('W3 database schema and migrations', () => {
    expectDecision(tool('Write', { file_path: `${PROJECT}/src/db/schema.sql`, content: '' }), 'ask', 'W3');
    expectDecision(tool('Edit', { file_path: 'migrations/002_ratings.ts', old_string: 'a', new_string: 'b' }), 'ask', 'W3');
  });

  it('W4 configuration', () => {
    expectDecision(tool('Edit', { file_path: 'package.json', old_string: 'a', new_string: 'b' }), 'ask', 'W4');
    expectDecision(tool('Write', { file_path: '.github/workflows/ci.yml', content: '' }), 'ask', 'W4');
    expectDecision(tool('Edit', { file_path: '.mcp.json', old_string: 'a', new_string: 'b' }), 'ask', 'W4');
  });

  it('W5 recommender core', () => {
    expectDecision(tool('Edit', { file_path: 'src/recommendation/score.ts', old_string: 'a', new_string: 'b' }), 'ask', 'W5');
  });

  it('W6 writing to the vault through MCP', () => {
    expectDecision(tool('mcp__vault__ingest_note', { title: 'Watchlist', type: 'concept', content: 'x' }), 'ask', 'W6');
  });

  it('W7 network and GitHub write commands', () => {
    expectDecision(bash('curl https://example.com'), 'ask', 'W7');
    expectDecision(bash('gh pr create --fill'), 'ask', 'W7');
  });
});

describe('allow', () => {
  it('A1 reading and searching project files', () => {
    expectDecision(tool('Read', { file_path: `${PROJECT}/docs/app-requirements.md` }), 'allow', 'A1');
    expectDecision(tool('Grep', { pattern: 'Recommender' }), 'allow', 'A1');
    expectDecision(tool('Glob', { pattern: 'src/**/*.ts' }), 'allow', 'A1');
  });

  it('A2 editing source, tests and docs', () => {
    expectDecision(tool('Edit', { file_path: 'src/services/movie-service.ts', old_string: 'a', new_string: 'b' }), 'allow', 'A2');
    expectDecision(tool('Write', { file_path: `${PROJECT}/test/movies.test.ts`, content: '' }), 'allow', 'A2');
    expectDecision(tool('Edit', { file_path: 'docs/ontology.md', old_string: 'a', new_string: 'b' }), 'allow', 'A2');
  });

  it('A3 checks, read-only git and inspection, also chained', () => {
    expectDecision(bash('npm test'), 'allow', 'A3');
    expectDecision(bash('cd harness/vault-mcp && npm run typecheck'), 'allow', 'A3');
    expectDecision(bash('git status -sb && git log --oneline -5 && git diff --stat'), 'allow', 'A3');
    expectDecision(bash('git ls-remote https://github.com/vadimsabadosh/movie-tracker-vault.git'), 'allow', 'A3');
    expectDecision(bash('node --test harness/hooks/test/'), 'allow', 'A3');
  });

  it('A4 read-only MCP tools', () => {
    expectDecision(tool('mcp__vault__get_note', { title: 'MOC - movie-tracker' }), 'allow', 'A4');
    expectDecision(tool('mcp__vault__search_notes', { query: 'рекомендації' }), 'allow', 'A4');
    expectDecision(tool('mcp__github__list_commits', { owner: 'vadimsabadosh', repo: 'movie-tracker' }), 'allow', 'A4');
  });
});

describe('no decision: Claude Code permission settings apply', () => {
  it('leaves unknown or mixed commands to the normal permission flow', () => {
    expectDecision(bash('npm test > out.txt'), null); // redirect: not a pure check
    expectDecision(bash('ls $(npm bin)'), null); // command substitution
    expectDecision(bash('rm -rf node_modules'), null); // inside the project, not data
    expectDecision(bash('python3 script.py'), null);
    expectDecision(tool('Read', { file_path: '/etc/hosts' }), null); // outside project, not secret
  });
});

describe('allow-list cannot be abused through arguments', () => {
  it('inspection commands that run programs or write files fall back to the permission flow', () => {
    expectDecision(bash('rg --pre ./evil.sh TODO'), null);
    expectDecision(bash('git -c core.pager=./evil.sh log'), null);
    expectDecision(bash('git diff --output=src/index.ts'), null);
    expectDecision(bash('git grep -O ./evil.sh TODO'), null);
    expectDecision(bash('git fetch --upload-pack=./evil.sh origin'), null);
    expectDecision(bash('git diff --ext-diff'), null);
    expectDecision(bash("sed -n 's/a/b/w out.txt' README.md"), null);
    expectDecision(bash("sed '1e ./evil.sh' README.md"), null);
    expectDecision(bash('uniq in.txt out.txt'), null);
    expectDecision(bash('find . -fprintf out.txt %p'), null);
    expectDecision(bash('sort -o out.txt in.txt'), null);
    expectDecision(bash('tree -o out.txt'), null);
    expectDecision(bash('npm audit fix'), null);
    expectDecision(bash('jq -n env'), null); // prints the environment, tokens included
  });

  it('the same commands without such arguments stay allowed', () => {
    expectDecision(bash('rg -n TODO src'), 'allow', 'A3');
    expectDecision(bash('git -C harness/vault-mcp log --oneline -3'), 'allow', 'A3');
    expectDecision(bash('git diff --stat'), 'allow', 'A3');
    expectDecision(bash('find src -name "*.ts"'), 'allow', 'A3');
    expectDecision(bash('sort -u words.txt'), 'allow', 'A3');
    expectDecision(bash('npm audit'), 'allow', 'A3');
  });
});

describe('parser cannot be tricked into hiding commands', () => {
  it('a heredoc marker inside quotes does not hide the following lines', () => {
    expectDecision(bash("echo '<<X'\nrm -rf /\nX"), 'deny', 'B7');
    expectDecision(bash('echo "<<EOF"\ngit push --force\nEOF'), 'deny', 'B1');
  });

  it('an unterminated heredoc is analysed as commands and never allowed', () => {
    expectDecision(bash('cat <<EOF\ngit reset --hard'), 'deny', 'B3');
    expectDecision(bash('cat <<EOF\nhello'), null);
  });

  it('a real heredoc body is data for cat, and the command after it is analysed', () => {
    expectDecision(bash("cat <<'EOF'\nrm -rf /\nEOF\ngit push origin main"), 'deny', 'B1');
    expectDecision(bash("cat <<'EOF'\nrm -rf /\nEOF"), 'allow', 'A3');
  });

  it('bash -c and eval are analysed recursively and never auto-allowed', () => {
    expectDecision(bash('bash -c "git push --force"'), 'deny', 'B1');
    expectDecision(bash("sh -c 'cat .env'"), 'deny', 'B5');
    expectDecision(bash('eval git reset --hard'), 'deny', 'B3');
    expectDecision(bash('bash -c "ls"'), null);
  });

  it('commands with $ expansion are never auto-allowed', () => {
    expectDecision(bash('cat "$HOME/notes.txt"'), null);
    expectDecision(bash('rm -rf src/$TARGET'), 'deny', 'B7');
  });
});

describe('globs are expanded against the filesystem', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'guard-glob-'));
  const app = path.join(root, 'movie-tracker');
  for (const dir of ['src', 'harness/hooks', '../movie-tracker-vault']) mkdirSync(path.join(app, dir), { recursive: true });
  writeFileSync(path.join(app, '.env'), 'GITHUB_PAT=x\n');
  writeFileSync(path.join(app, 'src/a.ts'), '');
  writeFileSync(path.join(app, 'harness/hooks/rules.ts'), '');
  writeFileSync(path.join(root, 'movie-tracker-vault/README.md'), '');
  const fsEnv: Env = { projectDir: app, vaultDir: path.join(root, 'movie-tracker-vault'), branchOf: () => 'pr4' };
  after(() => rmSync(root, { recursive: true, force: true }));

  it('B5 sees the secret behind a glob', () => {
    expectDecision(bash('cat .e*', app), 'deny', 'B5', fsEnv);
    expectDecision(bash('head -1 .[e]nv', app), 'deny', 'B5', fsEnv);
  });

  it('B4 sees the vault behind a glob', () => {
    expectDecision(bash('cat ../movie-tracker-v*/README.md', app), 'deny', 'B4', fsEnv);
  });

  it('B6 sees guardrail files behind a glob', () => {
    expectDecision(bash('rm -rf harness/ho*', app), 'deny', 'B6', fsEnv);
  });

  it('a harmless glob is not blocked but not auto-allowed either', () => {
    expectDecision(bash('ls src/*.ts', app), null, undefined, fsEnv);
  });
});

describe('false positives that must not happen', () => {
  it('commit messages, heredoc bodies and quoted text are not commands', () => {
    expectDecision(bash('git commit -m "Document .env handling and movie-tracker-vault access; git push origin main"'), 'ask', 'W2');
    expectDecision(bash("git commit -F - <<'EOF'\nNever run git push --force or rm -rf /\nEOF"), 'ask', 'W2');
    expectDecision(bash('grep -n "git reset --hard" docs/guardrails.md'), 'allow', 'A3');
  });

  it('similar but harmless commands', () => {
    expectDecision(bash('git push -u origin pr4'), 'ask', 'W2'); // -u is not -f
    expectDecision(bash('git branch -a'), 'allow', 'A3');
    expectDecision(bash('git branch --show-current'), 'allow', 'A3');
    expectDecision(bash('cat .env.example'), 'allow', 'A3');
    expectDecision(bash('git reset HEAD file.ts'), null); // soft reset is fine
    expectDecision(tool('Read', { file_path: `${PROJECT}/.claude/settings.json` }), 'allow', 'A1'); // reading guardrails is fine
  });
});

describe('hook protocol (process)', () => {
  const guard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../guard.ts');
  const runHook = (payload: unknown) =>
    execFileSync('node', [guard], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT },
    });

  it('prints a PreToolUse deny decision with the rule id', () => {
    const out = JSON.parse(runHook({ hook_event_name: 'PreToolUse', ...bash('git push --force') }));
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /^\[B1 /);
  });

  it('prints nothing when no rule applies and ignores garbage input', () => {
    assert.equal(runHook({ hook_event_name: 'PreToolUse', ...bash('python3 x.py') }), '');
    assert.equal(execFileSync('node', [guard], { input: 'not json', encoding: 'utf8' }), '');
  });
});
