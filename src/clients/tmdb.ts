// TMDB lookups by IMDb ID: posters (FR-9), plot and cast (FR-10). Responses are external input, so they are validated with Zod (NFR-2).
import { z } from 'zod';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
export const CAST_LIMIT = 10;

export interface PosterSource {
  /** TMDB poster path such as `/abc.jpg`, or null when TMDB has no poster; throws when TMDB cannot answer. */
  findPosterPath(imdbId: string): Promise<string | null>;
}

export interface MovieDetails {
  overview: string;
  cast: { name: string; character: string }[];
}

export interface DetailsSource {
  /** Plot and top-billed cast, or null when TMDB has no match; throws when TMDB cannot answer. */
  findDetails(imdbId: string): Promise<MovieDetails | null>;
}

// Strict path pattern: nothing odd can reach an <img src> URL.
const FindResponse = z.object({
  movie_results: z.array(
    z.object({
      poster_path: z
        .string()
        .regex(/^\/[A-Za-z0-9_-]+\.(jpg|png)$/)
        .nullable(),
    }),
  ),
});

const FindDetails = z.object({
  movie_results: z.array(z.object({ id: z.number().int().positive(), overview: z.string().nullish() })),
});

const Credits = z.object({
  cast: z.array(z.object({ name: z.string().trim().min(1), character: z.string().nullish(), order: z.number().int() })),
});

/** GET with the Bearer token and a 5 s timeout; throws on non-2xx (the message never contains the token). */
async function get(fetchFn: typeof fetch, token: string, url: string): Promise<unknown> {
  const res = await fetchFn(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`TMDB answered ${res.status}`);
  return res.json();
}

/** undefined without a token: posters are optional and the app runs without TMDB (NFR-7). */
export function tmdbPosterSource(token: string | undefined, fetchFn: typeof fetch = fetch): PosterSource | undefined {
  if (!token) return undefined;
  return {
    async findPosterPath(imdbId) {
      const body = await get(fetchFn, token, `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`);
      return FindResponse.parse(body).movie_results[0]?.poster_path ?? null;
    },
  };
}

/** undefined without a token, like posters (NFR-7). Two documented calls: /find for the TMDB id and plot, then /credits. */
export function tmdbDetailsSource(token: string | undefined, fetchFn: typeof fetch = fetch): DetailsSource | undefined {
  if (!token) return undefined;
  return {
    async findDetails(imdbId) {
      const found = FindDetails.parse(
        await get(fetchFn, token, `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&language=en-US`),
      ).movie_results[0];
      if (!found) return null;
      const credits = Credits.parse(
        await get(fetchFn, token, `https://api.themoviedb.org/3/movie/${encodeURIComponent(found.id)}/credits?language=en-US`),
      );
      return {
        overview: (found.overview ?? '').trim(),
        cast: credits.cast
          .toSorted((a, b) => a.order - b.order)
          .slice(0, CAST_LIMIT)
          .map((c) => ({ name: c.name, character: (c.character ?? '').trim() })),
      };
    },
  };
}
