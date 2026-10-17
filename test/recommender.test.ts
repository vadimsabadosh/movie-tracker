// Pure tests of the base Recommender (FR-7, ADR-003): no database, the weights and the formula are pinned here.
import { describe, expect, it } from 'vitest';
import {
  affinity,
  DIRECTOR_WEIGHT,
  GENRE_WEIGHT,
  NEUTRAL_RATING,
  ProfileScoreRecommender,
  round2,
} from '../src/recommendation/profile-score-recommender.ts';
import type { Movie } from '../src/schemas/movie.ts';
import type { PreferenceProfile } from '../src/schemas/profile.ts';

const profile: PreferenceProfile = {
  genres: [
    { name: 'Drama', count: 4, averageRating: 8.5 },
    { name: 'Sci-Fi', count: 2, averageRating: 9 },
    { name: 'Comedy', count: 2, averageRating: 4.5 },
    { name: 'Horror', count: 1, averageRating: 2 },
    { name: 'Thriller', count: 1, averageRating: 10 },
  ],
  directors: [
    { name: 'Other', count: 6, averageRating: 7.33 },
    { name: 'Nolan', count: 2, averageRating: 9 },
    { name: 'Bay', count: 1, averageRating: 2 },
  ],
};

const movie = (id: number, genres: string[], director: string): Movie => ({ id, title: `Film ${id}`, year: 2000, genres, director });

const candidates: Movie[] = [
  movie(10, ['Drama', 'Sci-Fi'], 'Nolan'),
  movie(11, ['Sci-Fi'], 'Villeneuve'),
  movie(12, ['Drama'], 'Kurosawa'),
  movie(13, ['Comedy', 'Drama'], 'Allen'),
  movie(14, ['Horror'], 'Bay'),
  movie(15, ['Western'], 'Leone'),
  movie(16, ['Sci-Fi'], 'Scott'),
  movie(17, ['Thriller'], 'Fincher'),
];

const recommender = new ProfileScoreRecommender();

describe('affinity', () => {
  it('is the average shrunk toward neutral by one imaginary 5.5 rating', () => {
    expect(affinity({ name: 'Drama', count: 4, averageRating: 8.5 })).toBeCloseTo(2.4, 10);
    expect(affinity({ name: 'Thriller', count: 1, averageRating: 10 })).toBeCloseTo(2.25, 10);
    expect(affinity({ name: 'Comedy', count: 2, averageRating: 4.5 })).toBeCloseTo(-2 / 3, 10);
    for (const count of [1, 2, 7]) expect(affinity({ name: 'X', count, averageRating: 5.5 })).toBe(0);
  });

  it('round2 rounds to two decimals', () => {
    expect(round2(2 / 3)).toBe(0.67);
    expect(round2(-2 / 3)).toBe(-0.67);
    expect(round2(9.4)).toBe(9.4);
  });

  it('pins the weights (ADR-003)', () => {
    expect(NEUTRAL_RATING).toBe(5.5);
    expect(GENRE_WEIGHT).toBe(1);
    expect(DIRECTOR_WEIGHT).toBe(2);
  });
});

describe('ProfileScoreRecommender', () => {
  it('returns nothing for an empty profile', () => {
    expect(recommender.recommend({ genres: [], directors: [] }, candidates, 20)).toEqual([]);
  });

  it('returns nothing without candidates', () => {
    expect(recommender.recommend(profile, [], 20)).toEqual([]);
  });

  it('ranks by score desc, then id, and drops scores <= 0', () => {
    const items = recommender.recommend(profile, candidates, 20);
    expect(items.map((r) => r.movie.id)).toEqual([10, 12, 11, 16, 17, 13]);
    expect(items.map((r) => r.score)).toEqual([9.4, 2.4, 2.33, 2.33, 2.25, 1.73]);
  });

  it('builds reasons and explanation from the same components', () => {
    const [top] = recommender.recommend(profile, candidates, 1);
    expect(top!.reasons).toEqual([
      { kind: 'director', name: 'Nolan', count: 2, averageRating: 9, points: 4.67 },
      { kind: 'genre', name: 'Drama', count: 4, averageRating: 8.5, points: 2.4 },
      { kind: 'genre', name: 'Sci-Fi', count: 2, averageRating: 9, points: 2.33 },
    ]);
    expect(top!.explanation).toBe(
      'Director Nolan: 2 watched, average 9.0 (+4.67); Genre Drama: 4 watched, average 8.5 (+2.40); Genre Sci-Fi: 2 watched, average 9.0 (+2.33)',
    );
  });

  it('keeps director before genre when points are equal', () => {
    const items = recommender.recommend(
      { genres: [{ name: 'Drama', count: 1, averageRating: 9.5 }], directors: [{ name: 'Lee', count: 1, averageRating: 7.5 }] },
      [movie(1, ['Drama'], 'Lee')],
      5,
    );
    expect(items[0]!.reasons.map((r) => r.kind)).toEqual(['director', 'genre']);
    expect(items[0]!.score).toBe(4);
  });

  it('gives the same output for shuffled candidates (NFR-5)', () => {
    const shuffled = [...candidates].reverse();
    shuffled.push(shuffled.shift()!);
    expect(recommender.recommend(profile, shuffled, 20)).toEqual(recommender.recommend(profile, candidates, 20));
  });

  it('slices to the limit after ranking', () => {
    expect(recommender.recommend(profile, candidates, 3).map((r) => r.movie.id)).toEqual([10, 12, 11]);
  });
});
