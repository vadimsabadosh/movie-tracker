// Route registry: each module adds one line here (skill new-module, step "register").
import type { FastifyInstance } from 'fastify';
import type { Services } from '../container.ts';
import { movieRoutes } from './movies.ts';
import { watchRoutes } from './watches.ts';

export async function registerRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get('/health', () => ({ status: 'ok' }));
  await movieRoutes(app, services.movies);
  await watchRoutes(app, services.watches);
}
