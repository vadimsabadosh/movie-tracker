// Preference Profile (FR-6). No Fastify, no SQL — data only through ProfileRepository.
import type { ProfileRepository } from '../repositories/profile-repository.ts';
import type { PreferenceProfile } from '../schemas/profile.ts';

export class ProfileService {
  private readonly repo: ProfileRepository;

  constructor(repo: ProfileRepository) {
    this.repo = repo;
  }

  /**
   * The profile computed from the current Watch History (never stored). This is the entry point for FR-7:
   * the recommendation service takes this ProfileService and passes get() to Recommender.recommend.
   * Deterministic (NFR-5): the same database state gives the same, totally ordered lists.
   */
  get(): PreferenceProfile {
    return { genres: this.repo.genres(), directors: this.repo.directors() };
  }
}
