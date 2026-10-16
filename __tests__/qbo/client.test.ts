import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  QboError,
  qbEscape,
  qboErrorMessage,
  QboNotConnectedError,
  qboQueryAll,
  qboReasonOnly,
  qboRequest,
  WRITE_OUTCOME_UNKNOWN,
  writeOutcomeUnknown,
} from '@/lib/qbo/client';
import { qboInvoiceUrl } from '@/lib/qbo/env';
import { canInvoiceInQbo } from '@/lib/qbo/roles';

describe('QuickBooks client helpers', () => {
  it('escapes quotes and backslashes for the query language', () => {
    expect(qbEscape("O'Brien \\ Co")).toBe("O\\'Brien \\\\ Co");
  });

  it('turns a QuickBooks fault into the sentence staff see', () => {
    const e = new QboError(400, '6240', 'Duplicate Name Exists Error');
    expect(qboErrorMessage(e)).toBe(
      "QuickBooks didn't accept this: Duplicate Name Exists Error"
    );
    expect(qboErrorMessage(new Error('fetch failed'))).toBe(
      "QuickBooks couldn't be reached. Nothing was saved — try again in a minute."
    );
  });

  it('asks for a reconnect when QuickBooks refuses the saved key', () => {
    expect(
      qboErrorMessage(
        new QboError(400, 'invalid_grant', 'Incorrect or invalid refresh token')
      )
    ).toBe(
      'QuickBooks needs to be connected again. Ask a superadmin to reconnect it in Billing → Settings.'
    );
    expect(qboErrorMessage(new QboNotConnectedError())).toBe(
      'QuickBooks is not connected. Ask a superadmin to connect it in Billing → Settings.'
    );
  });

  it('gives the reason only, never "Nothing was saved", once QuickBooks accepted', () => {
    expect(
      qboReasonOnly(new QboError(400, '6000', 'Business validation error'))
    ).toBe('Business validation error');
    expect(qboReasonOnly(new Error('fetch failed'))).toBe(
      "QuickBooks couldn't be reached"
    );
    expect(qboReasonOnly(new QboNotConnectedError())).toBe(
      qboErrorMessage(new QboNotConnectedError())
    );
    const grant = new QboError(400, 'invalid_grant', 'x');
    expect(qboReasonOnly(grant)).toBe(qboErrorMessage(grant));
    for (const e of [new Error('x'), new QboError(500, null, 'y')])
      expect(qboReasonOnly(e)).not.toContain('Nothing was saved');
  });

  it('treats a write with no definite answer as possibly saved', () => {
    expect(writeOutcomeUnknown(new TypeError('fetch failed'))).toBe(true);
    expect(
      writeOutcomeUnknown(Object.assign(new Error('x'), { name: 'AbortError' }))
    ).toBe(true);
    expect(
      writeOutcomeUnknown(
        Object.assign(new Error('x'), { name: 'TimeoutError' })
      )
    ).toBe(true);
    expect(writeOutcomeUnknown(new QboError(500, null, 'x'))).toBe(true);
    expect(writeOutcomeUnknown(new QboError(503, null, 'x'))).toBe(true);
    expect(writeOutcomeUnknown(new QboError(408, null, 'x'))).toBe(true);
    expect(writeOutcomeUnknown(new QboError(429, null, 'x'))).toBe(true);
    expect(writeOutcomeUnknown(new QboError(400, '6000', 'x'))).toBe(false);
    expect(writeOutcomeUnknown(new QboError(401, null, 'x'))).toBe(false);
    expect(writeOutcomeUnknown(new QboNotConnectedError())).toBe(false);
    expect(writeOutcomeUnknown(new Error('One of the items…'))).toBe(false);
    expect(WRITE_OUTCOME_UNKNOWN).not.toContain('Nothing was saved');
  });

  it('links to the invoice in the right QuickBooks', () => {
    expect(qboInvoiceUrl('sandbox', '130')).toBe(
      'https://app.sandbox.qbo.intuit.com/app/invoice?txnId=130'
    );
    expect(qboInvoiceUrl('production', '130')).toBe(
      'https://app.qbo.intuit.com/app/invoice?txnId=130'
    );
  });

  describe('qboQueryAll', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('pages 1000 at a time until a short page', async () => {
      const farFuture = new Date(Date.now() + 3_600_000).toISOString();
      const service = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  realm_id: 'r1',
                  environment: 'sandbox',
                  refresh_token: 'rt',
                  access_token: 'at',
                  access_token_expires_at: farFuture,
                },
                error: null,
              }),
            }),
          }),
        }),
      } as never;
      const pages = [
        Array.from({ length: 1000 }, (_, i) => ({ Id: String(i) })),
        [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }],
      ];
      const fetchMock = vi.fn(async (..._args: unknown[]) => ({
        ok: true,
        status: 200,
        json: async () => ({ QueryResponse: { Customer: pages.shift() } }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const rows = await qboQueryAll<{ Id: string }>(service, 'Customer');

      expect(rows).toHaveLength(1003);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls[0]).toContain('startposition%201%20');
      expect(urls[1]).toContain('startposition%201001%20');
    });
  });

  describe('qboRequest throttling', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('waits and retries on 429', async () => {
      vi.useFakeTimers();
      const farFuture = new Date(Date.now() + 3_600_000).toISOString();
      const service = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  realm_id: 'r1',
                  environment: 'sandbox',
                  refresh_token: 'rt',
                  access_token: 'at',
                  access_token_expires_at: farFuture,
                },
                error: null,
              }),
            }),
          }),
        }),
      } as never;
      const responses = [
        {
          ok: false,
          status: 429,
          headers: { get: () => null },
          statusText: 'Too Many Requests',
          json: async () => null,
        },
        {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ Invoice: { Id: '1' } }),
        },
      ];
      const fetchMock = vi.fn(async (..._args: unknown[]) => responses.shift());
      vi.stubGlobal('fetch', fetchMock);

      const p = qboRequest<{ Invoice: { Id: string } }>(
        service,
        'GET',
        '/invoice/1'
      );
      await vi.advanceTimersByTimeAsync(2000);
      expect(await p).toEqual({ Invoice: { Id: '1' } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('sends requestid only when asked', async () => {
      const farFuture = new Date(Date.now() + 3_600_000).toISOString();
      const service = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  realm_id: 'r1',
                  environment: 'sandbox',
                  refresh_token: 'rt',
                  access_token: 'at',
                  access_token_expires_at: farFuture,
                },
                error: null,
              }),
            }),
          }),
        }),
      } as never;
      const fetchMock = vi.fn(async (..._args: unknown[]) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
      }));
      vi.stubGlobal('fetch', fetchMock);
      await qboRequest(
        service,
        'POST',
        '/payment',
        { a: 1 },
        { requestId: 'abc-c0' }
      );
      await qboRequest(service, 'POST', '/payment', { a: 1 });
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls[0]).toMatch(/\/payment\?minorversion=\d+&requestid=abc-c0$/);
      expect(urls[1]).not.toContain('requestid');
    });
  });

  it('only admissions, school_admin and superadmin invoice', () => {
    expect(canInvoiceInQbo('admissions')).toBe(true);
    expect(canInvoiceInQbo('school_admin')).toBe(true);
    expect(canInvoiceInQbo('superadmin')).toBe(true);
    expect(canInvoiceInQbo('academic_coordinator')).toBe(false);
    expect(canInvoiceInQbo(null)).toBe(false);
  });
});
