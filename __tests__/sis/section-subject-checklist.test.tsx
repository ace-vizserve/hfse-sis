/**
 * Regression test for a review finding on `handleMotherTongueChange`
 * (`components/sis/section-subject-checklist.tsx`): its mutation is TWO
 * sequential requests (attach the new language, then detach the old one).
 * A partial failure (attach succeeds, detach throws — or vice versa) used
 * to only revert the LOCAL `attachedIds` snapshot in `onError`, silently
 * showing the pre-mutation state while the server's `section_subjects`
 * rows could have actually drifted to a state that violates "at most one
 * Mother Tongue language attached at a time" (e.g. both attached, or
 * neither) — masked until the next full page load.
 *
 * The fix adds `router.refresh()` to that `onError` handler so a partial
 * failure re-syncs the UI to server truth instead of hiding behind a
 * stale-but-clean-looking local snapshot. This mirrors the plain
 * attach/detach toggle mutations' existing `onSuccess` → `router.refresh()`
 * pattern (see `totals-editor.test.tsx` for the canonical Tier-2 shape),
 * extended to this compound mutation's error path specifically.
 *
 * Also asserts the plain per-subject toggle mutation's `onError` is
 * UNCHANGED (still reverts state only, no refresh) — the fix is scoped to
 * the Mother Tongue radio's compound mutation, not every rollback path in
 * this file.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SectionSubjectChecklist } from '@/components/sis/section-subject-checklist';
import type { SectionWithSubjectsRow } from '@/lib/sis/subjects/queries';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastError },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const baseSection: SectionWithSubjectsRow = {
  id: 'section-1',
  name: 'S3 - Discipline',
  levelId: 'level-s3',
  levelCode: 'S3',
  classType: null,
  studentCount: 20,
  subjects: [
    {
      subjectConfigId: 'cfg-fil',
      subjectId: 'subj-fil',
      code: 'FIL',
      name: 'Filipino',
      isExaminable: true,
      attached: true,
      recommended: null,
      offeredAtThisLevel: true,
    },
    {
      subjectConfigId: 'cfg-mandarin',
      subjectId: 'subj-mandarin',
      code: 'MANDARIN',
      name: 'Mandarin',
      isExaminable: true,
      attached: false,
      recommended: null,
      offeredAtThisLevel: true,
    },
    {
      subjectConfigId: 'cfg-eng',
      subjectId: 'subj-eng',
      code: 'ENG',
      name: 'English',
      isExaminable: true,
      attached: true,
      recommended: null,
      offeredAtThisLevel: true,
    },
  ],
};

describe('SectionSubjectChecklist — Mother Tongue mutation error path', () => {
  it('reverts local state AND refreshes the route on a partial attach/detach failure', async () => {
    const user = userEvent.setup();
    // Attach (POST) succeeds, the following detach (DELETE) fails — the
    // exact partial-failure shape the finding describes.
    const fetchSpy = stubFetch((_input, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE') {
        return Promise.resolve(
          jsonResponse({ error: 'could_not_detach' }, 500)
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    renderWithClient(
      <SectionSubjectChecklist section={baseSection} levelType="secondary" />
    );

    const mandarinRadio = screen.getByRole('radio', { name: /mandarin/i });
    await user.click(mandarinRadio);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // The core assertion: a partial failure must re-sync from the server,
    // not just quietly restore the local snapshot.
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Both requests were actually attempted (attach then detach).
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/sections/section-1/subjects',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/sections/section-1/subjects/cfg-fil',
      expect.objectContaining({ method: 'DELETE' })
    );

    // Local state reverted to pre-mutation (Filipino still shown attached).
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /filipino/i })).toBeChecked()
    );
    expect(mandarinRadio).not.toBeChecked();
  });

  it('does not refresh on a plain checkbox toggle failure (unchanged behavior)', async () => {
    const user = userEvent.setup();
    stubFetch(() =>
      Promise.resolve(jsonResponse({ error: 'could_not_update' }, 500))
    );

    renderWithClient(
      <SectionSubjectChecklist section={baseSection} levelType="secondary" />
    );

    const englishCheckbox = screen.getByRole('checkbox', {
      name: /english.*attached/i,
    });
    await user.click(englishCheckbox);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
