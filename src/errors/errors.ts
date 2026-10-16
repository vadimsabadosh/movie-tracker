// Domain errors and the single API error format (NFR-2, vault: Error Handling).
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: number | string) {
    super(404, 'NOT_FOUND', `${entity} ${id} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function errorHandler(error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    const body: ErrorBody = { error: { code: error.code, message: error.message, details: error.details } };
    void reply.status(error.statusCode).send(body);
    return;
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map((v) => ({ path: v.instancePath, message: v.message }));
    const body: ErrorBody = { error: { code: 'VALIDATION_ERROR', message: 'Request does not match the schema', details } };
    void reply.status(400).send(body);
    return;
  }
  if (error.statusCode && error.statusCode < 500) {
    void reply.status(error.statusCode).send({ error: { code: error.code ?? 'BAD_REQUEST', message: error.message } } satisfies ErrorBody);
    return;
  }
  // 500 without implementation details
  request.log.error(error);
  void reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } satisfies ErrorBody);
}
