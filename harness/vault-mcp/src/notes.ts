// Vault note format: YAML frontmatter + markdown body, conventions from the vault README.
import YAML from 'yaml';

export const NOTE_TYPES = ['concept', 'component', 'decision', 'glossary'] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const TYPE_FOLDERS: Record<NoteType, string> = {
  concept: 'Concepts',
  component: 'Components',
  decision: 'Decisions',
  glossary: 'Glossary',
};

// Heading keyword of the matching section in the MOC note.
export const MOC_SECTIONS: Record<NoteType, string> = {
  concept: 'Concepts',
  component: 'Components',
  decision: 'Decisions',
  glossary: 'Glossary',
};

// Typed relations (ontology, PR4): frontmatter lists of "[[Target]]" links.
// `domain` — types of the note that holds the field, `range` — allowed target types.
export const RELATIONS = {
  depends_on: { domain: ['component'], range: ['component'], inverse: 'used_by' },
  implements: { domain: ['component'], range: ['concept', 'decision'], inverse: 'implemented_by' },
  governed_by: { domain: ['component', 'concept'], range: ['decision'], inverse: 'governs' },
  part_of: { domain: ['concept'], range: ['concept'], inverse: 'has_part' },
  supersedes: { domain: ['decision'], range: ['decision'], inverse: 'superseded_by' },
} as const satisfies Record<string, { domain: NoteType[]; range: NoteType[]; inverse: string }>;
export type RelationType = keyof typeof RELATIONS;
export const RELATION_TYPES = Object.keys(RELATIONS) as RelationType[];

export function toLink(title: string): string {
  return `[[${title}]]`;
}

/** "[[Target]]", "[[Target|alias]]" or a bare "Target" → "Target". */
export function fromLink(value: string): string {
  const match = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(value.trim());
  return (match ? match[1] ?? '' : value).trim();
}

export type Frontmatter = Record<string, unknown>;

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export function parseNote(text: string): ParsedNote {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const data: unknown = YAML.parse(match[1] ?? '');
  const frontmatter = data && typeof data === 'object' && !Array.isArray(data) ? (data as Frontmatter) : {};
  return { frontmatter, body: text.slice(match[0].length).replace(/^\n/, '') };
}

export function serializeNote(frontmatter: Frontmatter, body: string): string {
  const doc = new YAML.Document(frontmatter);
  // Lists stay inline (`tags: [a, b]`), matching the hand-written notes.
  YAML.visit(doc, {
    Seq(_, node) {
      node.flow = true;
    },
  });
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return `---\n${yaml}---\n\n${body.trimEnd()}\n`;
}

const LINK_RE = /\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g;

export function extractLinks(text: string): string[] {
  return [...text.matchAll(LINK_RE)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
}

// English Title Case file names (README convention 1): plain ASCII, no path separators.
const TITLE_RE = /^[A-Za-z0-9][A-Za-z0-9 .,()&+'_-]*[A-Za-z0-9)]$/;
const ADR_TITLE_RE = /^ADR-(\d{3}) \S/;

export function validateTitle(title: string, type: NoteType): string | null {
  if (title.length > 120) return 'title is longer than 120 characters';
  if (!TITLE_RE.test(title) || title.includes('..')) {
    return 'title must be plain ASCII (letters, digits, spaces, - _ . , ( ) & + \') — put the Ukrainian name into aliases';
  }
  if (type === 'decision' && !ADR_TITLE_RE.test(title)) {
    return 'decision title must look like "ADR-006 Short Title"';
  }
  return null;
}

export function adrId(title: string): string | undefined {
  const match = ADR_TITLE_RE.exec(title);
  return match ? `ADR-${match[1]}` : undefined;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}

export function union(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}
