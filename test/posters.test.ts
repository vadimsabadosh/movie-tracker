// GET /movies/:id/poster (FR-9) with a fake PosterSource: no network.
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { PosterSource } from '../src/clients/tmdb.ts';
import { openDatabase } from '../src/db/database.ts';

const MOVIE = { title: 'Arrival', year: 2016, genres: ['Drama'], director: 'Denis Villeneuve' };

/** App on a fresh db with one movie (id 1), optionally linked to `imdbId`, plus the poster_path reader. */
async function setup({
  source,
  imdbId = 'tt1',
  posterPath = null,
}: {
  source?: PosterSource;
  imdbId?: string | null;
  posterPath?: string | null;
}) {
  const db = openDatabase(':memory:');
  const app = await buildApp({ db, posterSource: source });
  const { id } = (await app.inject({ method: 'POST', url: '/movies', payload: MOVIE })).json();
  db.prepare('UPDATE movies SET imdb_id = @imdbId, poster_path = @posterPath WHERE id = @id').run({ imdbId, posterPath, id });
  const saved = () => (db.prepare('SELECT poster_path AS p FROM movies WHERE id = ?').get(id) as { p: string | null }).p;
  return { app, id, saved };
}

const fake = (impl: PosterSource['findPosterPath']) => ({ findPosterPath: vi.fn(impl) });

describe('GET /movies/:id/poster', () => {
  it('404 for an unknown movie', async () => {
    const { app } = await setup({ source: fake(async () => '/a.jpg') });
    const res = await app.inject('/movies/999/poster');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('400 for a non-numeric id', async () => {
    const { app } = await setup({});
    const res = await app.inject('/movies/abc/poster');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('404 without asking TMDB when the movie has no IMDb ID', async () => {
    const source = fake(async () => '/a.jpg');
    const { app, id } = await setup({ source, imdbId: null });
    const res = await app.inject(`/movies/${id}/poster`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('POSTER_NOT_LINKED');
    expect(res.json().error.message).toMatch(/no IMDb ID.*npm run import:imdb/);
    expect(source.findPosterPath).not.toHaveBeenCalled();
  });

  it('302 to the TMDB image and asks TMDB only once', async () => {
    const source = fake(async () => '/abc.jpg');
    const { app, id, saved } = await setup({ source });
    const res = await app.inject(`/movies/${id}/poster`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
    expect((await app.inject(`/movies/${id}/poster`)).statusCode).toBe(302);
    expect(source.findPosterPath).toHaveBeenCalledTimes(1);
    expect(source.findPosterPath).toHaveBeenCalledWith('tt1');
    expect(saved()).toBe('/abc.jpg');
  });

  it('404 when TMDB has no poster, and remembers it', async () => {
    const source = fake(async () => null);
    const { app, id, saved } = await setup({ source });
    for (let i = 0; i < 2; i++) {
      const res = await app.inject(`/movies/${id}/poster`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('POSTER_NOT_FOUND');
      expect(res.json().error.message).toMatch(/TMDB has no poster.*tt1/);
    }
    expect(source.findPosterPath).toHaveBeenCalledTimes(1);
    expect(saved()).toBe('');
  });

  it('503 when TMDB fails, and saves nothing so the next request asks again', async () => {
    const source = fake(async () => {
      throw new Error('network down');
    });
    const { app, id, saved } = await setup({ source });
    const res = await app.inject(`/movies/${id}/poster`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('POSTER_UNAVAILABLE');
    expect(saved()).toBeNull();
    await app.inject(`/movies/${id}/poster`);
    expect(source.findPosterPath).toHaveBeenCalledTimes(2);
  });

  it('503 without TMDB when the poster was never looked up', async () => {
    const { app, id } = await setup({});
    const res = await app.inject(`/movies/${id}/poster`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('POSTER_UNAVAILABLE');
  });

  it('302 without TMDB once the poster path is saved (works offline)', async () => {
    const { app, id } = await setup({ posterPath: '/kept.jpg' });
    const res = await app.inject(`/movies/${id}/poster`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://image.tmdb.org/t/p/w342/kept.jpg');
  });

  it('leaves the Movie response shape unchanged', async () => {
    const { app, id } = await setup({ posterPath: '/kept.jpg' });
    expect((await app.inject(`/movies/${id}`)).json()).toEqual({ id, ...MOVIE, imdbRating: null, imdbVotes: null, watched: false });
  });
});
