// Git-level guardrails (harness/git-hooks) on a temporary repository with a bare remote.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOKS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../git-hooks');
let dir: string;
let work: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
/** Runs git and returns stderr of a rejected command, or null if it succeeded. */
const rejected = (...args: string[]): string | null => {
  try {
    git(...args);
    return null;
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
};

before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'git-hooks-'));
  const remote = path.join(dir, 'remote.git');
  work = path.join(dir, 'work');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['clone', '--quiet', remote, work], { stdio: 'ignore' });
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(work, 'README.md'), 'seed\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'seed'); // before hooks: the remote needs a main branch
  git('push', '--quiet', 'origin', 'main');
  git('config', 'core.hooksPath', HOOKS);
  git('switch', '--quiet', '-c', 'pr4');
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe('pre-commit', () => {
  it('B2 blocks a commit on main', () => {
    git('switch', '--quiet', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    assert.match(rejected('commit', '-m', 'on main') ?? '', /guardrail B2/);
    git('reset', '--quiet');
    git('switch', '--quiet', 'pr4');
  });

  it('B5 blocks staged secret files but not .env.example', () => {
    writeFileSync(path.join(work, '.env'), 'GITHUB_PAT=x\n');
    git('add', '.env');
    assert.match(rejected('commit', '-m', 'secrets') ?? '', /guardrail B5[\s\S]*\.env/);
    git('rm', '--quiet', '--cached', '.env');
    rmSync(path.join(work, '.env'));

    writeFileSync(path.join(work, '.env.example'), 'GITHUB_PAT=\n');
    git('add', '.env.example');
    assert.equal(rejected('commit', '--quiet', '-m', 'example'), null);
  });

  it('allows a normal commit on a prN branch', () => {
    writeFileSync(path.join(work, 'b.txt'), 'b\n');
    git('add', 'b.txt');
    assert.equal(rejected('commit', '--quiet', '-m', 'work'), null);
  });
});

describe('pre-push', () => {
  it('allows pushing a prN branch', () => {
    assert.equal(rejected('push', '--quiet', '-u', 'origin', 'pr4'), null);
  });

  it('B1 blocks pushing to main', () => {
    assert.match(rejected('push', 'origin', 'pr4:main') ?? '', /guardrail B1: push to 'main'/);
  });

  it('B1 blocks a force-push that rewrites history', () => {
    git('commit', '--quiet', '--amend', '-m', 'rewritten');
    assert.match(rejected('push', '--force', 'origin', 'pr4') ?? '', /guardrail B1: non-fast-forward/);
  });

  it('B3 blocks deleting a remote branch', () => {
    assert.match(rejected('push', 'origin', '--delete', 'pr4') ?? '', /guardrail B3/);
  });
});
