// Watch marks (FR-2, FR-3): one entry per movie, so it lives under /movies/:id/watch; /watches lists them.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorResponse, IdParams } from '../schemas/common.ts';
import { WatchEntry, WatchInput, WatchListQuery, WatchPage } from '../schemas/watch.ts';
import type { WatchService } from '../services/watch-service.ts';

export async function watchRoutes(app: FastifyInstance, service: WatchService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['watches'];

  r.get('/watches', { schema: { tags, querystring: WatchListQuery, response: { 200: WatchPage, 400: ErrorResponse } } }, (req) =>
    service.list(req.query),
  );

  r.get('/movies/:id/watch', { schema: { tags, params: IdParams, response: { 200: WatchEntry, 404: ErrorResponse } } }, (req) =>
    service.get(req.params.id),
  );

  r.post(
    '/movies/:id/watch',
    { schema: { tags, params: IdParams, body: WatchInput, response: { 201: WatchEntry, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse } } },
    async (req, reply) => reply.status(201).send(service.mark(req.params.id, req.body)),
  );

  r.put(
    '/movies/:id/watch',
    { schema: { tags, params: IdParams, body: WatchInput, response: { 200: WatchEntry, 400: ErrorResponse, 404: ErrorResponse } } },
    (req) => service.update(req.params.id, req.body),
  );

  r.delete('/movies/:id/watch', { schema: { tags, params: IdParams, response: { 204: z.null(), 404: ErrorResponse } } }, async (req, reply) => {
    service.cancel(req.params.id);
    return reply.status(204).send(null);
  });
}
