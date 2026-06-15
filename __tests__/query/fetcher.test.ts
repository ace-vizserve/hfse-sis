import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';
import { jsonResponse, stubFetch, textResponse } from '../_utils/mock-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  it('parses and returns a JSON body on 2xx', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ rows: [1, 2, 3] })));
    const data = await apiFetch<{ rows: number[] }>('/api/x');
    expect(data).toEqual({ rows: [1, 2, 3] });
  });

  it('returns text for non-JSON responses', async () => {
    stubFetch(() => Promise.resolve(textResponse('hello')));
    const data = await apiFetch<string>('/api/x');
    expect(data).toBe('hello');
  });

  it('throws ApiError on a non-2xx response, carrying status + body', async () => {
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'late_revert_not_t1' }, 422))
    );
    await expect(apiFetch('/api/x')).rejects.toBeInstanceOf(ApiError);
    try {
      await apiFetch('/api/x');
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(422);
      // message prefers body.error so call sites' specific copy is preserved
      expect(err.message).toBe('late_revert_not_t1');
      // raw body remains available for code-based branching
      expect(err.body).toEqual({ error: 'late_revert_not_t1' });
    }
  });

  it('falls back to statusText when the error body has no error/message', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response('', { status: 500, statusText: 'Internal Server Error' })
      )
    );
    await expect(apiFetch('/api/x')).rejects.toMatchObject({
      status: 500,
      message: 'Internal Server Error',
    });
  });

  it('forwards the abort signal to fetch', async () => {
    const spy = stubFetch(() => Promise.resolve(jsonResponse({})));
    const controller = new AbortController();
    await apiFetch('/api/x', { signal: controller.signal });
    expect(spy).toHaveBeenCalledWith('/api/x', {
      signal: controller.signal,
    });
  });
});

describe('jsonInit', () => {
  it('builds a JSON mutation init with serialized body', () => {
    expect(jsonInit('PATCH', { a: 1 })).toEqual({
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
  });

  it('omits the body when no payload is given', () => {
    const init = jsonInit('POST');
    expect(init.body).toBeUndefined();
    expect(init.method).toBe('POST');
  });

  it('merges extra headers and keeps content-type', () => {
    const init = jsonInit('DELETE', undefined, { headers: { 'x-test': '1' } });
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-test': '1',
    });
  });
});
