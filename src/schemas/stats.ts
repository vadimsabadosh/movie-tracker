// Viewing Statistics schemas (FR-8, ADR-004). Computed from the Watch History on every request, never stored
// (vault: Viewing Statistics). Counts only, independent of the Preference Profile (plan D2).
import { z } from 'zod';
import { MIN_YEAR } from './movie.ts';

export const GenreCount = z.object({
  name: z.string().describe('Genre name, first spelling kept'),
  count: z.number().int().positive().describe('Watched movies having this genre'),
});
export type GenreCount = z.infer<typeof GenreCount>;

export const YearCount = z.object({
  year: z.number().int().min(MIN_YEAR).describe('Release year of the movie (ADR-010 meaning of "year")'),
  count: z.number().int().positive().describe('Watched movies released that year'),
});
export type YearCount = z.infer<typeof YearCount>;

export const ViewingStatistics = z.object({
  watchedCount: z.number().int().min(0).describe('Number of watched movies (one watch entry per movie, ADR-009)'),
  averageRating: z
    .number()
    .min(1)
    .max(10)
    .nullable()
    .describe('Average personal rating over all watched movies, rounded to 2 decimals; null when nothing is watched'),
  byGenre: z
    .array(GenreCount)
    .describe('Watched movies per genre: count desc, then name (case-insensitive). A movie counts once in each of its genres'),
  byYear: z.array(YearCount).describe('Watched movies per release year, ascending; only years with at least one watched movie'),
});
export type ViewingStatistics = z.infer<typeof ViewingStatistics>;

export const StatsTotals = ViewingStatistics.pick({ watchedCount: true, averageRating: true });
export type StatsTotals = z.infer<typeof StatsTotals>;
