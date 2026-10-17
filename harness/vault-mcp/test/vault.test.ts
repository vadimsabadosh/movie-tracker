import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseNote } from '../src/notes.ts';
import { SemanticIndex } from '../src/semantic.ts';
import { addToMoc, Vault } from '../src/vault.ts';

const MOC = `---
type: moc
tags: [moc]
---

# MOC - movie-tracker

## Concepts — предметна область
- [[Movie]]

## Decisions — ADR
- [[ADR-001 Layered Architecture]]

## Glossary
- [[MOC]]
`;

const MOVIE = `---
type: concept
aliases: [Фільм]
tags: [concept, domain]
requirements: [FR-1]
created: 2026-10-01
updated: 2026-10-01
---

# Movie

**Визначення:** запис каталогу. Пов'язано з [[ADR-001 Layered Architecture]].
`;

let dir: string;
let work: string;
let remote: string;
let vault: Vault;

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const commitCount = () => Number(run(work, 'rev-list', '--count', 'HEAD'));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vault-mcp-'));
  remote = path.join(dir, 'remote.git');
  work = path.join(dir, 'vault');
  run(dir, 'init', '--quiet', '--bare', '-b', 'main', remote);
  run(dir, 'clone', '--quiet', remote, work);
  run(work, 'config', 'user.email', 'test@example.com');
  run(work, 'config', 'user.name', 'Test');
  await mkdir(path.join(work, 'Concepts'));
  await mkdir(path.join(work, 'Templates'));
  await writeFile(path.join(work, 'MOC - movie-tracker.md'), MOC);
  await writeFile(path.join(work, 'Concepts', 'Movie.md'), MOVIE);
  await writeFile(path.join(work, 'Templates', 'Concept.md'), '---\ntype: concept\n---\n\n# {{title}}\n');
  await writeFile(path.join(work, 'README.md'), '# readme\n');
  run(work, 'add', '-A');
  run(work, 'commit', '--quiet', '-m', 'seed');
  run(work, 'push', '--quiet', '-u', 'origin', 'main');
  vault = new Vault({ root: work, today: () => '2026-10-16' });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const watchlist = {
  title: 'Watchlist',
  type: 'concept' as const,
  content: 'Список фільмів, які користувач планує переглянути. Кандидати беруться з [[Movie]].',
  aliases: ['Список до перегляду'],
  requirements: ['FR-1'],
  source: 'test',
};

describe('ingest_note', () => {
  it('creates a note with conventions, links it from the MOC, commits and pushes', async () => {
    const result = await vault.ingest(watchlist);

    expect(result).toMatchObject({ status: 'created', path: 'Concepts/Watchlist.md', pushed: true, mocUpdated: true, warnings: [] });
    const { frontmatter, body } = parseNote(await readFile(path.join(work, 'Concepts/Watchlist.md'), 'utf8'));
    expect(frontmatter).toEqual({
      type: 'concept',
      aliases: ['Список до перегляду'],
      tags: ['concept'],
      requirements: ['FR-1'],
      sources: ['test'],
      created: '2026-10-16',
      updated: '2026-10-16',
    });
    expect(body.startsWith('# Watchlist\n\nСписок фільмів')).toBe(true);
    const moc = await readFile(path.join(work, 'MOC - movie-tracker.md'), 'utf8');
    expect(moc).toContain('- [[Movie]]\n- [[Watchlist]]\n\n## Decisions');
    expect(run(remote, 'log', '-1', '--format=%s')).toBe('vault-mcp: create Concepts/Watchlist.md');
  });

  it('is idempotent: the same call twice makes one commit and no duplicates', async () => {
    await vault.ingest(watchlist);
    const before = commitCount();

    const second = await vault.ingest(watchlist);

    expect(second.status).toBe('unchanged');
    expect(commitCount()).toBe(before);
    const moc = await readFile(path.join(work, 'MOC - movie-tracker.md'), 'utf8');
    expect(moc.match(/\[\[Watchlist\]\]/g)).toHaveLength(1);
  });

  it('treats a title differing only in case as the same note', async () => {
    await vault.ingest(watchlist);
    const again = await vault.ingest({ ...watchlist, title: 'WATCHLIST' });
    expect(again).toMatchObject({ status: 'unchanged', path: 'Concepts/Watchlist.md' });
  });

  it('updates an existing note: replaces body, merges lists, keeps created, bumps updated', async () => {
    const result = await vault.ingest({
      title: 'Movie',
      type: 'concept',
      content: 'Оновлене визначення.',
      aliases: ['Кінофільм'],
      requirements: ['FR-5'],
      source: 'github:movie-tracker@abc1234',
    });

    expect(result).toMatchObject({ status: 'updated', mocUpdated: false });
    const { frontmatter, body } = parseNote(await readFile(path.join(work, 'Concepts/Movie.md'), 'utf8'));
    expect(frontmatter).toMatchObject({
      aliases: ['Фільм', 'Кінофільм'],
      tags: ['concept', 'domain'],
      requirements: ['FR-1', 'FR-5'],
      sources: ['github:movie-tracker@abc1234'],
      created: '2026-10-01',
      updated: '2026-10-16',
    });
    expect(body).toBe('# Movie\n\nОновлене визначення.\n');
    expect(run(work, 'log', '-1', '--format=%B')).toContain('Source: github:movie-tracker@abc1234');
  });

  it('fills decision defaults from the ADR title', async () => {
    await vault.ingest({ title: 'ADR-006 Cursor Pagination', type: 'decision', content: '## Контекст\n...' });
    const { frontmatter } = parseNote(await readFile(path.join(work, 'Decisions/ADR-006 Cursor Pagination.md'), 'utf8'));
    expect(frontmatter).toMatchObject({ type: 'decision', id: 'ADR-006', status: 'proposed', date: '2026-10-16', supersedes: [] });
  });

  it('pulls before writing so edits made elsewhere are not overwritten', async () => {
    const other = path.join(dir, 'other');
    run(dir, 'clone', '--quiet', remote, other);
    run(other, 'config', 'user.email', 'o@example.com');
    run(other, 'config', 'user.name', 'Other');
    await writeFile(path.join(other, 'Concepts', 'Genre.md'), '---\ntype: concept\n---\n\n# Genre\n');
    run(other, 'add', '-A');
    run(other, 'commit', '--quiet', '-m', 'genre');
    run(other, 'push', '--quiet');

    const result = await vault.ingest({ ...watchlist, content: 'Див. [[Genre]].' });

    expect(result.warnings).toEqual([]);
    expect(run(remote, 'log', '--format=%s')).toContain('genre');
  });

  it('warns about links that match no note', async () => {
    const result = await vault.ingest({ ...watchlist, links: ['Nonexistent Note'] });
    expect(result.warnings).toEqual(['link [[Nonexistent Note]] does not match any note']);
  });

  it('rejects input that breaks vault conventions without touching the repo', async () => {
    const before = commitCount();
    await expect(vault.ingest({ ...watchlist, title: 'Перегляд' })).rejects.toThrow(/ASCII/);
    await expect(vault.ingest({ ...watchlist, title: '../escape' })).rejects.toThrow(/ASCII/);
    await expect(vault.ingest({ ...watchlist, type: 'decision', title: 'Use SQLite' })).rejects.toThrow(/ADR-006/);
    await expect(vault.ingest({ ...watchlist, title: 'Movie', type: 'component' })).rejects.toThrow(/type "concept"/);
    await expect(vault.ingest({ ...watchlist, requirements: ['F1'] })).rejects.toThrow(/FR-1/);
    await expect(vault.ingest({ ...watchlist, properties: { created: '2020-01-01' } })).rejects.toThrow(/managed/);
    expect(commitCount()).toBe(before);
    expect(run(work, 'status', '--porcelain')).toBe('');
  });
});

describe('typed relations', () => {
  const component = (title: string, content = 'Компонент.') => ({ title, type: 'component' as const, content });

  it('stores relations as wiki-links in frontmatter and merges them on update', async () => {
    await vault.ingest(component('Repositories Layer'));
    await vault.ingest(component('Database'));
    await vault.ingest({ ...component('Services Layer'), relations: { depends_on: ['Repositories Layer'] } });

    const result = await vault.ingest({ title: 'services layer', type: 'component', relations: { depends_on: ['[[database]]'] } });

    expect(result.status).toBe('updated');
    const text = await readFile(path.join(work, 'Components/Services Layer.md'), 'utf8');
    expect(text).toContain('depends_on: ["[[Repositories Layer]]", "[[Database]]"]');
    expect(parseNote(text).body).toBe('# Services Layer\n\nКомпонент.\n');
  });

  it('is idempotent for relations already present', async () => {
    await vault.ingest(component('Database'));
    await vault.ingest({ ...component('Repositories Layer'), relations: { depends_on: ['Database'] } });
    const again = await vault.ingest({ title: 'Repositories Layer', type: 'component', relations: { depends_on: ['Database'] } });
    expect(again.status).toBe('unchanged');
  });

  it('returns outgoing relations and incoming ones under the inverse name', async () => {
    await vault.ingest({ title: 'ADR-001 Layered Architecture', type: 'decision', content: '## Рішення\n...' });
    await vault.ingest({ ...component('Movie Repository'), relations: { implements: ['Movie', 'ADR-001 Layered Architecture'] } });
    expect((await vault.getNote('Movie Repository'))?.relations.outgoing).toEqual({ implements: ['Movie', 'ADR-001 Layered Architecture'] });
    expect((await vault.getNote('Movie'))?.relations.incoming).toEqual({ implemented_by: ['Movie Repository'] });
  });

  it('rejects relations that break the ontology without touching the repo', async () => {
    await vault.ingest(component('Database'));
    const before = commitCount();
    await expect(vault.ingest({ ...watchlist, relations: { depends_on: ['Movie'] } })).rejects.toThrow(/cannot start from a concept/);
    await expect(vault.ingest({ ...component('Recommender'), relations: { governed_by: ['Database'] } })).rejects.toThrow(
      /cannot point to component note "Database"/,
    );
    await expect(vault.ingest({ ...component('Recommender'), relations: { depends_on: ['Ghost'] } })).rejects.toThrow(/no note "Ghost"/);
    await expect(vault.ingest({ ...component('Database'), relations: { depends_on: ['Database'] } })).rejects.toThrow(/itself/);
    await expect(vault.ingest({ ...component('Recommender'), relations: { uses: ['Database'] } as never })).rejects.toThrow(/unknown relation/);
    await expect(vault.ingest({ ...component('Recommender'), properties: { depends_on: '[[Database]]' } })).rejects.toThrow(/managed/);
    await expect(vault.ingest({ title: 'Brand New', type: 'concept' })).rejects.toThrow(/content is required/);
    expect(commitCount()).toBe(before);
    expect(run(work, 'status', '--porcelain')).toBe('');
  });
});

describe('get_note', () => {
  it('finds a note by alias and lists backlinks', async () => {
    await vault.ingest(watchlist);
    const note = await vault.getNote('фільм');
    expect(note).toMatchObject({ title: 'Movie', path: 'Concepts/Movie.md' });
    expect(note?.backlinks.sort()).toEqual(['MOC - movie-tracker', 'Watchlist']);
  });

  it('ignores templates and files without frontmatter', async () => {
    expect(await vault.getNote('Concept')).toBeNull();
    expect(await vault.getNote('README')).toBeNull();
  });
});

describe('search_notes', () => {
  it('ranks title and alias matches first and filters by type', async () => {
    await vault.ingest(watchlist);
    const hits = await vault.search('фільм');
    expect(hits[0]?.title).toBe('Movie');
    expect(hits.map((h) => h.title)).toContain('Watchlist');
    expect(await vault.search('фільм', { type: 'moc' })).toEqual([]);
  });

  it('returns nothing for an empty query', async () => {
    expect(await vault.search('  ')).toEqual([]);
  });

  it('falls back to keyword search when semantic search fails', async () => {
    const broken = new SemanticIndex({
      dir: path.join(dir, 'index'),
      embed: async () => {
        throw new Error('model unavailable');
      },
    });
    const withIndex = new Vault({ root: work, semantic: broken });
    expect((await withIndex.search('фільм'))[0]?.title).toBe('Movie');
  });
});

describe('addToMoc', () => {
  it('appends a missing section at the end', () => {
    expect(addToMoc('# MOC\n', 'Recommender', 'component')).toBe('# MOC\n\n## Components\n- [[Recommender]]\n');
  });
});
