// Recommender seam (FR-7, ADR-003; vault: Recommender). Implementations are pure: they never touch the Database,
// they get the Preference Profile and the unwatched candidates from the Services Layer. Another algorithm (for
// example an LLM, ADR-003) is plugged in through the composition root (src/container.ts) without changing callers.
import type { Movie } from '../schemas/movie.ts';
import type { PreferenceProfile } from '../schemas/profile.ts';
import type { Recommendation } from '../schemas/recommendation.ts';

export interface Recommender {
  /** At most `limit` recommendations for `candidates`, in a deterministic order (NFR-5). */
  recommend(profile: PreferenceProfile, candidates: Movie[], limit: number): Recommendation[];
}
