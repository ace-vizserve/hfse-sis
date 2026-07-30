import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReportCardDocument } from '@/components/report-card/report-card-document';
import type { ReportCardPayload } from '@/lib/report-card/build-report-card';

// The bug this file pins: the document renders form-adviser comment boxes for
// terms 1..min(viewingTermNumber, 3). Two call sites used to pin
// `viewingTermNumber` to 1 — a `?? 1` fallback when no term carried
// `is_current`, and an "Interim (T1–T3)" pill hardcoded to `?term=1` — so a
// student with live T1 AND T2 write-ups showed only T1, and T3 would have been
// invisible for the same reason.

const TERMS: ReportCardPayload['terms'] = [1, 2, 3, 4].map((n) => ({
  id: `term-${n}`,
  term_number: n,
  label: `Term ${n}`,
  virtue_theme: n === 2 ? 'Patience' : null,
  start_date: `2026-0${n}-01`,
  end_date: `2026-0${n}-28`,
}));

function payloadWithComments(): ReportCardPayload {
  return {
    ay: { id: 'ay-1', label: '2026' },
    terms: TERMS,
    student: {
      id: 'stu-1',
      student_number: 'S-0001',
      last_name: 'Tan',
      first_name: 'Amir',
      middle_name: null,
      full_name: 'Tan, Amir',
    },
    section: { id: 'sec-1', name: 'Obedience', form_class_adviser: 'Maria T.' },
    level: {
      id: 'lvl-1',
      code: 'P4',
      label: 'Primary 4',
      level_type: 'primary',
    },
    enrollment_status: 'active',
    subjects: [],
    attendance: [],
    comments: [
      { term_id: 'term-1', comment: 'Settled in well.', submitted: true },
      { term_id: 'term-2', comment: 'Reading has improved.', submitted: true },
      { term_id: 'term-3', comment: 'Consistent effort.', submitted: true },
    ],
    schoolConfig: {
      principalName: 'Dr. Santos',
      ceoName: 'Jane Lim',
    } as ReportCardPayload['schoolConfig'],
  };
}

function commentTexts() {
  return [
    'Settled in well.',
    'Reading has improved.',
    'Consistent effort.',
  ].filter((t) => screen.queryByText(t) != null);
}

describe('ReportCardDocument — form-adviser comment boxes', () => {
  it('renders only T1 when viewing term 1', () => {
    render(
      <ReportCardDocument
        payload={payloadWithComments()}
        viewingTermNumber={1}
      />
    );
    expect(commentTexts()).toEqual(['Settled in well.']);
  });

  // The regression: T2 exists and must appear once the viewed term is 2.
  it('renders T1 + T2 cumulatively when viewing term 2', () => {
    render(
      <ReportCardDocument
        payload={payloadWithComments()}
        viewingTermNumber={2}
      />
    );
    expect(commentTexts()).toEqual([
      'Settled in well.',
      'Reading has improved.',
    ]);
  });

  it('renders all three when viewing term 3', () => {
    render(
      <ReportCardDocument
        payload={payloadWithComments()}
        viewingTermNumber={3}
      />
    );
    expect(commentTexts()).toHaveLength(3);
  });

  it('renders none on the final (T4) card', () => {
    render(
      <ReportCardDocument
        payload={payloadWithComments()}
        viewingTermNumber={4}
      />
    );
    expect(commentTexts()).toEqual([]);
  });

  it("carries each term's own virtue theme in its heading", () => {
    render(
      <ReportCardDocument
        payload={payloadWithComments()}
        viewingTermNumber={2}
      />
    );
    expect(screen.getByText(/HFSE Virtues: Patience/)).toBeInTheDocument();
  });

  it('omits a term whose comment is blank rather than rendering an empty box', () => {
    const payload = payloadWithComments();
    payload.comments = [
      { term_id: 'term-1', comment: '   ', submitted: true },
      { term_id: 'term-2', comment: 'Reading has improved.', submitted: true },
    ];
    render(<ReportCardDocument payload={payload} viewingTermNumber={2} />);
    expect(commentTexts()).toEqual(['Reading has improved.']);
  });
});

describe('ReportCardDocument — unsubmitted drafts', () => {
  function withDraftT2(): ReportCardPayload {
    const payload = payloadWithComments();
    payload.comments = [
      { term_id: 'term-1', comment: 'Settled in well.', submitted: true },
      { term_id: 'term-2', comment: 'Reading has improved.', submitted: false },
    ];
    return payload;
  }

  // Deliverables (parent API, section batch print) leave showDrafts off.
  it('omits a draft by default', () => {
    render(
      <ReportCardDocument payload={withDraftT2()} viewingTermNumber={2} />
    );
    expect(commentTexts()).toEqual(['Settled in well.']);
    expect(screen.queryByText(/not submitted/i)).toBeNull();
  });

  // The staff preview turns it on, so an empty box always explains itself.
  it('renders a draft flagged when showDrafts is on', () => {
    render(
      <ReportCardDocument
        payload={withDraftT2()}
        viewingTermNumber={2}
        showDrafts
      />
    );
    expect(commentTexts()).toEqual([
      'Settled in well.',
      'Reading has improved.',
    ]);
    expect(screen.getByText(/Draft — not submitted/)).toBeInTheDocument();
  });

  it('never flags a submitted comment', () => {
    render(
      <ReportCardDocument
        payload={payloadWithComments()}
        viewingTermNumber={3}
        showDrafts
      />
    );
    expect(screen.queryByText(/not submitted/i)).toBeNull();
  });
});

describe('ReportCardDocument — comment boxes follow the terms it is given', () => {
  // The school-side card always receives every term for the year, so this only
  // pins the rule. The parent payload is narrowed to one term, and the earlier
  // terms' comments travel separately (see selectEarlierComments) rather than
  // through this component.
  it('renders only the terms present in the payload', () => {
    const payload = payloadWithComments();
    payload.terms = TERMS.filter((t) => t.term_number === 3);
    render(<ReportCardDocument payload={payload} viewingTermNumber={3} />);
    expect(commentTexts()).toEqual(['Consistent effort.']);
  });
});
