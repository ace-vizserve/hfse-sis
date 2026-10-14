import { describe, expect, it } from 'vitest';

import { QboError, qbEscape, qboErrorMessage } from '@/lib/qbo/client';
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

  it('only admissions, school_admin and superadmin invoice', () => {
    expect(canInvoiceInQbo('admissions')).toBe(true);
    expect(canInvoiceInQbo('school_admin')).toBe(true);
    expect(canInvoiceInQbo('superadmin')).toBe(true);
    expect(canInvoiceInQbo('academic_coordinator')).toBe(false);
    expect(canInvoiceInQbo(null)).toBe(false);
  });
});
