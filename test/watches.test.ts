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

describe('watch history (FR-4)', () => {
  // Dune (created in beforeEach) plus five more; genre spellings differ on purpose (ADR-008).
  const fixture = [
    { title: 'Arrival', year: 2016, genres: ['Sci-Fi', 'Драма'], rating: 8, watchedAt: '2026-05-01' },
    { title: 'Тіні забутих предків', year: 1965, genres: ['Драма'], rating: 10, watchedAt: '2026-03-01' },
    { title: 'Interstellar', year: 2014, genres: ['Sci-Fi', 'Adventure'], rating: 8, watchedAt: '2026-03-15' },
    { title: 'Мавка', year: 2023, genres: ['Анімація'], rating: 5, watchedAt: '2026-07-20' },
    { title: 'eXistenZ', year: 1999, genres: ['драма'], rating: 7, watchedAt: '2026-05-01' },
  ];

  beforeEach(async () => {
    await mark({ rating: 9, watchedAt: '2026-01-01' });
    for (const { rating, watchedAt, ...movie } of fixture) {
      const id = (await app.inject({ method: 'POST', url: '/movies', payload: { ...movie, director: 'Someone' } })).json().id;
      expect((await mark({ rating, watchedAt }, id)).statusCode).toBe(201);
    }
  });

  const history = async (qs: string) => {
    const res = await app.inject(`/watches?${qs}`);
    expect(res.statusCode).toBe(200);
    return res.json() as { items: { movieId: number; rating: number; movie: { title: string; genres: string[] } }[]; total: number; limit: number; offset: number };
  };
  // Every fixture result fits on one default page (6 rows < limit 20), so total must equal the item count.
  // This guards the page and COUNT statements in WatchRepository against drifting apart, for every filter.
  const titles = async (qs: string) => {
    const page = await history(qs);
    expect(page.total, `total for "${qs}"`).toBe(page.items.length);
    return page.items.map((i) => i.movie.title);
  };

  it('embeds the movie in each item, genres sorted like /movies', async () => {
    const page = await history('genre=sci-fi&yearFrom=2016&yearTo=2016');
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    expect(item).toEqual({
      movieId: item.movieId,
      watchedAt: '2026-05-01',
      rating: 8,
      note: null,
      movie: { id: item.movieId, title: 'Arrival', year: 2016, genres: ['Sci-Fi', 'Драма'], director: 'Someone' },
    });
    expect((await app.inject(`/movies/${item.movieId}`)).json().genres).toEqual(item.movie.genres);
  });

  it('lists everything newest first by default; same-day entries by movie id', async () => {
    expect(await titles('')).toEqual(['Мавка', 'Arrival', 'eXistenZ', 'Interstellar', 'Тіні забутих предків', 'Dune']);
  });

  it('filters by genre case-insensitively, also Cyrillic (ADR-008), without duplicating multi-genre movies', async () => {
    const sciFi = await history('genre=sci-fi');
    expect(sciFi.items.map((i) => i.movie.title)).toEqual(['Arrival', 'Interstellar', 'Dune']);
    expect(sciFi.total).toBe(3);
    const drama = await history('genre=%D0%94%D0%A0%D0%90%D0%9C%D0%90'); // ДРАМА
    expect(drama.items.map((i) => i.movie.title)).toEqual(['Arrival', 'eXistenZ', 'Тіні забутих предків']);
    expect(drama.total).toBe(3);
    expect(await titles('genre=%20Adventure%20')).toEqual(['Interstellar']);
  });

  it('returns an empty page for an unknown genre', async () => {
    expect(await history('genre=Western')).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it('filters by release year range, bounds inclusive', async () => {
    expect(await titles('yearFrom=2014&yearTo=2016')).toEqual(['Arrival', 'Interstellar']);
    expect(await titles('yearFrom=2016&yearTo=2016')).toEqual(['Arrival']);
    expect(await titles('yearFrom=2021')).toEqual(['Мавка', 'Dune']);
    expect(await titles('yearTo=1999')).toEqual(['eXistenZ', 'Тіні забутих предків']);
  });

  it('filters by rating range, bounds inclusive', async () => {
    expect((await history('ratingMin=8')).total).toBe(4);
    expect(await titles('ratingMax=5')).toEqual(['Мавка']);
    expect(await titles('ratingMin=7&ratingMax=7')).toEqual(['eXistenZ']);
  });

  it('filters by watch period, bounds inclusive', async () => {
    expect(await titles('watchedFrom=2026-03-01&watchedTo=2026-05-01')).toEqual(['Arrival', 'eXistenZ', 'Interstellar', 'Тіні забутих предків']);
    expect(await titles('watchedTo=2026-01-01')).toEqual(['Dune']);
    expect(await titles('watchedFrom=2026-07-01')).toEqual(['Мавка']);
  });

  it('combines filters; total counts the filtered rows only', async () => {
    const page = await history('genre=Sci-Fi&yearFrom=2015&ratingMin=8&watchedFrom=2026-02-01');
    expect(page.items.map((i) => i.movie.title)).toEqual(['Arrival']);
    expect(page.total).toBe(1);
  });

  it('sorts by rating, ties by watch date (newest first) then movie id; default direction desc', async () => {
    expect(await titles('sort=rating&order=asc')).toEqual(['Мавка', 'eXistenZ', 'Arrival', 'Interstellar', 'Dune', 'Тіні забутих предків']);
    expect(await titles('sort=rating')).toEqual(['Тіні забутих предків', 'Dune', 'Arrival', 'Interstellar', 'eXistenZ', 'Мавка']);
  });

  it('sorts by release year, default desc', async () => {
    expect(await titles('sort=year')).toEqual(['Мавка', 'Dune', 'Arrival', 'Interstellar', 'eXistenZ', 'Тіні забутих предків']);
    expect(await titles('sort=year&order=asc')).toEqual(['Тіні забутих предків', 'eXistenZ', 'Interstellar', 'Arrival', 'Dune', 'Мавка']);
  });

  it('sorts by title case-insensitively, default A→Z; order=desc reverses', async () => {
    const az = ['Arrival', 'Dune', 'eXistenZ', 'Interstellar', 'Мавка', 'Тіні забутих предків'];
    expect(await titles('sort=title')).toEqual(az);
    expect(await titles('sort=title&order=desc')).toEqual([...az].reverse());
  });

  it('sorts by watch date ascending on request', async () => {
    expect(await titles('order=asc')).toEqual(['Dune', 'Тіні забутих предків', 'Interstellar', 'Arrival', 'eXistenZ', 'Мавка']);
  });

  it('paginates the filtered, sorted list without overlap; total is the full filtered count', async () => {
    const first = await history('ratingMin=8&limit=2&offset=0');
    const second = await history('ratingMin=8&limit=2&offset=2');
    expect(first).toMatchObject({ total: 4, limit: 2, offset: 0 });
    expect(second).toMatchObject({ total: 4, limit: 2, offset: 2 });
    expect(first.items.map((i) => i.movie.title)).toEqual(['Arrival', 'Interstellar']);
    expect(second.items.map((i) => i.movie.title)).toEqual(['Тіні забутих предків', 'Dune']);
  });

  it('returns an empty page with the right total when offset is past the end', async () => {
    expect(await history('ratingMin=8&offset=10')).toEqual({ items: [], total: 4, limit: 20, offset: 10 });
  });

  it.each([
    'ratingMin=0',
    'ratingMax=11',
    'ratingMin=7.5',
    'ratingMin=abc',
    'yearFrom=1887',
    `yearTo=${new Date().getFullYear() + 2}`,
    'watchedFrom=16.10.2026',
    'watchedTo=2026-02-30',
    'sort=director',
    'order=up',
    'genre=',
    'genre=%20%20',
    `genre=${'x'.repeat(51)}`,
    'limit=0',
    'limit=101',
    'offset=-1',
  ])('rejects %s with 400', async (qs) => {
    const res = await app.inject(`/watches?${qs}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['ratingMin=8&ratingMax=5', '/ratingMax'],
    ['yearFrom=2020&yearTo=2010', '/yearTo'],
    ['watchedFrom=2026-05-01&watchedTo=2026-01-01', '/watchedTo'],
  ])('rejects the inverted range %s with 400 on the upper bound', async (qs, path) => {
    const res = await app.inject(`/watches?${qs}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path }] });
  });
});
