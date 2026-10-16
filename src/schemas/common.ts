// Shared Zod schemas (ADR-004: Zod is the single source of truth for validation, types and OpenAPI).
import { z } from 'zod';

export const IdParams = z.object({ id: z.coerce.number().int().positive() });

export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type Pagination = z.infer<typeof PaginationQuery>;

export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: z.number().int(), limit: z.number().int(), offset: z.number().int() });
}
