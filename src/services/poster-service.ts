// Movie posters (FR-9): looked up on TMDB on first request, then served from the saved path. No Fastify, no SQL.
import { TMDB_IMAGE_BASE, type PosterSource } from '../clients/tmdb.ts';
import { AppError, NotFoundError } from '../errors/errors.ts';
import type { MovieRepository } from '../repositories/movie-repository.ts';

export class PosterService {
  private readonly repo: MovieRepository;
  private readonly source: PosterSource | undefined;

  constructor(repo: MovieRepository, source: PosterSource | undefined) {
    this.repo = repo;
    this.source = source;
  }

  /** Full image URL; 404 when the movie or its poster does not exist, 503 when TMDB cannot be asked yet. */
  async url(id: number): Promise<string> {
    const info = this.repo.posterInfo(id);
    if (!info) throw new NotFoundError('Movie', id);
    let path = info.posterPath;
    if (path === null && info.imdbId !== null) {
      if (!this.source) throw new AppError(503, 'POSTER_UNAVAILABLE', 'TMDB is not configured');
      try {
        path = (await this.source.findPosterPath(info.imdbId)) ?? '';
      } catch {
        // A temporary failure is not saved: the next request asks again.
        throw new AppError(503, 'POSTER_UNAVAILABLE', 'TMDB is unreachable');
      }
      this.repo.setPosterPath(id, path);
    }
    // Two distinct 404s, so "never linked" (fixable by the importer) is not mistaken for "TMDB has none".
    if (info.imdbId === null && !path) {
      throw new AppError(404, 'POSTER_NOT_LINKED', `Movie ${id} has no IMDb ID; run npm run import:imdb to link imported movies`);
    }
    if (!path) throw new AppError(404, 'POSTER_NOT_FOUND', `TMDB has no poster for movie ${id} (${info.imdbId})`);
    return TMDB_IMAGE_BASE + path;
  }
}
