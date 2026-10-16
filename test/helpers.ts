// Test app on an in-memory database with all migrations applied.
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';

export async function testApp(): Promise<FastifyInstance> {
  const app = await buildApp({ db: openDatabase(':memory:') });
  await app.ready();
  return app;
}
