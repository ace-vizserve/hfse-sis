import { describe, expect, it } from 'vitest';

import {
  applyTargetFilter,
  documentStatusToDisplay,
  type PFilesDrillLoadResult,
  type PFilesDrillRow,
} from '@/lib/p-files/drill';
import { resolveStatus } from '@/lib/p-files/document-config';

// ─── documentStatusToDisplay ────────────────────────────────────────────────
// This is the drill's new bridge onto the shared `resolveStatus` classifier
// (KD fix — the drill previously had its own independent `normaliseStatus`
// that never applied the expiry backstop).

describe('documentStatusToDisplay', () => {
  it('maps every canonical DocumentStatus to the drill display enum', () => {
    expect(documentStatusToDisplay('valid')).toBe('On file');
    expect(documentStatusToDisplay('uploaded')).toBe('Awaiting validation');
    expect(documentStatusToDisplay('to-follow')).toBe('Promised');
    expect(documentStatusToDisplay('rejected')).toBe('Rejected');
    expect(documentStatusToDisplay('expired')).toBe('Expired');
    expect(documentStatusToDisplay('missing')).toBe('Missing');
    expect(documentStatusToDisplay('na')).toBe('Missing');
  });

  it('expiry backstop: a Valid raw status with a past expiry resolves to Expired, not On file', () => {
    // This is the exact bug the old normaliseStatus had — it read the raw
    // 'Valid' string directly and never looked at the expiry date at all.
    const resolved = resolveStatus(null, 'Valid', '2020-01-01', true);
    expect(resolved).toBe('expired');
    expect(documentStatusToDisplay(resolved)).toBe('Expired');
  });

  it('a currently-valid, not-yet-expired document still reads On file', () => {
    const resolved = resolveStatus(null, 'Valid', '2099-01-01', true);
    expect(documentStatusToDisplay(resolved)).toBe('On file');
  });
});

// ─── applyTargetFilter — level-applicants gating ────────────────────────────

function makeRow(overrides: Partial<PFilesDrillRow>): PFilesDrillRow {
  return {
    enroleeNumber: 'E-1',
    fullName: 'Test Student',
    level: 'P1',
    slotKey: 'passport',
    slotLabel: 'Student Passport',
    status: 'Missing',
    fileUrl: null,
    expiryDate: null,
    daysToExpiry: null,
    revisionCount: 0,
    lastRevisionAt: null,
    gated: false,
    ...overrides,
  };
}

describe('applyTargetFilter — level-applicants gating', () => {
  it('excludes gated rows (e.g. fatherPassport when fatherEmail is empty)', () => {
    const rows: PFilesDrillRow[] = [
      makeRow({ slotKey: 'passport', gated: false }),
      makeRow({ slotKey: 'fatherPassport', gated: true }),
    ];
    const data: PFilesDrillLoadResult = { rows, revisionEvents: [] };
    const result = applyTargetFilter(data, 'level-applicants', null);
    expect(result).toHaveLength(1);
    expect(result[0]!.slotKey).toBe('passport');
  });

  it('gating still applies when a segment (level) filter is also active', () => {
    const rows: PFilesDrillRow[] = [
      makeRow({ slotKey: 'passport', level: 'P1', gated: false }),
      makeRow({ slotKey: 'fatherPassport', level: 'P1', gated: true }),
      makeRow({ slotKey: 'passport', level: 'P2', gated: false }),
    ];
    const data: PFilesDrillLoadResult = { rows, revisionEvents: [] };
    const result = applyTargetFilter(data, 'level-applicants', 'P1');
    expect(result).toHaveLength(1);
    expect(result[0]!.slotKey).toBe('passport');
    expect(result[0]!.level).toBe('P1');
  });

  it('other targets do NOT apply the gate — a gated row still shows up e.g. in all-docs', () => {
    const rows: PFilesDrillRow[] = [
      makeRow({ slotKey: 'fatherPassport', gated: true }),
    ];
    const data: PFilesDrillLoadResult = { rows, revisionEvents: [] };
    const result = applyTargetFilter(data, 'all-docs', null);
    expect(result).toHaveLength(1);
  });
});

// ─── applyTargetFilter — revisions-on-day event counting ───────────────────

describe('applyTargetFilter — revisions-on-day counts events, not latest-per-slot', () => {
  it('a slot revised twice on different days produces 2 rows, one per day', () => {
    const rows: PFilesDrillRow[] = [
      makeRow({
        slotKey: 'passport',
        revisionCount: 2,
        lastRevisionAt: '2026-03-05T10:00:00.000Z',
      }),
    ];
    const revisionEvents: PFilesDrillRow[] = [
      makeRow({
        slotKey: 'passport',
        revisionCount: 1,
        lastRevisionAt: '2026-03-01T09:00:00.000Z',
      }),
      makeRow({
        slotKey: 'passport',
        revisionCount: 1,
        lastRevisionAt: '2026-03-05T10:00:00.000Z',
      }),
    ];
    const data: PFilesDrillLoadResult = { rows, revisionEvents };

    // No segment/range: every event.
    const all = applyTargetFilter(data, 'revisions-on-day', null);
    expect(all).toHaveLength(2);

    // Segment = a specific day: only that day's event.
    const onOneDay = applyTargetFilter(data, 'revisions-on-day', '2026-03-01');
    expect(onOneDay).toHaveLength(1);
    expect(onOneDay[0]!.lastRevisionAt).toBe('2026-03-01T09:00:00.000Z');

    // Range covering only the later event.
    const inRange = applyTargetFilter(data, 'revisions-on-day', null, {
      from: '2026-03-04',
      to: '2026-03-10',
    });
    expect(inRange).toHaveLength(1);
    expect(inRange[0]!.lastRevisionAt).toBe('2026-03-05T10:00:00.000Z');
  });

  it('uses revisionEvents, not the deduped rows set, even when rows has just 1 entry', () => {
    // Regression guard: the old behaviour deduped to "latest revision per
    // (enrolee, slot)" — a slot revised 3 times only ever produced 1 row.
    const rows: PFilesDrillRow[] = [
      makeRow({ slotKey: 'passport', revisionCount: 3 }),
    ];
    const revisionEvents: PFilesDrillRow[] = [
      makeRow({ slotKey: 'passport', lastRevisionAt: '2026-01-01T00:00:00Z' }),
      makeRow({ slotKey: 'passport', lastRevisionAt: '2026-02-01T00:00:00Z' }),
      makeRow({ slotKey: 'passport', lastRevisionAt: '2026-03-01T00:00:00Z' }),
    ];
    const data: PFilesDrillLoadResult = { rows, revisionEvents };
    const result = applyTargetFilter(data, 'revisions-on-day', null);
    expect(result).toHaveLength(3);
  });
});
