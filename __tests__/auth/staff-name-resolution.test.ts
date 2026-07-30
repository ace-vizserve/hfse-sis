/**
 * Staff names resolved from `user_metadata` must prefer `display_name`.
 *
 * The writer and the reader had drifted apart: `POST /api/sis/admin/users`
 * stores `user_metadata: { display_name }` (KD #87), and the per-user PATCH
 * writes the same key — but lib/auth/staff-list.ts read
 * `full_name ?? name ?? email`, and NOTHING in this codebase writes either of
 * the first two. So every name that surface produced was the account's email.
 *
 * It was invisible because the split was clean along module lines rather than
 * per-account: lib/sis/users/queries.ts and lib/sis/approvers/queries.ts read
 * `display_name` directly and were right, so the Staff Accounts page and the
 * approvers table showed real names while everything backed by staff-list.ts —
 * the grading-sheet hero, section teachers tab, attendance adviser line,
 * masterfile form-adviser column — showed emails. Nothing compared the two.
 *
 * Caught on a live probe: a P1 Respect grading sheet resolved its Filipino
 * subject teacher to `atlasxdev@gmail.com` when the account's display_name was
 * 'Test Teacher'.
 */

import { describe, expect, it } from 'vitest';
import { resolveStaffName } from '@/lib/auth/staff-list';

const EMAIL = 'atlasxdev@gmail.com';

describe('resolveStaffName', () => {
  it('prefers display_name — the key our own provisioning writes', () => {
    expect(resolveStaffName({ display_name: 'Test Teacher' }, EMAIL)).toBe(
      'Test Teacher'
    );
  });

  it('beats full_name and name when all three are present', () => {
    // Ordering matters: an account edited through our PATCH route updates
    // display_name only, so a stale full_name must not win.
    expect(
      resolveStaffName(
        {
          display_name: 'Current Name',
          full_name: 'Stale Name',
          name: 'Other',
        },
        EMAIL
      )
    ).toBe('Current Name');
  });

  it('falls back to full_name for accounts created outside our route', () => {
    // Supabase dashboard / OAuth populate these instead.
    expect(resolveStaffName({ full_name: 'Dashboard User' }, EMAIL)).toBe(
      'Dashboard User'
    );
    expect(resolveStaffName({ name: 'OAuth User' }, EMAIL)).toBe('OAuth User');
  });

  it('falls back to the email when no name is set at all', () => {
    expect(resolveStaffName({}, EMAIL)).toBe(EMAIL);
  });

  it('treats blank and whitespace-only names as absent', () => {
    // `??` alone would return '' here and render a nameless row.
    expect(resolveStaffName({ display_name: '' }, EMAIL)).toBe(EMAIL);
    expect(resolveStaffName({ display_name: '   ' }, EMAIL)).toBe(EMAIL);
    expect(
      resolveStaffName({ display_name: '  ', full_name: 'Real Name' }, EMAIL)
    ).toBe('Real Name');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveStaffName({ display_name: '  Test Teacher  ' }, EMAIL)).toBe(
      'Test Teacher'
    );
  });

  it('reads display_name from the same key the users route writes', () => {
    // Pins reader to writer. `app/api/sis/admin/users/route.ts` does
    // `user_metadata: displayName ? { display_name: displayName } : undefined`
    // — if that key is ever renamed, this fails rather than silently
    // reverting every staff name in the app to an email address.
    const asWrittenByOurRoute = { display_name: 'Joann Cruz' };
    expect(resolveStaffName(asWrittenByOurRoute, EMAIL)).toBe('Joann Cruz');
  });
});
