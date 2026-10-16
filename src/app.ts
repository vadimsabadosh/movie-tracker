// Fastify application factory: wires schemas, error handling and routes (ADR-001 layers).
import swagger from '@fastify/swagger';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { createServices } from './container.ts';
import { errorHandler } from './errors/errors.ts';
import { registerRoutes } from './routes/index.ts';

export interface AppOptions {
  db: Database.Database;
  logger?: boolean;
  /** Clock for date rules (tests pin it); defaults to the local date. */
  today?: () => string;
}

export async function buildApp({ db, logger = false, today }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` } }),
  );
  // OpenAPI generated from the route schemas (NFR-6); served at /openapi.json
  await app.register(swagger, {
    openapi: { info: { title: 'movie-tracker', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());
  await registerRoutes(app, createServices(db, today));
  return app;
}
