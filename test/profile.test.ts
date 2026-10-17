// Preference Profile (FR-6) black-box tests: computed from the Watch History on each request, never stored.
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createServices } from '../src/container.ts';
import { openDatabase } from '../src/db/database.ts';
import { testApp } from './helpers.ts';

const TODAY = '2026-10-16';
let app: FastifyInstance;

beforeEach(async () => {
  app = await testApp({ today: () => TODAY });
});

interface Film {
  title?: string;
  genres: string[];
  director?: string;
  rating?: number;
}

let serial = 0;
async function addMovie(a: FastifyInstance, { title, genres, director = 'Someone' }: Film): Promise<number> {
  const res = await a.inject({
    method: 'POST',
    url: '/movies',
    payload: { title: title ?? `Film ${++serial}`, year: 2000, genres, director },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}

async function watch(a: FastifyInstance, id: number, rating: number): Promise<void> {
  const res = await a.inject({ method: 'POST', url: `/movies/${id}/watch`, payload: { rating } });
  expect(res.statusCode).toBe(201);
}

/** Adds the films and marks those with a rating as watched; returns the movie ids in order. */
async function seed(films: Film[], a: FastifyInstance = app): Promise<number[]> {
  const ids: number[] = [];
  for (const film of films) {
    const id = await addMovie(a, film);
    if (film.rating !== undefined) await watch(a, id, film.rating);
    ids.push(id);
  }
  return ids;
}

const profile = async (a: FastifyInstance = app, url = '/profile') => {
  const res = await a.inject(url);
  expect(res.statusCode).toBe(200);
  return res.json();
};

describe('GET /profile (FR-6)', () => {
  it('returns empty lists for an empty database', async () => {
    expect(await profile()).toEqual({ genres: [], directors: [] });
  });

  it('counts only watched movies', async () => {
    await seed([{ genres: ['Drama'] }, { genres: ['Comedy'], director: 'B' }]);
    expect(await profile()).toEqual({ genres: [], directors: [] });
  });

  it('orders genres by count first, then by average rating', async () => {
    await seed([
      { genres: ['Drama'], rating: 8 },
      { genres: ['Drama'], rating: 9 },
      { genres: ['Drama'], rating: 7 },
      { genres: ['Comedy'], rating: 10 },
    ]);
    expect((await profile()).genres).toEqual([
      { name: 'Drama', count: 3, averageRating: 8 },
      { name: 'Comedy', count: 1, averageRating: 10 },
    ]);
  });

  it('puts the higher average first when counts are equal', async () => {
    await seed([
      { genres: ['Horror'], rating: 6 },
      { genres: ['Western'], rating: 9 },
    ]);
    expect((await profile()).genres.map((g: { name: string }) => g.name)).toEqual(['Western', 'Horror']);
  });

  it('breaks full ties by the case-insensitive key and keeps the original spelling (ADR-008)', async () => {
    // Binary order would put "Комедія" (К, U+041A) before "драма" (д, U+0434); name_key order is д < к.
    await seed([
      { genres: ['Комедія'], rating: 7 },
      { genres: ['драма'], rating: 7 },
    ]);
    expect((await profile()).genres).toEqual([
      { name: 'драма', count: 1, averageRating: 7 },
      { name: 'Комедія', count: 1, averageRating: 7 },
    ]);
  });

  it('counts a movie with two genres in both genres and once for its director', async () => {
    await seed([{ genres: ['Drama', 'Crime'], director: 'Scorsese', rating: 9 }]);
    expect(await profile()).toEqual({
      genres: [
        { name: 'Crime', count: 1, averageRating: 9 },
        { name: 'Drama', count: 1, averageRating: 9 },
      ],
      directors: [{ name: 'Scorsese', count: 1, averageRating: 9 }],
    });
  });

  it('rounds the average to two decimals', async () => {
    await seed([
      { genres: ['Drama'], rating: 7 },
      { genres: ['Drama'], rating: 8 },
      { genres: ['Drama'], rating: 8 },
    ]);
    expect((await profile()).genres[0].averageRating).toBe(7.67);
  });

  it('orders directors by count, then average, then name', async () => {
    await seed([
      { genres: ['X'], director: 'C', rating: 10 },
      { genres: ['X'], director: 'A', rating: 6 },
      { genres: ['X'], director: 'B', rating: 9 },
      { genres: ['X'], director: 'A', rating: 6 },
      { genres: ['X'], director: 'B', rating: 7 },
    ]);
    expect((await profile()).directors).toEqual([
      { name: 'B', count: 2, averageRating: 8 },
      { name: 'A', count: 2, averageRating: 6 },
      { name: 'C', count: 1, averageRating: 10 },
    ]);
  });

  it('orders equal directors by name', async () => {
    await seed([
      { genres: ['X'], director: 'Zhao', rating: 8 },
      { genres: ['X'], director: 'Allen', rating: 8 },
    ]);
    expect((await profile()).directors.map((d: { name: string }) => d.name)).toEqual(['Allen', 'Zhao']);
  });

  it('groups genre spellings into one entry with the first spelling (ADR-008)', async () => {
    await seed([
      { genres: ['Sci-Fi'], rating: 8 },
      { genres: ['sci-fi'], rating: 6 },
    ]);
    expect((await profile()).genres).toEqual([{ name: 'Sci-Fi', count: 2, averageRating: 7 }]);
  });

  it('reflects a changed rating (computed, not stored)', async () => {
    const [id] = await seed([{ genres: ['Drama'], director: 'A', rating: 4 }]);
    const res = await app.inject({ method: 'PUT', url: `/movies/${id}/watch`, payload: { rating: 10 } });
    expect(res.statusCode).toBe(200);
    expect(await profile()).toEqual({
      genres: [{ name: 'Drama', count: 1, averageRating: 10 }],
      directors: [{ name: 'A', count: 1, averageRating: 10 }],
    });
  });

  it('drops a cancelled watch, and a genre with no watches left disappears', async () => {
    const [drama] = await seed([
      { genres: ['Drama'], director: 'A', rating: 9 },
      { genres: ['Comedy'], director: 'B', rating: 5 },
    ]);
    expect((await app.inject({ method: 'DELETE', url: `/movies/${drama}/watch` })).statusCode).toBe(204);
    expect(await profile()).toEqual({
      genres: [{ name: 'Comedy', count: 1, averageRating: 5 }],
      directors: [{ name: 'B', count: 1, averageRating: 5 }],
    });
  });

  it('ignores unknown query parameters', async () => {
    await seed([{ genres: ['Drama'], rating: 8 }]);
    expect(await profile(app, '/profile?x=1')).toEqual(await profile());
  });
});

describe('determinism (NFR-5)', () => {
  const films: Film[] = [
    { title: 'A', genres: ['Drama', 'Crime'], director: 'Nolan', rating: 8 },
    { title: 'B', genres: ['Comedy'], director: 'Allen', rating: 8 },
    { title: 'C', genres: ['Crime'], director: 'Nolan', rating: 6 },
    { title: 'D', genres: ['Drama'], director: 'Allen', rating: 6 },
    { title: 'E', genres: ['Comedy', 'Drama'], director: 'Coen', rating: 7 },
    { title: 'F', genres: ['Western'], director: 'Leone', rating: 7 },
  ];

  it('gives the same profile for the same data inserted in a different order', async () => {
    const other = await testApp({ today: () => TODAY });
    await seed(films);
    // Reverse order, and add all movies before marking any of them, so ids and rowids differ.
    const ids = [];
    for (const film of [...films].reverse()) ids.push(await addMovie(other, film));
    for (const [i, film] of [...films].reverse().entries()) await watch(other, ids[i]!, film.rating!);

    const first = await profile();
    expect(await profile(other)).toEqual(first);
    expect(await profile()).toEqual(first);
    expect(first.genres.map((g: { name: string }) => g.name)).toEqual(['Drama', 'Comedy', 'Crime', 'Western']);
  });
});

describe('reuse for FR-7', () => {
  it('ProfileService.get() from the container equals the HTTP body', async () => {
    const db = openDatabase(':memory:');
    const services = createServices(db, () => TODAY);
    const movie = services.movies.create({ title: 'Dune', year: 2021, genres: ['Sci-Fi', 'Drama'], director: 'Villeneuve' });
    services.watches.mark(movie.id, { rating: 9 });

    const direct = services.profile.get();
    expect(direct.directors).toEqual([{ name: 'Villeneuve', count: 1, averageRating: 9 }]);
    const http = await buildApp({ db, today: () => TODAY });
    await http.ready();
    expect(await profile(http)).toEqual(direct);
  });
});
