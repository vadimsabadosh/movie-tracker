// TMDB client with a fake fetch: no network, no real token.
import { describe, expect, it, vi } from 'vitest';
import { CAST_LIMIT, tmdbDetailsSource, tmdbPosterSource } from '../src/clients/tmdb.ts';

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('tmdbPosterSource', () => {
  it('is undefined without a token', () => {
    expect(tmdbPosterSource(undefined)).toBeUndefined();
    expect(tmdbPosterSource('')).toBeUndefined();
  });

  it('finds the poster path by IMDb ID with a Bearer token', async () => {
    const fetchFn = respond(200, { movie_results: [{ poster_path: '/a.jpg', title: 'ignored' }], tv_results: [] });
    expect(await tmdbPosterSource('t', fetchFn)!.findPosterPath('tt1')).toBe('/a.jpg');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.themoviedb.org/3/find/tt1?external_source=imdb_id');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
    expect((init.headers as Record<string, string>).accept).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null when TMDB has no match or no poster', async () => {
    expect(await tmdbPosterSource('t', respond(200, { movie_results: [] }))!.findPosterPath('tt1')).toBeNull();
    expect(await tmdbPosterSource('t', respond(200, { movie_results: [{ poster_path: null }] }))!.findPosterPath('tt1')).toBeNull();
  });

  it('rejects on non-2xx without leaking the token', async () => {
    for (const status of [401, 500]) {
      const error = await tmdbPosterSource('secret-value', respond(status, {}))!
        .findPosterPath('tt1')
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('secret-value');
    }
  });

  it('rejects a poster path that is not a plain image path', async () => {
    const source = tmdbPosterSource('t', respond(200, { movie_results: [{ poster_path: '"><script>' }] }))!;
    await expect(source.findPosterPath('tt1')).rejects.toThrow();
  });
});

/** Fake fetch answering each call from `bodies` in order (status 200 unless given as [status, body]). */
const sequence = (...bodies: unknown[]) => {
  const fn = vi.fn();
  for (const b of bodies) {
    const [status, body] = Array.isArray(b) ? b : [200, b];
    fn.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  }
  return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
};

describe('tmdbDetailsSource', () => {
  it('is undefined without a token', () => {
    expect(tmdbDetailsSource(undefined)).toBeUndefined();
    expect(tmdbDetailsSource('')).toBeUndefined();
  });

  it('finds the plot and the top 10 cast in billing order with two calls', async () => {
    const orders = [5, 11, 0, 3, 9, 1, 7, 2, 10, 4, 8, 6];
    const cast = orders.map((order) => ({ name: `Actor ${order}`, character: order === 2 ? null : `Role ${order}`, order, id: order }));
    const fetchFn = sequence({ movie_results: [{ id: 42, overview: ' Plot ', title: 'x' }] }, { id: 42, cast, crew: [] });
    const details = await tmdbDetailsSource('t', fetchFn)!.findDetails('tt1');
    expect(details!.overview).toBe('Plot');
    expect(details!.cast).toHaveLength(CAST_LIMIT);
    expect(details!.cast.map((c) => c.name)).toEqual(Array.from({ length: 10 }, (_, i) => `Actor ${i}`));
    expect(details!.cast[0]).toEqual({ name: 'Actor 0', character: 'Role 0' });
    expect(details!.cast[2]).toEqual({ name: 'Actor 2', character: '' });
    const calls = fetchFn.mock.calls as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      'https://api.themoviedb.org/3/find/tt1?external_source=imdb_id&language=en-US',
      'https://api.themoviedb.org/3/movie/42/credits?language=en-US',
    ]);
    for (const [, init] of calls) {
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
      expect((init.headers as Record<string, string>).accept).toBe('application/json');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('returns null after one call when TMDB has no match', async () => {
    const fetchFn = sequence({ movie_results: [] });
    expect(await tmdbDetailsSource('t', fetchFn)!.findDetails('tt1')).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('treats a missing overview as empty', async () => {
    const fetchFn = sequence({ movie_results: [{ id: 1, overview: null }] }, { cast: [] });
    expect(await tmdbDetailsSource('t', fetchFn)!.findDetails('tt1')).toEqual({ overview: '', cast: [] });
  });

  it('rejects on non-2xx without leaking the token', async () => {
    for (const fetchFn of [sequence([401, {}]), sequence({ movie_results: [{ id: 1 }] }, [500, {}])]) {
      const error = await tmdbDetailsSource('secret-value', fetchFn)!
        .findDetails('tt1')
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('secret-value');
    }
  });

  it('rejects malformed TMDB JSON (Zod)', async () => {
    await expect(tmdbDetailsSource('t', sequence({ movie_results: [{ id: 'x' }] }))!.findDetails('tt1')).rejects.toThrow();
    const noName = sequence({ movie_results: [{ id: 1 }] }, { cast: [{ character: 'c', order: 0 }] });
    await expect(tmdbDetailsSource('t', noName)!.findDetails('tt1')).rejects.toThrow();
  });
});
