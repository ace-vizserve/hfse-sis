import { describe, it, expect } from 'vitest';
import {
  computeActivePublishedTermNumbers,
  filterPayloadToActiveTerms,
  type PublicationRow,
  type TermNumberRow,
  type PayloadLike,
} from '@/lib/report-card/publication-window';

const NOW = new Date('2026-07-07T00:00:00.000Z').getTime();

const TERMS: TermNumberRow[] = [
  { id: 't1', term_number: 1 },
  { id: 't2', term_number: 2 },
  { id: 't3', term_number: 3 },
  { id: 't4', term_number: 4 },
];

function pub(overrides: Partial<PublicationRow> = {}): PublicationRow {
  return {
    section_id: 'sec-1',
    term_id: 't1',
    publish_from: '2026-01-01T00:00:00.000Z',
    publish_until: '2026-12-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeActivePublishedTermNumbers', () => {
  it('one active window on the student section → only that term', () => {
    const pubs = [pub({ section_id: 'sec-1', term_id: 't1' })];
    const result = computeActivePublishedTermNumbers(
      pubs,
      TERMS,
      ['sec-1'],
      NOW
    );
    expect(result).toEqual(new Set([1]));
  });

  it('two active windows across different sections → both terms, others excluded', () => {
    const pubs = [
      pub({ section_id: 'sec-1', term_id: 't1' }),
      pub({ section_id: 'sec-2', term_id: 't2' }),
      // A window on a section this student never enrolled in — must not leak in.
      pub({ section_id: 'sec-9', term_id: 't3' }),
    ];
    const result = computeActivePublishedTermNumbers(
      pubs,
      TERMS,
      ['sec-1', 'sec-2'],
      NOW
    );
    expect(result).toEqual(new Set([1, 2]));
  });

  it('zero active windows → empty set', () => {
    const pubs = [
      // Expired window (publish_until in the past).
      pub({
        section_id: 'sec-1',
        term_id: 't1',
        publish_from: '2026-01-01T00:00:00.000Z',
        publish_until: '2026-02-01T00:00:00.000Z',
      }),
      // Not yet open (publish_from in the future).
      pub({
        section_id: 'sec-1',
        term_id: 't2',
        publish_from: '2027-01-01T00:00:00.000Z',
        publish_until: '2027-06-01T00:00:00.000Z',
      }),
    ];
    const result = computeActivePublishedTermNumbers(
      pubs,
      TERMS,
      ['sec-1'],
      NOW
    );
    expect(result).toEqual(new Set());
  });

  it('window on a section the student is not in → excluded even if the time window is active', () => {
    const pubs = [pub({ section_id: 'sec-not-mine', term_id: 't1' })];
    const result = computeActivePublishedTermNumbers(
      pubs,
      TERMS,
      ['sec-1'],
      NOW
    );
    expect(result).toEqual(new Set());
  });

  it('boundary: publish_from == now and publish_until == now both count as active', () => {
    const pubs = [
      pub({
        section_id: 'sec-1',
        term_id: 't1',
        publish_from: new Date(NOW).toISOString(),
        publish_until: new Date(NOW + 1000).toISOString(),
      }),
      pub({
        section_id: 'sec-1',
        term_id: 't2',
        publish_from: new Date(NOW - 1000).toISOString(),
        publish_until: new Date(NOW).toISOString(),
      }),
    ];
    const result = computeActivePublishedTermNumbers(
      pubs,
      TERMS,
      ['sec-1'],
      NOW
    );
    expect(result).toEqual(new Set([1, 2]));
  });

  it('does not care about enrollment status — only takes section_ids, so a withdrawn student whose (withdrawn) section still has an active window still counts', () => {
    // The helper has no enrollment_status parameter at all. As long as the
    // withdrawn section's id is passed in sectionIds (which the route now
    // does unconditionally per KD #150), its active window resolves.
    const withdrawnSectionId = 'sec-withdrawn';
    const pubs = [pub({ section_id: withdrawnSectionId, term_id: 't3' })];
    const result = computeActivePublishedTermNumbers(
      pubs,
      TERMS,
      [withdrawnSectionId],
      NOW
    );
    expect(result).toEqual(new Set([3]));
  });

  it('a term_id with no matching terms row is silently skipped (not added as undefined/NaN)', () => {
    const pubs = [pub({ section_id: 'sec-1', term_id: 'unknown-term' })];
    const result = computeActivePublishedTermNumbers(
      pubs,
      TERMS,
      ['sec-1'],
      NOW
    );
    expect(result).toEqual(new Set());
  });
});

type Term = { id: string; term_number: number };
type Payload = PayloadLike<Term>;

function payload(): Payload {
  return {
    terms: [
      { id: 't1', term_number: 1 },
      { id: 't2', term_number: 2 },
      { id: 't3', term_number: 3 },
      { id: 't4', term_number: 4 },
    ],
    attendance: [
      { term_id: 't1' },
      { term_id: 't2' },
      { term_id: 't3' },
      { term_id: 't4' },
    ],
    comments: [{ term_id: 't1' }, { term_id: 't2' }, { term_id: 't3' }],
  };
}

describe('filterPayloadToActiveTerms', () => {
  it('requested termNumber matching an active window → that term only', () => {
    const result = filterPayloadToActiveTerms(payload(), new Set([1]));
    expect(result.terms.map((t) => t.term_number)).toEqual([1]);
    expect(result.attendance.map((a) => a.term_id)).toEqual(['t1']);
    expect(result.comments.map((c) => c.term_id)).toEqual(['t1']);
  });

  it('two active terms → both included, others excluded', () => {
    const result = filterPayloadToActiveTerms(payload(), new Set([1, 3]));
    expect(result.terms.map((t) => t.term_number).sort()).toEqual([1, 3]);
    expect(result.attendance.map((a) => a.term_id).sort()).toEqual([
      't1',
      't3',
    ]);
    expect(result.comments.map((c) => c.term_id).sort()).toEqual(['t1', 't3']);
  });

  it('empty active set → empty payload (never falls back to unfiltered)', () => {
    const result = filterPayloadToActiveTerms(payload(), new Set());
    expect(result.terms).toEqual([]);
    expect(result.attendance).toEqual([]);
    expect(result.comments).toEqual([]);
  });

  it('requested termNumber NOT in the active set → filters it out entirely', () => {
    // Mirrors the route calling filterPayloadToActiveTerms with
    // new Set([termNumber]) where termNumber never appeared in the
    // pre-checked active set — never leaks a term outside the active set.
    const result = filterPayloadToActiveTerms(payload(), new Set([99]));
    expect(result.terms).toEqual([]);
    expect(result.attendance).toEqual([]);
    expect(result.comments).toEqual([]);
  });

  it('preserves other payload fields untouched', () => {
    const withExtra = { ...payload(), studentName: 'Jane Doe' };
    const result = filterPayloadToActiveTerms(withExtra, new Set([2]));
    expect(result.studentName).toBe('Jane Doe');
  });
});
