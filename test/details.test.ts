// GET /movies/:id/details (FR-10) with a fake DetailsSource: no network.
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { DetailsSource } from '../src/clients/tmdb.ts';
import { openDatabase } from '../src/db/database.ts';

const MOVIE = { title: 'Arrival', year: 2016, genres: ['Drama'], director: 'Denis Villeneuve' };
const CAST = [{ name: 'Amy Adams', character: 'Louise' }];

/** App on a fresh db with one movie, optionally linked to `imdbId` and with saved details, plus a reader for them. */
async function setup({
  source,
  imdbId = 'tt1',
  overview = null,
  castJson = null,
}: {
  source?: DetailsSource;
  imdbId?: string | null;
  overview?: string | null;
  castJson?: string | null;
}) {
  const db = openDatabase(':memory:');
  const app = await buildApp({ db, detailsSource: source });
  const { id } = (await app.inject({ method: 'POST', url: '/movies', payload: MOVIE })).json();
  db.prepare('UPDATE movies SET imdb_id = @imdbId, overview = @overview, cast_json = @castJson WHERE id = @id').run({
    imdbId,
    overview,
    castJson,
    id,
  });
  const saved = () => db.prepare('SELECT overview, cast_json AS castJson FROM movies WHERE id = ?').get(id);
  return { app, id, saved };
}

const fake = (impl: DetailsSource['findDetails']) => ({ findDetails: vi.fn(impl) });

describe('GET /movies/:id/details', () => {
  it('404 for an unknown movie', async () => {
    const { app } = await setup({ source: fake(async () => null) });
    const res = await app.inject('/movies/999/details');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('400 for a non-numeric id', async () => {
    const { app } = await setup({});
    const res = await app.inject('/movies/abc/details');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('404 without asking TMDB when the movie has no IMDb ID', async () => {
    const source = fake(async () => null);
    const { app, id } = await setup({ source, imdbId: null });
    const res = await app.inject(`/movies/${id}/details`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('DETAILS_NOT_LINKED');
    expect(source.findDetails).not.toHaveBeenCalled();
  });

  it('200 with plot and cast, saved so TMDB is asked only once', async () => {
    const source = fake(async () => ({ overview: 'Plot', cast: CAST }));
    const { app, id, saved } = await setup({ source });
    for (let i = 0; i < 2; i++) {
      const res = await app.inject(`/movies/${id}/details`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ overview: 'Plot', cast: CAST });
    }
    expect(source.findDetails).toHaveBeenCalledTimes(1);
    expect(source.findDetails).toHaveBeenCalledWith('tt1');
    expect(saved()).toEqual({ overview: 'Plot', castJson: JSON.stringify(CAST) });
  });

  it('200 empty when TMDB has no match, and remembers it', async () => {
    const source = fake(async () => null);
    const { app, id, saved } = await setup({ source });
    for (let i = 0; i < 2; i++) {
      const res = await app.inject(`/movies/${id}/details`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ overview: null, cast: [] });
    }
    expect(source.findDetails).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual({ overview: '', castJson: '[]' });
  });

  it('overview null when TMDB has a cast but no plot', async () => {
    const { app, id } = await setup({ source: fake(async () => ({ overview: '', cast: CAST })) });
    expect((await app.inject(`/movies/${id}/details`)).json()).toEqual({ overview: null, cast: CAST });
  });

  it('503 when TMDB fails, and saves nothing so the next request asks again', async () => {
    const source = fake(async () => {
      throw new Error('network down');
    });
    const { app, id, saved } = await setup({ source });
    const res = await app.inject(`/movies/${id}/details`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('DETAILS_UNAVAILABLE');
    expect(saved()).toEqual({ overview: null, castJson: null });
    await app.inject(`/movies/${id}/details`);
    expect(source.findDetails).toHaveBeenCalledTimes(2);
  });

  it('503 without TMDB when details were never looked up', async () => {
    const { app, id } = await setup({});
    const res = await app.inject(`/movies/${id}/details`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('DETAILS_UNAVAILABLE');
  });

  it('200 without TMDB once details are saved (works offline)', async () => {
    const { app, id } = await setup({ overview: 'Kept', castJson: JSON.stringify(CAST) });
    expect((await app.inject(`/movies/${id}/details`)).json()).toEqual({ overview: 'Kept', cast: CAST });
  });

  it('leaves the Movie response shape unchanged', async () => {
    const { app, id } = await setup({ overview: 'Kept', castJson: '[]' });
    expect((await app.inject(`/movies/${id}`)).json()).toEqual({ id, ...MOVIE, imdbRating: null, imdbVotes: null, watched: false });
  });
});
