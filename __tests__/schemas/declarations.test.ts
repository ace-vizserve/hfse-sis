import { describe, expect, it } from 'vitest';

import {
  DECLARATION_MAX_RANGE_DAYS,
  fileDeclarationSchema,
  inclusiveDayCount,
  shiftIsoDays,
} from '@/lib/schemas/declarations';

// Parent absence / travel declarations. Every message these rules produce is
// read by a parent through the admissions portal, so the assertions below care
// about *which* field an issue lands on — the portal puts the message under
// that field, and one on the wrong path is invisible.

const TODAY = '2026-09-15';
const schema = fileDeclarationSchema(TODAY);

const absence = (over: Record<string, unknown> = {}) => ({
  declarationType: 'absence' as const,
  studentNumbers: ['H250001'],
  startDate: '2026-09-16',
  endDate: '2026-09-18',
  withMedical: false,
  ...over,
});

const travel = (over: Record<string, unknown> = {}) => ({
  declarationType: 'travel' as const,
  studentNumbers: ['H250001'],
  startDate: '2026-12-01',
  endDate: '2026-12-10',
  destinationCountry: 'Malaysia',
  ...over,
});

const pathsOf = (result: {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[] }> };
}) => (result.error?.issues ?? []).map((i) => i.path.join('.'));

describe('date helpers', () => {
  it('counts both ends of the range', () => {
    // A one-day absence is one day, not zero. Off by one here writes the wrong
    // number of register rows on approval.
    expect(inclusiveDayCount('2026-09-16', '2026-09-16')).toBe(1);
    expect(inclusiveDayCount('2026-09-16', '2026-09-18')).toBe(3);
  });

  it('shifts across a month boundary without drifting', () => {
    expect(shiftIsoDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftIsoDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('shifts across a leap day', () => {
    expect(shiftIsoDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('absence', () => {
  it('accepts a plain one', () => {
    expect(schema.safeParse(absence()).success).toBe(true);
  });

  it('rejects an end date before the start', () => {
    const result = schema.safeParse(
      absence({ startDate: '2026-09-18', endDate: '2026-09-16' })
    );
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('endDate');
  });

  it('accepts a single-day absence', () => {
    expect(
      schema.safeParse(
        absence({ startDate: '2026-09-16', endDate: '2026-09-16' })
      ).success
    ).toBe(true);
  });

  it('refuses a range long enough to be a typed year', () => {
    const result = schema.safeParse(
      absence({ startDate: '2026-09-16', endDate: '2027-09-16' })
    );
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('endDate');
  });

  it('allows exactly the maximum range', () => {
    const end = shiftIsoDays('2026-09-16', DECLARATION_MAX_RANGE_DAYS - 1);
    expect(
      schema.safeParse(absence({ startDate: '2026-09-16', endDate: end }))
        .success
    ).toBe(true);
  });

  it('refuses a filing from long ago', () => {
    const result = schema.safeParse(
      absence({ startDate: '2026-01-05', endDate: '2026-01-06' })
    );
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('startDate');
  });

  it('accepts a filing from a few days ago — parents file after the fact', () => {
    expect(
      schema.safeParse(
        absence({ startDate: '2026-09-11', endDate: '2026-09-12' })
      ).success
    ).toBe(true);
  });

  it('refuses a date years ahead', () => {
    const result = schema.safeParse(
      absence({ startDate: '2036-09-16', endDate: '2036-09-17' })
    );
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('startDate');
  });

  it('requires evidence when a certificate is claimed', () => {
    const result = schema.safeParse(absence({ withMedical: true }));
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('evidencePath');
  });

  it('takes an upload as that evidence', () => {
    expect(
      schema.safeParse(
        absence({ withMedical: true, evidencePath: 'declarations/u1/a.pdf' })
      ).success
    ).toBe(true);
  });

  it('takes a link as that evidence', () => {
    expect(
      schema.safeParse(
        absence({ withMedical: true, evidenceUrl: 'https://mc.gov.sg/abc123' })
      ).success
    ).toBe(true);
  });

  it('needs no evidence without a certificate', () => {
    expect(schema.safeParse(absence({ withMedical: false })).success).toBe(
      true
    );
  });

  it('refuses a link that is not https', () => {
    // The scheme check is the security-relevant half — without it `javascript:`
    // reaches an href on the staff queue.
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>',
      'http://mc.gov.sg/abc',
      'mc.gov.sg/abc',
    ]) {
      const result = schema.safeParse(
        absence({ withMedical: true, evidenceUrl: url })
      );
      expect(result.success, url).toBe(false);
    }
  });
});

describe('travel', () => {
  it('accepts a plain one', () => {
    expect(schema.safeParse(travel()).success).toBe(true);
  });

  it('requires a country', () => {
    const result = schema.safeParse(travel({ destinationCountry: '   ' }));
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('destinationCountry');
  });

  it('treats the city as optional', () => {
    expect(
      schema.safeParse(travel({ destinationCity: undefined })).success
    ).toBe(true);
  });

  it('carries no medical fields', () => {
    // The discriminated union must not quietly accept absence-only keys on a
    // travel filing — the table's CHECK would reject the row at insert time,
    // which is a 500 the parent cannot act on.
    const result = schema.safeParse(travel({ withMedical: true }));
    expect(result.success).toBe(false);
  });
});

describe('children', () => {
  it('needs at least one', () => {
    const result = schema.safeParse(absence({ studentNumbers: [] }));
    expect(result.success).toBe(false);
    expect(pathsOf(result)).toContain('studentNumbers');
  });

  it('accepts several — one submission covers siblings', () => {
    expect(
      schema.safeParse(absence({ studentNumbers: ['H250001', 'H250002'] }))
        .success
    ).toBe(true);
  });

  it('rejects the same child twice', () => {
    const result = schema.safeParse(
      absence({ studentNumbers: ['H250001', 'H250001'] })
    );
    expect(result.success).toBe(false);
  });

  it('caps how many one submission may cover', () => {
    const many = Array.from({ length: 11 }, (_, i) => `H25000${i}`);
    expect(schema.safeParse(absence({ studentNumbers: many })).success).toBe(
      false
    );
  });
});

describe('the note', () => {
  it('caps at the same length as the register note', () => {
    // 300 matches attendance_daily_ex_note_len_chk exactly, so the two can never
    // disagree about what fits.
    expect(
      schema.safeParse(absence({ parentNote: 'x'.repeat(300) })).success
    ).toBe(true);
    expect(
      schema.safeParse(absence({ parentNote: 'x'.repeat(301) })).success
    ).toBe(false);
  });
});
