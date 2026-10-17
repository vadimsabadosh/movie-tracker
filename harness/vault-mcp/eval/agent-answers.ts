// `npm run eval:agent -- [--mode keyword|semantic] [--only Q1,Q2]`: asks each question of
// docs/rag-evaluation/questions.json to a fresh headless Claude Code agent whose only tool is
// search_notes, once with keyword and once with semantic search. Answers and the searches the
// agent made are merged into docs/rag-evaluation/agent-runs.json.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, '../../../docs/rag-evaluation');
const SERVER = path.resolve(HERE, '../src/server.ts');
const MODEL = process.env.EVAL_MODEL ?? 'claude-sonnet-5-5';
const CONCURRENCY = 4;
const SYSTEM =
  'Answer only from the movie-tracker knowledge base, which you can reach only through the search_notes tool. ' +
  'Name the notes you relied on. If the knowledge base does not contain the answer, say so instead of guessing. ' +
  'Answer in the language of the question, in at most 150 words.';

interface Question {
  id: string;
  question: string;
}

export interface AgentRun {
  id: string;
  mode: string;
  model: string;
  searches: string[];
  answer: string;
  turns: number;
  durationMs: number;
  costUsd: number;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const modes = flag('--mode') ? [flag('--mode')!] : ['keyword', 'semantic'];
const only = flag('--only')?.split(',');
const questions = (JSON.parse(await readFile(path.join(DOCS, 'questions.json'), 'utf8')) as Question[]).filter(
  (q) => !only || only.includes(q.id),
);

const jobs = modes.flatMap((mode) => questions.map((q) => ({ mode, q })));
const runs: AgentRun[] = [];
const workers = Array.from({ length: CONCURRENCY }, async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    const run = await ask(job.q, job.mode);
    console.log(`${run.mode} ${run.id}: ${run.searches.length} searches, ${run.turns} turns`);
    runs.push(run);
  }
});
await Promise.all(workers);

const file = path.join(DOCS, 'agent-runs.json');
const previous = JSON.parse(await readFile(file, 'utf8').catch(() => '[]')) as AgentRun[];
const merged = [...previous.filter((p) => !runs.some((r) => r.id === p.id && r.mode === p.mode)), ...runs].sort(
  (a, b) => a.mode.localeCompare(b.mode) || Number(a.id.slice(1)) - Number(b.id.slice(1)),
);
await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);

// A throwaway working directory keeps the agent away from the app repository, its CLAUDE.md and memory;
// `--setting-sources local` leaves out user-level plugins and hooks, so both modes see the same context.
async function ask(q: Question, mode: string): Promise<AgentRun> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'vault-eval-'));
  try {
    const mcpConfig = path.join(cwd, 'mcp.json');
    const server = { command: 'node', args: [SERVER], env: { VAULT_SEARCH: mode, VAULT_PUSH: 'false' } };
    await writeFile(mcpConfig, JSON.stringify({ mcpServers: { vault: server } }));
    const started = Date.now();
    const lines = await runClaude(cwd, [
      '-p', q.question,
      '--model', MODEL,
      '--setting-sources', 'local',
      '--strict-mcp-config', '--mcp-config', mcpConfig,
      '--tools', '',
      '--allowedTools', 'mcp__vault__search_notes',
      '--disallowedTools', 'mcp__vault__get_note', 'mcp__vault__ingest_note',
      '--append-system-prompt', SYSTEM,
      '--no-session-persistence',
      '--output-format', 'stream-json', '--verbose',
    ]);
    const searches: string[] = [];
    let result: { result?: string; num_turns?: number; total_cost_usd?: number } = {};
    for (const event of lines) {
      if (event.type === 'assistant') {
        for (const part of event.message.content) {
          if (part.type === 'tool_use') searches.push(`${part.name.replace('mcp__vault__', '')}: ${JSON.stringify(part.input)}`);
        }
      }
      if (event.type === 'result') result = event;
    }
    return {
      id: q.id,
      mode,
      model: MODEL,
      searches,
      answer: (result.result ?? '').trim(),
      turns: result.num_turns ?? 0,
      durationMs: Date.now() - started,
      costUsd: Math.round((result.total_cost_usd ?? 0) * 10000) / 10000,
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function runClaude(cwd: string, claudeArgs: string[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', claudeArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited with ${code}: ${err.slice(-500)}`));
      resolve(out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));
    });
  });
}
