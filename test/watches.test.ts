// Watch marks (FR-2, FR-3) black-box tests; "today" is pinned so date rules are deterministic.
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers.ts';

const TODAY = '2026-10-16';
let app: FastifyInstance;
let movieId: number;

beforeEach(async () => {
  app = await testApp({ today: () => TODAY });
  const movie = await app.inject({
    method: 'POST',
    url: '/movies',
    payload: { title: 'Dune', year: 2021, genres: ['Sci-Fi'], director: 'Denis Villeneuve' },
  });
  movieId = movie.json().id;
});

const mark = (body: object, id = movieId) => app.inject({ method: 'POST', url: `/movies/${id}/watch`, payload: body });
const update = (body: object, id = movieId) => app.inject({ method: 'PUT', url: `/movies/${id}/watch`, payload: body });
const cancel = (id = movieId) => app.inject({ method: 'DELETE', url: `/movies/${id}/watch` });

describe('mark as watched (FR-2, FR-3)', () => {
  it('marks with date, rating and note, and reads it back', async () => {
    const res = await mark({ watchedAt: '2026-10-01', rating: 9, note: 'Чудовий звук' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ movieId, watchedAt: '2026-10-01', rating: 9, note: 'Чудовий звук' });
    expect((await app.inject(`/movies/${movieId}/watch`)).json()).toEqual(res.json());
  });

  it('defaults the date to today and the note to null', async () => {
    expect((await mark({ rating: 7 })).json()).toEqual({ movieId, watchedAt: TODAY, rating: 7, note: null });
  });

  it('stores an empty or whitespace note as null', async () => {
    expect((await mark({ rating: 7, note: '   ' })).json().note).toBeNull();
  });

  it('returns 409 for a second mark of the same movie (vault: Error Handling)', async () => {
    await mark({ rating: 7 });
    const res = await mark({ rating: 8 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('returns 404 for a movie that does not exist', async () => {
    const res = await mark({ rating: 7 }, 999);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Movie 999 not found');
  });
});

describe('validation', () => {
  it('accepts the rating boundaries 1 and 10', async () => {
    expect((await mark({ rating: 1 })).statusCode).toBe(201);
    expect((await update({ rating: 10 })).json().rating).toBe(10);
  });

  it.each([
    ['rating 0', { rating: 0 }],
    ['rating 11', { rating: 11 }],
    ['fractional rating', { rating: 7.5 }],
    ['missing rating', {}],
    ['not a date', { rating: 7, watchedAt: '16.10.2026' }],
    ['impossible date', { rating: 7, watchedAt: '2026-02-30' }],
    ['timestamp instead of date', { rating: 7, watchedAt: '2026-10-01T10:00:00Z' }],
    ['date before 1888', { rating: 7, watchedAt: '1887-12-31' }],
    ['note over 2000 characters', { rating: 7, note: 'x'.repeat(2001) }],
  ])('rejects %s with 400', async (_, body) => {
    const res = await mark(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a future date with 400 in the same format, but accepts today', async () => {
    const res = await mark({ rating: 7, watchedAt: '2026-10-17' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: '/watchedAt' }] });
    expect((await mark({ rating: 7, watchedAt: TODAY })).statusCode).toBe(201);
  });
});

describe('update and cancel', () => {
  it('updates rating, date and note', async () => {
    await mark({ rating: 5, note: 'meh' });
    const res = await update({ rating: 8, watchedAt: '2026-09-30', note: null });
    expect(res.json()).toEqual({ movieId, watchedAt: '2026-09-30', rating: 8, note: null });
  });

  it('returns 404 when updating a movie that is not marked', async () => {
    expect((await update({ rating: 8 })).statusCode).toBe(404);
  });

  it('cancels the mark (FR-2): the entry is gone and the movie can be marked again', async () => {
    await mark({ rating: 5 });
    expect((await cancel()).statusCode).toBe(204);
    expect((await app.inject(`/movies/${movieId}/watch`)).statusCode).toBe(404);
    expect((await cancel()).statusCode).toBe(404);
    expect((await mark({ rating: 6 })).statusCode).toBe(201);
  });
});

describe('movie deletion keeps history', () => {
  it('refuses to delete a watched movie with 409, and deletes it after the mark is cancelled', async () => {
    await mark({ rating: 9 });
    const refused = await app.inject({ method: 'DELETE', url: `/movies/${movieId}` });
    expect(refused.statusCode).toBe(409);
    expect((await app.inject(`/movies/${movieId}/watch`)).statusCode).toBe(200);

    await cancel();
    expect((await app.inject({ method: 'DELETE', url: `/movies/${movieId}` })).statusCode).toBe(204);
  });
});

describe('GET /watches', () => {
  it('lists entries newest first with pagination; empty list when nothing is watched', async () => {
    expect((await app.inject('/watches')).json()).toEqual({ items: [], total: 0, limit: 20, offset: 0 });

    const second = (
      await app.inject({ method: 'POST', url: '/movies', payload: { title: 'Arrival', year: 2016, genres: ['Sci-Fi'], director: 'Denis Villeneuve' } })
    ).json().id;
    await mark({ rating: 9, watchedAt: '2026-01-01' });
    await mark({ rating: 8, watchedAt: '2026-05-01' }, second);

    const page = (await app.inject('/watches?limit=1')).json();
    expect(page).toMatchObject({ total: 2, limit: 1 });
    expect(page.items[0].movieId).toBe(second);
  });
});
