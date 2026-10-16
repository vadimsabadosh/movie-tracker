// /movies endpoints (FR-1 CRUD, FR-5 search via ?q=): validate, call the service, shape the response.
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorResponse, IdParams } from '../schemas/common.ts';
import { Movie, MovieInput, MovieListQuery, MoviePage } from '../schemas/movie.ts';
import type { MovieService } from '../services/movie-service.ts';

export async function movieRoutes(app: FastifyInstance, service: MovieService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['movies'];

  r.get('/movies', { schema: { tags, querystring: MovieListQuery, response: { 200: MoviePage, 400: ErrorResponse } } }, (req) =>
    service.list(req.query),
  );

  r.get('/movies/:id', { schema: { tags, params: IdParams, response: { 200: Movie, 404: ErrorResponse } } }, (req) =>
    service.get(req.params.id),
  );

  r.post(
    '/movies',
    { schema: { tags, body: MovieInput, response: { 201: Movie, 400: ErrorResponse, 409: ErrorResponse } } },
    async (req, reply) => reply.status(201).send(service.create(req.body)),
  );

  r.put(
    '/movies/:id',
    {
      schema: { tags, params: IdParams, body: MovieInput, response: { 200: Movie, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse } },
    },
    (req) => service.update(req.params.id, req.body),
  );

  r.delete('/movies/:id', { schema: { tags, params: IdParams, response: { 204: z.null(), 404: ErrorResponse, 409: ErrorResponse } } }, async (req, reply) => {
    service.delete(req.params.id);
    return reply.status(204).send(null);
  });
}
