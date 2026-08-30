/**
 * `QUERY_TRACE=1` is the only product-code change Phase 0 of the app-wide
 * query/write pass makes (everything else in that phase is new files). The
 * brief is explicit that it must be INERT unless the flag is set — "the code
 * path must be identical to today" — so this file exists to prove exactly
 * that, not just that the tracer "works" when turned on.
 *
 * `@supabase/supabase-js`'s `createClient` is mocked so the test can inspect
 * the options object `createServiceClient()` actually builds, without a real
 * network client (or real Supabase env vars) getting involved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn((..._args: unknown[]) => ({ from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe('createServiceClient — QUERY_TRACE inertness', () => {
  beforeEach(() => {
    createClientMock.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes no `global` option when QUERY_TRACE is unset', async () => {
    vi.stubEnv('QUERY_TRACE', '');
    delete process.env.QUERY_TRACE;
    const { createServiceClient } = await import('@/lib/supabase/service');
    createServiceClient();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [, , options] = createClientMock.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(options).toEqual({
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect('global' in options).toBe(false);
  });

  it('passes no `global` option when QUERY_TRACE is set to any value other than "1"', async () => {
    vi.stubEnv('QUERY_TRACE', 'true');
    const { createServiceClient } = await import('@/lib/supabase/service');
    createServiceClient();

    const [, , options] = createClientMock.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect('global' in options).toBe(false);
  });

  it('the auth options are untouched regardless of the flag', async () => {
    vi.stubEnv('QUERY_TRACE', '1');
    const { createServiceClient } = await import('@/lib/supabase/service');
    createServiceClient();

    const [, , options] = createClientMock.mock.calls[0] as [
      string,
      string,
      { auth: unknown },
    ];
    expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it('adds a `global.fetch` function only when QUERY_TRACE=1', async () => {
    vi.stubEnv('QUERY_TRACE', '1');
    const { createServiceClient } = await import('@/lib/supabase/service');
    createServiceClient();

    const [, , options] = createClientMock.mock.calls[0] as [
      string,
      string,
      { global?: { fetch: unknown } },
    ];
    expect(typeof options.global?.fetch).toBe('function');
  });

  it('the traced fetch logs one [qtrace] line per request and counts them', async () => {
    vi.stubEnv('QUERY_TRACE', '1');
    const realFetch = vi.fn(
      async () => new Response('{}', { status: 200 })
    );
    vi.stubGlobal('fetch', realFetch);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { createServiceClient } = await import('@/lib/supabase/service');
    createServiceClient();
    const [, , options] = createClientMock.mock.calls[0] as [
      string,
      string,
      { global: { fetch: typeof fetch } },
    ];
    const tracedFetch = options.global.fetch;

    await tracedFetch('https://example.supabase.co/rest/v1/students?select=id');
    await tracedFetch('https://example.supabase.co/rest/v1/sections?select=id');

    expect(realFetch).toHaveBeenCalledTimes(2);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toMatch(/^\[qtrace\] \/rest\/v1\/students\?select=id n=1 ms=\d+$/);
    expect(lines[1]).toMatch(/^\[qtrace\] \/rest\/v1\/sections\?select=id n=2 ms=\d+$/);

    logSpy.mockRestore();
  });

  it('each createServiceClient() call gets its own independent counter', async () => {
    vi.stubEnv('QUERY_TRACE', '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { createServiceClient } = await import('@/lib/supabase/service');
    createServiceClient();
    createServiceClient();
    const [firstCallOptions] = [createClientMock.mock.calls[0][2]] as [
      { global: { fetch: typeof fetch } },
    ];
    const [secondCallOptions] = [createClientMock.mock.calls[1][2]] as [
      { global: { fetch: typeof fetch } },
    ];

    await firstCallOptions.global.fetch('https://example.supabase.co/rest/v1/a');
    await secondCallOptions.global.fetch('https://example.supabase.co/rest/v1/b');

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toContain('n=1');
    expect(lines[1]).toContain('n=1'); // independent counter, not n=2

    logSpy.mockRestore();
  });
});
