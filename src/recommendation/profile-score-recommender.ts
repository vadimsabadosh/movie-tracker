// Base Recommender (FR-7): a fixed, deterministic score from the Preference Profile (ADR-003, NFR-5).
//
// affinity(item) = count × (averageRating − NEUTRAL_RATING) / (count + 1)
//   the profile average with one imaginary neutral rating added, minus neutral (a Bayesian average shrunk toward 5.5),
//   so a single 10 does not beat a steady 8.5 over four films, and disliked items push a movie down.
// score = round2(DIRECTOR_WEIGHT × affinity(director) + Σ GENRE_WEIGHT × affinity(genre))
//   over the movie's genres and director that appear in the profile. Genres match by name (the same genres.name
//   column, unique by name_key, ADR-008); directors by the exact string, as the profile groups them (ADR-013).
// Only score > 0 is recommended. Order: score desc, then movie id asc. The explanation is built from the same
// reasons as the score (ADR-003). The weights are fixed here and pinned in test/recommender.test.ts.
import type { Movie } from '../schemas/movie.ts';
import type { PreferenceItem, PreferenceProfile } from '../schemas/profile.ts';
import type { Recommendation, RecommendationReason } from '../schemas/recommendation.ts';
import type { Recommender } from './recommender.ts';

/** Midpoint of the 1–10 rating scale: items rated above it attract, items rated below it repel. */
export const NEUTRAL_RATING = 5.5;
export const GENRE_WEIGHT = 1;
export const DIRECTOR_WEIGHT = 2;

export const round2 = (x: number): number => Math.round(x * 100) / 100;

/** How much the profile likes a genre or director, shrunk toward neutral by one imaginary neutral rating. */
export function affinity({ count, averageRating }: PreferenceItem): number {
  return (count * (averageRating - NEUTRAL_RATING)) / (count + 1);
}

interface ScoredReason {
  reason: RecommendationReason;
  points: number;
}

function reasonOf(kind: RecommendationReason['kind'], item: PreferenceItem, weight: number): ScoredReason {
  const points = weight * affinity(item);
  return { reason: { kind, name: item.name, count: item.count, averageRating: item.averageRating, points: round2(points) }, points };
}

function describe(r: RecommendationReason): string {
  const label = r.kind === 'director' ? 'Director' : 'Genre';
  const sign = r.points >= 0 ? '+' : '-';
  return `${label} ${r.name}: ${r.count} watched, average ${r.averageRating.toFixed(1)} (${sign}${Math.abs(r.points).toFixed(2)})`;
}

export class ProfileScoreRecommender implements Recommender {
  recommend(profile: PreferenceProfile, candidates: Movie[], limit: number): Recommendation[] {
    const genres = new Map(profile.genres.map((g) => [g.name, g]));
    const directors = new Map(profile.directors.map((d) => [d.name, d]));
    const result: Recommendation[] = [];
    for (const movie of candidates) {
      const scored: ScoredReason[] = [];
      const director = directors.get(movie.director);
      if (director) scored.push(reasonOf('director', director, DIRECTOR_WEIGHT));
      for (const name of movie.genres) {
        const genre = genres.get(name);
        if (genre) scored.push(reasonOf('genre', genre, GENRE_WEIGHT));
      }
      const score = round2(scored.reduce((sum, s) => sum + s.points, 0));
      if (score <= 0) continue;
      // Stable sort: equal points keep director first, then the movie's genre order.
      const reasons = scored.sort((a, b) => b.points - a.points).map((s) => s.reason);
      result.push({ movie, score, explanation: reasons.map(describe).join('; '), reasons });
    }
    // Sort by the returned (rounded) score so visually equal scores always tie-break by id (ADR-003).
    return result.sort((a, b) => b.score - a.score || a.movie.id - b.movie.id).slice(0, limit);
  }
}
