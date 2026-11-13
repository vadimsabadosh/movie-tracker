// /movies black-box tests (FR-1, FR-5) through the HTTP layer on an in-memory database.
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db/database.ts';
import { maxYear } from '../src/schemas/movie.ts';
import { testApp } from './helpers.ts';

let app: FastifyInstance;
beforeEach(async () => {
  app = await testApp();
});
afterEach(() => app.close());

const dune = { title: 'Dune', year: 2021, genres: ['Sci-Fi', 'Drama'], director: 'Denis Villeneuve' };
const create = (body: object) => app.inject({ method: 'POST', url: '/movies', payload: body });
const list = async (query = '') => (await app.inject(`/movies${query}`)).json();

describe('/movies CRUD (FR-1)', () => {
  it('creates, reads, updates and deletes a movie', async () => {
    const created = await create(dune);
    expect(created.statusCode).toBe(201);
    const movie = created.json();
    expect(movie).toEqual({
      id: expect.any(Number),
      ...dune,
      genres: ['Drama', 'Sci-Fi'],
      imdbRating: null,
      imdbVotes: null,
      watched: false,
    });

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
    expect(
      (await app.inject({ method: 'PUT', url: `/movies/${other.id}`, payload: { ...dune, year: 1984, director: 'D. Lynch' } })).statusCode,
    ).toBe(200);
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

type Item = { id: number; title: string; year: number; watched: boolean; imdbRating: number | null; imdbVotes: number | null };
const titles = async (query: string) => {
  const page = await list(query);
  // total must match the filter, not the page: guards the duplicated WHERE in CATALOG_PAGE_SQL / CATALOG_COUNT_SQL.
  expect(page.total).toBe(page.items.length);
  return page.items.map((m: Item) => `${m.title} ${m.year}`);
};

describe('catalog filters (FR-5)', () => {
  beforeEach(async () => {
    await create(dune);
    await create({ ...dune, title: 'Dune', year: 1984, director: 'David Lynch' });
    await create({ ...dune, title: 'Тіні забутих предків', year: 1965, genres: ['Drama', 'Жахи'], director: 'Сергій Параджанов' });
    await create({ ...dune, title: 'Duo', year: 2000, genres: ['Comedy'], director: 'Jane Doe, John Roe' });
  });

  it('filters by genre name, case-insensitively (Cyrillic too), without duplicating multi-genre movies', async () => {
    expect(await titles('?genre=sci-fi&sort=title')).toEqual(['Dune 1984', 'Dune 2021']);
    expect(await titles('?genre=DRAMA&sort=title')).toEqual(['Dune 1984', 'Dune 2021', 'Тіні забутих предків 1965']);
    expect(await titles(`?genre=${encodeURIComponent('жАХИ')}`)).toEqual(['Тіні забутих предків 1965']);
  });

  it('returns an empty page for an unknown genre', async () => {
    expect(await list('?genre=nope')).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it('filters by an inclusive year range', async () => {
    expect(await titles('?yearFrom=1965&yearTo=1984&sort=year&order=asc')).toEqual(['Тіні забутих предків 1965', 'Dune 1984']);
    expect(await titles('?yearFrom=2000&sort=year&order=asc')).toEqual(['Duo 2000', 'Dune 2021']);
    expect(await titles('?yearTo=1965')).toEqual(['Тіні забутих предків 1965']);
  });

  it('filters by part of the director name, case-insensitively (Cyrillic too), co-directors included', async () => {
    expect(await titles('?director=villeneuve')).toEqual(['Dune 2021']);
    expect(await titles(`?director=${encodeURIComponent('ПАРАДЖАНОВ')}`)).toEqual(['Тіні забутих предків 1965']);
    expect(await titles('?director=Doe')).toEqual(['Duo 2000']);
    expect(await titles('?director=roe')).toEqual(['Duo 2000']);
  });

  it('treats % and _ in the director literally', async () => {
    expect((await list('?director=%25')).total).toBe(0);
    expect((await list('?director=_')).total).toBe(0);
  });

  it('finds a movie by its new director after an update', async () => {
    const id = (await list('?director=lynch')).items[0].id;
    await app.inject({ method: 'PUT', url: `/movies/${id}`, payload: { ...dune, year: 1984, director: 'Alan Smithee' } });
    expect(await titles('?director=smithee')).toEqual(['Dune 1984']);
    expect((await list('?director=lynch')).total).toBe(0);
  });

  it('filters by watched status and marks watched movies', async () => {
    const id = (await list('?director=villeneuve')).items[0].id;
    expect((await app.inject({ method: 'POST', url: `/movies/${id}/watch`, payload: { rating: 8 } })).statusCode).toBe(201);
    expect(await titles('?watched=true')).toEqual(['Dune 2021']);
    expect(await titles('?watched=false&sort=title')).toEqual(['Dune 1984', 'Duo 2000', 'Тіні забутих предків 1965']);
    expect((await list('?director=villeneuve')).items[0].watched).toBe(true);
    expect((await list('?director=lynch')).items[0].watched).toBe(false);
    expect((await app.inject(`/movies/${id}`)).json().watched).toBe(true);
  });

  it('combines all filters with AND; total counts every match, not the page', async () => {
    const id = (await list('?director=villeneuve')).items[0].id;
    await app.inject({ method: 'POST', url: `/movies/${id}/watch`, payload: { rating: 8 } });
    expect(await titles('?q=dun&genre=Sci-Fi&yearFrom=1980&director=d&watched=false&sort=year')).toEqual(['Dune 1984']);
    const page = await list('?genre=drama&limit=1');
    expect(page).toMatchObject({ total: 3, limit: 1 });
    expect(page.items).toHaveLength(1);
  });

  it.each([
    ['?yearFrom=2020&yearTo=2010', 'yearTo'],
    ['?yearFrom=1887', 'yearFrom'],
    [`?yearTo=${maxYear() + 1}`, 'yearTo'],
  ])('rejects the year bound %s with 400 on %s', async (qs, path) => {
    const res = await app.inject(`/movies${qs}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.json().error.details)).toContain(path);
  });

  it.each(['?sort=popularity', '?order=up', '?director=', '?genre=', '?watched=yes', '?watched=1', '?watched='])(
    'rejects %s with 400',
    async (qs) => {
      const res = await app.inject(`/movies${qs}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    },
  );
});

describe('catalog sorting (FR-5, NFR-5)', () => {
  let db: ReturnType<typeof openDatabase>;
  beforeEach(async () => {
    db = openDatabase(':memory:');
    await app.close(); // replaces the top-level app
    app = await buildApp({ db });
    // [title, year, rating, votes]; Delta was added by hand (no IMDb data).
    const movies: [string, number, number | null, number | null][] = [
      ['Beta', 1999, 7.0, 9000],
      ['Alpha', 2001, 7.0, 9000],
      ['Gamma', 2010, 7.0, 100],
      ['Delta', 2001, null, null],
      ['Epsilon', 2015, 9.0, 50],
    ];
    for (const [title, year, rating, votes] of movies) {
      const { id } = (await create({ ...dune, title, year })).json();
      db.prepare('UPDATE movies SET imdb_rating = @rating, imdb_votes = @votes WHERE id = @id').run({ id, rating, votes });
    }
  });
  const order = async (query: string) => (await list(query)).items.map((m: Item) => m.title);

  it('defaults to most votes first; equal votes by title; no IMDb data last', async () => {
    expect(await order('')).toEqual(['Alpha', 'Beta', 'Gamma', 'Epsilon', 'Delta']);
    expect(await order('?sort=votes&order=desc')).toEqual(['Alpha', 'Beta', 'Gamma', 'Epsilon', 'Delta']);
    expect(await order('?sort=votes&order=asc')).toEqual(['Epsilon', 'Gamma', 'Alpha', 'Beta', 'Delta']);
  });

  it('sorts by IMDb rating; equal ratings by more votes, then title; no IMDb data last both ways', async () => {
    expect(await order('?sort=rating')).toEqual(['Epsilon', 'Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(await order('?sort=rating&order=asc')).toEqual(['Alpha', 'Beta', 'Gamma', 'Epsilon', 'Delta']);
  });

  it('sorts by year, newest first by default; equal years by title', async () => {
    expect(await order('?sort=year')).toEqual(['Epsilon', 'Gamma', 'Alpha', 'Delta', 'Beta']);
    expect(await order('?sort=year&order=asc')).toEqual(['Beta', 'Alpha', 'Delta', 'Gamma', 'Epsilon']);
  });

  it('sorts by title, A→Z by default', async () => {
    expect(await order('?sort=title')).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);
    expect(await order('?sort=title&order=desc')).toEqual(['Gamma', 'Epsilon', 'Delta', 'Beta', 'Alpha']);
  });

  it('sorts equal titles by year ascending, also in Z→A order', async () => {
    await create({ ...dune, title: 'gamma', year: 1950 });
    expect((await list('?sort=title&order=desc')).items.slice(0, 2).map((m: Item) => m.year)).toEqual([1950, 2010]);
  });

  it('returns IMDb data on list items and the movie page; null for a hand-added movie', async () => {
    const [epsilon] = (await list('?sort=rating&limit=1')).items;
    expect(epsilon).toMatchObject({ title: 'Epsilon', imdbRating: 9, imdbVotes: 50, watched: false });
    expect((await app.inject(`/movies/${epsilon.id}`)).json()).toEqual(epsilon);
    const delta = (await list('?q=delta')).items[0];
    expect(delta).toMatchObject({ imdbRating: null, imdbVotes: null });
    expect(Object.keys(delta).sort()).toEqual(['director', 'genres', 'id', 'imdbRating', 'imdbVotes', 'title', 'watched', 'year']);
  });
});

describe('GET /genres', () => {
  it('returns an empty list for an empty catalog', async () => {
    expect((await app.inject('/genres')).json()).toEqual({ items: [] });
  });

  it('lists each used genre once, first spelling kept, in case-insensitive order', async () => {
    await create({ ...dune, genres: ['Drama', 'sci-fi'] });
    await create({ ...dune, year: 1984, genres: ['SCI-FI', 'Жахи', 'абсурд'] });
    expect((await app.inject('/genres')).json()).toEqual({ items: ['Drama', 'sci-fi', 'абсурд', 'Жахи'] });
  });

  it('leaves out a genre whose last movie was deleted', async () => {
    await create(dune);
    const { id } = (await create({ ...dune, year: 1984, genres: ['X'] })).json();
    await app.inject({ method: 'DELETE', url: `/movies/${id}` });
    expect((await app.inject('/genres')).json()).toEqual({ items: ['Drama', 'Sci-Fi'] });
  });
});
