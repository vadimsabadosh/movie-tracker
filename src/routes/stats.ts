// GET /stats: the Viewing Statistics (FR-8). No query parameters (plan D11); empty history gives zero totals.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ViewingStatistics } from '../schemas/stats.ts';
import type { StatsService } from '../services/stats-service.ts';

export async function statsRoutes(app: FastifyInstance, service: StatsService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/stats', { schema: { tags: ['stats'], response: { 200: ViewingStatistics } } }, () => service.get());
}
