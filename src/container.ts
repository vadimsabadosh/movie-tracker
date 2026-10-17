// Composition root: the only place that wires repositories into services (keeps routes free of DB imports, ADR-001).
import type Database from 'better-sqlite3';
import { ProfileScoreRecommender } from './recommendation/profile-score-recommender.ts';
import type { Recommender } from './recommendation/recommender.ts';
import { MovieRepository } from './repositories/movie-repository.ts';
import { ProfileRepository } from './repositories/profile-repository.ts';
import { WatchRepository } from './repositories/watch-repository.ts';
import { MovieService } from './services/movie-service.ts';
import { ProfileService } from './services/profile-service.ts';
import { RecommendationService } from './services/recommendation-service.ts';
import { WatchService } from './services/watch-service.ts';

export interface Services {
  movies: MovieService;
  watches: WatchService;
  profile: ProfileService;
  recommendations: RecommendationService;
}

/** `recommender` is the swap point for another algorithm (ADR-003); the default is the fixed profile score. */
export function createServices(
  db: Database.Database,
  today?: () => string,
  recommender: Recommender = new ProfileScoreRecommender(),
): Services {
  const movies = new MovieRepository(db);
  const watches = new WatchRepository(db);
  const profile = new ProfileService(new ProfileRepository(db));
  return {
    movies: new MovieService(movies, watches),
    watches: new WatchService(watches, movies, today),
    profile,
    recommendations: new RecommendationService(profile, movies, recommender),
  };
}
