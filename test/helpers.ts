// Test app on an in-memory database with all migrations applied.
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';

export async function testApp(options: { today?: () => string } = {}): Promise<FastifyInstance> {
  const app = await buildApp({ db: openDatabase(':memory:'), ...options });
  await app.ready();
  return app;
}
