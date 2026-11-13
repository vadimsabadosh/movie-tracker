// GET /movies/:id/details (FR-10): TMDB plot and top-billed cast, fetched by the movie page after it renders.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ErrorResponse, IdParams } from '../schemas/common.ts';
import { MovieDetails } from '../schemas/movie.ts';
import type { DetailsService } from '../services/details-service.ts';

export async function detailsRoutes(app: FastifyInstance, service: DetailsService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/movies/:id/details',
    {
      schema: {
        tags: ['movies'],
        params: IdParams,
        response: { 200: MovieDetails, 400: ErrorResponse, 404: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (req) => service.get(req.params.id),
  );
}
