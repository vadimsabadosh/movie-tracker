// Route registry: each module adds one line here (skill new-module, step "register").
import type { FastifyInstance } from 'fastify';
import type { Services } from '../container.ts';
import { detailsRoutes } from './details.ts';
import { movieRoutes } from './movies.ts';
import { posterRoutes } from './posters.ts';
import { profileRoutes } from './profile.ts';
import { recommendationRoutes } from './recommendations.ts';
import { statsRoutes } from './stats.ts';
import { watchRoutes } from './watches.ts';

export async function registerRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.get('/health', () => ({ status: 'ok' }));
  await movieRoutes(app, services.movies);
  await watchRoutes(app, services.watches);
  await profileRoutes(app, services.profile);
  await recommendationRoutes(app, services.recommendations);
  await statsRoutes(app, services.stats);
  await posterRoutes(app, services.posters);
  await detailsRoutes(app, services.details);
}
