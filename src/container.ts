// Composition root: the only place that wires repositories into services (keeps routes free of DB imports, ADR-001).
import type Database from 'better-sqlite3';
import { MovieRepository } from './repositories/movie-repository.ts';
import { MovieService } from './services/movie-service.ts';

export interface Services {
  movies: MovieService;
}

export function createServices(db: Database.Database): Services {
  return {
    movies: new MovieService(new MovieRepository(db)),
  };
}
