// Movie catalog rules (FR-1, FR-5). No Fastify, no SQL — data only through MovieRepository.
import { ConflictError, NotFoundError } from '../errors/errors.ts';
import type { MovieRepository } from '../repositories/movie-repository.ts';
import type { WatchRepository } from '../repositories/watch-repository.ts';
import type { Movie, MovieInput, MovieListQuery } from '../schemas/movie.ts';

export class MovieService {
  private readonly repo: MovieRepository;
  private readonly watches: WatchRepository;

  constructor(repo: MovieRepository, watches: WatchRepository) {
    this.repo = repo;
    this.watches = watches;
  }

  get(id: number): Movie {
    const found = this.repo.findById(id);
    if (!found) throw new NotFoundError('Movie', id);
    return found;
  }

  list(query: MovieListQuery) {
    return { ...this.repo.list(query), limit: query.limit, offset: query.offset };
  }

  create(input: MovieInput): Movie {
    this.assertUnique(input);
    return this.repo.create(input);
  }

  update(id: number, input: MovieInput): Movie {
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

  /** (title, year) is unique, title compared case-insensitively. */
  private assertUnique(input: MovieInput, exceptId?: number): void {
    const other = this.repo.findDuplicate(input.title, input.year, exceptId);
    if (other !== undefined) throw new ConflictError(`Movie "${input.title}" (${input.year}) already exists with id ${other}`);
  }
}
