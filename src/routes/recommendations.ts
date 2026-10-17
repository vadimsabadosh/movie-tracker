// GET /recommendations: unwatched movies ranked from the Preference Profile (FR-7). Only `limit` (1–100, default 20);
// no offset, a ranked top-N list needs no paging (plan D9). Empty history gives an empty list.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ErrorResponse } from '../schemas/common.ts';
import { RecommendationList, RecommendationQuery } from '../schemas/recommendation.ts';
import type { RecommendationService } from '../services/recommendation-service.ts';

export async function recommendationRoutes(app: FastifyInstance, service: RecommendationService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    '/recommendations',
    { schema: { tags: ['recommendations'], querystring: RecommendationQuery, response: { 200: RecommendationList, 400: ErrorResponse } } },
    (req) => service.recommend(req.query),
  );
}
