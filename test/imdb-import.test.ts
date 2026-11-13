// IMDb import: reading the dataset files (fixture .tsv.gz, no network) and saving through MovieService.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServices } from '../src/container.ts';
import { openDatabase } from '../src/db/database.ts';
import { importMovies, joinDirectors, readImdbMovies } from '../src/import/imdb.ts';

const MANY = Array.from({ length: 40 }, (_, i) => `nm${i + 10}`);

const FIXTURES: Record<string, string[][]> = {
  'title.ratings': [
    ['tconst', 'averageRating', 'numVotes'],
    ['tt1', '7.9', '6000'],
    ['tt2', '8.0', '6000'],
    ['tt3', '6.0', '100'],
    ['tt4', '7.0', '9000'],
    ['tt5', '7.0', '7000'],
    ['tt6', '7.0', '8000'],
  ],
  'title.basics': [
    ['tconst', 'titleType', 'primaryTitle', 'originalTitle', 'isAdult', 'startYear', 'endYear', 'runtimeMinutes', 'genres'],
    ['tt1', 'movie', 'Arrival', 'Arrival', '0', '2016', '\\N', '116', 'Drama,Sci-Fi'],
    ['tt2', 'tvSeries', 'Show', 'Show', '0', '2010', '2012', '\\N', 'Drama'],
    ['tt3', 'movie', 'Obscure', 'Obscure', '0', '2000', '\\N', '90', 'Drama'],
    ['tt4', 'movie', 'He Said "Yes"', 'He Said "Yes"', '0', '2019', '\\N', '90', 'Comedy'],
    ['tt5', 'movie', 'No Year', 'No Year', '0', '\\N', '\\N', '90', 'Drama'],
    ['tt6', 'movie', 'Anthology', 'Anthology', '0', '2001', '\\N', '120', 'Drama'],
  ],
  'title.crew': [
    ['tconst', 'directors', 'writers'],
    ['tt1', 'nm1', '\\N'],
    ['tt4', 'nm2', '\\N'],
    ['tt5', 'nm1', '\\N'],
    ['tt6', MANY.join(','), '\\N'],
  ],
  'name.basics': [
    ['nconst', 'primaryName', 'birthYear', 'deathYear', 'primaryProfession', 'knownForTitles'],
    ['nm1', 'Denis Villeneuve', '1967', '\\N', 'director', 'tt1'],
    ['nm2', 'Jane Doe', '\\N', '\\N', 'director', 'tt4'],
    ...MANY.map((id) => [id, `Director Number ${id.slice(2)}`, '\\N', '\\N', 'director', 'tt6']),
  ],
};

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'imdb-'));
  for (const [stem, rows] of Object.entries(FIXTURES)) {
    writeFileSync(path.join(dir, `${stem}.tsv.gz`), gzipSync(rows.map((r) => r.join('\t')).join('\n')));
  }
});

describe('readImdbMovies', () => {
  it('reads only movies above the vote threshold, with directors', async () => {
    const { inputs, invalid } = await readImdbMovies(dir, 5000);
    expect(inputs.map((m) => m.title).sort()).toEqual(['Anthology', 'Arrival', 'He Said "Yes"']);
    expect(inputs.find((m) => m.title === 'Arrival')).toEqual({
      title: 'Arrival',
      year: 2016,
      genres: ['Drama', 'Sci-Fi'],
      director: 'Denis Villeneuve',
    });
    expect(invalid).toBe(1); // tt5: \N year
  });

  it('keeps quotes in titles (TSV has no quoting)', async () => {
    const { inputs } = await readImdbMovies(dir, 5000);
    expect(inputs.find((m) => m.title === 'He Said "Yes"')?.director).toBe('Jane Doe');
  });

  it('cuts long director lists at a name boundary', async () => {
    const anthology = (await readImdbMovies(dir, 5000)).inputs.find((m) => m.title === 'Anthology')!;
    expect(anthology.director.length).toBeLessThanOrEqual(200);
    expect(anthology.director).toMatch(/^Director Number \d+(, Director Number \d+)*$/);
  });

  it('respects the vote threshold', async () => {
    // tt3 passes the lower threshold but has no director, so it is counted invalid, not imported.
    const { inputs, invalid } = await readImdbMovies(dir, 50);
    expect(inputs).toHaveLength(3);
    expect(invalid).toBe(2);
  });
});

describe('joinDirectors', () => {
  it('joins with ", " and never exceeds max', () => {
    expect(joinDirectors(['A', 'B'])).toBe('A, B');
    expect(joinDirectors(['aaaa', 'bbbb'], 6)).toBe('aaaa');
  });
});

describe('importMovies', () => {
  it('imports through the service and is idempotent', async () => {
    const db = openDatabase(':memory:');
    const services = createServices(db);
    const { inputs } = await readImdbMovies(dir, 5000);
    expect(importMovies(db, services.movies, inputs)).toEqual({ imported: 3, duplicates: 0 });
    expect(importMovies(db, services.movies, inputs)).toEqual({ imported: 0, duplicates: 3 });
    expect(services.movies.list({ limit: 20, offset: 0 }).total).toBe(3);
  });
});
