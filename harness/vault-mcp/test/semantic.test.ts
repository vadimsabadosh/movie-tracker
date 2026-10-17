import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseNote } from '../src/notes.ts';
import { chunkNote, SemanticIndex, type Embedder } from '../src/semantic.ts';
import type { NoteFile } from '../src/vault.ts';

function note(notePath: string, text: string): NoteFile {
  const { frontmatter, body } = parseNote(text);
  return { path: notePath, title: path.basename(notePath, '.md'), frontmatter, body, text };
}

const RATING = note(
  'Concepts/Rating.md',
  `---
type: concept
aliases: [Оцінка]
tags: [concept, history]
---

# Rating

**Визначення:** особиста оцінка фільму від 1 до 10.

## Правила
- Значення поза діапазоном відхиляються.
`,
);

const ADR = note(
  'Decisions/ADR-009 One Watch Entry.md',
  `---
type: decision
tags: []
---

# ADR-009 One Watch Entry

## Рішення
Видалення переглянутого фільму повертає 409.
`,
);

// Deterministic stand-in for the model: a hashed bag of words, so tests need no download.
const calls: string[][] = [];
const fakeEmbed: Embedder = async (texts) => {
  calls.push(texts);
  return texts.map((text) => {
    const vector = new Array<number>(64).fill(0);
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      let h = 0;
      for (const ch of word) h = (h * 31 + ch.codePointAt(0)!) % 64;
      vector[h]! += 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((v) => v / norm);
  });
};

let dir: string;
let index: SemanticIndex;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vault-index-'));
  index = new SemanticIndex({ dir, embed: fakeEmbed, model: 'fake' });
  calls.length = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('chunkNote', () => {
  it('splits by ## sections, drops the H1 and prefixes the note title and aliases', () => {
    const chunks = chunkNote(RATING);
    expect(chunks.map((c) => c.section)).toEqual(['', 'Правила']);
    expect(chunks[0]?.content).toBe('**Визначення:** особиста оцінка фільму від 1 до 10.');
    expect(chunks[1]?.passage).toBe('Rating (Оцінка) — Правила\n- Значення поза діапазоном відхиляються.');
  });

  it('splits a long section at paragraph boundaries', () => {
    const long = note('Concepts/Long.md', `---\ntype: concept\n---\n\n# Long\n\n## Body\n${Array.from({ length: 40 }, (_, i) => `- пункт ${i} ${'слово '.repeat(10)}`).join('\n')}\n`);
    const chunks = chunkNote(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 1300 && c.section === 'Body')).toBe(true);
  });
});

describe('SemanticIndex', () => {
  it('finds the section closest to the query and filters by type and tag', async () => {
    const notes = [RATING, ADR];
    const hits = await index.search(notes, 'видалення переглянутого фільму');
    expect(hits[0]).toMatchObject({ title: 'ADR-009 One Watch Entry', type: 'decision', section: 'Рішення' });
    expect(hits[0]?.snippet).toContain('409');
    expect((await index.search(notes, 'фільм', { type: 'concept' })).every((h) => h.title === 'Rating')).toBe(true);
    expect((await index.search(notes, 'фільм', { tag: 'history' })).map((h) => h.title)).toEqual(['Rating', 'Rating']);
    expect(await index.search(notes, 'фільм', { type: "it's" })).toEqual([]);
  });

  it('embeds only changed notes and forgets deleted ones', async () => {
    expect(await index.sync([RATING, ADR])).toEqual({ embedded: 2, removed: 0, unchanged: 0 });
    expect(await index.sync([RATING, ADR])).toEqual({ embedded: 0, removed: 0, unchanged: 2 });

    const edited = note(RATING.path, RATING.text.replace('від 1 до 10', 'від 1 до 5'));
    calls.length = 0;
    expect(await index.sync([edited])).toEqual({ embedded: 1, removed: 1, unchanged: 0 });
    expect(calls.flat().every((t) => t.startsWith('Rating'))).toBe(true);

    const hits = await index.search([edited], 'оцінка');
    expect(new Set(hits.map((h) => h.title))).toEqual(new Set(['Rating']));
    expect(hits.some((h) => h.snippet.includes('від 1 до 5'))).toBe(true);
  });

  it('survives a restart and rebuilds on request', async () => {
    await index.sync([RATING]);
    const reopened = new SemanticIndex({ dir, embed: fakeEmbed, model: 'fake' });
    expect(await reopened.sync([RATING])).toEqual({ embedded: 0, removed: 0, unchanged: 1 });
    expect(await reopened.rebuild([RATING])).toEqual({ embedded: 1, removed: 0, unchanged: 0 });
  });

  it('returns nothing for an empty query or an empty vault', async () => {
    expect(await index.search([RATING], '  ')).toEqual([]);
    expect(await index.search([], 'оцінка')).toEqual([]);
  });
});
