// Viewing Statistics (FR-8) black-box tests: computed from the Watch History on each request, never stored.
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createServices } from '../src/container.ts';
import { openDatabase } from '../src/db/database.ts';
import { testApp } from './helpers.ts';

const TODAY = '2026-10-16';
const EMPTY = { watchedCount: 0, averageRating: null, byGenre: [], byYear: [] };
let app: FastifyInstance;

beforeEach(async () => {
  app = await testApp({ today: () => TODAY });
});

interface Film {
  title?: string;
  genres: string[];
  year?: number;
  rating?: number;
  watchedAt?: string;
}

let serial = 0;
async function addMovie(a: FastifyInstance, { title, genres, year = 2000 }: Film): Promise<number> {
  const res = await a.inject({
    method: 'POST',
    url: '/movies',
    payload: { title: title ?? `Film ${++serial}`, year, genres, director: 'Someone' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

async function watch(a: FastifyInstance, id: number, rating: number, watchedAt?: string): Promise<void> {
  const res = await a.inject({ method: 'POST', url: `/movies/${id}/watch`, payload: { rating, watchedAt } });
  expect(res.statusCode).toBe(201);
}

/** Adds the films and marks those with a rating as watched; returns the movie ids in order. */
async function seed(films: Film[], a: FastifyInstance = app): Promise<number[]> {
  const ids: number[] = [];
  for (const film of films) {
    const id = await addMovie(a, film);
    if (film.rating !== undefined) await watch(a, id, film.rating, film.watchedAt);
    ids.push(id);
  }
  return ids;
}

const stats = async (a: FastifyInstance = app, url = '/stats') => {
  const res = await a.inject(url);
  expect(res.statusCode).toBe(200);
  return res.json();
};

const sum = (items: { count: number }[]) => items.reduce((total, item) => total + item.count, 0);

describe('GET /stats (FR-8)', () => {
  it('returns zero totals and empty distributions for an empty database', async () => {
    expect(await stats()).toEqual(EMPTY);
  });

  it('counts only watched movies', async () => {
    await seed([
      { genres: ['Drama'], year: 2010 },
      { genres: ['Comedy'], year: 1999 },
    ]);
    expect(await stats()).toEqual(EMPTY);
  });

  it('returns the count, the average rating and both distributions', async () => {
    await seed([
      { genres: ['Drama'], year: 2010, rating: 8 },
      { genres: ['Drama'], year: 2010, rating: 9 },
      { genres: ['Drama', 'Comedy'], year: 2015, rating: 7 },
      { genres: ['Comedy'], year: 1999, rating: 10 },
      { genres: ['Horror'], year: 2020 },
    ]);
    expect(await stats()).toEqual({
      watchedCount: 4,
      averageRating: 8.5,
      byGenre: [
        { name: 'Drama', count: 3 },
        { name: 'Comedy', count: 2 },
      ],
      byYear: [
        { year: 1999, count: 1 },
        { year: 2010, count: 2 },
        { year: 2015, count: 1 },
      ],
    });
  });

  it('counts a multi-genre movie once per year and once in each genre', async () => {
    await seed([
      { genres: ['Drama', 'Crime', 'Thriller'], year: 1994, rating: 9 },
      { genres: ['Drama'], year: 1995, rating: 8 },
    ]);
    const body = await stats();
    expect(body.watchedCount).toBe(2);
    expect(sum(body.byGenre)).toBeGreaterThan(body.watchedCount);
    expect(sum(body.byYear)).toBe(body.watchedCount);
  });

  it('rounds the average rating to two decimals', async () => {
    await seed([
      { genres: ['Drama'], rating: 7 },
      { genres: ['Drama'], rating: 8 },
      { genres: ['Drama'], rating: 8 },
    ]);
    expect((await stats()).averageRating).toBe(7.67);
  });

  it('breaks genre ties by the case-insensitive key and keeps the original spelling (ADR-008)', async () => {
    // Binary order would put "Комедія" (К, U+041A) before "драма" (д, U+0434); name_key order is д < к.
    await seed([
      { genres: ['Комедія'], rating: 7 },
      { genres: ['драма'], rating: 7 },
    ]);
    expect((await stats()).byGenre).toEqual([
      { name: 'драма', count: 1 },
      { name: 'Комедія', count: 1 },
    ]);
  });

  it('orders genres by count before name', async () => {
    await seed([
      { genres: ['Alpha'], rating: 5 },
      { genres: ['Zeta'], rating: 5 },
      { genres: ['Zeta'], rating: 5 },
    ]);
    expect((await stats()).byGenre).toEqual([
      { name: 'Zeta', count: 2 },
      { name: 'Alpha', count: 1 },
    ]);
  });

  it('groups genre spellings into one entry with the first spelling (ADR-008)', async () => {
    await seed([
      { genres: ['Sci-Fi'], rating: 8 },
      { genres: ['sci-fi'], rating: 6 },
    ]);
    expect((await stats()).byGenre).toEqual([{ name: 'Sci-Fi', count: 2 }]);
  });

  it('orders years ascending regardless of insertion order', async () => {
    await seed([
      { genres: ['X'], year: 2020, rating: 5 },
      { genres: ['X'], year: 1950, rating: 5 },
      { genres: ['X'], year: 2001, rating: 5 },
    ]);
    expect((await stats()).byYear.map((y: { year: number }) => y.year)).toEqual([1950, 2001, 2020]);
  });

  it('groups by release year, not the watch date (ADR-010)', async () => {
    await seed([{ genres: ['Drama'], year: 1999, rating: 8, watchedAt: '2024-05-01' }]);
    expect((await stats()).byYear).toEqual([{ year: 1999, count: 1 }]);
  });

  it('reflects a changed rating (computed, not stored)', async () => {
    const [id] = await seed([
      { genres: ['Drama'], year: 2010, rating: 4 },
      { genres: ['Drama'], year: 2010, rating: 6 },
    ]);
    const before = await stats();
    expect(before.averageRating).toBe(5);
    const res = await app.inject({ method: 'PUT', url: `/movies/${id}/watch`, payload: { rating: 10 } });
    expect(res.statusCode).toBe(200);
    const after = await stats();
    expect(after.averageRating).toBe(8);
    expect({ ...after, averageRating: 5 }).toEqual(before);
  });

  it('drops a cancelled watch; a genre or year with no watches left disappears', async () => {
    const [drama] = await seed([
      { genres: ['Drama'], year: 2010, rating: 9 },
      { genres: ['Comedy'], year: 2015, rating: 5 },
    ]);
    expect((await app.inject({ method: 'DELETE', url: `/movies/${drama}/watch` })).statusCode).toBe(204);
    expect(await stats()).toEqual({
      watchedCount: 1,
      averageRating: 5,
      byGenre: [{ name: 'Comedy', count: 1 }],
      byYear: [{ year: 2015, count: 1 }],
    });
  });

  it('ignores unknown query parameters', async () => {
    await seed([{ genres: ['Drama'], rating: 8 }]);
    expect(await stats(app, '/stats?x=1')).toEqual(await stats());
  });
});

describe('determinism (NFR-5)', () => {
  const films: Film[] = [
    { title: 'A', genres: ['Drama', 'Crime'], year: 2010, rating: 8 },
    { title: 'B', genres: ['Comedy'], year: 1999, rating: 8 },
    { title: 'C', genres: ['Crime'], year: 2010, rating: 6 },
    { title: 'D', genres: ['Drama'], year: 2021, rating: 6 },
    { title: 'E', genres: ['Comedy', 'Drama'], year: 1985, rating: 7 },
    { title: 'F', genres: ['Western'], year: 1966, rating: 7 },
  ];

  it('gives the same statistics for the same data inserted in a different order', async () => {
    const other = await testApp({ today: () => TODAY });
    await seed(films);
    // Reverse order, and add all movies before marking any of them, so ids and rowids differ.
    const ids = [];
    for (const film of [...films].reverse()) ids.push(await addMovie(other, film));
    for (const [i, film] of [...films].reverse().entries()) await watch(other, ids[i]!, film.rating!);

    const first = await stats();
    expect(await stats(other)).toEqual(first);
    expect(await stats()).toEqual(first);
    expect(first.byGenre.map((g: { name: string }) => g.name)).toEqual(['Drama', 'Comedy', 'Crime', 'Western']);
    expect(first.byYear.map((y: { year: number }) => y.year)).toEqual([1966, 1985, 1999, 2010, 2021]);
  });
});

describe('container', () => {
  it('StatsService.get() from the container equals the HTTP body', async () => {
    const db = openDatabase(':memory:');
    const services = createServices(db, () => TODAY);
    expect(services.stats.get()).toEqual(EMPTY);
    const movie = services.movies.create({ title: 'Dune', year: 2021, genres: ['Sci-Fi', 'Drama'], director: 'Villeneuve' });
    services.watches.mark(movie.id, { rating: 9 });

    const direct = services.stats.get();
    expect(direct).toEqual({
      watchedCount: 1,
      averageRating: 9,
      byGenre: [
        { name: 'Drama', count: 1 },
        { name: 'Sci-Fi', count: 1 },
      ],
      byYear: [{ year: 2021, count: 1 }],
    });
    const http = await buildApp({ db, today: () => TODAY });
    await http.ready();
    expect(await stats(http)).toEqual(direct);
  });
});
