// Entry point: `npm start` (NFR-7: one command, SQLite file, no external services).
import { buildApp } from './app.ts';
import { tmdbDetailsSource, tmdbPosterSource } from './clients/tmdb.ts';
import { openDatabase } from './db/database.ts';

const db = openDatabase(process.env.DATABASE_PATH ?? 'data/movie-tracker.db');
const token = process.env.TMDB_ACCESS_TOKEN;
const app = await buildApp({ db, logger: true, posterSource: tmdbPosterSource(token), detailsSource: tmdbDetailsSource(token) });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '127.0.0.1' });
