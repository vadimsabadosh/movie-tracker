// Recommendation schemas (FR-7, ADR-004). Output of Recommender.recommend (vault: Recommendation, Recommender).
// The score and the explanation are built from the same reasons (ADR-003), so clients can check one against the other.
import { z } from 'zod';
import { PaginationQuery } from './common.ts';
import { Movie } from './movie.ts';

export const RecommendationReason = z.object({
  kind: z.enum(['director', 'genre']).describe('Which part of the Preference Profile matched the movie'),
  name: z.string().describe('Genre or director name as it appears in the Preference Profile'),
  count: z.number().int().positive().describe('Watched movies with this genre or director'),
  averageRating: z.number().min(1).max(10).describe('Average personal rating from the profile, rounded to 2 decimals'),
  points: z.number().describe('Contribution to the score (weight × affinity, rounded to 2 decimals); negative for disliked items'),
});
export type RecommendationReason = z.infer<typeof RecommendationReason>;

export const Recommendation = z.object({
  movie: Movie,
  score: z.number().positive().describe('Recommendation Score: sum of the unrounded points, rounded to 2 decimals'),
  explanation: z.string().min(1).describe('Human-readable text built from the reasons'),
  reasons: z
    .array(RecommendationReason)
    .min(1)
    .describe('Every matched profile item, including negative ones: points desc, director before genre, then genre order'),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const RecommendationQuery = PaginationQuery.pick({ limit: true });
export type RecommendationQuery = z.infer<typeof RecommendationQuery>;

export const RecommendationList = z.object({
  items: z
    .array(Recommendation)
    .describe('Unwatched movies with a positive score, ordered by score desc, then movie id asc (deterministic, NFR-5)'),
});
export type RecommendationList = z.infer<typeof RecommendationList>;
