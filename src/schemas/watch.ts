// Watch Entry schemas (ADR-004). Fields: vault concepts "Watch Entry" (FR-2) and "Rating" (FR-3).
import { z } from 'zod';
import { page, PaginationQuery } from './common.ts';

/** Earliest possible watch date: the earliest catalog year (MIN_YEAR in movie.ts). */
export const MIN_WATCH_DATE = '1888-01-01';

export const Rating = z.number().int().min(1).max(10);

export const WatchInput = z.object({
  // Plain calendar date; defaults to today and must not be in the future (checked in WatchService: needs the clock).
  watchedAt: z.iso.date().refine((d) => d >= MIN_WATCH_DATE, `must be on or after ${MIN_WATCH_DATE}`).optional(),
  rating: Rating,
  // Empty or whitespace-only note is stored as no note.
  note: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional(),
});
export type WatchInput = z.infer<typeof WatchInput>;

export const WatchEntry = z.object({
  movieId: z.number().int().positive(),
  watchedAt: z.iso.date(),
  rating: Rating,
  note: z.string().nullable(),
});
export type WatchEntry = z.infer<typeof WatchEntry>;

export const WatchListQuery = PaginationQuery;
export type WatchListQuery = z.infer<typeof WatchListQuery>;

export const WatchPage = page(WatchEntry);
