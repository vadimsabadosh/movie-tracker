// Preference Profile schemas (FR-6, ADR-004). Computed from the Watch History on every request, never stored
// (vault: Preference Profile). PreferenceProfile is the input type of Recommender.recommend (FR-7).
import { z } from 'zod';

export const PreferenceItem = z.object({
  name: z.string().describe('Genre name (first spelling kept) or director, as stored'),
  count: z.number().int().positive().describe('Watched movies with this genre or director'),
  averageRating: z.number().min(1).max(10).describe('Average personal rating, rounded to 2 decimals'),
});
export type PreferenceItem = z.infer<typeof PreferenceItem>;

export const PreferenceProfile = z.object({
  genres: z.array(PreferenceItem).describe('Every watched genre, favourite first: count desc, average desc, name'),
  directors: z.array(PreferenceItem).describe('Every watched director, favourite first: count desc, average desc, name'),
});
export type PreferenceProfile = z.infer<typeof PreferenceProfile>;
