import { describe, expect, it } from 'vitest';

import {
  CalendarEventCreateSchema,
  CalendarEventUpdateSchema,
} from '@/lib/schemas/attendance';
import { audienceFor } from '@/lib/sis/backfill/calendar/types';

const base = {
  termId: '11111111-1111-4111-8111-111111111111',
  startDate: '2026-05-08',
  endDate: '2026-05-08',
  label: 'Primary Six Fieldtrip',
};

describe('CalendarEventCreateSchema — level scope (migration 158)', () => {
  it('accepts an event with no scope, as every pre-158 caller sends', () => {
    const r = CalendarEventCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.levels).toBeUndefined();
      expect(r.data.audience).toBe('all');
    }
  });

  it('accepts level codes', () => {
    const r = CalendarEventCreateSchema.safeParse({ ...base, levels: ['P6'] });
    expect(r.success).toBe(true);
  });

  it('accepts a scope spanning both halves of the school', () => {
    // Leadership Camp runs P4 through S4 — the case `audience` alone cannot
    // express, and the reason this column exists.
    const r = CalendarEventCreateSchema.safeParse({
      ...base,
      levels: ['P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects a level code that is not a level', () => {
    const r = CalendarEventCreateSchema.safeParse({ ...base, levels: ['P7'] });
    expect(r.success).toBe(false);
  });

  it('rejects an empty level array — whole-school is null, not []', () => {
    const r = CalendarEventCreateSchema.safeParse({ ...base, levels: [] });
    expect(r.success).toBe(false);
  });

  it('rejects levels and sections together, matching the DB CHECK', () => {
    // Turns a 500 from calendar_events_one_scope_chk into a 400 with a reason.
    const r = CalendarEventCreateSchema.safeParse({
      ...base,
      levels: ['P6'],
      sectionIds: ['22222222-2222-4222-8222-222222222222'],
    });
    expect(r.success).toBe(false);
  });

  it('accepts sections on their own', () => {
    const r = CalendarEventCreateSchema.safeParse({
      ...base,
      sectionIds: ['22222222-2222-4222-8222-222222222222'],
    });
    expect(r.success).toBe(true);
  });
});

describe('CalendarEventUpdateSchema — level scope', () => {
  const id = '33333333-3333-4333-8333-333333333333';

  it('distinguishes "clear the scope" from "leave it alone"', () => {
    // An explicit null clears back to whole-school; omitting the key must not
    // be read as a clear. The route forwards only what was actually sent.
    const cleared = CalendarEventUpdateSchema.safeParse({ id, levels: null });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.levels).toBeNull();

    const untouched = CalendarEventUpdateSchema.safeParse({ id });
    expect(untouched.success).toBe(true);
    if (untouched.success) expect(untouched.data.levels).toBeUndefined();
  });

  it('rejects both scopes together on update too', () => {
    const r = CalendarEventUpdateSchema.safeParse({
      id,
      levels: ['P1'],
      sectionIds: ['22222222-2222-4222-8222-222222222222'],
    });
    expect(r.success).toBe(false);
  });
});

describe('audience derivation parity', () => {
  // ⚠ THIS IS ONE RULE WRITTEN TWICE. `audienceFor` here and
  // `public.calendar_events_derive_audience()` in migration 158 must agree, or
  // a row's stored audience will disagree with what the backfill computed for
  // the same levels. These cases pin the TypeScript half; the SQL half is
  // verified by migration 158's own post-apply query.
  it('all-primary levels resolve to primary', () => {
    expect(audienceFor(['P1', 'P6'])).toBe('primary');
  });

  it('all-secondary levels resolve to secondary', () => {
    expect(audienceFor(['S1', 'S4'])).toBe('secondary');
  });

  it('a mixed scope resolves to all, losing detail on purpose', () => {
    expect(audienceFor(['P4', 'S1'])).toBe('all');
  });

  it('no scope resolves to all', () => {
    expect(audienceFor(null)).toBe('all');
    expect(audienceFor([])).toBe('all');
  });
});
