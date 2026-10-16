import { describe, expect, it } from 'vitest';

import { shouldRenewRequestId } from '@/lib/billing/request-id';
import { ApiError } from '@/lib/query/fetcher';

describe('shouldRenewRequestId', () => {
  it('renews when our route answered with its own error', () => {
    expect(
      shouldRenewRequestId(
        new ApiError(422, { error: 'Choose the account.' }, 'x')
      )
    ).toBe(true);
    expect(
      shouldRenewRequestId(new ApiError(502, { error: 'QuickBooks…' }, 'x'))
    ).toBe(true);
  });

  it('keeps the id when our route says QuickBooks may have saved it', () => {
    expect(
      shouldRenewRequestId(
        new ApiError(
          502,
          { error: "QuickBooks didn't answer…", keepRequestId: true },
          'x'
        )
      )
    ).toBe(false);
    expect(
      shouldRenewRequestId(
        new ApiError(502, { error: 'x', keepRequestId: false }, 'x')
      )
    ).toBe(true);
  });

  it('keeps the id for platform errors, lost responses and network failures', () => {
    // A platform 502/504 (HTML or empty body) may follow a write QuickBooks
    // accepted; the retry must replay the same id.
    expect(
      shouldRenewRequestId(new ApiError(504, '<html>timeout</html>', 'x'))
    ).toBe(false);
    expect(shouldRenewRequestId(new ApiError(502, '', 'x'))).toBe(false);
    expect(shouldRenewRequestId(new ApiError(500, null, 'x'))).toBe(false);
    expect(shouldRenewRequestId(new ApiError(500, { message: 'x' }, 'x'))).toBe(
      false
    );
    expect(shouldRenewRequestId(new ApiError(500, ['x'], 'x'))).toBe(false);
    expect(shouldRenewRequestId(new TypeError('Failed to fetch'))).toBe(false);
  });
});
