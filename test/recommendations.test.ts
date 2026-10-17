// Recommendations (FR-7) black-box tests: unwatched movies ranked by the fixed profile score (ADR-003, NFR-5).
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { createServices } from '../src/container.ts';
import { openDatabase } from '../src/db/database.ts';
import type { Recommender } from '../src/recommendation/recommender.ts';
import type { Movie } from '../src/schemas/movie.ts';
import type { PreferenceProfile } from '../src/schemas/profile.ts';
import type { Recommendation } from '../src/schemas/recommendation.ts';
import { testApp } from './helpers.ts';

const TODAY = '2026-10-16';
let app: FastifyInstance;

beforeEach(async () => {
  app = await testApp({ today: () => TODAY });
});

interface Film {
  genres: string[];
  director: string;
  rating?: number;
}

// Titles follow the creation order per app, so the same seed gives the same database in two apps (NFR-5 test).
const created = new WeakMap<FastifyInstance, number>();

/** Adds the films in order (ids 1..n on a fresh app) and marks those with a rating as watched. */
async function seed(films: Film[], a: FastifyInstance = app): Promise<number[]> {
  const ids: number[] = [];
  for (const { genres, director, rating } of films) {
    const n = (created.get(a) ?? 0) + 1;
    created.set(a, n);
    const res = await a.inject({ method: 'POST', url: '/movies', payload: { title: `Film ${n}`, year: 2000, genres, director } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as number;
    if (rating !== undefined) {
      const watch = await a.inject({ method: 'POST', url: `/movies/${id}/watch`, payload: { rating } });
      expect(watch.statusCode).toBe(201);
    }
    ids.push(id);
  }
  return ids;
}

// Plan test fixture: 1–9 watched, 10–17 unwatched candidates.
const FIXTURE: Film[] = [
  { genres: ['Sci-Fi', 'Drama'], director: 'Nolan', rating: 9 },
  { genres: ['Sci-Fi'], director: 'Nolan', rating: 9 },
  { genres: ['Drama'], director: 'Other', rating: 8 },
  { genres: ['Drama'], director: 'Other', rating: 8 },
  { genres: ['Drama'], director: 'Other', rating: 9 },
  { genres: ['Comedy'], director: 'Other', rating: 4 },
  { genres: ['Comedy'], director: 'Other', rating: 5 },
  { genres: ['Horror'], director: 'Bay', rating: 2 },
  { genres: ['Thriller'], director: 'Other', rating: 10 },
  { genres: ['Drama', 'Sci-Fi'], director: 'Nolan' },
  { genres: ['Sci-Fi'], director: 'Villeneuve' },
  { genres: ['Drama'], director: 'Kurosawa' },
  { genres: ['Comedy', 'Drama'], director: 'Allen' },
  { genres: ['Horror'], director: 'Bay' },
  { genres: ['Western'], director: 'Leone' },
  { genres: ['Sci-Fi'], director: 'Scott' },
  { genres: ['Thriller'], director: 'Fincher' },
];

const recommendations = async (url = '/recommendations', a: FastifyInstance = app): Promise<Recommendation[]> => {
  const res = await a.inject(url);
  expect(res.statusCode).toBe(200);
  return res.json().items;
};
const ids = (items: Recommendation[]) => items.map((r) => r.movie.id);
const byId = (items: Recommendation[], id: number) => items.find((r) => r.movie.id === id)!;

describe('GET /recommendations (FR-7)', () => {
  it('returns an empty list for an empty database', async () => {
    expect((await app.inject('/recommendations')).json()).toEqual({ items: [] });
  });

  it('returns an empty list when nothing is watched yet', async () => {
    await seed([{ genres: ['Drama'], director: 'Nolan' }]);
    expect(await recommendations()).toEqual([]);
  });

  describe('on the plan fixture', () => {
    beforeEach(async () => {
      await seed(FIXTURE);
    });

    it('orders by score desc, then by id, with the exact scores', async () => {
      const items = await recommendations();
      expect(ids(items)).toEqual([10, 12, 11, 16, 17, 13]);
      expect(items.map((r) => r.score)).toEqual([9.4, 2.4, 2.33, 2.33, 2.25, 1.73]);
    });

    it('never recommends watched movies and drops scores <= 0', async () => {
      const got = ids(await recommendations());
      for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(got).not.toContain(id);
      expect(got).not.toContain(14); // Horror + Bay: -5.25
      expect(got).not.toContain(15); // Western, no match: 0
    });

    it('explains the top movie with the reasons behind its score', async () => {
      const top = byId(await recommendations(), 10);
      expect(top.reasons).toEqual([
        { kind: 'director', name: 'Nolan', count: 2, averageRating: 9, points: 4.67 },
        { kind: 'genre', name: 'Drama', count: 4, averageRating: 8.5, points: 2.4 },
        { kind: 'genre', name: 'Sci-Fi', count: 2, averageRating: 9, points: 2.33 },
      ]);
      expect(top.explanation).toBe(
        'Director Nolan: 2 watched, average 9.0 (+4.67); Genre Drama: 4 watched, average 8.5 (+2.40); Genre Sci-Fi: 2 watched, average 9.0 (+2.33)',
      );
    });

    it('keeps negative reasons in the explanation', async () => {
      expect(byId(await recommendations(), 13).explanation).toBe(
        'Genre Drama: 4 watched, average 8.5 (+2.40); Genre Comedy: 2 watched, average 4.5 (-0.67)',
      );
    });

    it('returns the movie as GET /movies/:id does', async () => {
      const top = byId(await recommendations(), 10);
      expect(top.movie).toEqual((await app.inject('/movies/10')).json());
    });

    it('applies the limit after ranking', async () => {
      expect(ids(await recommendations('/recommendations?limit=2'))).toEqual([10, 12]);
    });

    it('drops a movie once it is watched', async () => {
      const res = await app.inject({ method: 'POST', url: '/movies/10/watch', payload: { rating: 7 } });
      expect(res.statusCode).toBe(201);
      expect(ids(await recommendations())).not.toContain(10);
    });

    it('matches genres case-insensitively, showing the profile spelling', async () => {
      const [id] = await seed([{ genres: ['sci-fi'], director: 'Nobody' }]);
      expect(byId(await recommendations(), id!).reasons).toEqual([
        { kind: 'genre', name: 'Sci-Fi', count: 2, averageRating: 9, points: 2.33 },
      ]);
    });

    it('matches directors by the exact string, as the profile groups them (ADR-013)', async () => {
      const [id] = await seed([{ genres: ['Drama'], director: 'nolan' }]);
      const item = byId(await recommendations(), id!);
      expect(item.reasons.map((r) => r.kind)).toEqual(['genre']);
      expect(item.score).toBe(2.4);
    });
  });

  it('returns 20 items by default', async () => {
    await seed([
      { genres: ['Drama'], director: 'A', rating: 9 },
      ...Array.from({ length: 25 }, () => ({ genres: ['Drama'], director: 'B' })),
    ]);
    expect(await recommendations()).toHaveLength(20);
  });

  it.each(['0', '101', 'abc'])('rejects limit=%s with a validation error', async (limit) => {
    const res = await app.inject(`/recommendations?limit=${limit}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('gives identical bodies for the same database state (NFR-5)', async () => {
    const other = await testApp({ today: () => TODAY });
    await seed(FIXTURE);
    await seed(FIXTURE, other);
    const a = await app.inject('/recommendations');
    const b = await other.inject('/recommendations');
    expect(a.body).toBe(b.body);
    expect(a.body).toBe((await app.inject('/recommendations')).body);
  });
});

describe('Recommender swap (ADR-003)', () => {
  it('delegates to the Recommender given to the composition root', () => {
    const calls: { profile: PreferenceProfile; candidates: Movie[]; limit: number }[] = [];
    const canned: Recommendation[] = [];
    const stub: Recommender = {
      recommend(profile, candidates, limit) {
        calls.push({ profile, candidates, limit });
        return canned;
      },
    };
    const services = createServices(openDatabase(':memory:'), () => TODAY, stub);
    const watched = services.movies.create({ title: 'Dune', year: 2021, genres: ['Sci-Fi'], director: 'Villeneuve' });
    services.watches.mark(watched.id, { rating: 9 });
    const b = services.movies.create({ title: 'Heat', year: 1995, genres: ['Crime'], director: 'Mann' });
    const a = services.movies.create({ title: 'Alien', year: 1979, genres: ['Sci-Fi'], director: 'Scott' });

    const result = services.recommendations.recommend({ limit: 5 });
    expect(result.items).toBe(canned);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.profile).toEqual(services.profile.get());
    expect(calls[0]!.candidates).toEqual([b, a]);
    expect(calls[0]!.limit).toBe(5);
  });
});
