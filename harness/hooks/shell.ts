// Minimal shell parsing for guardrail checks: enough to split a Bash tool command into
// simple commands without being fooled by quotes, heredoc bodies or commit messages.
// It is not a full shell parser; anything it cannot resolve to literal words makes the
// command `opaque` or the segment `dynamic`, and then `allow` is impossible (see rules.ts).

export interface Segment {
  /** Words with quotes removed. */
  words: string[];
  /** Redirection targets (`> file`, `>> file`), excluding /dev/null and fd duplication. */
  redirects: string[];
  /** Words (and redirect targets) with unquoted glob characters: `*`, `?`, `[`, `{`. */
  globs: string[];
  /** A word depends on `$` expansion, so its real value is unknown. */
  dynamic: boolean;
}

export interface ParsedCommand {
  segments: Segment[];
  /** Command/process substitution, subshells or an unterminated heredoc — not fully analysed. */
  opaque: boolean;
}

const OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '\n', '(', ')'];

export function parseCommand(text: string): ParsedCommand {
  const segments: Segment[] = [];
  let opaque = /\$\(|`|<\(|>\(/.test(text);
  let words: string[] = [];
  let redirects: string[] = [];
  let globs: string[] = [];
  let dynamic = false;
  let word = '';
  let hasWord = false;
  let wordGlob = false;
  let pendingRedirect = false;
  /** Heredoc delimiters whose bodies start after the next newline. */
  const heredocs: string[] = [];

  const endWord = () => {
    if (!hasWord) return;
    if (wordGlob) globs.push(word);
    if (pendingRedirect) {
      if (word !== '/dev/null') redirects.push(word);
      pendingRedirect = false;
    } else {
      words.push(word);
    }
    word = '';
    hasWord = false;
    wordGlob = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length || redirects.length) segments.push({ words, redirects, globs, dynamic });
    words = [];
    redirects = [];
    globs = [];
    dynamic = false;
  };
  /** Skips heredoc bodies that start at `start` (just after a newline); returns the index to continue from. */
  const skipHeredocs = (start: number): number => {
    let pos = start;
    while (heredocs.length) {
      const delim = heredocs.shift() ?? '';
      let found = -1;
      let lineStart = pos;
      while (lineStart <= text.length) {
        const nl = text.indexOf('\n', lineStart);
        const lineEnd = nl === -1 ? text.length : nl;
        if (text.slice(lineStart, lineEnd).replace(/^\t+/, '') === delim) {
          found = lineEnd;
          break;
        }
        if (nl === -1) break;
        lineStart = nl + 1;
      }
      if (found === -1) {
        // No terminator: a shell would read to the end, but we cannot be sure — analyse the rest as commands.
        opaque = true;
        heredocs.length = 0;
        return start;
      }
      pos = found + 1;
    }
    return pos;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      const end = close === -1 ? text.length : close;
      word += text.slice(i + 1, end);
      hasWord = true;
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length) j++;
        else if (text[j] === '$') dynamic = true;
        word += text[j];
        j++;
      }
      hasWord = true;
      i = j;
    } else if (ch === '\\' && i + 1 < text.length) {
      if (text[i + 1] !== '\n') {
        word += text[i + 1];
        hasWord = true;
      }
      i++;
    } else if (ch === ' ' || ch === '\t') {
      endWord();
    } else if (ch === '#' && !hasWord) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++;
    } else if (/[0-9]/.test(ch) && !hasWord && (text[i + 1] === '>' || text[i + 1] === '<')) {
      // fd prefix of a redirection, e.g. 2>&1 or 2>/dev/null
      continue;
    } else if (ch === '>' || ch === '<') {
      endWord();
      if (text[i + 1] === '&') {
        // >&2, 2>&1: fd duplication, skip the fd number
        i += 1;
        while (/[0-9-]/.test(text[i + 1] ?? '')) i++;
        continue;
      }
      if (ch === '<' && text.startsWith('<<<', i)) {
        i += 2; // here-string: the next word is data, keep it as a word
        continue;
      }
      if (ch === '<' && text[i + 1] === '<') {
        // heredoc operator: record the delimiter, the body starts after the next newline
        i += 1;
        if (text[i + 1] === '-') i++;
        while (text[i + 1] === ' ') i++;
        const delim = /^(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(text.slice(i + 1));
        if (delim) {
          heredocs.push(delim[2] ?? '');
          i += delim[0].length;
        } else {
          opaque = true;
        }
        continue;
      }
      if (text[i + 1] === ch) i++; // >>
      if (ch === '>') pendingRedirect = true;
      // `< file`: the file is read; it stays a normal word for path checks
    } else {
      const op = OPERATORS.find((o) => text.startsWith(o, i));
      if (op) {
        if (op === '(' || op === ')') opaque = true;
        endSegment();
        i += op.length - 1;
        if (op === '\n' && heredocs.length) i = skipHeredocs(i + 1) - 1;
      } else {
        if (ch === '$') dynamic = true;
        if ('*?[{'.includes(ch)) wordGlob = true;
        word += ch;
        hasWord = true;
      }
    }
  }
  endSegment();
  if (heredocs.length) opaque = true; // heredoc without a body line
  return { segments, opaque };
}

/** `git -C dir -c k=v commit ...` → { dir, sub: 'commit', args: [...] }. */
export function gitInvocation(words: string[]): { dir?: string; sub: string; args: string[] } | null {
  if (words[0] !== 'git') return null;
  let dir: string | undefined;
  let i = 1;
  while (i < words.length) {
    const w = words[i] ?? '';
    if (w === '-C') {
      dir = words[i + 1];
      i += 2;
    } else if (w === '-c' || w === '--git-dir' || w === '--work-tree') {
      i += 2;
    } else if (w.startsWith('-')) {
      i += 1;
    } else break;
  }
  if (i >= words.length) return null;
  return { dir, sub: words[i] ?? '', args: words.slice(i + 1) };
}
