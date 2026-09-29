/**
 * Behavior test for SubjectConfigForm's create-mode DepEd default-weight
 * pre-fill: opening "Set weights" on a never-configured subject should
 * start the WW/PT/QA inputs at the DepEd-inferred split for that subject's
 * code (not blank), remain fully editable, and Save the edited values —
 * "default, but configurable," never a locked value.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubjectConfigForm } from '@/components/sis/subject-config-form';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
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

// Valid RFC4122 v4-shaped UUIDs — zod's .uuid() checks the version (4) and
// variant (8/9/a/b) nibbles, not just dash placement.
const SUBJECT_UUID = '11111111-1111-4111-8111-111111111111';
const AY_UUID = '22222222-2222-4222-8222-222222222222';

function renderCreate(code: string) {
  return renderWithClient(
    <SubjectConfigForm
      mode="create"
      subject={{
        id: SUBJECT_UUID,
        code,
        name: code,
        is_examinable: true,
        grading_method: 'standard_sheet',
      }}
      ayId={AY_UUID}
      ayCode="AY2026"
      subjects={[]}
    />
  );
}

// PercentField renders WW, PT, QA in that fixed order — no htmlFor/id
// association to the visible label, so DOM order is the reliable query.
function weightInputs() {
  // The subject name and the year's description come first (both modes);
  // the weights are the boxes after them.
  const name = screen.getByLabelText(/^subject name$/i);
  const inputs = screen
    .getAllByRole('textbox')
    .filter(
      (el) =>
        el !== name && !/ in AY\d{4}$/.test(el.getAttribute('aria-label') ?? '')
    );
  return { ww: inputs[0], pt: inputs[1], qa: inputs[2] };
}

/**
 * The WRITES this form made, in order — GETs filtered out.
 *
 * In edit mode the form mounts `<SubjectTermWeights/>`, which reads this
 * subject's per-term weights as soon as the drawer opens (migration 159). That
 * read is not what any test below is about, and it arrives first, so these
 * assertions select the call they mean by method rather than by position.
 * Indexing into `mock.calls[0]` made every test here hostage to the next read
 * anyone adds to the form.
 */
function writeCalls(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter(([, init]) => {
    const method = (init as RequestInit | undefined)?.method;
    return method != null && method !== 'GET';
  }) as [RequestInfo | URL, RequestInit | undefined][];
}

describe('SubjectConfigForm (create mode — DepEd default weights)', () => {
  it('pre-fills 30/50/20 for a Language-bucket subject code', () => {
    renderCreate('ENG');
    const { ww, pt, qa } = weightInputs();
    expect(ww).toHaveValue('30');
    expect(pt).toHaveValue('50');
    expect(qa).toHaveValue('20');
  });

  it('pre-fills 40/40/20 for a Math/Science-bucket subject code', () => {
    renderCreate('MATH');
    const { ww, pt, qa } = weightInputs();
    expect(ww).toHaveValue('40');
    expect(pt).toHaveValue('40');
    expect(qa).toHaveValue('20');
  });

  it('pre-fills 20/60/20 for a MAPEH-family subject code', () => {
    renderCreate('MAPEH');
    const { ww, pt, qa } = weightInputs();
    expect(ww).toHaveValue('20');
    expect(pt).toHaveValue('60');
    expect(qa).toHaveValue('20');
  });

  it('Save is enabled immediately on open, since the default already sums to 100', () => {
    renderCreate('ENG');
    expect(screen.getByRole('button', { name: /set weights/i })).toBeEnabled();
  });

  it('stays editable — an edited value is what gets saved, not the default', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ id: 'cfg-1' }))
    );
    renderCreate('ENG');

    const { ww, pt } = weightInputs();
    await user.clear(ww);
    await user.type(ww, '35');
    await user.clear(pt);
    await user.type(pt, '45');
    // qa stays at its 20 default — 35 + 45 + 20 = 100.

    await user.click(screen.getByRole('button', { name: /set weights/i }));

    // The success toast is the LAST step — it waits on the refresh, so waiting
    // for the refresh alone would race it.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/sis/admin/subjects',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"ww_weight":35'),
      })
    );
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ ww_weight: 35, pt_weight: 45, qa_weight: 20 });
  });

  it('does not toast an error when submitting the untouched default (it already sums to 100)', async () => {
    const user = userEvent.setup();
    stubFetch(() => Promise.resolve(jsonResponse({ id: 'cfg-1' })));
    renderCreate('MAPEH');

    await user.click(screen.getByRole('button', { name: /set weights/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });
});

/**
 * The subject's ONE name (2026-09-29, KD #203 update).
 *
 * Prefilled with the real catalogue name (not a placeholder) and saved on blur
 * through the CATALOGUE route (`subjects.name`, every year, audited as
 * subject.rename). There is no per-year name or report-card label any more.
 */
const CONFIG_UUID = '33333333-3333-4333-8333-333333333333';

function renderEdit() {
  return renderWithClient(
    <SubjectConfigForm
      mode="edit"
      draft={{
        configId: CONFIG_UUID,
        id: SUBJECT_UUID,
        code: 'MAPEH',
        name: 'MAPEH',
        is_examinable: true,
        grading_method: 'standard_sheet',
        ayCode: 'AY2026',
        ww_weight: 20,
        pt_weight: 60,
        qa_weight: 20,
        ww_max_slots: 5,
        pt_max_slots: 5,
        qa_max: 30,
        reportSubjectId: SUBJECT_UUID,
        description: null,
      }}
      subjects={[]}
    />
  );
}

function nameBox() {
  return screen.getByLabelText(/^subject name$/i);
}

function descriptionBox() {
  return screen.getByLabelText(/^description for MAPEH in AY2026$/i);
}

describe('SubjectConfigForm — one subject name', () => {
  it('shows the catalogue name as the value, not a placeholder', () => {
    renderEdit();
    expect(nameBox()).toHaveValue('MAPEH');
    expect(nameBox()).not.toHaveAttribute('placeholder');
  });

  it('has no per-year name or report card label box', () => {
    renderEdit();
    expect(screen.queryByLabelText(/report card name/i)).toBeNull();
    expect(screen.queryByLabelText(/^name for MAPEH in/i)).toBeNull();
  });

  it('saves a rename on blur to the catalogue route, name only', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit();

    await user.clear(nameBox());
    await user.type(nameBox(), 'STAR');
    await user.tab();

    await waitFor(() => expect(writeCalls(fetchSpy).length).toBeGreaterThan(0));
    const [url, init] = writeCalls(fetchSpy)[0];
    expect(url).toBe(`/api/sis/admin/subjects/catalog/${SUBJECT_UUID}`);
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'STAR',
    });
  });

  it('does not call the API when the name was not changed', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit();

    await user.click(nameBox());
    await user.tab();

    expect(writeCalls(fetchSpy)).toHaveLength(0);
  });

  it('puts a cleared name back instead of saving a blank', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit();

    await user.clear(nameBox());
    await user.tab();

    expect(nameBox()).toHaveValue('MAPEH');
    expect(writeCalls(fetchSpy)).toHaveLength(0);
    expect(toastError).toHaveBeenCalled();
  });

  it('puts the box back to the saved name when the save fails', async () => {
    const user = userEvent.setup();
    stubFetch(() => Promise.resolve(jsonResponse({ error: 'nope' }, 500)));
    renderEdit();

    await user.clear(nameBox());
    await user.type(nameBox(), 'Rhythm');
    await user.tab();

    await waitFor(() => expect(nameBox()).toHaveValue('MAPEH'));
  });

  it('is offered in create mode too, saved straight to the catalogue', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true, id: 'cfg-new' }))
    );
    renderCreate('MAPEH');

    expect(nameBox()).toHaveValue('MAPEH');
    await user.clear(nameBox());
    await user.type(nameBox(), 'STAR');
    await user.tab();

    await waitFor(() => expect(writeCalls(fetchSpy)).toHaveLength(1));
    const [url] = writeCalls(fetchSpy)[0] as [string, RequestInit];
    expect(url).toBe(`/api/sis/admin/subjects/catalog/${SUBJECT_UUID}`);
  });
});

/**
 * The year's description (migration 138) — the one per-year text field left.
 * It saves to the per-year config route; a field that posts to the wrong
 * endpoint still looks like it saved.
 */
describe('SubjectConfigForm (description in this academic year)', () => {
  it('saves the description on blur to the config route, with the SAVED weights', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit();

    await user.type(descriptionBox(), 'Sports, Talent, Arts and Rhythm');
    await user.tab();

    await waitFor(() => expect(writeCalls(fetchSpy).length).toBeGreaterThan(0));
    const [url, init] = writeCalls(fetchSpy)[0];
    expect(url).toBe(`/api/sis/admin/subjects/${CONFIG_UUID}`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      description: 'Sports, Talent, Arts and Rhythm',
      ww_weight: 20,
      pt_weight: 60,
      qa_weight: 20,
    });
    expect(body.display_name).toBeUndefined();
    expect(body.report_label).toBeUndefined();
  });

  it('create mode sends the description with the weights, and no per-year name', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true, id: 'cfg-new' }))
    );
    renderCreate('MAPEH');

    await user.type(
      screen.getByLabelText(/^description for MAPEH in/i),
      'Sports, Talent, Arts and Rhythm'
    );
    await user.tab();
    // Blur saves nothing in create mode — there is no row yet.
    expect(writeCalls(fetchSpy)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /set weights/i }));
    await waitFor(() => expect(writeCalls(fetchSpy)).toHaveLength(1));
    const [url, init] = writeCalls(fetchSpy)[0] as [string, RequestInit];
    expect(url).toBe('/api/sis/admin/subjects');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      description: 'Sports, Talent, Arts and Rhythm',
    });
    expect(body.display_name).toBeUndefined();
    expect(body.report_label).toBeUndefined();
  });
});
