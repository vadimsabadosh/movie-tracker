// Movie schemas (ADR-004). Fields: vault concept "Movie" (FR-1, FR-5); genres: "Genre".
import { z } from 'zod';
import { page, PaginationQuery } from './common.ts';

/** 1888: earliest surviving film; next year: announced releases. */
export const MIN_YEAR = 1888;
export const maxYear = () => new Date().getFullYear() + 1;

export const MovieInput = z.object({
  title: z.string().trim().min(1).max(300),
  year: z.number().int().min(MIN_YEAR).max(maxYear()),
  // One or more genres (Genre: many-to-many); free names, matched case-insensitively.
  genres: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
  // Director is a plain string in the base version (vault: Director).
  director: z.string().trim().min(1).max(200),
});
export type MovieInput = z.infer<typeof MovieInput>;

export const Movie = MovieInput.extend({
  id: z.number().int().positive(),
});
export type Movie = z.infer<typeof Movie>;

export const MovieListQuery = PaginationQuery.extend({
  // FR-5: part of the title, case-insensitive (also for Cyrillic)
  q: z.string().trim().min(1).max(300).optional(),
});
export type MovieListQuery = z.infer<typeof MovieListQuery>;

export const MoviePage = page(Movie);
