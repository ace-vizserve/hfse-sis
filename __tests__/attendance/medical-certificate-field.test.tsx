/**
 * The medical certificate, uploaded where the day is marked.
 *
 * Mr Ace: *"the simplest way is just allow the SIS users to upload the MC."*
 * A paper certificate handed in at the office used to end in a drawer with
 * nothing on the day; this is the control that puts it on the day instead.
 *
 * ⚠ WHAT THESE PIN IS THAT THERE IS ONE QUESTION AND ONE ENDPOINT. The person
 * using this is never asked whether a parent has already filed — they cannot
 * know, and the server decides (see
 * `__tests__/declarations/staff-medical-certificate.test.ts`). So every test
 * below sends the same request whatever is on record, and the component holds
 * no branch about it at all.
 *
 * ⚠ AND THAT A FAILED UPLOAD NEVER REPORTS A SAVED CERTIFICATE. The file goes
 * up separately and comes back as a path, so there are two requests behind one
 * button — the case worth pinning is the second one never being sent when the
 * first fails.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/dom';

import { MedicalCertificateField } from '@/components/attendance/medical-certificate-field';

// `useWriteAction` reaches `useRouter`, which throws outright with no app
// router mounted. Nothing here asserts on navigation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/attendance/section-1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', async () => ({
  toast: (await import('../_utils/mock-toast')).createToastMock(),
}));

const ENROLMENT = '11111111-1111-4111-8111-111111111111';
const DATE = '2026-09-02';

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[];

/** A JSON response `apiFetch` will accept. */
function json(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Queued replies, in the order the component makes its requests. */
let replies: Response[];

beforeEach(() => {
  calls = [];
  replies = [];
  global.fetch = vi.fn((input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = replies.shift();
    return Promise.resolve(next ?? json({}, 200));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

function setup(hasCertificate = false) {
  render(
    <MedicalCertificateField
      sectionStudentId={ENROLMENT}
      date={DATE}
      studentName="Reyes, Ana"
      hasCertificate={hasCertificate}
    />
  );
  return { user: userEvent.setup() };
}

const fileInput = () =>
  screen.getByLabelText(
    'Medical certificate file for Reyes, Ana'
  ) as HTMLInputElement;
const linkInput = () =>
  screen.getByLabelText('Link to the medical certificate for Reyes, Ana');
const saveButton = () => screen.getByRole('button', { name: /Save/i });

/** The filing request, parsed. Throws if it was never made. */
function filingBody(): Record<string, unknown> {
  const call = calls.find((c) => c.url === '/api/declarations/staff');
  if (!call) throw new Error('the filing request was never sent');
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

describe('proof can be a file or a link', () => {
  it('sends a link on its own, with no upload at all', async () => {
    // Singapore issues digital MCs as a URL. A control that demanded a file
    // would turn away the commonest modern certificate.
    replies = [json({ declaration: { id: 'd1' } }, 201)];
    const { user } = setup();

    await user.type(linkInput(), 'https://mc.gov.sg/abc123');
    await user.click(saveButton());

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toBe('/api/declarations/staff');
    expect(filingBody()).toMatchObject({
      sectionStudentId: ENROLMENT,
      // One day at a time on both surfaces.
      startDate: DATE,
      endDate: DATE,
      evidenceUrl: 'https://mc.gov.sg/abc123',
    });
    expect(filingBody().evidencePath).toBeUndefined();
  });

  it('uploads a file first and files the path it gets back', async () => {
    replies = [
      json({ path: 'declarations/staff/u-1/abc.pdf' }, 201),
      json({ declaration: { id: 'd1' } }, 201),
    ];
    const { user } = setup();

    await user.upload(
      fileInput(),
      new File(['%PDF-'], 'mc.pdf', { type: 'application/pdf' })
    );
    // The chosen file is named on screen before anything is sent — nobody
    // should have to click Save to find out what they picked.
    expect(screen.getByText('mc.pdf')).toBeTruthy();

    await user.click(saveButton());

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[0].url).toBe('/api/declarations/staff/evidence');
    // ⚠ NO `content-type` HEADER on the upload. The browser sets the multipart
    // boundary itself and naming the type here strips it.
    expect(calls[0].init?.headers).toBeUndefined();
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect(filingBody().evidencePath).toBe('declarations/staff/u-1/abc.pdf');
  });

  it('never files anything when the upload fails', async () => {
    // ⚠ TWO REQUESTS, ONE WRITE. A filing sent after a failed upload would
    // carry no evidence and be refused by the schema — but worse, a success
    // reported for a certificate that never landed is the exact failure the
    // whole write lifecycle exists to prevent.
    replies = [json({ error: 'Could not upload that file.' }, 500)];
    const { user } = setup();

    await user.upload(
      fileInput(),
      new File(['%PDF-'], 'mc.pdf', { type: 'application/pdf' })
    );
    await user.click(saveButton());

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls.some((c) => c.url === '/api/declarations/staff')).toBe(false);
    // The control stays open, with the file still chosen, so the retry is one
    // click rather than a re-pick.
    expect(screen.getByText('mc.pdf')).toBeTruthy();
  });
});

describe('what it refuses before it sends anything', () => {
  it('turns away a file that is not a certificate', async () => {
    setup();
    // `applyAccept: false` bypasses the browser's own `accept` filter so the
    // component's check is the thing under test — the filter is a convenience,
    // not a guard, and the upload route enforces the same list.
    fireEvent.change(fileInput(), {
      target: {
        files: [
          new File(['x'], 'notes.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        ],
      },
    });

    // ⚠ THE SERVER'S OWN SENTENCE, WORD FOR WORD. Two wordings for one rule is
    // how a person learns to distrust the message.
    expect(
      screen.getByText('Attach a PDF or a photo (JPG, PNG or WEBP).')
    ).toBeTruthy();
    expect(screen.queryByText('notes.docx')).toBeNull();
    expect(calls.length).toBe(0);
  });

  it('turns away a link that is not a web address', async () => {
    const { user } = setup();
    await user.type(linkInput(), 'mc.gov.sg/abc');
    await user.click(saveButton());

    expect(screen.getByText(/must start with https:\/\//)).toBeTruthy();
    expect(calls.length).toBe(0);
  });

  it('says what is missing when neither was given', async () => {
    // An empty save is the commonest mis-click, and a button that silently
    // does nothing reads as broken.
    const { user } = setup();
    await user.click(saveButton());

    expect(
      screen.getByText('Choose a file or paste a link first.')
    ).toBeTruthy();
    expect(calls.length).toBe(0);
  });
});

describe('once a certificate is on the day', () => {
  it('shows the record instead of the control', () => {
    // Whether a parent filed it or the office attached it, the answer to "is
    // there a certificate" is the same — so there is nothing left to offer.
    setup(true);
    expect(screen.getByText('Certificate on file')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Choose a file/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Save/i })).toBeNull();
  });

  it('becomes the record the moment the save lands', async () => {
    replies = [json({ declaration: { id: 'd1' } }, 201)];
    const { user } = setup();

    await user.type(linkInput(), 'https://mc.gov.sg/abc123');
    await user.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText('Certificate on file')).toBeTruthy()
    );
    expect(screen.queryByRole('button', { name: /Choose a file/i })).toBeNull();
  });

  it('says the same thing whether the server created or attached', async () => {
    // ⚠ ONE SENTENCE FOR BOTH OUTCOMES. Which branch the server took is not
    // something the person did, chose, or can act on — surfacing it would be
    // the branch this feature exists to avoid.
    replies = [json({ attached: true, declaration: { id: 'd-parent' } }, 200)];
    const { user } = setup();

    await user.type(linkInput(), 'https://mc.gov.sg/abc123');
    await user.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText('Certificate on file')).toBeTruthy()
    );
    expect(screen.queryByText(/parent/i)).toBeNull();
    expect(screen.queryByText(/attached/i)).toBeNull();
  });
});
