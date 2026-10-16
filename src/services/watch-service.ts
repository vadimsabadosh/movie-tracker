// Watch Entry rules (FR-2, FR-3). No Fastify, no SQL — data only through repositories.
import { ConflictError, DomainValidationError, NotFoundError } from '../errors/errors.ts';
import type { MovieRepository } from '../repositories/movie-repository.ts';
import type { WatchData, WatchRepository } from '../repositories/watch-repository.ts';
import type { WatchEntry, WatchInput, WatchListQuery } from '../schemas/watch.ts';

/** Today's date in the server's local time zone as YYYY-MM-DD. */
export const localToday = () => new Date().toLocaleDateString('en-CA');

export class WatchService {
  private readonly watches: WatchRepository;
  private readonly movies: MovieRepository;
  private readonly today: () => string;

  constructor(watches: WatchRepository, movies: MovieRepository, today: () => string = localToday) {
    this.watches = watches;
    this.movies = movies;
    this.today = today;
  }

  get(movieId: number): WatchEntry {
    this.assertMovie(movieId);
    const entry = this.watches.findByMovie(movieId);
    if (!entry) throw new NotFoundError('Watch entry for movie', movieId);
    return entry;
  }

  list(query: WatchListQuery) {
    return { ...this.watches.list(query), limit: query.limit, offset: query.offset };
  }

  /** FR-2: mark as watched. One entry per movie — a second mark is a conflict (vault: Error Handling). */
  mark(movieId: number, input: WatchInput): WatchEntry {
    this.assertMovie(movieId);
    if (this.watches.findByMovie(movieId)) throw new ConflictError(`Movie ${movieId} is already marked as watched`);
    return this.watches.create(movieId, this.toData(input));
  }

  update(movieId: number, input: WatchInput): WatchEntry {
    this.get(movieId);
    return this.watches.update(movieId, this.toData(input))!;
  }

  /** FR-2: cancel the mark; the movie becomes a recommendation candidate again. */
  cancel(movieId: number): void {
    this.assertMovie(movieId);
    if (!this.watches.delete(movieId)) throw new NotFoundError('Watch entry for movie', movieId);
  }

  private toData(input: WatchInput): WatchData {
    const today = this.today();
    const watchedAt = input.watchedAt ?? today;
    if (watchedAt > today) throw new DomainValidationError('/watchedAt', `must not be in the future (today is ${today})`);
    return { watchedAt, rating: input.rating, note: input.note ?? null };
  }

  private assertMovie(movieId: number): void {
    if (!this.movies.findById(movieId)) throw new NotFoundError('Movie', movieId);
  }
}
