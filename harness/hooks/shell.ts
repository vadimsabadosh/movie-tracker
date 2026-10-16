// Minimal shell parsing for guardrail checks: enough to split a Bash tool command into
// simple commands without being fooled by quotes, heredoc bodies or commit messages.
// It is not a full shell parser; unknown constructs make `allow` impossible (see rules.ts).

export interface Segment {
  /** Words with quotes removed. */
  words: string[];
  /** Redirection targets (`> file`, `>> file`), excluding /dev/null and fd duplication. */
  redirects: string[];
}

export interface ParsedCommand {
  segments: Segment[];
  /** Command substitution, process substitution or subshells — content not analysed as segments. */
  opaque: boolean;
}

const OPERATORS = ['&&', '||', ';;', '|&', ';', '|', '&', '\n', '(', ')'];

/** Drops heredoc bodies: `cat <<'EOF'\n...\nEOF` keeps only `cat <<'EOF'`. */
export function stripHeredocs(command: string): string {
  const lines = command.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    out.push(line);
    const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (!match) continue;
    const end = match[2];
    while (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== end) i++;
    i++; // skip the terminator line
  }
  return out.join('\n');
}

export function parseCommand(command: string): ParsedCommand {
  const text = stripHeredocs(command);
  const segments: Segment[] = [];
  let opaque = /\$\(|`|<\(|>\(/.test(text);
  let words: string[] = [];
  let redirects: string[] = [];
  let word = '';
  let hasWord = false;
  let pendingRedirect = false;

  const endWord = () => {
    if (!hasWord) return;
    if (pendingRedirect) {
      if (word !== '/dev/null') redirects.push(word);
      pendingRedirect = false;
    } else {
      words.push(word);
    }
    word = '';
    hasWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length || redirects.length) segments.push({ words, redirects });
    words = [];
    redirects = [];
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
      if (text[i + 1] === ch) i++; // >> or <<
      if (ch === '<' && text[i] === '<') {
        // heredoc marker: the delimiter word is not a file
        while (text[i + 1] === ' ' || text[i + 1] === '-') i++;
        const delim = /^(['"]?)[A-Za-z_][A-Za-z0-9_]*\1/.exec(text.slice(i + 1));
        if (delim) i += delim[0].length;
        continue;
      }
      if (ch === '>') pendingRedirect = true;
      else {
        // input redirection: the file is read, keep it as a word for path checks
      }
    } else {
      const op = OPERATORS.find((o) => text.startsWith(o, i));
      if (op) {
        if (op === '(' || op === ')') opaque = true;
        endSegment();
        i += op.length - 1;
      } else {
        word += ch;
        hasWord = true;
      }
    }
  }
  endSegment();
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
