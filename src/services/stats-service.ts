// Viewing Statistics (FR-8). No Fastify, no SQL — data only through StatsRepository.
import type { StatsRepository } from '../repositories/stats-repository.ts';
import type { ViewingStatistics } from '../schemas/stats.ts';

export class StatsService {
  private readonly repo: StatsRepository;

  constructor(repo: StatsRepository) {
    this.repo = repo;
  }

  /**
   * The statistics computed from the current Watch History (never stored). The three reads run one after another
   * on the single synchronous connection, so no write interleaves (plan D12).
   * Deterministic (NFR-5): the same database state gives the same totals and the same, totally ordered lists.
   */
  get(): ViewingStatistics {
    return { ...this.repo.totals(), byGenre: this.repo.byGenre(), byYear: this.repo.byYear() };
  }
}
