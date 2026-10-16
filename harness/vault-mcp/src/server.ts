// MCP server "vault": the only channel between the agent and the movie-tracker-vault repository.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { NOTE_TYPES, RELATION_TYPES, RELATIONS } from './notes.ts';
import { Vault } from './vault.ts';

// harness/vault-mcp/src -> app repository root
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// The vault is a sibling clone of the app repository, never a folder inside it (ADR-005).
const vaultRoot = path.resolve(APP_ROOT, process.env.VAULT_PATH ?? '../movie-tracker-vault');

const vault = new Vault({
  root: vaultRoot,
  mocFile: process.env.VAULT_MOC ?? 'MOC - movie-tracker.md',
  push: process.env.VAULT_PUSH !== 'false',
});

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] };
}

const server = new McpServer(
  { name: 'vault', version: '0.1.0' },
  {
    instructions:
      'Knowledge base (Obsidian vault) of the movie-tracker app. Start from get_note("MOC - movie-tracker"). ' +
      'Use search_notes/get_note before answering questions about the domain, architecture or decisions. ' +
      'Record finished work and decisions with ingest_note; it is idempotent, so repeating a call is safe.',
  },
);

server.registerTool(
  'ingest_note',
  {
    title: 'Create or update a vault note',
    description:
      'Writes one note into the vault following its conventions (frontmatter, folder per type, wiki-links), ' +
      'adds new notes to the MOC, then commits and pushes the vault repository. ' +
      'Idempotent: the same input twice returns status "unchanged" and creates no commit. ' +
      'Updating replaces the note body with `content` (omit it to keep the body); aliases, tags, requirements, sources and relations are merged. ' +
      'Typed relations are checked against the vault ontology: wrong source or target type, or a missing target, rejects the call. ' +
      'Notes are never deleted through this tool.',
    inputSchema: {
      title: z
        .string()
        .describe('File name without .md: English Title Case, e.g. "Watchlist" or "ADR-006 Cursor Pagination". Ukrainian name goes to aliases.'),
      type: z.enum(NOTE_TYPES).describe('Note type; decides the folder: Concepts/, Components/, Decisions/, Glossary/'),
      content: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Markdown body without frontmatter and without the H1 title. Reference other notes as [[Note Title]]. ' +
            'Required for a new note; omit when only frontmatter or relations change.',
        ),
      aliases: z.array(z.string()).optional().describe('Alternative names, e.g. the Ukrainian term'),
      tags: z.array(z.string()).optional().describe('Extra tags; the type tag is added automatically'),
      requirements: z.array(z.string()).optional().describe('Requirement IDs from docs/app-requirements.md, e.g. ["FR-7", "NFR-5"]'),
      links: z.array(z.string()).optional().describe('Titles of related notes to link at the end of the body'),
      properties: z
        .record(z.string(), z.union([z.string(), z.array(z.string())]))
        .optional()
        .describe('Type-specific frontmatter: component → layer, source_path, status; decision → status, supersedes, superseded_by'),
      relations: z
        .partialRecord(z.enum(RELATION_TYPES as [string, ...string[]]), z.array(z.string()))
        .optional()
        .describe(
          'Typed links to existing notes, by title. ' +
            RELATION_TYPES.map((r) => `${r}: ${RELATIONS[r].domain.join('/')} → ${RELATIONS[r].range.join('/')}`).join('; '),
        ),
      source: z
        .string()
        .optional()
        .describe('Where the knowledge came from, e.g. "github:movie-tracker@1a2b3c4" or "PR #3"; kept in frontmatter `sources`'),
      add_to_moc: z.boolean().optional().describe('Link a newly created note from the MOC (default true)'),
    },
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ add_to_moc, ...input }) => {
    try {
      return ok(await vault.ingest({ ...input, addToMoc: add_to_moc }));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  'get_note',
  {
    title: 'Read a vault note',
    description:
      'Returns one note by exact title or alias (case-insensitive): frontmatter, markdown body, backlinks ' +
      'and typed relations (outgoing, and incoming under the inverse name, e.g. used_by, implemented_by).',
    inputSchema: { title: z.string().describe('Note title, e.g. "Recommender", or an alias such as "Рекомендатор"') },
    annotations: { readOnlyHint: true },
  },
  async ({ title }) => {
    try {
      const note = await vault.getNote(title);
      if (note) return ok(note);
      const suggestions = (await vault.search(title, { limit: 5 })).map((h) => h.title);
      return fail(new Error(`No note "${title}". Closest matches: ${suggestions.join(', ') || 'none'}`));
    } catch (error) {
      return fail(error);
    }
  },
);

server.registerTool(
  'search_notes',
  {
    title: 'Search the vault',
    description:
      'Keyword search over note titles, aliases, tags and bodies (Ukrainian or English). ' +
      'Returns ranked titles with a snippet; read the full note with get_note.',
    inputSchema: {
      query: z.string().min(1).describe('Words to look for, e.g. "рекомендації детермінованість"'),
      type: z.enum([...NOTE_TYPES, 'moc']).optional().describe('Only notes of this type'),
      tag: z.string().optional().describe('Only notes with this tag'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum results (default 10)'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, ...options }) => {
    try {
      return ok(await vault.search(query, options));
    } catch (error) {
      return fail(error);
    }
  },
);

try {
  await vault.assertReady();
} catch (error) {
  console.error(`vault-mcp: vault not found at ${vaultRoot} (${(error as Error).message}). Set VAULT_PATH.`);
  process.exit(1);
}
await server.connect(new StdioServerTransport());
console.error(`vault-mcp: serving ${vaultRoot}`);
