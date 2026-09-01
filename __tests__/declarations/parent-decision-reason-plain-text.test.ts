import { beforeEach, describe, expect, it, vi } from 'vitest';

// THE SECOND FREE-TEXT FIELD THE EXTERNAL PARENT PORTAL READS.
//
// When a filing is turned down, the parent is shown the approver's note — the
// only place a family learns that, say, a medical certificate was what was
// missing. The approver types that note on the staff decision sheet, which is
// now a rich-text editor, so the ladder stage holds HTML. The portal renders
// the string as text and we cannot redeploy it, so it has to leave here plain.
//
// `rejectionReasonFor` deliberately keeps returning the stored value: it
// answers "which stage holds the reason", staff surfaces reuse it, and only
// the parent-facing view strips.

const { ladders } = vi.hoisted(() => ({
  ladders: {
    value: new Map<string, { stages: Array<Record<string, unknown>> }>(),
  },
}));

vi.mock('@/lib/approvals/inbox', () => ({
  loadLaddersBySubject: async () => ladders.value,
}));

import {
  listParentDeclarations,
  type LinkedStudent,
} from '@/lib/declarations/parent';

const STUDENT: LinkedStudent = {
  studentNumber: 'S-0001',
  studentId: 'student-uuid',
  sectionStudentId: 'ss-uuid',
  sectionId: 'section-uuid',
  academicYearId: 'ay-uuid',
  displayName: 'Ravi Kumar',
  levelCode: 'P4',
  levelType: 'primary',
  sectionName: 'Diligence',
};

const ROW = {
  id: 'decl-1',
  filing_group_id: 'group-1',
  declaration_type: 'absence',
  student_id: 'student-uuid',
  start_date: '2026-09-01',
  end_date: '2026-09-02',
  with_medical: true,
  evidence_url: null,
  evidence_path: null,
  destination_country: null,
  destination_city: null,
  parent_note: 'He had a fever on Monday night.',
  status: 'rejected',
  created_at: '2026-09-01T00:00:00.000Z',
};

// Enough of a PostgREST builder for the one query this loader runs.
function fakeService(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'in', 'eq', 'order']) q[method] = () => q;
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return { from: () => q } as never;
}

beforeEach(() => {
  ladders.value = new Map();
});

describe('listParentDeclarations — decisionReason', () => {
  it('sends the approver note as plain text, not as markup', async () => {
    ladders.value.set('decl-1', {
      stages: [
        {
          status: 'rejected',
          decisionNote:
            '<p>We need a <strong>medical certificate</strong>.</p><p>Please upload one.</p>',
        },
      ],
    });

    const [view] = await listParentDeclarations(fakeService([ROW]), {
      students: [STUDENT],
    });

    expect(view.decisionReason).toBe(
      'We need a medical certificate.\nPlease upload one.'
    );
    expect(view.decisionReason).not.toContain('<');
  });

  it('treats an editor left empty as no reason given', async () => {
    ladders.value.set('decl-1', {
      stages: [{ status: 'rejected', decisionNote: '<p><br></p>' }],
    });

    const [view] = await listParentDeclarations(fakeService([ROW]), {
      students: [STUDENT],
    });

    expect(view.decisionReason).toBeNull();
  });

  it('leaves the parent own note exactly as they typed it', async () => {
    // ⚠ `parent_note` comes from the external portal's own plain text box and
    // never passes through our editor. Stripping it would only risk mangling
    // what a family wrote.
    ladders.value.set('decl-1', {
      stages: [{ status: 'rejected', decisionNote: '<p>No certificate.</p>' }],
    });

    const [view] = await listParentDeclarations(fakeService([ROW]), {
      students: [STUDENT],
    });

    expect(view.parentNote).toBe('He had a fever on Monday night.');
  });
});
