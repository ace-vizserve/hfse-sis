import { describe, expect, it } from 'vitest';

import { applyTargetFilter, type RecordsDrillRow } from '@/lib/sis/drill';

// backlog-by-document previously ignored the clicked chart segment entirely
// (literal `// segment ignored for now` comment) — every click opened the
// same broad "has any missing core doc" cohort regardless of which
// slot+status bar segment was clicked. `docSlotBuckets` (populated by the
// new `enrichWithDocSlotBuckets`, lib/sis/drill.ts) now lets the filter
// resolve the segment (`"{slotLabel}|{bucket}"`,
// components/sis/document-backlog-chart.client.tsx) to exactly the rows in
// that bucket for that slot (KD #82/#124 count==drill).

function row(over: Partial<RecordsDrillRow>): RecordsDrillRow {
  return {
    enroleeNumber: 'E1',
    studentNumber: 'S1',
    fullName: 'Doe, Jane',
    enrollmentStatus: 'active',
    applicationStatus: 'Enrolled',
    level: 'Primary 1',
    sectionId: 'sec1',
    sectionName: 'Obedience',
    pipelineStage: 'Enrolled',
    applicationDate: null,
    enrollmentDate: null,
    withdrawalDate: null,
    daysSinceUpdate: null,
    hasMissingDocs: true,
    expiringDocsCount: 0,
    documentsComplete: 0,
    documentsTotal: 5,
    ...over,
  };
}

describe("applyTargetFilter('backlog-by-document') — segment-scoped, not ignored", () => {
  it('a segment for a specific slot+bucket returns only rows in that bucket for that slot', () => {
    const rows = [
      row({
        enroleeNumber: 'E1',
        docSlotBuckets: { birthCert: 'missing', medical: 'valid' },
      }),
      row({
        enroleeNumber: 'E2',
        docSlotBuckets: { birthCert: 'valid', medical: 'missing' },
      }),
      row({
        enroleeNumber: 'E3',
        docSlotBuckets: { birthCert: 'missing', medical: 'missing' },
      }),
    ];
    const out = applyTargetFilter(
      rows,
      'backlog-by-document',
      'Birth Certificate|missing',
      undefined
    );
    expect(out.map((r) => r.enroleeNumber).sort()).toEqual(['E1', 'E3']);
  });

  it('two different segments for the same slot but different buckets return different row sets', () => {
    const rows = [
      row({ enroleeNumber: 'E1', docSlotBuckets: { medical: 'pending' } }),
      row({ enroleeNumber: 'E2', docSlotBuckets: { medical: 'rejected' } }),
      row({ enroleeNumber: 'E3', docSlotBuckets: { medical: 'pending' } }),
    ];
    const pending = applyTargetFilter(
      rows,
      'backlog-by-document',
      'Medical Exam|pending',
      undefined
    );
    const rejected = applyTargetFilter(
      rows,
      'backlog-by-document',
      'Medical Exam|rejected',
      undefined
    );
    expect(pending.map((r) => r.enroleeNumber).sort()).toEqual(['E1', 'E3']);
    expect(rejected.map((r) => r.enroleeNumber)).toEqual(['E2']);
  });

  it('an unrecognized slot label returns []', () => {
    const rows = [
      row({ enroleeNumber: 'E1', docSlotBuckets: { medical: 'missing' } }),
    ];
    const out = applyTargetFilter(
      rows,
      'backlog-by-document',
      'Not A Real Slot|missing',
      undefined
    );
    expect(out).toEqual([]);
  });

  it('an unrecognized bucket name returns []', () => {
    const rows = [
      row({ enroleeNumber: 'E1', docSlotBuckets: { medical: 'missing' } }),
    ];
    const out = applyTargetFilter(
      rows,
      'backlog-by-document',
      'Medical Exam|not-a-bucket',
      undefined
    );
    expect(out).toEqual([]);
  });

  it('excludes soft-closed rows even when their bucket matches the segment', () => {
    const rows = [
      row({
        enroleeNumber: 'E1',
        applicationStatus: 'Cancelled',
        docSlotBuckets: { medical: 'missing' },
      }),
      row({ enroleeNumber: 'E2', docSlotBuckets: { medical: 'missing' } }),
    ];
    const out = applyTargetFilter(
      rows,
      'backlog-by-document',
      'Medical Exam|missing',
      undefined
    );
    expect(out.map((r) => r.enroleeNumber)).toEqual(['E2']);
  });

  it('a row whose docSlotBuckets is unset (no enrichment) never matches a segment', () => {
    const rows = [row({ enroleeNumber: 'E1', docSlotBuckets: undefined })];
    const out = applyTargetFilter(
      rows,
      'backlog-by-document',
      'Medical Exam|missing',
      undefined
    );
    expect(out).toEqual([]);
  });

  it('no segment preserves the existing broad "has any missing core doc" cohort', () => {
    const rows = [
      row({ enroleeNumber: 'E1', hasMissingDocs: true }),
      row({ enroleeNumber: 'E2', hasMissingDocs: false }),
      row({
        enroleeNumber: 'E3',
        hasMissingDocs: true,
        applicationStatus: 'Withdrawn', // soft-closed
      }),
    ];
    const out = applyTargetFilter(rows, 'backlog-by-document', null, undefined);
    expect(out.map((r) => r.enroleeNumber)).toEqual(['E1']);
  });
});
