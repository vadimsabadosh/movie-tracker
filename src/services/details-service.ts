// Movie details (FR-10): plot and cast looked up on TMDB on first request, then served from SQLite. No Fastify, no SQL.
import type { DetailsSource } from '../clients/tmdb.ts';
import { AppError, NotFoundError } from '../errors/errors.ts';
import type { MovieRepository } from '../repositories/movie-repository.ts';
import type { CastMember, MovieDetails } from '../schemas/movie.ts';

export class DetailsService {
  private readonly repo: MovieRepository;
  private readonly source: DetailsSource | undefined;

  constructor(repo: MovieRepository, source: DetailsSource | undefined) {
    this.repo = repo;
    this.source = source;
  }

  /** Saved or freshly looked-up details; 404 for no movie or no IMDb ID, 503 when TMDB cannot be asked yet. */
  async get(id: number): Promise<MovieDetails> {
    const info = this.repo.detailsInfo(id);
    if (!info) throw new NotFoundError('Movie', id);
    if (info.overview !== null) return { overview: info.overview || null, cast: JSON.parse(info.castJson ?? '[]') as CastMember[] };
    if (info.imdbId === null) {
      throw new AppError(404, 'DETAILS_NOT_LINKED', `Movie ${id} has no IMDb ID; run npm run import:imdb to link imported movies`);
    }
    if (!this.source) throw new AppError(503, 'DETAILS_UNAVAILABLE', 'TMDB is not configured');
    let found;
    try {
      found = await this.source.findDetails(info.imdbId);
    } catch {
      // A temporary failure is not saved: the next request asks again.
      throw new AppError(503, 'DETAILS_UNAVAILABLE', 'TMDB is unreachable');
    }
    const cast = found?.cast ?? [];
    this.repo.setDetails(id, found?.overview ?? '', cast);
    return { overview: found?.overview || null, cast };
  }
}
