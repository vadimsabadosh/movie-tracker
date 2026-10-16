// Entry point: `npm start` (NFR-7: one command, SQLite file, no external services).
import { buildApp } from './app.ts';
import { openDatabase } from './db/database.ts';

const db = openDatabase(process.env.DATABASE_PATH ?? 'data/movie-tracker.db');
const app = await buildApp({ db, logger: true });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '127.0.0.1' });
