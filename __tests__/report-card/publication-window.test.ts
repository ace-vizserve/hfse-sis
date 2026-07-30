import { describe, it, expect } from 'vitest';
import {
  computeActivePublishedTermNumbers,
  computePublishedTermNumbers,
  filterPayloadToActiveTerms,
  selectEarlierComments,
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

describe('selectEarlierComments', () => {
  const FULL_TERMS = [
    { id: 't1', term_number: 1, label: 'Term 1', virtue_theme: 'Obedience' },
    { id: 't2', term_number: 2, label: 'Term 2', virtue_theme: null },
    { id: 't3', term_number: 3, label: 'Term 3', virtue_theme: 'Diligence' },
    { id: 't4', term_number: 4, label: 'Term 4', virtue_theme: 'Excellence' },
  ];

  function comment(
    term_id: string,
    over: Partial<{ comment: string | null; submitted: boolean }> = {}
  ) {
    return { term_id, comment: `${term_id} text`, submitted: true, ...over };
  }

  const ALL_OPENED = new Set([1, 2, 3, 4]);

  // The bug this fixes: a parent opening the Term 3 card saw only the Term 3
  // comment, though the adviser had written all three.
  it('returns the earlier terms, in order, with their own label and virtue', () => {
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t1'), comment('t2'), comment('t3')],
      ALL_OPENED,
      3
    );
    expect(result.map((c) => c.term_number)).toEqual([1, 2]);
    expect(result[0]).toEqual({
      term_id: 't1',
      term_number: 1,
      term_label: 'Term 1',
      virtue_theme: 'Obedience',
      comment: 't1 text',
    });
    // Self-describing: nothing needs looking up in `terms`.
    expect(result[1].term_label).toBe('Term 2');
    expect(result[1].virtue_theme).toBeNull();
  });

  // Must not overlap `comments`, which still carries the viewed term — the
  // portal would otherwise render the same box twice.
  it('excludes the viewed term itself', () => {
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t1'), comment('t2'), comment('t3')],
      ALL_OPENED,
      3
    );
    expect(result.map((c) => c.term_id)).not.toContain('t3');
  });

  it('returns nothing when viewing Term 1', () => {
    expect(
      selectEarlierComments(FULL_TERMS, [comment('t1')], ALL_OPENED, 1)
    ).toEqual([]);
  });

  // The final card has no form-adviser comment section at all (KD #49), so it
  // gets nothing — not "T1-T3". Returning them would invite the portal to
  // render a block the card isn't supposed to have.
  it('returns nothing when viewing the final (Term 4) card', () => {
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t1'), comment('t2'), comment('t3'), comment('t4')],
      ALL_OPENED,
      4
    );
    expect(result).toEqual([]);
  });

  it('never includes Term 4 itself when viewing an interim card', () => {
    // Defensive: term_number 4 can't be < 3, but the 1..3 bound is explicit so
    // a future Term 5 or a mis-numbered row can't leak in either.
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t1'), comment('t4')],
      ALL_OPENED,
      3
    );
    expect(result.map((c) => c.term_number)).toEqual([1]);
  });

  // Only re-shows what the parent was already shown once.
  it('excludes a term whose window has never opened', () => {
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t1'), comment('t2')],
      new Set([2, 3]), // term 1 never released
      3
    );
    expect(result.map((c) => c.term_number)).toEqual([2]);
  });

  it('excludes an unsubmitted draft', () => {
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t1', { submitted: false }), comment('t2')],
      ALL_OPENED,
      3
    );
    expect(result.map((c) => c.term_number)).toEqual([2]);
  });

  it('excludes blank and whitespace-only comments', () => {
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t1', { comment: '   ' }), comment('t2', { comment: null })],
      ALL_OPENED,
      3
    );
    expect(result).toEqual([]);
  });

  it('trims the returned text', () => {
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t1', { comment: '  well settled  ' })],
      ALL_OPENED,
      2
    );
    expect(result[0].comment).toBe('well settled');
  });

  it('skips a term with no write-up at all', () => {
    const result = selectEarlierComments(
      FULL_TERMS,
      [comment('t2')],
      ALL_OPENED,
      3
    );
    expect(result.map((c) => c.term_number)).toEqual([2]);
  });

  it('is order-independent on its inputs', () => {
    const reversed = [...FULL_TERMS].reverse();
    const result = selectEarlierComments(
      reversed,
      [comment('t2'), comment('t1')],
      ALL_OPENED,
      3
    );
    expect(result.map((c) => c.term_number)).toEqual([1, 2]);
  });
});

describe('computePublishedTermNumbers', () => {
  // Drops the upper bound only: an expired window still counts, because that
  // term was already delivered to this parent once.
  it('includes a term whose window has expired', () => {
    const pubs = [
      pub({
        section_id: 'sec-1',
        term_id: 't1',
        publish_from: '2020-01-01T00:00:00Z',
        publish_until: '2020-02-01T00:00:00Z',
      }),
    ];
    expect(computePublishedTermNumbers(pubs, TERMS, ['sec-1'], NOW)).toEqual(
      new Set([1])
    );
    // ...and is correctly NOT active.
    expect(
      computeActivePublishedTermNumbers(pubs, TERMS, ['sec-1'], NOW)
    ).toEqual(new Set());
  });

  // The distinction that makes "ever published" safe. Publishing upserts on
  // (section_id, term_id), so re-publishing a lapsed term REPLACES its dates
  // with future ones — treating that as "already delivered" would leak a
  // comment the coordinator deliberately scheduled for later.
  it('EXCLUDES a term whose window has not opened yet', () => {
    const pubs = [
      pub({
        section_id: 'sec-1',
        term_id: 't1',
        publish_from: '2030-01-01T00:00:00Z',
        publish_until: '2030-02-01T00:00:00Z',
      }),
    ];
    expect(computePublishedTermNumbers(pubs, TERMS, ['sec-1'], NOW)).toEqual(
      new Set()
    );
  });

  it('includes a term whose window is open right now', () => {
    const pubs = [pub({ section_id: 'sec-1', term_id: 't2' })];
    expect(computePublishedTermNumbers(pubs, TERMS, ['sec-1'], NOW)).toEqual(
      new Set([2])
    );
  });

  it('ignores publications for sections this student was never in', () => {
    const pubs = [pub({ section_id: 'other-section', term_id: 't1' })];
    expect(computePublishedTermNumbers(pubs, TERMS, ['sec-1'], NOW)).toEqual(
      new Set()
    );
  });

  it('skips a term_id with no matching terms row', () => {
    const pubs = [pub({ section_id: 'sec-1', term_id: 'unknown-term' })];
    expect(computePublishedTermNumbers(pubs, TERMS, ['sec-1'], NOW)).toEqual(
      new Set()
    );
  });
});
