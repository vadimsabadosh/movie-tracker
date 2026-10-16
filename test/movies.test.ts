// /movies black-box tests (FR-1, FR-5) through the HTTP layer on an in-memory database.
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { maxYear } from '../src/schemas/movie.ts';
import { testApp } from './helpers.ts';

let app: FastifyInstance;
beforeEach(async () => {
  app = await testApp();
});

const dune = { title: 'Dune', year: 2021, genres: ['Sci-Fi', 'Drama'], director: 'Denis Villeneuve' };
const create = (body: object) => app.inject({ method: 'POST', url: '/movies', payload: body });
const list = async (query = '') => (await app.inject(`/movies${query}`)).json();

describe('/movies CRUD (FR-1)', () => {
  it('creates, reads, updates and deletes a movie', async () => {
    const created = await create(dune);
    expect(created.statusCode).toBe(201);
    const movie = created.json();
    expect(movie).toEqual({ id: expect.any(Number), ...dune, genres: ['Drama', 'Sci-Fi'] });

    expect((await app.inject(`/movies/${movie.id}`)).json()).toEqual(movie);

    const updated = await app.inject({ method: 'PUT', url: `/movies/${movie.id}`, payload: { ...dune, year: 2022, genres: ['Sci-Fi'] } });
    expect(updated.json()).toMatchObject({ year: 2022, genres: ['Sci-Fi'] });

    expect((await app.inject({ method: 'DELETE', url: `/movies/${movie.id}` })).statusCode).toBe(204);
    expect((await app.inject(`/movies/${movie.id}`)).statusCode).toBe(404);
  });

  it('returns 404 in the common format for a missing movie', async () => {
    for (const res of [
      await app.inject('/movies/999'),
      await app.inject({ method: 'PUT', url: '/movies/999', payload: dune }),
      await app.inject({ method: 'DELETE', url: '/movies/999' }),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ code: 'NOT_FOUND', message: 'Movie 999 not found' });
    }
  });

  it.each([
    ['empty title', { ...dune, title: '   ' }],
    ['year before 1888', { ...dune, year: 1887 }],
    ['year after next year', { ...dune, year: maxYear() + 1 }],
    ['fractional year', { ...dune, year: 2021.5 }],
    ['no genres', { ...dune, genres: [] }],
    ['empty genre name', { ...dune, genres: [''] }],
    ['missing director', { title: 'Dune', year: 2021, genres: ['Drama'] }],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_, body) => {
    const res = await create(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts the boundary years 1888 and next year', async () => {
    expect((await create({ ...dune, year: 1888 })).statusCode).toBe(201);
    expect((await create({ ...dune, year: maxYear() })).statusCode).toBe(201);
  });

  it('rejects a non-numeric id with 400', async () => {
    expect((await app.inject('/movies/abc')).statusCode).toBe(400);
  });
});

describe('uniqueness of (title, year)', () => {
  it('returns 409 for the same title and year, ignoring case — Cyrillic included', async () => {
    await create(dune);
    const res = await create({ ...dune, title: 'DUNE' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');

    await create({ ...dune, title: 'Тіні забутих предків', year: 1965 });
    expect((await create({ ...dune, title: 'ТІНІ ЗАБУТИХ ПРЕДКІВ', year: 1965 })).statusCode).toBe(409);
  });

  it('allows the same title in another year (remakes)', async () => {
    await create(dune);
    expect((await create({ ...dune, year: 1984, director: 'David Lynch' })).statusCode).toBe(201);
  });

  it('returns 409 when an update would create a duplicate, but not for updating itself', async () => {
    await create(dune);
    const other = (await create({ ...dune, year: 1984 })).json();
    expect((await app.inject({ method: 'PUT', url: `/movies/${other.id}`, payload: dune })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: `/movies/${other.id}`, payload: { ...dune, year: 1984, director: 'D. Lynch' } })).statusCode).toBe(200);
  });
});

describe('genres', () => {
  it('creates genres on the fly, matches them case-insensitively and keeps the first spelling', async () => {
    await create(dune);
    const second = (await create({ ...dune, title: 'Arrival', year: 2016, genres: ['sci-fi', 'SCI-FI', 'Mystery'] })).json();
    expect(second.genres).toEqual(['Mystery', 'Sci-Fi']);
  });
});

describe('list and search (FR-5)', () => {
  beforeEach(async () => {
    await create(dune);
    await create({ ...dune, title: 'Dune', year: 1984, director: 'David Lynch' });
    await create({ ...dune, title: 'Тіні забутих предків', year: 1965, genres: ['Drama'], director: 'Сергій Параджанов' });
  });

  it('lists all movies sorted by title then year, with pagination', async () => {
    const all = await list();
    expect(all.total).toBe(3);
    expect(all.items.map((m: { year: number }) => m.year)).toEqual([1984, 2021, 1965]);
    const page = await list('?limit=1&offset=1');
    expect(page).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(page.items[0].year).toBe(2021);
  });

  it('finds by part of the title, case-insensitively, also for Cyrillic', async () => {
    expect((await list('?q=UN')).total).toBe(2);
    expect((await list(`?q=${encodeURIComponent('ЗАБУТИХ')}`)).items[0].title).toBe('Тіні забутих предків');
  });

  it('treats % and _ in the query literally', async () => {
    expect((await list('?q=%25')).total).toBe(0);
    expect((await list('?q=_')).total).toBe(0);
  });

  it('returns an empty page when nothing matches', async () => {
    expect(await list('?q=zzz')).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it('rejects limit above 100', async () => {
    expect((await app.inject('/movies?limit=101')).statusCode).toBe(400);
  });
});
