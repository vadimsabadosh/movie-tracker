// Guardrail rules (docs/guardrails.md). Each rule inspects one tool call and either matches or not.
// Precedence: any block (deny) > any warn (ask) > allow when every part of the call is allowed > no decision.
import { globSync } from 'node:fs';
import path from 'node:path';
import { gitInvocation, parseCommand, type Segment } from './shell.ts';

export type Level = 'deny' | 'ask' | 'allow';

export interface ToolCall {
  tool_name: string;
  tool_input: Record<string, unknown>;
  cwd: string;
}

export interface Env {
  /** App repository root (CLAUDE_PROJECT_DIR). */
  projectDir: string;
  /** Local clone of the vault repository. */
  vaultDir: string;
  /** Current branch of the repository at `dir`, or null if unknown. */
  branchOf: (dir: string) => string | null;
}

export interface Decision {
  level: Level;
  rule: string;
  reason: string;
}

interface Rule {
  id: string;
  level: Level;
  title: string;
  /** Returns a reason when the rule matches. */
  check: (call: Context) => string | null;
}

/** A tool call with resolved paths and parsed shell segments. */
interface Context {
  tool: string;
  input: Record<string, unknown>;
  env: Env;
  /** Absolute paths a file tool touches. */
  paths: string[];
  writes: boolean;
  /** Bash only: simple commands (wrappers like `env`, `nice` and `VAR=x` removed) with the directory each runs in. */
  commands: Command[];
  opaque: boolean;
  /** Bash only: a shell or interpreter runs code the guard cannot see (script file, stdin, `-e`). */
  hiddenCode: string | null;
}

interface Command {
  seg: Segment;
  cwd: string;
  /** False after `cd $DIR`, `cd -` or `cd <glob>`: relative paths cannot be resolved. */
  cwdKnown: boolean;
  /** Glob words expanded to absolute paths (computed on first use). */
  readonly expanded: string[];
}

const FILE_READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS']);
const FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// ---------- path helpers ----------

const within = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const rel = (ctx: Context, file: string) => path.relative(ctx.env.projectDir, file).split(path.sep).join('/');
const inProject = (ctx: Context, file: string) => within(file, ctx.env.projectDir);

const SECRET_FILE = /(^|\/)(\.env(\.(?!example$)[\w.-]+)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)[^/]*|\.npmrc|\.netrc)$/;
const SECRET_VAR = /\b(GITHUB_PAT|GH_TOKEN|GITHUB_TOKEN|[A-Z_]*(SECRET|PASSWORD|API_KEY)[A-Z_]*)\b/;
const GUARD_FILES = ['.claude/settings.json', '.claude/settings.local.json', 'harness/hooks/', 'harness/git-hooks/', 'docs/guardrails.md'];
const isGuardFile = (relPath: string) => GUARD_FILES.some((g) => (g.endsWith('/') ? relPath.startsWith(g) : relPath === g));
/** A guardrail file, or a directory that contains one (`rm -rf harness`). */
const holdsGuardFile = (relPath: string) =>
  isGuardFile(relPath) || GUARD_FILES.some((g) => g.startsWith(`${relPath.replace(/\/$/, '')}/`) && relPath !== '');
const SCHEMA_FILE = /^(src\/db\/|migrations\/)|\.sql$/;
const CORE_FILE = /^src\/recommendation\//;
const CONFIG_FILE =
  /^(package\.json|package-lock\.json|tsconfig[\w.-]*\.json|eslint\.config\.[cm]?[jt]s|\.prettierrc[\w.]*|vitest\.config\.[cm]?[jt]s|\.mcp\.json|CLAUDE\.md|\.github\/.*|harness\/vault-mcp\/package(-lock)?\.json)$/;
const ROUTINE_FILE = /^(src|test|tests|docs|harness\/vault-mcp\/(src|test))\//;
const DATA_FILE = /\.(db|sqlite3?|db-wal|db-shm)$/;

/** Every word that names the local vault clone (URLs of the GitHub repository do not count). */
function mentionsVault(ctx: Context, word: string, cwd: string): boolean {
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(word)) return false;
  if (word.includes(path.basename(ctx.env.vaultDir))) return true;
  if (word.startsWith('-') || word === '') return false;
  return within(path.resolve(cwd, expandHome(word)), ctx.env.vaultDir);
}

const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? path.join(process.env.HOME ?? '/', p.slice(1)) : p);

// ---------- command helpers ----------

const git = (seg: Segment) => gitInvocation(seg.words);
const isGit = (seg: Segment, ...subs: string[]) => {
  const g = git(seg);
  return g !== null && subs.includes(g.sub);
};
const gitDir = (seg: Segment, cwd: string) => {
  const g = git(seg);
  return g?.dir ? path.resolve(cwd, g.dir) : cwd;
};
const hasFlag = (args: string[], ...flags: string[]) =>
  args.some((a) => flags.includes(a) || flags.some((f) => /^-[a-zA-Z]$/.test(f) && /^-[a-zA-Z]+$/.test(a) && a.includes(f[1] ?? '')));
const PROTECTED_BRANCH = /^(refs\/heads\/)?(main|master)$/;

/** Words of a command that name things, without commit/tag message text. */
function subjectWords(seg: Segment): string[] {
  if (!isGit(seg, 'commit', 'tag')) return seg.words;
  return seg.words.filter((_, i) => !['-m', '--message'].includes(seg.words[i - 1] ?? ''));
}

function pushTargets(args: string[]): string[] {
  const positional = args.filter((a) => !a.startsWith('-'));
  return positional.slice(1); // first positional is the remote
}

// ---------- rules ----------

export const RULES: Rule[] = [
  // ----- block -----
  {
    id: 'B1',
    level: 'deny',
    title: 'Push to main or force-push',
    check: (ctx) => {
      for (const { seg, cwd } of ctx.commands) {
        const g = git(seg);
        if (!g || g.sub !== 'push') continue;
        if (hasFlag(g.args, '--force', '-f', '--force-with-lease', '--force-if-includes', '--mirror')) return 'force-push rewrites shared history';
        const targets = pushTargets(g.args);
        if (targets.some((t) => t.startsWith('+'))) return 'a "+" refspec is a force-push';
        if (targets.some((t) => PROTECTED_BRANCH.test(t.split(':').pop() ?? ''))) return 'main changes only through a merged pull request';
        if (targets.length === 0 && PROTECTED_BRANCH.test(ctx.env.branchOf(gitDir(seg, cwd)) ?? '')) {
          return 'current branch is main; main changes only through a merged pull request';
        }
      }
      return null;
    },
  },
  {
    id: 'B2',
    level: 'deny',
    title: 'Commit directly on main',
    check: (ctx) => {
      for (const { seg, cwd } of ctx.commands) {
        if (!isGit(seg, 'commit', 'merge', 'cherry-pick', 'rebase', 'am', 'revert')) continue;
        if (PROTECTED_BRANCH.test(ctx.env.branchOf(gitDir(seg, cwd)) ?? '')) {
          return `git ${git(seg)?.sub} on main; work on a prN branch and merge through a pull request`;
        }
      }
      return null;
    },
  },
  {
    id: 'B3',
    level: 'deny',
    title: 'Destroy history or uncommitted work; delete practical branches',
    check: (ctx) => {
      for (const { seg } of ctx.commands) {
        const g = git(seg);
        if (!g) continue;
        if (g.sub === 'reset' && g.args.includes('--hard')) return 'git reset --hard discards work irreversibly';
        if (g.sub === 'clean' && hasFlag(g.args, '-f', '--force')) return 'git clean -f deletes untracked files irreversibly';
        if (g.sub === 'push' && (hasFlag(g.args, '--delete', '-d') || pushTargets(g.args).some((t) => t.startsWith(':')))) {
          return 'remote branches (prN) are kept for sharing and never deleted';
        }
        if (g.sub === 'branch' && hasFlag(g.args, '-d', '-D', '--delete') && g.args.some((a) => /^(main|master|pr\d+)$/.test(a))) {
          return 'main and prN branches are never deleted';
        }
      }
      return null;
    },
  },
  {
    id: 'B4',
    level: 'deny',
    title: 'Direct access to the vault repository',
    check: (ctx) => {
      if (ctx.paths.some((p) => within(p, ctx.env.vaultDir))) return 'the vault is reachable only through the vault MCP tools (ADR-005)';
      for (const { seg, cwd, expanded } of ctx.commands) {
        if (seg.words[0] === 'git' && seg.words[1] === 'ls-remote') continue; // remote URL, not the clone
        if (
          [...subjectWords(seg), ...seg.redirects].some((w) => mentionsVault(ctx, w, cwd)) ||
          expanded.some((p) => within(p, ctx.env.vaultDir)) ||
          within(cwd, ctx.env.vaultDir)
        ) {
          return 'the vault is reachable only through the vault MCP tools (ADR-005)';
        }
      }
      return null;
    },
  },
  {
    id: 'B5',
    level: 'deny',
    title: 'Read or leak secrets',
    check: (ctx) => {
      const secret = ctx.paths.find((p) => SECRET_FILE.test(p));
      if (secret) return `${path.basename(secret)} holds secrets`;
      for (const { seg, expanded } of ctx.commands) {
        const hidden = expanded.find((p) => SECRET_FILE.test(p));
        if (hidden) return `${path.basename(hidden)} holds secrets (matched by a glob)`;
        for (const w of subjectWords(seg)) {
          if (SECRET_FILE.test(w)) return `${w} holds secrets`;
          if (SECRET_VAR.test(w)) return `${SECRET_VAR.exec(w)?.[0]} is a secret`;
        }
        if (['env', 'printenv', 'export', 'set'].includes(seg.words[0] ?? '') && seg.words.length === 1) {
          return 'dumping the environment prints tokens';
        }
      }
      return null;
    },
  },
  {
    id: 'B6',
    level: 'deny',
    title: 'Change guardrails or bypass hooks',
    check: (ctx) => {
      if (ctx.writes) {
        const guard = ctx.paths.find((p) => inProject(ctx, p) && isGuardFile(rel(ctx, p)));
        if (guard) return `${rel(ctx, guard)} is a guardrail; only the student changes it`;
      }
      for (const { seg, cwd, cwdKnown, expanded } of ctx.commands) {
        const g = git(seg);
        const noVerify = g !== null && (g.args.includes('--no-verify') || (g.sub === 'commit' && hasFlag(subjectWords(seg).slice(2), '-n')));
        if (noVerify && ['commit', 'push', 'merge'].includes(g.sub)) return '--no-verify skips the git guardrail hooks';
        if (g?.sub === 'config' && g.args.some((a) => /^core\.hookspath$/i.test(a))) return 'core.hooksPath selects the git guardrail hooks';
        const writer = ['rm', 'mv', 'cp', 'tee', 'truncate', 'chmod', 'ln', 'install', 'touch', 'dd'].includes(seg.words[0] ?? '');
        const sedInPlace = ['sed', 'perl'].includes(seg.words[0] ?? '') && seg.words.some((w) => /^-[a-zA-Z]*i/.test(w));
        const gitRestore = g !== null && (g.sub === 'restore' || g.sub === 'checkout' || g.sub === 'rm' || g.sub === 'mv');
        const targets = [...seg.redirects, ...(writer || sedInPlace || gitRestore ? [...seg.words.slice(1), ...expanded] : [])];
        const relative = targets.filter((w) => !w.startsWith('-') && !path.isAbsolute(expandHome(w)));
        if (!cwdKnown && relative.length) return `cannot verify ${relative[0]} after cd to an unknown directory`;
        const hit = targets.find((w) => {
          const abs = path.resolve(cwd, w);
          return inProject(ctx, abs) && holdsGuardFile(rel(ctx, abs));
        });
        if (hit) return `${hit} is a guardrail; only the student changes it`;
      }
      return null;
    },
  },
  {
    id: 'B7',
    level: 'deny',
    title: 'Delete data or files outside the project',
    check: (ctx) => {
      for (const { seg, cwd, cwdKnown, expanded } of ctx.commands) {
        const cmd = seg.words[0];
        if (cmd !== 'rm' && cmd !== 'unlink' && cmd !== 'shred') continue;
        if (!cwdKnown) return 'rm after cd to an unknown directory: target cannot be verified';
        for (const w of [...seg.words.slice(1).filter((a) => !a.startsWith('-')), ...expanded]) {
          const abs = path.resolve(cwd, expandHome(w));
          if (/^~/.test(w) || w.includes('$') || !inProject(ctx, abs) || abs === ctx.env.projectDir) return `rm outside the project: ${w}`;
          if (DATA_FILE.test(w) || rel(ctx, abs).startsWith('data/')) return `${w} is a database or user data file`;
          if (rel(ctx, abs) === '.git' || rel(ctx, abs).startsWith('.git/')) return 'deleting .git destroys the repository';
        }
      }
      return null;
    },
  },
  {
    id: 'B8',
    level: 'deny',
    title: 'Publish packages',
    check: (ctx) =>
      ctx.commands.some(({ seg }) => ['npm', 'pnpm', 'yarn'].includes(seg.words[0] ?? '') && /^(un)?publish$/.test(seg.words[1] ?? ''))
        ? 'publishing a package is irreversible and out of scope'
        : null,
  },

  // ----- warn / require approval -----
  {
    id: 'W1',
    level: 'ask',
    title: 'Install or change dependencies',
    check: (ctx) =>
      ctx.commands.some(
        ({ seg }) =>
          ['npm', 'pnpm', 'yarn'].includes(seg.words[0] ?? '') &&
          /^(install|i|add|ci|uninstall|remove|rm|un|update|upgrade|up)$/.test(seg.words[1] ?? ''),
      )
        ? 'dependency changes run third-party install scripts and change the lockfile'
        : null,
  },
  {
    id: 'W2',
    level: 'ask',
    title: 'Git write operations: commit, branch, merge, push',
    check: (ctx) => {
      for (const { seg } of ctx.commands) {
        const g = git(seg);
        if (!g) continue;
        if (['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'tag', 'stash', 'am'].includes(g.sub)) return `git ${g.sub} changes history`;
        if (g.sub === 'push') return 'git push publishes commits';
        if (g.sub === 'branch' && g.args.some((a) => !a.startsWith('-'))) return 'git branch creates or changes a branch';
        if ((g.sub === 'checkout' && g.args.includes('-b')) || (g.sub === 'switch' && hasFlag(g.args, '-c', '-C', '--create'))) {
          return 'creates a branch';
        }
      }
      return null;
    },
  },
  {
    id: 'W3',
    level: 'ask',
    title: 'Database schema and migrations',
    check: (ctx) => {
      const hit = ctx.writes && ctx.paths.find((p) => inProject(ctx, p) && SCHEMA_FILE.test(rel(ctx, p)));
      return hit ? `${rel(ctx, hit)} changes the database schema` : null;
    },
  },
  {
    id: 'W4',
    level: 'ask',
    title: 'Build, lint, test, CI, MCP and agent configuration',
    check: (ctx) => {
      const hit = ctx.writes && ctx.paths.find((p) => inProject(ctx, p) && CONFIG_FILE.test(rel(ctx, p)));
      return hit ? `${rel(ctx, hit)} is project configuration` : null;
    },
  },
  {
    id: 'W5',
    level: 'ask',
    title: 'Recommender core (determinism, NFR-5)',
    check: (ctx) => {
      const hit = ctx.writes && ctx.paths.find((p) => inProject(ctx, p) && CORE_FILE.test(rel(ctx, p)));
      return hit ? `${rel(ctx, hit)} affects recommendation results (NFR-5)` : null;
    },
  },
  {
    id: 'W6',
    level: 'ask',
    title: 'Write to the knowledge base',
    check: (ctx) => (ctx.tool === 'mcp__vault__ingest_note' ? 'ingest_note commits and pushes to the vault repository' : null),
  },
  {
    id: 'W7',
    level: 'ask',
    title: 'Network and remote commands',
    check: (ctx) => {
      const net = ctx.commands.find(({ seg }) => ['curl', 'wget', 'ssh', 'scp', 'rsync', 'nc'].includes(seg.words[0] ?? ''));
      if (net) return `${net.seg.words[0]} reaches the network`;
      const gh = ctx.commands.find(({ seg }) => seg.words[0] === 'gh' && !/^(status|auth)$/.test(seg.words[1] ?? '') && !isGhRead(seg));
      return gh ? `gh ${gh.seg.words.slice(1, 3).join(' ')} acts on GitHub` : null;
    },
  },

  {
    id: 'W8',
    level: 'ask',
    title: 'Shell or interpreter running code the guard cannot see',
    check: (ctx) => ctx.hiddenCode,
  },

  // ----- allow -----
  {
    id: 'A1',
    level: 'allow',
    title: 'Read and search project files',
    check: (ctx) => (FILE_READ_TOOLS.has(ctx.tool) && ctx.paths.every((p) => inProject(ctx, p)) ? 'read-only access inside the project' : null),
  },
  {
    id: 'A2',
    level: 'allow',
    title: 'Edit source, tests and docs',
    check: (ctx) =>
      FILE_WRITE_TOOLS.has(ctx.tool) && ctx.paths.length > 0 && ctx.paths.every((p) => inProject(ctx, p) && ROUTINE_FILE.test(rel(ctx, p)))
        ? 'routine change, reviewed through tests and the pull request'
        : null,
  },
  {
    id: 'A3',
    level: 'allow',
    title: 'Tests, lint, type check, build, read-only git and inspection',
    // Matches only when every simple command of the Bash call is in the safe list.
    check: (ctx) => (ctx.tool === 'Bash' && !ctx.opaque && ctx.commands.length > 0 && ctx.commands.every(({ seg }) => isSafeCommand(seg)) ? 'safe command' : null),
  },
  {
    id: 'A4',
    level: 'allow',
    title: 'Read the knowledge base and GitHub',
    check: (ctx) =>
      ctx.tool === 'mcp__vault__get_note' || ctx.tool === 'mcp__vault__search_notes' || ctx.tool.startsWith('mcp__github__')
        ? 'read-only MCP tool'
        : null,
  },
];

const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'ls-files', 'ls-remote', 'rev-parse', 'blame', 'fetch', 'remote', 'describe', 'shortlog', 'grep', 'merge-base', 'rev-list', 'cat-file']);

// A3 auto-allows a command only when EVERY flag is on its allowlist: an unknown flag means
// "not provably read-only" and falls back to the normal permission flow. (A denylist of
// dangerous flags kept missing ones: `sort --compress-program`, `git fetch -u`, `rg --pre`.)
// Words not starting with "-" are operands (paths, patterns, flag values) and are checked by B4–B7.
const SAFE_FLAGS: Record<string, RegExp> = {
  git: new RegExp(
    '^(-\\d+|-[nvsqpbarlwC]+|-vv|-U\\d+|--|' +
      '--(oneline|stat|shortstat|numstat|short|long|branch|name-only|name-status|graph|all|decorate|cached|staged|follow|reverse|' +
      'first-parent|no-merges|merges|relative|patch|no-patch|no-color|word-diff|ignore-all-space|show-current|show-toplevel|' +
      'abbrev-ref|verify|heads|tags|refs|list|is-ancestor|count|left-right|cherry-pick|exit-code|check|prune|quiet|porcelain)|' +
      '--(format|pretty|date|since|until|after|before|author|committer|grep|max-count|skip|diff-filter|abbrev|color|unified|porcelain)=[^\\s]*)$',
  ),
  ls: /^(-[a-zA-Z1@]+|--color=\w+|--all|--almost-all)$/,
  cat: /^-[nbsvAET]+$/,
  head: /^(-[nc]|-\d+)$/,
  tail: /^(-[nc]|-\d+|-[fF])$/,
  wc: /^-[lwcm]+$/,
  // no -r/-R/--recursive: a recursive grep reads .env and would print the token
  grep: /^(-[EFGPinvwxclLoqsHhAB0-9]+|-[eCAB]|--(color|include|exclude)=\S*|--(ignore-case|line-number|count|files-with-matches|fixed-strings|word-regexp|invert-match))$/,
  rg: /^(-[niSslcwFvoHNx]+|-[egtTCABm]|--(files|line-number|ignore-case|smart-case|count|files-with-matches|fixed-strings|word-regexp|invert-match|heading|no-heading|type|glob|max-count|context)|--(type|glob|max-count|context|color)=\S*)$/,
  find: /^(-(name|iname|type|path|ipath|wholename|regex|maxdepth|mindepth|newer|size|empty|print|print0|not|o|or|a|and|mtime|mmin|prune)|!)$/,
  sort: /^(-[urnfhVbs]+|-[kt])$/,
  tree: /^-[adfL]$|^-I$/,
  diff: /^-[urqNwbBi]+$/,
  stat: /^-[fLs]$/,
};
// Commands without flags that matter (or with no flags allowed).
const PLAIN = new Set(['pwd', 'echo', 'which', 'cd', 'true']);

/** Only `-C <dir>` may come between `git` and its subcommand; `-c key=value` can set core.pager and similar. */
function gitGlobalsSafe(words: string[]): boolean {
  for (let i = 1; i < words.length; i++) {
    const w = words[i] ?? '';
    if (w === '-C') i++;
    else return !w.startsWith('-');
  }
  return true;
}

const flagsAllowed = (cmd: string, args: string[]) => {
  const allow = SAFE_FLAGS[cmd];
  return args.every((w) => !w.startsWith('-') || w === '-' || (allow !== undefined && allow.test(w)));
};

function isGhRead(seg: Segment): boolean {
  return /^(pr|issue|run|repo|release)$/.test(seg.words[1] ?? '') && /^(view|list|diff|checks|status)$/.test(seg.words[2] ?? '');
}

function isSafeCommand(seg: Segment): boolean {
  // Unknown values (`$VAR`, globs) cannot be checked against B4–B7, so they are never auto-allowed.
  if (seg.redirects.length || seg.dynamic || seg.globs.length) return false;
  const [cmd, a1, a2] = seg.words;
  const g = git(seg);
  if (g) {
    if (!gitGlobalsSafe(seg.words) || !flagsAllowed('git', g.args)) return false;
    if (g.sub === 'branch') return g.args.every((a) => a.startsWith('-') && !/^-[a-zA-Z]*[dDmMcC]/.test(a) && a !== '--delete');
    if (g.sub === 'remote') return g.args.length === 0 || g.args[0] === '-v' || g.args[0] === 'show';
    return READ_ONLY_GIT.has(g.sub);
  }
  // Tests, linters and builds run project code by design; these are the project's own scripts.
  if (cmd === 'npm' && a1 === 'test') return true;
  if (cmd === 'npm' && a1 === 'run' && /^(test|lint|typecheck|build|format:check|check)$/.test(a2 ?? '')) return true;
  if (cmd === 'npm' && /^(ls|outdated|view|audit)$/.test(a1 ?? '')) return !seg.words.includes('fix');
  if (cmd === 'npx' && /^(vitest|tsc|eslint)$/.test(a1 ?? '') && !seg.words.includes('--fix')) return true;
  if (cmd === 'npx' && a1 === 'prettier' && seg.words.includes('--check')) return true;
  if (cmd === 'node') return a1 === '--test' || a1 === '--version' || a1 === '-v';
  if (PLAIN.has(cmd ?? '')) return true;
  return SAFE_FLAGS[cmd ?? ''] !== undefined && flagsAllowed(cmd ?? '', seg.words.slice(1));
}

// ---------- evaluation ----------

const SHELL = /^(ba|z|da|k|fi)?sh$/;
const INTERPRETER = /^(node|python\d*(\.\d+)?|perl|ruby|php|deno|bun)$/;
const INLINE_CODE = /^(-e|-E|-c|-p|--eval|--print|-r)$/;
/** Prefixes that run the rest of the words as a command. */
const WRAPPER = /^(env|command|builtin|exec|nohup|nice|time|sudo|doas|timeout|stdbuf|xargs)$/;

/**
 * `env A=1 nice -n 5 /usr/bin/git push` → `git push`: drops variable assignments and wrapper
 * commands (with their options) and reduces a path to its basename, so rules see the real command.
 */
function normalize(seg: Segment): Segment {
  const words = [...seg.words];
  for (let guard = 0; guard < 10 && words.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) {
      words.shift();
      continue;
    }
    if (words[0]?.includes('/')) words[0] = path.basename(words[0]);
    if (!WRAPPER.test(words[0] ?? '')) break;
    const wrapper = words.shift();
    // options of the wrapper and, for timeout/nice, their numeric argument
    while (words.length && (words[0]?.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? ''))) {
      const opt = words.shift() ?? '';
      if (/^-(n|u|g|s|k|I|L|P|o|i|e)$/.test(opt) && words.length) words.shift();
    }
    if (wrapper === 'timeout' && /^\d/.test(words[0] ?? '')) words.shift();
  }
  if (words[0]?.includes('/')) words[0] = path.basename(words[0]);
  return { ...seg, words };
}

function buildContext(call: ToolCall, env: Env): Context {
  const input = call.tool_input ?? {};
  const cwd = call.cwd || env.projectDir;
  const paths: string[] = [];
  const str = (k: string) => (typeof input[k] === 'string' && input[k] !== '' ? (input[k] as string) : undefined);
  if (FILE_READ_TOOLS.has(call.tool_name) || FILE_WRITE_TOOLS.has(call.tool_name)) {
    const target = str('file_path') ?? str('notebook_path') ?? str('path');
    paths.push(path.resolve(cwd, expandHome(target ?? '.')));
    // Glob patterns can carry their own directory: "../movie-tracker-vault/**/*.md"
    const pattern = call.tool_name === 'Glob' ? str('pattern') : undefined;
    if (pattern) {
      const base = pattern.split('/').filter((s) => !/[*?[{]/.test(s));
      const dir = pattern.startsWith('/') ? `/${base.join('/')}` : base.join('/');
      if (dir) paths.push(path.resolve(paths[0] ?? cwd, expandHome(dir)));
    }
  }
  const commands: Command[] = [];
  let opaque = false;
  let hiddenCode: string | null = null;
  const command = str('command');
  if (call.tool_name === 'Bash' && command) {
    let dir = cwd;
    let cwdKnown = true;
    const walk = (text: string, depth: number) => {
      const parsed = parseCommand(text);
      opaque ||= parsed.opaque;
      for (const raw of parsed.segments) {
        const seg = normalize(raw);
        if (seg.words.length !== raw.words.length) opaque = true; // wrappers are never auto-allowed
        let memo: string[] | undefined;
        const at = dir;
        commands.push({ seg, cwd: at, cwdKnown, get expanded() { return (memo ??= expandGlobs(seg.globs, at)); } });
        const [cmd] = seg.words;
        if (SHELL.test(cmd ?? '')) {
          // `bash -c "..."`, `sh -xc '...'`: analyse the script (bounded depth); otherwise the code is hidden.
          opaque = true;
          const flags = seg.words.slice(1).filter((w, i, all) => w.startsWith('-') && all.slice(0, i).every((p) => p.startsWith('-')));
          const cIndex = seg.words.findIndex((w, i) => i > 0 && i <= flags.length && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w));
          const script = cIndex === -1 ? undefined : seg.words.slice(cIndex + 1).find((w) => !w.startsWith('-'));
          if (script !== undefined && depth < 3) walk(script, depth + 1);
          else hiddenCode ??= `${cmd} runs a script the guard cannot inspect`;
        } else if (cmd === 'eval') {
          opaque = true;
          if (depth < 3) walk(seg.words.slice(1).join(' '), depth + 1);
        } else if (INTERPRETER.test(cmd ?? '') && seg.words.slice(1).some((w) => INLINE_CODE.test(w))) {
          hiddenCode ??= `${cmd} runs inline code the guard cannot inspect`;
        }
        if (cmd === 'cd') {
          const target = seg.words[1];
          if (target === '-' || seg.dynamic || seg.globs.length) {
            cwdKnown = false;
            opaque = true;
          } else {
            dir = path.resolve(dir, expandHome(target ?? process.env.HOME ?? '/'));
          }
        }
      }
    };
    walk(command, 0);
  }
  return { tool: call.tool_name, input, env, paths, writes: FILE_WRITE_TOOLS.has(call.tool_name), commands, opaque, hiddenCode };
}

/** Expands glob words the way the shell would, so `cat .e*` is checked as `cat .env`. */
function expandGlobs(patterns: string[], cwd: string): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    // `**` can walk a whole disk and time the hook out; such words already prevent `allow`.
    if (pattern.includes('**')) continue;
    try {
      for (const match of globSync(expandHome(pattern), { cwd })) {
        out.push(path.resolve(cwd, match));
        if (out.length >= 1000) return out;
      }
    } catch {
      // unreadable directory or invalid pattern: nothing to add
    }
  }
  return out;
}

export function evaluate(call: ToolCall, env: Env): Decision | null {
  const ctx = buildContext(call, env);
  for (const level of ['deny', 'ask', 'allow'] as const) {
    for (const rule of RULES.filter((r) => r.level === level)) {
      const reason = rule.check(ctx);
      if (reason) return { level, rule: rule.id, reason: `[${rule.id} ${rule.title}] ${reason}` };
    }
  }
  return null;
}
