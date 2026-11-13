// TMDB poster lookup by IMDb ID (FR-9). The response is external input, so it is validated with Zod (NFR-2).
import { z } from 'zod';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

export interface PosterSource {
  /** TMDB poster path such as `/abc.jpg`, or null when TMDB has no poster; throws when TMDB cannot answer. */
  findPosterPath(imdbId: string): Promise<string | null>;
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

/** undefined without a token: posters are optional and the app runs without TMDB (NFR-7). */
export function tmdbPosterSource(token: string | undefined, fetchFn: typeof fetch = fetch): PosterSource | undefined {
  if (!token) return undefined;
  return {
    async findPosterPath(imdbId) {
      const res = await fetchFn(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`TMDB answered ${res.status}`);
      return FindResponse.parse(await res.json()).movie_results[0]?.poster_path ?? null;
    },
  };
}
