// Movie catalog rules (FR-1, FR-5). No Fastify, no SQL — data only through MovieRepository.
import { ConflictError, NotFoundError } from '../errors/errors.ts';
import type { MovieRepository } from '../repositories/movie-repository.ts';
import type { WatchRepository } from '../repositories/watch-repository.ts';
import type { CatalogMovie, MovieInput, MovieListQuery } from '../schemas/movie.ts';

export class MovieService {
  private readonly repo: MovieRepository;
  private readonly watches: WatchRepository;

  constructor(repo: MovieRepository, watches: WatchRepository) {
    this.repo = repo;
    this.watches = watches;
  }

  get(id: number): CatalogMovie {
    const found = this.repo.findById(id);
    if (!found) throw new NotFoundError('Movie', id);
    return found;
  }

  /** FR-5. Default order depends on the sort: titles A→Z, everything else newest/highest/most voted first. */
  list(query: MovieListQuery) {
    const order = query.order ?? (query.sort === 'title' ? 'asc' : 'desc');
    return { ...this.repo.list({ ...query, order }), limit: query.limit, offset: query.offset };
  }

  /** Genre names in use, for the genre dropdowns. */
  genres(): { items: string[] } {
    return { items: this.repo.listGenres() };
  }

  create(input: MovieInput): CatalogMovie {
    this.assertUnique(input);
    return this.repo.create(input);
  }

  update(id: number, input: MovieInput): CatalogMovie {
    this.get(id);
    this.assertUnique(input, id);
    return this.repo.update(id, input)!;
  }

  /** A watched movie keeps its history: cancel the watch mark first (DB backstop: ON DELETE RESTRICT). */
  delete(id: number): void {
    this.get(id);
    if (this.watches.findByMovie(id)) throw new ConflictError(`Movie ${id} has a watch entry; cancel it before deleting the movie`);
    this.repo.delete(id);
  }

  /** Importer only (FR-9): stores the IMDb ID of an existing movie; true if it was newly linked. */
  attachImdbId(title: string, year: number, imdbId: string): boolean {
    return this.repo.attachImdbId(title, year, imdbId);
  }

  /** Importer only: refreshes the IMDb rating and vote count of the movie with this IMDb ID. */
  setImdbRating(imdbId: string, rating: number, votes: number): void {
    this.repo.setImdbRating(imdbId, rating, votes);
  }

  /** (title, year) is unique, title compared case-insensitively. */
  private assertUnique(input: MovieInput, exceptId?: number): void {
    const other = this.repo.findDuplicate(input.title, input.year, exceptId);
    if (other !== undefined) throw new ConflictError(`Movie "${input.title}" (${input.year}) already exists with id ${other}`);
  }
}
