import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  QboError,
  qbEscape,
  qboErrorMessage,
  qboQueryAll,
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
      'QuickBooks needs to be connected again. Ask a superadmin to reconnect it in SIS Admin.'
    );
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

  it('only admissions, school_admin and superadmin invoice', () => {
    expect(canInvoiceInQbo('admissions')).toBe(true);
    expect(canInvoiceInQbo('school_admin')).toBe(true);
    expect(canInvoiceInQbo('superadmin')).toBe(true);
    expect(canInvoiceInQbo('academic_coordinator')).toBe(false);
    expect(canInvoiceInQbo(null)).toBe(false);
  });
});
