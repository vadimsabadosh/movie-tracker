// Movie schemas (ADR-004). Fields: vault concept "Movie" (FR-1, FR-5); genres: "Genre".
import { z } from 'zod';
import { inverted, page, PaginationQuery, SortOrder } from './common.ts';

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

export const QueryYear = z.coerce.number().int().min(MIN_YEAR).max(maxYear());

/** votes = IMDb vote count, shown as "Popularity (votes)". */
export const MovieSort = z.enum(['title', 'year', 'rating', 'votes']);
export type MovieSort = z.infer<typeof MovieSort>;

// FR-5 catalog: all filters optional and combined with AND, year range inclusive (same contract as FR-4).
export const MovieListQuery = PaginationQuery.extend({
  // Part of the title, case-insensitive (also for Cyrillic)
  q: z.string().trim().min(1).max(300).optional(),
  // Exact genre name, case-insensitive; an unknown genre gives an empty page.
  genre: z.string().trim().min(1).max(50).optional(),
  yearFrom: QueryYear.optional(),
  yearTo: QueryYear.optional(),
  // Part of the director's name, case-insensitive.
  director: z.string().trim().min(1).max(200).optional(),
  // Strings, not coerce.boolean (which reads "false" as true); absent = all movies.
  watched: z.enum(['true', 'false']).optional(),
  sort: MovieSort.default('votes'),
  // Default depends on sort (title: asc, others: desc); resolved in MovieService.
  order: SortOrder.optional(),
}).refine((q) => !inverted(q.yearFrom, q.yearTo), { path: ['yearTo'], message: 'must be ≥ yearFrom' });
export type MovieListQuery = z.infer<typeof MovieListQuery>;

/** A movie as /movies returns it: plus imported IMDb data (null = none, e.g. added by hand) and watch state. */
export const CatalogMovie = Movie.extend({
  imdbRating: z.number().min(1).max(10).nullable(),
  imdbVotes: z.number().int().min(0).nullable(),
  watched: z.boolean(),
});
export type CatalogMovie = z.infer<typeof CatalogMovie>;

export const MoviePage = page(CatalogMovie);

/** Genre names used by at least one movie (feeds the genre dropdowns). */
export const GenreList = z.object({ items: z.array(z.string()) });
