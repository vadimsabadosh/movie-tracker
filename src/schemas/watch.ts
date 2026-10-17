// Watch Entry schemas (ADR-004). Fields: vault concepts "Watch Entry" (FR-2), "Rating" (FR-3), "Watch History" (FR-4).
import { z } from 'zod';
import { page, PaginationQuery } from './common.ts';
import { maxYear, MIN_YEAR, Movie } from './movie.ts';

/** Earliest possible watch date: the earliest catalog year (MIN_YEAR in movie.ts). */
export const MIN_WATCH_DATE = '1888-01-01';

export const Rating = z.number().int().min(1).max(10);

export const WatchInput = z.object({
  // Plain calendar date; defaults to today and must not be in the future (checked in WatchService: needs the clock).
  watchedAt: z.iso
    .date()
    .refine((d) => d >= MIN_WATCH_DATE, `must be on or after ${MIN_WATCH_DATE}`)
    .optional(),
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

export const WatchSort = z.enum(['watchedAt', 'rating', 'year', 'title']);
export type WatchSort = z.infer<typeof WatchSort>;

export const SortOrder = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof SortOrder>;

const QueryYear = z.coerce.number().int().min(MIN_YEAR).max(maxYear());
const QueryRating = z.coerce.number().int().min(1).max(10);

/** Both bounds given and lower > upper: an inverted range is a client error, not an empty result. */
const inverted = <T extends number | string>(from: T | undefined, to: T | undefined) => from !== undefined && to !== undefined && from > to;

// FR-4 Watch History: all filters optional, every range inclusive; dates compare as YYYY-MM-DD strings.
export const WatchListQuery = PaginationQuery.extend({
  genre: z.string().trim().min(1).max(50).optional(),
  yearFrom: QueryYear.optional(),
  yearTo: QueryYear.optional(),
  ratingMin: QueryRating.optional(),
  ratingMax: QueryRating.optional(),
  watchedFrom: z.iso.date().optional(),
  watchedTo: z.iso.date().optional(),
  sort: WatchSort.default('watchedAt'),
  // Default depends on sort (title: asc, others: desc); resolved in WatchService.
  order: SortOrder.optional(),
})
  .refine((q) => !inverted(q.yearFrom, q.yearTo), { path: ['yearTo'], message: 'must be ≥ yearFrom' })
  .refine((q) => !inverted(q.ratingMin, q.ratingMax), { path: ['ratingMax'], message: 'must be ≥ ratingMin' })
  .refine((q) => !inverted(q.watchedFrom, q.watchedTo), { path: ['watchedTo'], message: 'must be on or after watchedFrom' });
export type WatchListQuery = z.infer<typeof WatchListQuery>;

/** A history item: the Watch Entry plus the movie it belongs to. */
export const WatchHistoryItem = WatchEntry.extend({ movie: Movie });
export type WatchHistoryItem = z.infer<typeof WatchHistoryItem>;

export const WatchPage = page(WatchHistoryItem);
