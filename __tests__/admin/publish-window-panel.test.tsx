/**
 * Bespoke-error reference test for the PublishWindowPanel Tier-2 publish flow.
 *
 * The publish POST hard-gates on the server (KD #49/#120/#139). A 422 verdict
 * is NOT a generic error — it must surface a precise, plain-English message and
 * MUST NOT add a publication window:
 *   - 422 { code: 'publish_blocked', hardBlockers: [...] }
 *       → "Can't publish yet — <blocker labels>." and the window stays unset
 *   - clean publish (readiness OK + POST 200)
 *       → "Publication window saved" + the window list reloads
 *
 * These prove the 422 classification (read from ApiError.body) is preserved and
 * that a blocked section is never published, while a clean publish succeeds.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishWindowPanel } from '@/components/admin/publish-window-panel';
import { renderWithClient } from '../_utils/render-with-client';
import { jsonResponse, stubFetch } from '../_utils/mock-fetch';

const { refreshMock, toastSuccess, toastError } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/markbook/report-cards',
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

const TERMS = [{ id: 'term-1', term_number: 1, label: 'Term 1' }];

// A "clean" readiness verdict — no hard blockers, no soft gaps. With this,
// handlePublish skips the checklist dialog and goes straight to save().
function cleanReadiness() {
  return {
    grading_sheets: { total: 1, locked: 1, unlocked: [] },
    evaluations: { total_active: 1, submitted: 1, drafted: 0, missing: [] },
    attendance: { total_active: 1, complete: 1, missing: [] },
    t4_readiness: null,
    comment_gate: { ok: true, required_through_term: 1, gaps: [] },
    hardBlockers: [],
    softGaps: [],
    canPublish: true,
  };
}

function renderPanel() {
  return renderWithClient(
    <PublishWindowPanel
      sectionId="sec-1"
      sectionName="Patience"
      levelId="lvl-1"
      terms={TERMS}
    />
  );
}

// Open the inline editor for Term 1 (auto-populates from/until defaults) and
// click its Publish button to fire handlePublish → readiness → save.
async function openEditorAndPublish(user: ReturnType<typeof userEvent.setup>) {
  // The term row's first action button reads "Publish" (no existing window).
  const termRow = screen.getByText('Term 1').closest('li') as HTMLElement;
  await user.click(within(termRow).getByRole('button', { name: /^publish$/i }));
  // Editor appears; its action button also reads "Publish" — click the last one.
  const publishButtons = await screen.findAllByRole('button', {
    name: /^publish$/i,
  });
  await user.click(publishButtons[publishButtons.length - 1]);
}

describe('PublishWindowPanel (Tier-2 publish, 422 classification)', () => {
  it('classifies a 422 publish_blocked, surfaces the blocker labels, and does NOT publish', async () => {
    const user = userEvent.setup();
    stubFetch((input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/publish-readiness')) {
        return Promise.resolve(jsonResponse(cleanReadiness()));
      }
      if (url.includes('/report-card-publications') && method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              code: 'publish_blocked',
              error: 'publish blocked',
              hardBlockers: [
                { code: 'no_students', label: 'Section has no students' },
              ],
            },
            422
          )
        );
      }
      // publications GET (initial load + any reload) → empty list
      return Promise.resolve(jsonResponse({ publications: [] }));
    });

    renderPanel();
    // Wait for the initial publications load to settle (Publish button appears).
    await screen.findByText('Term 1');

    await openEditorAndPublish(user);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Can't publish yet — Section has no students."
      )
    );
    // The blocked section was never published → success toast never fired.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('publishes cleanly when readiness passes and the POST succeeds', async () => {
    const user = userEvent.setup();
    let reloaded = false;
    stubFetch((input, init) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/publish-readiness')) {
        return Promise.resolve(jsonResponse(cleanReadiness()));
      }
      if (url.includes('/report-card-publications') && method === 'POST') {
        return Promise.resolve(jsonResponse({ ok: true }, 200));
      }
      // The post-publish reload returns one active window; the initial load empty.
      if (url.includes('/report-card-publications')) {
        if (reloaded) {
          return Promise.resolve(
            jsonResponse({
              publications: [
                {
                  id: 'pub-1',
                  section_id: 'sec-1',
                  term_id: 'term-1',
                  publish_from: new Date().toISOString(),
                  publish_until: new Date(
                    Date.now() + 14 * 24 * 60 * 60 * 1000
                  ).toISOString(),
                  published_by: 'reg',
                  published_with_gaps: null,
                },
              ],
            })
          );
        }
        reloaded = true;
        return Promise.resolve(jsonResponse({ publications: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    renderPanel();
    await screen.findByText('Term 1');

    await openEditorAndPublish(user);

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Publication window saved')
    );
    expect(toastError).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
