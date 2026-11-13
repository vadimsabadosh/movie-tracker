// IMDb non-commercial datasets → catalog (personal use only). Rows go through MovieInput + MovieService,
// so validation and the title+year uniqueness rule apply exactly as for POST /movies.
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type Database from 'better-sqlite3';
import { ConflictError } from '../errors/errors.ts';
import { MovieInput } from '../schemas/movie.ts';
import type { MovieService } from '../services/movie-service.ts';

/** Read order matters: each file narrows what the next one keeps. On disk as `${stem}.tsv.gz`. */
export const IMDB_FILES = ['title.ratings', 'title.basics', 'title.crew', 'name.basics'] as const;

const NULL = '\\N';

/** Streams the data rows (header skipped) of one gzipped TSV. IMDb TSV has no quoting: split on tabs only. */
async function* rows(dir: string, stem: string): AsyncGenerator<string[]> {
  const lines = createInterface({ input: createReadStream(path.join(dir, `${stem}.tsv.gz`)).pipe(createGunzip()), crlfDelay: Infinity });
  let header = true;
  for await (const line of lines) {
    if (header) header = false;
    else if (line !== '') yield line.split('\t');
  }
}

/** Names joined with ", ", dropping whole names from the end so the result fits in `max`. */
export function joinDirectors(names: string[], max = 200): string {
  let result = '';
  for (const name of names) {
    const next = result === '' ? name : `${result}, ${name}`;
    if (next.length > max) break;
    result = next;
  }
  return result === '' ? (names[0] ?? '').slice(0, max) : result;
}

export async function readImdbMovies(dir: string, minVotes: number): Promise<{ inputs: MovieInput[]; invalid: number }> {
  const popular = new Set<string>();
  for await (const [tconst, , votes] of rows(dir, 'title.ratings')) if (Number(votes) >= minVotes) popular.add(tconst!);

  const basics = new Map<string, { title: string; year: string; genres: string }>();
  for await (const [tconst, type, title, , , year, , , genres] of rows(dir, 'title.basics')) {
    if (type === 'movie' && popular.has(tconst!)) basics.set(tconst!, { title: title!, year: year!, genres: genres! });
  }

  const directors = new Map<string, string[]>();
  for await (const [tconst, ids] of rows(dir, 'title.crew')) {
    if (basics.has(tconst!) && ids !== NULL) directors.set(tconst!, ids!.split(','));
  }

  const wanted = new Set([...directors.values()].flat());
  const names = new Map<string, string>();
  for await (const [nconst, name] of rows(dir, 'name.basics')) if (wanted.has(nconst!)) names.set(nconst!, name!);

  const inputs: MovieInput[] = [];
  let invalid = 0;
  for (const [tconst, movie] of basics) {
    const resolved = (directors.get(tconst) ?? []).flatMap((id) => names.get(id) ?? []);
    const parsed =
      movie.year === NULL || movie.genres === NULL || resolved.length === 0
        ? undefined
        : MovieInput.safeParse({
            title: movie.title,
            year: Number(movie.year),
            genres: movie.genres.split(','),
            director: joinDirectors(resolved),
          });
    if (parsed?.success) inputs.push(parsed.data);
    else invalid++;
  }
  return { inputs, invalid };
}

/** One transaction for the whole batch; duplicates (same title + year) are counted and skipped. */
export function importMovies(db: Database.Database, movies: MovieService, inputs: MovieInput[]): { imported: number; duplicates: number } {
  let imported = 0;
  let duplicates = 0;
  db.transaction(() => {
    for (const input of inputs) {
      try {
        movies.create(input);
        imported++;
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        duplicates++;
      }
    }
  })();
  return { imported, duplicates };
}
