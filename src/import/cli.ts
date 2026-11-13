// `npm run import:imdb`: downloads the IMDb datasets (cached in data/imdb/) and imports movies into the catalog.
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { createServices } from '../container.ts';
import { openDatabase } from '../db/database.ts';
import { IMDB_FILES, importMovies, readImdbMovies } from './imdb.ts';

const BASE_URL = 'https://datasets.imdbws.com/';
const CACHE_DIR = 'data/imdb';
const minVotes = Number(process.env.IMDB_MIN_VOTES ?? 5000);

mkdirSync(CACHE_DIR, { recursive: true });
for (const stem of IMDB_FILES) {
  const file = path.join(CACHE_DIR, `${stem}.tsv.gz`);
  if (existsSync(file)) continue;
  console.log(`downloading ${stem}.tsv.gz …`);
  const response = await fetch(`${BASE_URL}${stem}.tsv.gz`);
  if (!response.ok || !response.body) {
    console.error(`download failed: ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  // Rename only after a complete download, so an interrupted run never leaves a file the next run trusts.
  await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(`${file}.part`));
  renameSync(`${file}.part`, file);
}

const started = Date.now();
const { inputs, invalid } = await readImdbMovies(CACHE_DIR, minVotes);
const db = openDatabase(process.env.DATABASE_PATH ?? 'data/movie-tracker.db');
const { imported, duplicates } = importMovies(db, createServices(db).movies, inputs);
db.close();
const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`read ${inputs.length + invalid} movies (${invalid} invalid) → imported ${imported}, duplicates ${duplicates} in ${seconds} s`);
