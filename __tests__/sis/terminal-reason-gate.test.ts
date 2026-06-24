import { describe, expect, it } from 'vitest';

import { validateTerminalReason } from '@/lib/schemas/sis';

// Require a reason when cancelling / withdrawing an application. Shared by the
// stage PATCH route (server 422 `reason_required` / `notes_required`) + the
// edit-stage dialog (client-side disable + inline message), so this pure test
// is the single guarantee they agree.

describe('validateTerminalReason', () => {
  it('rejects a missing reason as reason_required', () => {
    for (const reason of [undefined, null, '']) {
      const r = validateTerminalReason(reason, null);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('reason_required');
    }
  });

  it('rejects an unknown reason value as reason_required', () => {
    const r = validateTerminalReason('made_up_reason', 'some notes');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('reason_required');
  });

  it('accepts a valid catalogue reason with no notes', () => {
    expect(validateTerminalReason('chose_another_school', null)).toEqual({
      ok: true,
    });
    expect(validateTerminalReason('visa_denied', '')).toEqual({ ok: true });
  });

  it('requires notes when the reason is "other"', () => {
    for (const notes of [undefined, null, '', '   ']) {
      const r = validateTerminalReason('other', notes);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('notes_required');
    }
  });

  it('accepts "other" once notes are provided', () => {
    expect(validateTerminalReason('other', 'Parent never responded')).toEqual({
      ok: true,
    });
  });
});
