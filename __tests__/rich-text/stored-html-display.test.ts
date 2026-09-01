import { describe, it, expect } from 'vitest';

import {
  buildDeclarationEvents,
  buildGradeChangeEvents,
} from '@/lib/activity/events';
import type { RequestLadder } from '@/lib/approvals/inbox';
import { auditContextSummary } from '@/lib/audit/humanize';

/**
 * EVERY MULTI-LINE BOX IN THIS APP IS A FORMATTING EDITOR NOW, so the columns
 * behind them hold HTML. A surface that prints one of those columns as text
 * shows the reader `<p>Because she was ill</p>` — the markup, not the note.
 *
 * These are the surfaces where the formatting must NOT show, and the reason is
 * the same one every time: the value is going somewhere that renders text and
 * nothing else — a one-line summary, a `title` attribute, a quotation inside a
 * sentence, a CSV cell, a table row that has to keep its height.
 *
 * The surfaces on the other side of the call (the approval page's teacher
 * reason, the adviser's term comment, a stage's remarks, a document revision
 * note) render through `<RichText>` and are covered by the component tests
 * that already exist for it — there is nothing to assert here about a string
 * that is deliberately passed through untouched.
 */

// ── The activity feed and the approval history dialog ────────────────────────

const NAMES = new Map([['u-adviser', 'Radhika Putrevu']]);

function ladderWithNote(note: string | null): RequestLadder {
  return {
    requestId: 'req-1',
    flow: 'student_declaration',
    subjectType: 'student_declaration',
    subjectId: 'dec-1',
    status: 'approved',
    currentStageOrder: 1,
    filedByEmail: 'parent@example.com',
    filedAt: '2026-08-24T00:12:00.000Z',
    decidedAt: '2026-08-24T01:40:00.000Z',
    stages: [
      {
        stageOrder: 1,
        label: 'Form class adviser',
        resolver: 'form_adviser',
        status: 'approved',
        sectionId: 'sec-1',
        approverPool: [],
        decidedBy: 'u-adviser',
        decidedByEmail: 'radhika.putrevu@hfse.edu.sg',
        decidedAt: '2026-08-24T01:40:00.000Z',
        decisionNote: note,
      },
    ],
  } as RequestLadder;
}

function declarationDetails(note: string | null) {
  const events = buildDeclarationEvents({
    ladder: ladderWithNote(note),
    subjectLabel: 'a travel request',
    viewerId: 'u-someone',
    nameById: NAMES,
    registerWrittenAt: null,
    registerDaysWritten: null,
    registerWriteError: null,
  });
  return events.find((e) => e.id.includes(':step:'))?.details ?? null;
}

describe('activity events — a decision note is carried as plain text', () => {
  it('strips the markup off a declaration decision note', () => {
    const details = declarationDetails(
      '<p>Approved. The flights are <strong>already booked</strong>.</p>'
    );

    expect(details).toEqual([
      {
        kind: 'note',
        text: 'Approved. The flights are already booked.',
      },
    ]);
  });

  it('flattens a list into lines rather than emitting <li>', () => {
    const details = declarationDetails(
      '<ul><li>Flights booked</li><li>Work covered</li></ul>'
    );

    expect(details?.[0]).toEqual({
      kind: 'note',
      text: 'Flights booked\nWork covered',
    });
  });

  it('treats an editor the approver opened and cleared as no note at all', () => {
    // ⚠ `<p></p>` is seven truthy characters. The old truthiness test put an
    // empty quotation — `“”` — on the timeline and in the feed.
    expect(declarationDetails('<p></p>')).toBeNull();
  });

  it('strips a mark-change decision note the same way', () => {
    const events = buildGradeChangeEvents({
      id: 'cr-1',
      fieldChanged: 'qa_score',
      slotIndex: null,
      currentValue: '18',
      proposedValue: '22',
      studentLabel: 'Aarav Sharma',
      requestedById: 'u-teacher',
      requestedByEmail: 'grace.lim@hfse.edu.sg',
      requestedAt: '2026-08-20T01:00:00.000Z',
      status: 'approved',
      reviewedById: 'u-adviser',
      reviewedByEmail: 'radhika.putrevu@hfse.edu.sg',
      reviewedAt: '2026-08-21T01:00:00.000Z',
      decisionNote: '<p>Checked against the <em>original</em> script.</p>',
      secondaryReviewedById: null,
      secondaryReviewedByEmail: null,
      secondaryReviewedAt: null,
      secondaryDecision: null,
      appliedById: null,
      appliedAt: null,
      viewerId: 'u-someone',
      nameById: NAMES,
      href: '/markbook/grading/requests',
    });

    const reviewed = events.find((e) => e.id.endsWith(':reviewed'));
    expect(reviewed?.details).toEqual([
      { kind: 'note', text: 'Checked against the original script.' },
    ]);
  });
});

// ── The audit log's one-line summaries ──────────────────────────────────────

describe('audit summaries — never print the markup', () => {
  it('flattens a rich-text key reached through the GENERIC tail', () => {
    // ⚠ THIS IS THE ONE THAT WAS ACTUALLY BROKEN, and it is the important
    // case. `auditContextSummary` has a bespoke branch per action, but every
    // action without one falls through to a generic "prettify the remaining
    // scalars" pass — which printed `Rejection Reason: <p>…</p>` verbatim for
    // any action nobody had written a branch for. Fixing only the three
    // branches that name a rich-text key would have left that open, and left
    // it open for every action added later.
    const summary = auditContextSummary(
      'grade_change_requested' as Parameters<typeof auditContextSummary>[0],
      {
        rejection_reason:
          '<p>The <strong>original script</strong> says 18.</p>',
      }
    );

    expect(summary).toContain('The original script says 18.');
    expect(summary).not.toContain('<');
  });

  it('flattens the reason on a rejected document', () => {
    const summary = auditContextSummary('sis.document.reject', {
      slot_key: 'passport',
      new_status: 'Rejected',
      rejection_reason: '<p>Expired — please send the <u>renewed</u> one.</p>',
    });

    expect(summary).toContain('Expired — please send the renewed one.');
    expect(summary).not.toContain('<');
  });

  it('flattens the notes on a removed teaching assignment', () => {
    const summary = auditContextSummary('assignment.delete', {
      teacher_name: 'Ms Koh',
      role: 'subject_teacher',
      subject_name: 'Mathematics',
      section_name: 'P5 Tenacity',
      change_reason: 'other',
      change_notes: '<p>Swapped with <strong>Ms Lim</strong>.</p>',
    });

    expect(summary).toContain('Swapped with Ms Lim.');
    expect(summary).not.toContain('<');
  });

  it('leaves a value that was never HTML exactly as it was', () => {
    // The columns predate the editor, so most stored reasons are bare
    // sentences. A bare sentence must survive the round trip unchanged —
    // otherwise this fix would rewrite every historical audit row.
    const summary = auditContextSummary('assignment.delete', {
      teacher_name: 'Ms Koh',
      change_reason: 'other',
      change_notes: 'Swapped with Ms Lim for the STEM pilot.',
    });

    expect(summary).toContain('Swapped with Ms Lim for the STEM pilot.');
  });
});
