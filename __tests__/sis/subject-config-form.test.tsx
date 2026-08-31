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
//
// CREATE mode renders no free-text field before them: all three per-year
// fields (name, report-card name, description) need a subject_configs row and
// a subject being created has none. So the weights are the first textboxes on
// the form.
function weightInputs() {
  const inputs = screen.getAllByRole('textbox');
  return { ww: inputs[0], pt: inputs[1], qa: inputs[2] };
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
 * Edit mode — the per-year subject name (migration 137).
 *
 * The school renamed MAPEH to STAR for AY2026 and AY2025 must keep saying
 * MAPEH, so this box writes to THIS year's subject_configs row and nothing
 * else. Two behaviours are pinned because both fail silently:
 *
 *   • The save carries the SAVED weights, never what is currently typed in the
 *     weight boxes. Someone can be mid-edit on a weight when they tab out of
 *     the name field, and a rename must not commit a number they had not
 *     finished. Sending the stored values is also what puts the route on its
 *     rename-only path — no grading-sheet resync, no weights_confirmed flip.
 *   • Clearing the box sends '' so the route can drop the override and go back
 *     to the catalogue name.
 */
const CONFIG_UUID = '33333333-3333-4333-8333-333333333333';

function renderEdit(displayName: string | null) {
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
        display_name: displayName,
        report_label: null,
        description: null,
      }}
      subjects={[]}
    />
  );
}

// ANCHORED. "Report card name for MAPEH in AY2026" also contains "name for
// MAPEH in AY2026", so an unanchored pattern matches two inputs and the query
// throws rather than picking one.
function nameBox() {
  return screen.getByLabelText(/^name for MAPEH in AY2026$/i);
}

function reportLabelBox() {
  return screen.getByLabelText(/^report card name for MAPEH in AY2026$/i);
}

function descriptionBox() {
  return screen.getByLabelText(/^description for MAPEH in AY2026$/i);
}

// EDIT mode renders THREE free-text fields ahead of the weights — the "In
// AY2026" group: subject name, name on the report card, and what it stands
// for. So the weights start three further along than in create mode.
//
// (Getting this wrong is not subtle in a good way: an earlier version of this
// helper typed a weight into the report-label box and saved it to the
// catalogue route. Positional queries are used because PercentField's visible
// label has no htmlFor/id association to its input.)
function editWeightInputs() {
  const inputs = screen.getAllByRole('textbox');
  return { ww: inputs[3], pt: inputs[4], qa: inputs[5] };
}

describe('SubjectConfigForm (edit mode — name in this academic year)', () => {
  it('starts blank when the subject has no per-year name, showing the catalogue name as the placeholder', () => {
    renderEdit(null);
    expect(nameBox()).toHaveValue('');
    expect(nameBox()).toHaveAttribute('placeholder', 'MAPEH');
  });

  it('seeds from the stored name when one is already set', () => {
    renderEdit('STAR');
    expect(nameBox()).toHaveValue('STAR');
  });

  it('saves on blur, sending the SAVED weights rather than what is typed in the weight boxes', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit(null);

    // Half-finished weight edit — 7 alone does not sum to 100 and was never
    // saved. It must not ride along with the rename.
    const { ww } = editWeightInputs();
    await user.clear(ww);
    await user.type(ww, '7');
    expect(ww).toHaveValue('7');

    await user.type(nameBox(), 'STAR');
    await user.tab();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/sis/admin/subjects/${CONFIG_UUID}`);
    expect((init as RequestInit).method).toBe('PATCH');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      display_name: 'STAR',
      ww_weight: 20,
      pt_weight: 60,
      qa_weight: 20,
      ww_max_slots: 5,
      pt_max_slots: 5,
      qa_max: 30,
    });
  });

  it('sends an empty name when the box is cleared, so the override is dropped', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit('STAR');

    await user.clear(nameBox());
    await user.tab();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      display_name: '',
    });
  });

  it('does not call the API when the name was not touched', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit('STAR');

    await user.click(nameBox());
    await user.tab();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('puts the box back to the saved name when the save fails', async () => {
    const user = userEvent.setup();
    stubFetch(() => Promise.resolve(jsonResponse({ error: 'nope' }, 500)));
    renderEdit('STAR');

    await user.clear(nameBox());
    await user.type(nameBox(), 'Rhythm');
    await user.tab();

    await waitFor(() => expect(nameBox()).toHaveValue('STAR'));
  });

  it('is not offered in create mode — a per-year name needs this year’s row', () => {
    renderCreate('MAPEH');
    expect(screen.queryByLabelText(/name for MAPEH in/i)).toBeNull();
  });
});

/**
 * Edit mode — the other two per-year fields (migration 138).
 *
 * `report_label` used to live on `subjects`, with no academic year on it at
 * all, and the form saved it through the CATALOGUE route. Both facts changed:
 * it is per year now, and it saves through the same subject_configs PATCH the
 * name does. `description` is new.
 *
 * The route is what these pin — a field that posts to the wrong endpoint still
 * looks like it saved.
 */
describe('SubjectConfigForm (edit mode — report card name and description)', () => {
  it('offers all three per-year fields, and none of them in create mode', () => {
    renderEdit(null);
    expect(nameBox()).toBeInTheDocument();
    expect(reportLabelBox()).toBeInTheDocument();
    expect(descriptionBox()).toBeInTheDocument();
  });

  it('saves the report card name to the config route, not the catalogue route', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit(null);

    await user.type(reportLabelBox(), 'Mother Tongue');
    await user.tab();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    // The catalogue route would be /catalog/<subjectId>. This must be the
    // per-year config route.
    expect(url).toBe(`/api/sis/admin/subjects/${CONFIG_UUID}`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      report_label: 'Mother Tongue',
      // Saved weights ride along untouched, same as for the name.
      ww_weight: 20,
      pt_weight: 60,
      qa_weight: 20,
    });
    // The other two per-year fields are NOT sent — an unsent field means
    // "don't touch", and naming them here would clear them.
    expect(body.display_name).toBeUndefined();
    expect(body.description).toBeUndefined();
  });

  it('saves the description to the config route', async () => {
    const user = userEvent.setup();
    const fetchSpy = stubFetch(() =>
      Promise.resolve(jsonResponse({ ok: true }))
    );
    renderEdit(null);

    await user.type(descriptionBox(), 'Sports, Talent, Arts and Rhythm');
    await user.tab();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/sis/admin/subjects/${CONFIG_UUID}`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      description: 'Sports, Talent, Arts and Rhythm',
    });
    expect(body.report_label).toBeUndefined();
  });

  it('shows the year name as the report-card placeholder, so the default is visible', () => {
    // Leaving the report-card box blank means "print what everything else
    // shows". The placeholder says so by BEING that value.
    renderEdit('STAR');
    expect(reportLabelBox()).toHaveAttribute('placeholder', 'STAR');
  });
});
