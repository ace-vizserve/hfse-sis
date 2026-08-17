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
        report_label: null,
      }}
      ayId={AY_UUID}
      ayCode="AY2026"
      subjects={[]}
    />
  );
}

// PercentField renders WW, PT, QA in that fixed order — no htmlFor/id
// association to the visible label, so DOM order is the reliable query.
// Index 0 is the "Report label" free-text field, which renders before the
// weights row in the Subject identity FieldRow — skip it.
function weightInputs() {
  const inputs = screen.getAllByRole('textbox');
  return { ww: inputs[1], pt: inputs[2], qa: inputs[3] };
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
