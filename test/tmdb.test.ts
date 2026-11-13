// TMDB client with a fake fetch: no network, no real token.
import { describe, expect, it, vi } from 'vitest';
import { tmdbPosterSource } from '../src/clients/tmdb.ts';

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
