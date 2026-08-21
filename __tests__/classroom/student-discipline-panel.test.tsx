/**
 * The Discipline surface of the Classroom student drawer (#7).
 *
 * THE ASSERTIONS THAT MATTER are the three a reviewer cannot check by looking:
 * that the two record types are told apart by colour and not just by wording,
 * that the parent acknowledgement is offered for a letter and CLEARED when the
 * record stops being one, and that Edit is only offered to someone the server
 * would actually let edit. The last two are silent failures otherwise — a
 * stranded acknowledgement fails the save with nothing on screen explaining
 * why, and an ungated Edit button answers 403 after the work is typed.
 */

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DisciplineRecordForm } from '@/components/classroom/discipline-record-form';
import { FileDisciplineRecordButton } from '@/components/classroom/file-discipline-record-button';
import {
  DisciplineList,
  StudentDisciplineTakeover,
} from '@/components/classroom/student-discipline-panel';
import type { DisciplineRecordRow } from '@/lib/discipline/queries';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';
import { renderWithClient } from '../_utils/render-with-client';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/classroom/sec-1/students',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', async () => ({
  toast: {
    ...(await import('../_utils/mock-toast')).createToastMock(),
    success: toastSuccess,
    error: toastError,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function row(over: Partial<DisciplineRecordRow> = {}): DisciplineRecordRow {
  return {
    id: 'rec-1',
    studentId: 'stu-1',
    studentNumber: 'H260127',
    studentName: 'Joaquin Bautista',
    sectionId: 'sec-1',
    className: 'Sec 1 Discipline 1',
    academicYearId: 'ay-1',
    ayCode: 'AY2026',
    recordType: 'incident',
    occurredOn: '2026-05-12',
    occurredAtTime: '14:05',
    nature: 'Pushing in the canteen queue',
    details: '',
    remarks: null,
    documentUrl: null,
    acknowledgedOn: null,
    filedBy: 'user-filer',
    filedByName: 'R. Fernandez',
    filedByOffice: null,
    createdAt: '2026-05-12T06:10:00Z',
    updatedAt: '2026-05-12T06:10:00Z',
    updatedBy: null,
    updatedByName: null,
    ...over,
  };
}

const LETTER = row({
  id: 'rec-2',
  recordType: 'letter',
  occurredOn: '2026-05-25',
  occurredAtTime: null,
  nature: 'First warning — attendance',
  acknowledgedOn: '2026-05-27',
  filedByName: 'Chandana Dileep',
  filedByOffice: 'Academics',
  documentUrl: 'https://hfse.sharepoint.com/docs/warning-1.pdf',
  details: 'Attendance for May fell below the school’s requirement.',
});

describe('the list', () => {
  it('reads as good news when there is nothing, not as a broken panel', () => {
    renderWithClient(
      <DisciplineList
        records={[]}
        isLoading={false}
        isError={false}
        onOpen={vi.fn()}
        onFile={vi.fn()}
      />
    );

    expect(screen.getByText('Nothing on record')).toBeInTheDocument();
    // The empty state still has to be a way IN — this is the state most
    // students are in, and it is where most filings will start.
    expect(
      screen.getByRole('button', { name: /file a record/i })
    ).toBeInTheDocument();
  });

  it('tells the two kinds of record apart by colour, not only by wording', () => {
    renderWithClient(
      <DisciplineList
        records={[LETTER, row()]}
        isLoading={false}
        isError={false}
        onOpen={vi.fn()}
        onFile={vi.fn()}
      />
    );

    // A letter is the school escalating, so it takes the destructive recipe; an
    // incident is a recorded fact, so it takes the informational one. Scanning
    // a year, three indigo chips then a red one is the whole argument for one
    // list rather than two.
    expect(screen.getByText('Letter sent').className).toContain(
      'text-destructive'
    );
    expect(screen.getByText('Incident').className).toContain(
      'text-brand-indigo-deep'
    );
  });

  it('says when the signed slip came back, and stays quiet when it has not', () => {
    renderWithClient(
      <DisciplineList
        records={[LETTER, row()]}
        isLoading={false}
        isError={false}
        onOpen={vi.fn()}
        onFile={vi.fn()}
      />
    );

    expect(
      screen.getByText(/Chandana Dileep · Slip back 27 May/)
    ).toBeInTheDocument();
    // An incident has nothing to acknowledge, so it must not carry the phrase
    // at all — "Slip back —" would read as something outstanding.
    expect(screen.getByText('Filed by R. Fernandez')).toBeInTheDocument();
  });

  it('opens the record from the nature line', async () => {
    const onOpen = vi.fn();
    renderWithClient(
      <DisciplineList
        records={[row()]}
        isLoading={false}
        isError={false}
        onOpen={onOpen}
        onFile={vi.fn()}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Pushing in the canteen queue' })
    );
    expect(onOpen).toHaveBeenCalledWith('rec-1');
  });
});

describe('who may correct a record', () => {
  function detail(viewerUserId: string, canManageAnyDiscipline: boolean) {
    return renderWithClient(
      <StudentDisciplineTakeover
        sectionId="sec-1"
        studentNumber="H260127"
        records={[LETTER]}
        view={{ mode: 'detail', recordId: 'rec-2' }}
        onView={vi.fn()}
        viewerUserId={viewerUserId}
        canManageAnyDiscipline={canManageAnyDiscipline}
      />
    );
  }

  it('offers Edit to the person who filed it', () => {
    detail('user-filer', false);
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('offers Edit to leadership', () => {
    detail('someone-else', true);
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('withholds Edit from another teacher', () => {
    // The route answers this case with a 403 sentence. Offering the button
    // anyway would spend a teacher's typing before telling them.
    detail('someone-else', false);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('shows a letter still waiting on its slip as waiting, not as blank', () => {
    renderWithClient(
      <StudentDisciplineTakeover
        sectionId="sec-1"
        studentNumber="H260127"
        records={[{ ...LETTER, acknowledgedOn: null }]}
        view={{ mode: 'detail', recordId: 'rec-2' }}
        onView={vi.fn()}
        viewerUserId="user-filer"
        canManageAnyDiscipline={false}
      />
    );

    const rows = screen.getByText('Slip back').parentElement!;
    expect(within(rows).getByText('Not yet')).toBeInTheDocument();
  });

  it('does not ask about a slip on an incident', () => {
    renderWithClient(
      <StudentDisciplineTakeover
        sectionId="sec-1"
        studentNumber="H260127"
        records={[row()]}
        view={{ mode: 'detail', recordId: 'rec-1' }}
        onView={vi.fn()}
        viewerUserId="user-filer"
        canManageAnyDiscipline={false}
      />
    );

    expect(screen.queryByText('Slip back')).toBeNull();
  });
});

describe('the form', () => {
  it('names the link for what it is, and changes with the type', async () => {
    // Mr Ace, 2026-08-21: the record is filed, the document is sent, and the
    // ACKNOWLEDGED copy is attached here afterwards. That holds for both kinds
    // — the slip a parent signed, or the acknowledged incident report — so
    // only the wording changes with the type, never the meaning.
    renderWithClient(
      <DisciplineRecordForm
        sectionId="sec-1"
        studentNumber="H260127"
        record={null}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByText('Link to the acknowledged incident report')
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /letter sent/i }));
    expect(
      await screen.findByText('Link to the signed slip')
    ).toBeInTheDocument();
    // The field above already owns the timing — two helper lines 30px apart
    // both saying "leave blank until it comes back" was the first draft, and
    // this assertion is what caught it.
    expect(
      screen.getByText('Where the signed copy is saved.')
    ).toBeInTheDocument();
  });

  it('asks about the parent slip only when the record is a letter', async () => {
    renderWithClient(
      <DisciplineRecordForm
        sectionId="sec-1"
        studentNumber="H260127"
        record={null}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByText(/returned the signed slip/i)).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: /letter sent/i }));
    expect(
      await screen.findByText(/returned the signed slip/i)
    ).toBeInTheDocument();
  });

  it('clears the acknowledgement when a letter is changed to an incident', async () => {
    // The schema refine AND a CHECK both refuse an acknowledged incident, so a
    // value left behind the hidden field would fail the save with nothing on
    // screen to explain it. This is the assertion for that.
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true, id: 'rec-2' }))
    );
    renderWithClient(
      <DisciplineRecordForm
        sectionId="sec-1"
        studentNumber="H260127"
        record={LETTER}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('radio', { name: /incident/i }));
    await waitFor(() =>
      expect(screen.queryByText(/returned the signed slip/i)).toBeNull()
    );
    await userEvent.click(
      screen.getByRole('button', { name: /save changes/i })
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      '/api/classroom/sec-1/students/H260127/discipline/rec-2'
    );
    expect(init?.method).toBe('PATCH');
    const body = JSON.parse(String(init?.body));
    expect(body.record_type).toBe('incident');
    expect(body.acknowledged_on).toBeNull();
  });

  it('says the record was filed, not just that the request returned', async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true, id: 'rec-2' })));
    renderWithClient(
      <DisciplineRecordForm
        sectionId="sec-1"
        studentNumber="H260127"
        record={LETTER}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: /save changes/i })
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Changes saved')
    );
  });

  it('repeats the server’s own sentence when it refuses', async () => {
    // The PATCH 403 names exactly who may fix the record. Flattening it into
    // "Failed to save" would leave the reader with nowhere to go.
    stubFetch(() =>
      Promise.resolve(
        jsonResponse(
          {
            error:
              'Only the person who filed this record, or a school leader, can change it.',
          },
          403
        )
      )
    );
    renderWithClient(
      <DisciplineRecordForm
        sectionId="sec-1"
        studentNumber="H260127"
        record={LETTER}
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: /save changes/i })
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Only the person who filed this record, or a school leader, can change it.'
      )
    );
  });
});

describe('filing from the class page', () => {
  const STUDENTS = [
    {
      studentNumber: 'H260127',
      studentName: 'Bautista, Joaquin P.',
      indexNumber: 2,
    },
    { studentNumber: 'H260140', studentName: 'Reyes, Ana', indexNumber: 7 },
  ];

  function open() {
    renderWithClient(
      <FileDisciplineRecordButton
        sectionId="sec-1"
        sectionName="Sec 1 Discipline 1"
        students={STUDENTS}
      />
    );
    return userEvent.click(
      screen.getByRole('button', { name: /file a record/i })
    );
  }

  it('asks which student before it asks anything else', async () => {
    await open();
    // A record is always about one child, and this is the one surface that
    // does not already have one open — so the student step cannot be skipped.
    expect(await screen.findByText('Who is this about?')).toBeInTheDocument();
    expect(screen.getByText('Bautista, Joaquin P.')).toBeInTheDocument();
    expect(screen.queryByText('What is this?')).toBeNull();
  });

  it('hands the chosen student to the same form the drawer uses', async () => {
    await open();
    await userEvent.click(await screen.findByText('Reyes, Ana'));

    // The header becomes the student, and the body becomes the ordinary
    // filing form — not a second, parallel one.
    expect(await screen.findByText('What is this?')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /file record/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/No\. 7 · H260140/)).toBeInTheDocument();
  });
});
