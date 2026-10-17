// Semantic retrieval (PR7): a local embedded vector index over vault notes, chunked by `##` sections.
// The vault stays the source of truth; the index is a derived artifact that can be deleted at any time.
import { createHash } from 'node:crypto';
import * as lancedb from '@lancedb/lancedb';
import { asStringArray } from './notes.ts';
import type { NoteFile, SearchHit } from './vault.ts';

export const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';
// Sections longer than this are split at paragraph boundaries: e5 reads at most 512 tokens.
const MAX_CHUNK_CHARS = 1200;
const SNIPPET_CHARS = 700;

export interface Chunk {
  id: string;
  path: string;
  title: string;
  type: string;
  tags: string[];
  section: string;
  /** Section text shown to the agent. */
  content: string;
  /** What gets embedded: the note title and aliases give a section its context. */
  passage: string;
}

/** Turns texts into normalized vectors; e5 models expect different prefixes for queries and passages. */
export type Embedder = (texts: string[], kind: 'query' | 'passage') => Promise<number[][]>;

export function chunkNote(note: NoteFile): Chunk[] {
  const type = String(note.frontmatter.type);
  const tags = asStringArray(note.frontmatter.tags);
  const aliases = asStringArray(note.frontmatter.aliases);
  const heading = aliases.length ? `${note.title} (${aliases.join(', ')})` : note.title;

  const sections: { section: string; lines: string[] }[] = [{ section: '', lines: [] }];
  for (const line of note.body.split('\n')) {
    if (line.startsWith('## ')) sections.push({ section: line.slice(3).trim(), lines: [] });
    else if (!line.startsWith('# ')) sections.at(-1)!.lines.push(line);
  }

  const chunks: Chunk[] = [];
  for (const { section, lines } of sections) {
    for (const content of splitLong(lines.join('\n').trim())) {
      if (!content) continue;
      const id = `${note.path}#${chunks.length}`;
      const label = section ? `${heading} — ${section}` : heading;
      chunks.push({ id, path: note.path, title: note.title, type, tags, section, content, passage: `${label}\n${content}` });
    }
  }
  return chunks;
}

function splitLong(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const parts: string[] = [];
  let current = '';
  for (const paragraph of text.split(/\n(?=\s*\n|- |\*\*)/)) {
    if (current && current.length + paragraph.length > MAX_CHUNK_CHARS) {
      parts.push(current.trim());
      current = '';
    }
    current += `${paragraph}\n`;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Embeddings computed locally with transformers.js; the model is downloaded once into `cacheDir`. */
export function localEmbedder(options: { model?: string; cacheDir: string }): Embedder {
  let extractor: Promise<(texts: string[], opts: object) => Promise<{ tolist(): unknown }>> | undefined;
  return async (texts, kind) => {
    extractor ??= import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = options.cacheDir;
      return (await pipeline('feature-extraction', options.model ?? DEFAULT_MODEL, { dtype: 'q8' })) as never;
    });
    const output = await (await extractor)(
      texts.map((t) => `${kind}: ${t}`),
      { pooling: 'mean', normalize: true },
    );
    return output.tolist() as number[][];
  };
}

export interface SyncResult {
  embedded: number;
  removed: number;
  unchanged: number;
}

export class SemanticIndex {
  private readonly dir: string;
  private readonly embed: Embedder;
  private readonly tableName: string;
  private table?: Promise<lancedb.Table | null>;
  private db?: Promise<lancedb.Connection>;
  // Syncs are serialized so two searches never write the same notes twice.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: { dir: string; embed: Embedder; model?: string }) {
    this.dir = options.dir;
    this.embed = options.embed;
    // A different model gives incompatible vectors, so each model gets its own table.
    this.tableName = `chunks_${(options.model ?? DEFAULT_MODEL).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
  }

  /** Brings the index in line with the notes: only notes whose text changed are embedded again. */
  sync(notes: NoteFile[]): Promise<SyncResult> {
    const run = this.queue.then(() => this.syncNow(notes));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Drops the index and embeds every note again. */
  async rebuild(notes: NoteFile[]): Promise<SyncResult> {
    const db = await this.connect();
    if ((await db.tableNames()).includes(this.tableName)) await db.dropTable(this.tableName);
    this.table = Promise.resolve(null);
    return this.sync(notes);
  }

  async search(notes: NoteFile[], query: string, options: { type?: string; tag?: string; limit?: number } = {}): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    await this.sync(notes);
    const table = await this.openTable();
    if (!table) return [];
    const [vector] = await this.embed([query.trim()], 'query');
    const filters: string[] = [];
    if (options.type) filters.push(`type = ${sqlString(options.type)}`);
    if (options.tag) filters.push(`array_has(tags, ${sqlString(options.tag)})`);
    let request = table.vectorSearch(vector!).distanceType('cosine').limit(options.limit ?? 10);
    if (filters.length) request = request.where(filters.join(' AND '));
    const rows = (await request.toArray()) as (Row & { _distance: number })[];
    return rows.map((row) => ({
      title: row.title,
      path: row.path,
      type: row.type,
      section: row.section,
      score: Math.round((1 - row._distance) * 1000) / 1000,
      snippet: row.content.length > SNIPPET_CHARS ? `${row.content.slice(0, SNIPPET_CHARS - 3)}...` : row.content,
    }));
  }

  private async syncNow(notes: NoteFile[]): Promise<SyncResult> {
    const table = await this.openTable();
    const indexed = new Map<string, string>();
    if (table) {
      for (const row of (await table.query().select(['path', 'note_hash']).toArray()) as Pick<Row, 'path' | 'note_hash'>[]) {
        indexed.set(row.path, row.note_hash);
      }
    }
    const current = new Map(notes.map((n) => [n.path, n]));
    const changed = notes.filter((n) => indexed.get(n.path) !== hash(n.text));
    const gone = [...indexed.keys()].filter((p) => !current.has(p));
    const stale = [...gone, ...changed.map((n) => n.path).filter((p) => indexed.has(p))];
    if (table && stale.length) await table.delete(`path IN (${stale.map(sqlString).join(', ')})`);

    const chunks = changed.flatMap((note) => chunkNote(note).map((chunk) => ({ chunk, noteHash: hash(note.text) })));
    if (chunks.length) {
      const vectors = await this.embed(chunks.map((c) => c.chunk.passage), 'passage');
      const rows: Row[] = chunks.map(({ chunk, noteHash }, i) => ({
        id: chunk.id,
        path: chunk.path,
        title: chunk.title,
        type: chunk.type,
        tags: chunk.tags,
        section: chunk.section,
        content: chunk.content,
        note_hash: noteHash,
        vector: vectors[i]!,
      }));
      if (table) await table.add(rows as unknown as Record<string, unknown>[]);
      else this.table = Promise.resolve(await (await this.connect()).createTable(this.tableName, rows as unknown as Record<string, unknown>[]));
    }
    return { embedded: changed.length, removed: gone.length, unchanged: notes.length - changed.length };
  }

  private connect(): Promise<lancedb.Connection> {
    this.db ??= lancedb.connect(this.dir);
    return this.db;
  }

  private openTable(): Promise<lancedb.Table | null> {
    this.table ??= this.connect().then(async (db) => ((await db.tableNames()).includes(this.tableName) ? db.openTable(this.tableName) : null));
    return this.table;
  }
}

interface Row {
  id: string;
  path: string;
  title: string;
  type: string;
  tags: string[];
  section: string;
  content: string;
  note_hash: string;
  vector: number[];
}

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
