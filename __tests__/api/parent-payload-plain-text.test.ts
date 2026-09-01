import { beforeEach, describe, expect, it, vi } from 'vitest';

// THE PARENT PORTAL IS A SEPARATE APP WE DO NOT OWN AND CANNOT REDEPLOY.
//
// It reads `payload.comments[].comment` — the form-class adviser's write-up —
// and renders it as text. The adviser now writes that write-up in the
// rich-text editor, so `evaluation_writeups.writeup` holds HTML. Ship the HTML
// and every parent sees `<p><strong>` wrapped around what was written about
// their child, with no release on our side able to fix it.
//
// The same applies to `decisionReason` on a declaration: it is the approver's
// note, typed on the staff decision sheet, and the portal shows it to the
// family whose filing was turned down.
//
// These two fields are the whole of the external contract that carries prose.
// Nothing else the parent API returns has ever been through a text box in this
// app — names, class labels, dates, level codes and file paths are all values
// we composed.

const FORMATTED_WRITEUP =
  '<p><strong>Ravi</strong> has settled in well.</p>' +
  '<p>He leads group work with real care.</p>';

const { fakes } = vi.hoisted(() => ({
  fakes: {
    tables: {} as Record<string, unknown[]>,
    reportCard: null as unknown,
  },
}));

vi.mock('@/lib/supabase/service', () => {
  // A query builder that ignores every filter and answers from `tables`. The
  // route's authorisation is exercised elsewhere; what is under test here is
  // the shape of what leaves.
  const makeQuery = (table: string) => {
    const rows = fakes.tables[table] ?? [];
    const result = { data: rows, error: null };
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
      q[method] = () => q;
    }
    q.single = async () => ({ data: rows[0] ?? null, error: null });
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return q;
  };
  return {
    createServiceClient: () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: 'parent-user', email: 'parent@example.com' } },
          error: null,
        }),
      },
      from: (table: string) => makeQuery(table),
    }),
  };
});

vi.mock('@/lib/supabase/admissions', () => ({
  getAllStudentsByParentEmail: async () => [{ student_number: 'S-0001' }],
}));

vi.mock('@/lib/report-card/build-report-card', () => ({
  buildReportCard: async () => fakes.reportCard,
}));

import { GET } from '@/app/api/parent/v2/report-card/route';

const TERMS = [
  { id: 'term-1', term_number: 1, label: 'Term 1', virtue_theme: 'Courage' },
  { id: 'term-2', term_number: 2, label: 'Term 2', virtue_theme: 'Patience' },
];

function request(termNumber: number) {
  return new Request(
    `https://sis.hfse.edu.sg/api/parent/v2/report-card?studentId=00000000-0000-0000-0000-000000000001&termNumber=${termNumber}`,
    { headers: { authorization: 'Bearer token' } }
  );
}

type Payload = {
  comments: Array<{ term_id: string; comment: string | null }>;
  earlierComments: Array<{ term_id: string; comment: string }>;
};

async function fetchPayload(termNumber: number): Promise<Payload> {
  const res = await GET(request(termNumber));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { payload: Payload };
  return body.payload;
}

beforeEach(() => {
  const now = Date.now();
  const window = {
    publish_from: new Date(now - 86_400_000).toISOString(),
    publish_until: new Date(now + 86_400_000).toISOString(),
  };
  fakes.tables = {
    students: [{ id: 'student-uuid', student_number: 'S-0001' }],
    section_students: [{ section_id: 'section-1' }],
    report_card_publications: [
      { id: 'p1', section_id: 'section-1', term_id: 'term-1', ...window },
      { id: 'p2', section_id: 'section-1', term_id: 'term-2', ...window },
    ],
    terms: [
      { id: 'term-1', term_number: 1 },
      { id: 'term-2', term_number: 2 },
    ],
  };
  fakes.reportCard = {
    ok: true,
    payload: {
      terms: TERMS,
      attendance: [],
      subjects: [],
      comments: [
        { term_id: 'term-1', comment: FORMATTED_WRITEUP, submitted: true },
        { term_id: 'term-2', comment: FORMATTED_WRITEUP, submitted: true },
      ],
    },
  };
});

describe('parent report-card payload', () => {
  it('ships the viewed term comment as plain text', async () => {
    const payload = await fetchPayload(2);

    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0].comment).toBe(
      'Ravi has settled in well.\nHe leads group work with real care.'
    );
    expect(payload.comments[0].comment).not.toContain('<');
  });

  it('ships the earlier terms comments as plain text too', async () => {
    // Term 1's write-up travels in its own list (KD #129) and goes out through
    // a different line of code, so it needs its own guard.
    const payload = await fetchPayload(2);

    expect(payload.earlierComments).toHaveLength(1);
    expect(payload.earlierComments[0].term_id).toBe('term-1');
    expect(payload.earlierComments[0].comment).toBe(
      'Ravi has settled in well.\nHe leads group work with real care.'
    );
    expect(payload.earlierComments[0].comment).not.toContain('<');
  });

  it('flattens a bulleted write-up into readable lines', async () => {
    (
      fakes.reportCard as { payload: { comments: unknown[] } }
    ).payload.comments = [
      {
        term_id: 'term-2',
        comment:
          '<ul><li><p>Leads group work</p></li><li><p>Written fluency</p></li></ul>',
        submitted: true,
      },
    ];

    const payload = await fetchPayload(2);
    expect(payload.comments[0].comment).toBe(
      'Leads group work\nWritten fluency'
    );
  });

  it('drops an earlier comment that is an empty editor rather than sending a blank one', async () => {
    // `selectEarlierComments` rejects a blank write-up by trimming the stored
    // string — and `'<p></p>'.trim()` is seven characters, so it survives that
    // test and only strips to nothing afterwards.
    (
      fakes.reportCard as { payload: { comments: unknown[] } }
    ).payload.comments = [
      { term_id: 'term-1', comment: '<p></p>', submitted: true },
      { term_id: 'term-2', comment: FORMATTED_WRITEUP, submitted: true },
    ];

    const payload = await fetchPayload(2);
    expect(payload.earlierComments).toHaveLength(0);
  });

  it('keeps a missing write-up missing rather than turning it into an empty string', async () => {
    // The portal branches on the comment being absent. `toPlainText(null)`
    // returns '', so a blanket map would have quietly changed that branch.
    (
      fakes.reportCard as { payload: { comments: unknown[] } }
    ).payload.comments = [
      { term_id: 'term-2', comment: null, submitted: true },
    ];

    const payload = await fetchPayload(2);
    expect(payload.comments[0].comment).toBeNull();
  });
});
