// Recommendations (FR-7). No Fastify, no SQL: the profile comes from ProfileService (ADR-013), the candidates from
// MovieRepository, and the ranking is delegated to the Recommender (ADR-003; vault: Services Layer).
import type { Recommender } from '../recommendation/recommender.ts';
import type { MovieRepository } from '../repositories/movie-repository.ts';
import type { RecommendationList, RecommendationQuery } from '../schemas/recommendation.ts';
import type { ProfileService } from './profile-service.ts';

export class RecommendationService {
  private readonly profile: ProfileService;
  private readonly movies: MovieRepository;
  private readonly recommender: Recommender;

  constructor(profile: ProfileService, movies: MovieRepository, recommender: Recommender) {
    this.profile = profile;
    this.movies = movies;
    this.recommender = recommender;
  }

  /** Unwatched movies ranked by the Recommender; deterministic for the same database state (NFR-5). */
  recommend({ limit }: RecommendationQuery): RecommendationList {
    return { items: this.recommender.recommend(this.profile.get(), this.movies.listUnwatched(), limit) };
  }
}
