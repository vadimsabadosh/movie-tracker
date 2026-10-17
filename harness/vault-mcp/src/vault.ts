// Ingestion and retrieval over a local clone of the vault repository.
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { git, hasUpstream } from './git.ts';
import type { SemanticIndex } from './semantic.ts';
import {
  adrId,
  asStringArray,
  extractLinks,
  fromLink,
  MOC_SECTIONS,
  parseNote,
  RELATION_TYPES,
  RELATIONS,
  serializeNote,
  toLink,
  TYPE_FOLDERS,
  union,
  validateTitle,
  type Frontmatter,
  type NoteType,
  type RelationType,
} from './notes.ts';

// Folders that hold no knowledge notes.
const SKIPPED_DIRS = new Set(['Templates']);
// Fields the server manages itself; callers cannot set them through `properties`.
const RESERVED_KEYS = new Set(['type', 'id', 'aliases', 'tags', 'requirements', 'sources', 'created', 'updated', ...RELATION_TYPES]);
const REQUIREMENT_RE = /^N?FR-\d+$/;

export interface VaultOptions {
  root: string;
  mocFile?: string;
  push?: boolean;
  today?: () => string;
  /** Semantic retrieval (PR7); without it, or when it fails, search falls back to keywords. */
  semantic?: SemanticIndex;
}

export interface NoteFile {
  path: string;
  title: string;
  frontmatter: Frontmatter;
  body: string;
  text: string;
}

export interface IngestInput {
  title: string;
  type: NoteType;
  /** Required for a new note; omitted on update keeps the current body. */
  content?: string;
  aliases?: string[];
  tags?: string[];
  requirements?: string[];
  links?: string[];
  properties?: Record<string, string | string[]>;
  relations?: Partial<Record<RelationType, string[]>>;
  source?: string;
  addToMoc?: boolean;
}

export interface IngestResult {
  status: 'created' | 'updated' | 'unchanged';
  path: string;
  commit?: string;
  pushed: boolean;
  mocUpdated: boolean;
  warnings: string[];
}

export interface NoteView {
  path: string;
  title: string;
  frontmatter: Frontmatter;
  body: string;
  backlinks: string[];
  relations: { outgoing: Record<string, string[]>; incoming: Record<string, string[]> };
}

export interface SearchHit {
  title: string;
  path: string;
  type: string;
  /** `##` section the fragment comes from (semantic search only); empty for the note intro. */
  section?: string;
  score: number;
  snippet: string;
}

export interface SearchOptions {
  type?: string;
  tag?: string;
  limit?: number;
}

export class Vault {
  readonly root: string;
  private readonly mocFile: string;
  private readonly push: boolean;
  private readonly today: () => string;
  private readonly semantic?: SemanticIndex;
  // Ingests are serialized so two calls never race on the same git index.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: VaultOptions) {
    this.root = path.resolve(options.root);
    this.mocFile = options.mocFile ?? 'MOC - movie-tracker.md';
    this.push = options.push ?? true;
    this.today = options.today ?? (() => new Date().toISOString().slice(0, 10));
    this.semantic = options.semantic;
  }

  async assertReady(): Promise<void> {
    const top = await git(this.root, 'rev-parse', '--show-toplevel');
    if (path.resolve(top) !== this.root) throw new Error(`${this.root} is not the root of a git repository`);
  }

  /** Every markdown file outside hidden and template folders, typed or not. */
  async listFiles(): Promise<NoteFile[]> {
    const files: NoteFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(path.join(this.root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name)) await walk(rel);
        } else if (entry.name.endsWith('.md')) {
          const text = await readFile(path.join(this.root, rel), 'utf8');
          const { frontmatter, body } = parseNote(text);
          files.push({ path: rel, title: entry.name.slice(0, -3), frontmatter, body, text });
        }
      }
    };
    await walk('');
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Knowledge notes: files with a frontmatter `type`. */
  async listNotes(): Promise<NoteFile[]> {
    return (await this.listFiles()).filter((note) => typeof note.frontmatter.type === 'string');
  }

  async getNote(name: string): Promise<NoteView | null> {
    const notes = await this.listNotes();
    const wanted = name.trim().toLowerCase();
    const note =
      notes.find((n) => n.title.toLowerCase() === wanted) ??
      notes.find((n) => asStringArray(n.frontmatter.aliases).some((a) => a.toLowerCase() === wanted));
    if (!note) return null;
    const titleLower = note.title.toLowerCase();
    const backlinks = notes
      .filter((n) => n !== note && extractLinks(n.text).some((l) => l.toLowerCase() === titleLower))
      .map((n) => n.title);
    return { path: note.path, title: note.title, frontmatter: note.frontmatter, body: note.body, backlinks, relations: relationsOf(note, notes) };
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    if (this.semantic) {
      try {
        return await this.semantic.search(await this.listNotes(), query, options);
      } catch (error) {
        console.error(`vault-mcp: semantic search failed, falling back to keywords: ${(error as Error).message}`);
      }
    }
    return this.keywordSearch(query, options);
  }

  /** Brings the semantic index up to date; a no-op in keyword mode. */
  async syncIndex(): Promise<void> {
    if (this.semantic) await this.semantic.sync(await this.listNotes());
  }

  /** Pre-PR7 retrieval: term matches in titles, aliases, tags and bodies. */
  async keywordSearch(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? []).filter((t) => t.length > 1).map(stem))];
    if (terms.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const note of await this.listNotes()) {
      if (options.type && note.frontmatter.type !== options.type) continue;
      if (options.tag && !asStringArray(note.frontmatter.tags).includes(options.tag)) continue;
      const title = note.title.toLowerCase();
      const aliases = asStringArray(note.frontmatter.aliases).join(' ').toLowerCase();
      const tags = asStringArray(note.frontmatter.tags).join(' ').toLowerCase();
      const body = note.body.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 5;
        if (aliases.includes(term)) score += 4;
        if (tags.includes(term)) score += 2;
        score += Math.min(body.split(term).length - 1, 5);
      }
      if (score > 0) {
        hits.push({ title: note.title, path: note.path, type: String(note.frontmatter.type), score, snippet: snippet(note.body, terms) });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return hits.slice(0, options.limit ?? 10);
  }

  ingest(input: IngestInput): Promise<IngestResult> {
    const run = this.queue.then(() => this.ingestNow(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async ingestNow(input: IngestInput): Promise<IngestResult> {
    const title = input.title.trim();
    const titleError = validateTitle(title, input.type);
    if (titleError) throw new Error(titleError);
    const badRequirement = (input.requirements ?? []).find((r) => !REQUIREMENT_RE.test(r));
    if (badRequirement) throw new Error(`requirement "${badRequirement}" must look like FR-1 or NFR-2`);
    const reserved = Object.keys(input.properties ?? {}).find((k) => RESERVED_KEYS.has(k));
    if (reserved) throw new Error(`property "${reserved}" is managed by the server; use the dedicated argument`);

    const upstream = await hasUpstream(this.root);
    if (upstream) await git(this.root, 'pull', '--ff-only', '--quiet');

    const files = await this.listFiles();
    const existing = files.find((f) => f.title.toLowerCase() === title.toLowerCase());
    if (existing && existing.frontmatter.type !== input.type) {
      throw new Error(`"${existing.path}" already exists with type "${String(existing.frontmatter.type ?? 'none')}"`);
    }
    if (!existing && !input.content?.trim()) throw new Error('content is required to create a note');
    const relations = resolveRelations(input, title, files);
    const relPath = existing?.path ?? path.join(TYPE_FOLDERS[input.type], `${title}.md`);
    const today = this.today();

    const frontmatter = buildFrontmatter(existing?.frontmatter, input, title, today, relations);
    const body = input.content?.trim() ? buildBody(existing?.title ?? title, input.content, input.links) : existing!.body;
    let text = serializeNote(frontmatter, body);

    const warnings = unresolvedLinks(text, files, title).map((l) => `link [[${l}]] does not match any note`);
    if (existing && text === existing.text) {
      return { status: 'unchanged', path: relPath, pushed: false, mocUpdated: false, warnings };
    }
    if (existing) {
      frontmatter.updated = today;
      text = serializeNote(frontmatter, body);
    }

    const changed: { path: string; previous: string | null }[] = [{ path: relPath, previous: existing?.text ?? null }];
    const moc = files.find((f) => f.path === this.mocFile);
    let mocUpdated = false;
    if (input.addToMoc !== false && moc && !existing) {
      const nextMoc = addToMoc(moc.text, title, input.type);
      if (nextMoc !== moc.text) {
        changed.push({ path: moc.path, previous: moc.text });
        await writeFile(path.join(this.root, moc.path), nextMoc);
        mocUpdated = true;
      }
    }
    await mkdir(path.dirname(path.join(this.root, relPath)), { recursive: true });
    await writeFile(path.join(this.root, relPath), text);

    const status = existing ? 'updated' : 'created';
    let commit: string;
    try {
      const paths = changed.map((c) => c.path);
      await git(this.root, 'add', '--', ...paths);
      const message = `vault-mcp: ${status === 'created' ? 'create' : 'update'} ${relPath}`;
      const args = ['commit', '--quiet', '-m', message];
      if (input.source) args.push('-m', `Source: ${input.source}`);
      await git(this.root, ...args, '--', ...paths);
      commit = await git(this.root, 'rev-parse', '--short', 'HEAD');
    } catch (error) {
      await rollback(this.root, changed);
      throw error;
    }

    let pushed = false;
    if (upstream && this.push) {
      try {
        await git(this.root, 'push', '--quiet');
        pushed = true;
      } catch (error) {
        warnings.push(`committed locally but push failed: ${(error as Error).message}`);
      }
    }
    return { status, path: relPath, commit, pushed, mocUpdated, warnings };
  }
}

/**
 * Checks every relation against the ontology (allowed source and target types, target exists)
 * and returns canonical target titles. Any violation rejects the whole call.
 */
function resolveRelations(input: IngestInput, title: string, files: NoteFile[]): Partial<Record<RelationType, string[]>> {
  const resolved: Partial<Record<RelationType, string[]>> = {};
  for (const [name, targets] of Object.entries(input.relations ?? {})) {
    const relation = name as RelationType;
    const spec = RELATIONS[relation];
    if (!spec) throw new Error(`unknown relation "${name}"; allowed: ${RELATION_TYPES.join(', ')}`);
    if (!(spec.domain as readonly string[]).includes(input.type)) {
      throw new Error(`relation "${relation}" cannot start from a ${input.type} note (allowed: ${spec.domain.join(', ')})`);
    }
    resolved[relation] = (targets ?? []).map((raw) => {
      const wanted = fromLink(raw).toLowerCase();
      if (wanted === title.toLowerCase()) throw new Error(`relation "${relation}" cannot point to the note itself`);
      const target = files.find((f) => f.title.toLowerCase() === wanted && typeof f.frontmatter.type === 'string');
      if (!target) throw new Error(`relation "${relation}": no note "${fromLink(raw)}"`);
      const targetType = String(target.frontmatter.type);
      if (!(spec.range as readonly string[]).includes(targetType)) {
        throw new Error(`relation "${relation}" cannot point to ${targetType} note "${target.title}" (allowed: ${spec.range.join(', ')})`);
      }
      return target.title;
    });
  }
  return resolved;
}

function relationsOf(note: NoteFile, notes: NoteFile[]): NoteView['relations'] {
  const outgoing: Record<string, string[]> = {};
  const incoming: Record<string, string[]> = {};
  const titleLower = note.title.toLowerCase();
  for (const relation of RELATION_TYPES) {
    const targets = asStringArray(note.frontmatter[relation]).map(fromLink).filter(Boolean);
    if (targets.length) outgoing[relation] = targets;
    const sources = notes
      .filter((n) => asStringArray(n.frontmatter[relation]).some((v) => fromLink(v).toLowerCase() === titleLower))
      .map((n) => n.title);
    if (sources.length) incoming[RELATIONS[relation].inverse] = sources;
  }
  return { outgoing, incoming };
}

function buildFrontmatter(
  previous: Frontmatter | undefined,
  input: IngestInput,
  title: string,
  today: string,
  relations: Partial<Record<RelationType, string[]>>,
): Frontmatter {
  // Existing key order is kept; new keys follow the vault templates.
  const fm: Frontmatter = previous ? { ...previous } : { type: input.type };
  if (input.type === 'decision' && fm.id === undefined) fm.id = adrId(title);
  fm.aliases = union(asStringArray(previous?.aliases), input.aliases ?? []);
  fm.tags = union(previous ? asStringArray(previous.tags) : [input.type], input.tags ?? []);
  if (!previous && input.type === 'decision') {
    Object.assign(fm, { status: 'proposed', date: today, supersedes: [], superseded_by: [] });
  }
  if (!previous && input.type === 'component') fm.status = 'planned';
  Object.assign(fm, input.properties ?? {});
  if (input.requirements?.length || previous?.requirements !== undefined) {
    fm.requirements = union(asStringArray(previous?.requirements), input.requirements ?? []);
  }
  for (const [relation, targets] of Object.entries(relations)) {
    const merged = union(asStringArray(previous?.[relation]).map(fromLink), targets ?? []);
    fm[relation] = merged.map(toLink);
  }
  if (input.source) fm.sources = union(asStringArray(previous?.sources), [input.source]);
  if (!previous) {
    fm.created = today;
    fm.updated = today;
  }
  return fm;
}

function buildBody(title: string, rawContent: string, extraLinks: string[] | undefined): string {
  let content = rawContent.trim();
  // Callers sometimes include the H1 themselves; the server owns it.
  const h1 = new RegExp(`^# ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n`, 'i');
  content = content.replace(h1, '').trim();
  let body = `# ${title}\n\n${content}`;
  const links = union(extraLinks ?? []).filter((l) => !extractLinks(content).includes(l));
  if (links.length) body += `\n\n**Пов'язано:** ${links.map((l) => `[[${l}]]`).join(' · ')}`;
  return body;
}

function unresolvedLinks(text: string, files: NoteFile[], ownTitle: string): string[] {
  const known = new Set([...files.map((f) => f.title.toLowerCase()), ownTitle.toLowerCase()]);
  return union(extractLinks(text)).filter((l) => !known.has(l.toLowerCase()));
}

export function addToMoc(mocText: string, title: string, type: NoteType): string {
  if (extractLinks(mocText).some((l) => l.toLowerCase() === title.toLowerCase())) return mocText;
  const lines = mocText.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## ') && l.includes(MOC_SECTIONS[type]));
  if (start === -1) {
    return `${mocText.trimEnd()}\n\n## ${MOC_SECTIONS[type]}\n- [[${title}]]\n`;
  }
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  let insertAt = end;
  while (insertAt > start + 1 && (lines[insertAt - 1] ?? '').trim() === '') insertAt--;
  lines.splice(insertAt, 0, `- [[${title}]]`);
  return lines.join('\n');
}

// Crude stemming: Ukrainian words change endings ("рекомендація" / "рекомендацій"),
// so long terms are matched by prefix. Kept as the fallback for semantic search (PR7).
function stem(term: string): string {
  return term.length > 6 ? term.slice(0, Math.max(6, term.length - 3)) : term;
}

function snippet(body: string, terms: string[]): string {
  const line =
    body.split('\n').find((l) => !l.startsWith('#') && terms.some((t) => l.toLowerCase().includes(t))) ??
    body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ??
    '';
  const trimmed = line.trim();
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}

async function rollback(root: string, changed: { path: string; previous: string | null }[]): Promise<void> {
  for (const change of changed) {
    const file = path.join(root, change.path);
    if (change.previous === null) await unlink(file).catch(() => undefined);
    else await writeFile(file, change.previous);
  }
  await git(root, 'reset', '--quiet', '--', ...changed.map((c) => c.path)).catch(() => undefined);
}
