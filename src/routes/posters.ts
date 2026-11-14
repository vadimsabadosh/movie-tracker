// GET /movies/:id/poster (FR-9): redirect to the TMDB image, so the UI can use it as <img src>.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorResponse, IdParams } from '../schemas/common.ts';
import type { PosterService } from '../services/poster-service.ts';

export async function posterRoutes(app: FastifyInstance, service: PosterService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/movies/:id/poster',
    {
      schema: {
        tags: ['movies'],
        params: IdParams,
        response: {
          302: z.null().describe('Redirect to the TMDB poster image (Location header)'),
          400: ErrorResponse,
          404: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (req, reply) => reply.header('cache-control', 'public, max-age=604800').redirect(await service.url(req.params.id), 302),
  );
}
