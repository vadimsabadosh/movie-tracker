// Route registry: each module adds one line here (skill new-module, step "register").
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

export async function registerRoutes(app: FastifyInstance, db: Database.Database): Promise<void> {
  app.get('/health', () => ({ status: 'ok' }));
  void db;
}
