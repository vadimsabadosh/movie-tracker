// Composition root: the only place that wires repositories into services (keeps routes free of DB imports, ADR-001).
import type Database from 'better-sqlite3';
import { MovieRepository } from './repositories/movie-repository.ts';
import { WatchRepository } from './repositories/watch-repository.ts';
import { MovieService } from './services/movie-service.ts';
import { WatchService } from './services/watch-service.ts';

export interface Services {
  movies: MovieService;
  watches: WatchService;
}

export function createServices(db: Database.Database, today?: () => string): Services {
  const movies = new MovieRepository(db);
  const watches = new WatchRepository(db);
  return {
    movies: new MovieService(movies, watches),
    watches: new WatchService(watches, movies, today),
  };
}
