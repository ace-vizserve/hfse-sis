/**
 * A failed drill fetch used to render its "Couldn't load…" retry card as a
 * bare <div> — outside any <SheetContent>. Rendered from the *drillSheet*
 * slot of a MetricCard (a <Sheet>, no visible trigger click needed in these
 * tests since the parent always renders with `open`), that bare div painted
 * inline under the chart instead of sliding in as the side panel every other
 * drill state (loading skeleton, loaded rows) uses.
 *
 * Fixed by wrapping the error body in the sheet's own `<SheetContent>` (the
 * same shape `DrillSheetSkeleton` already used) so a fetch failure keeps
 * every drill state in the panel, not the page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(async () => {
    throw new Error('network down');
  }),
}));
vi.mock('@/lib/query/fetcher', () => ({ apiFetch }));

import { AdmissionsDrillSheet } from '@/components/admissions/drills/admissions-drill-sheet';
import { FeedbackRatingDrillSheet } from '@/components/admissions/drills/feedback-rating-drill-sheet';
import { Sheet } from '@/components/ui/sheet';

function renderInSheet(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* Every drill state — loading, loaded, error — is a SheetContent, so
          it needs its Sheet, exactly like the loading-skeleton tests do. */}
      <Sheet open>{children}</Sheet>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('AdmissionsDrillSheet — failed fetch', () => {
  it('renders the retry card inside the sheet panel, not a bare div beside it', async () => {
    renderInSheet(
      <AdmissionsDrillSheet
        target="funnel-stage"
        segment="Submitted"
        ayCode="AY2026"
      />
    );

    const retryHeading = await screen.findByText(/Couldn.t load/);
    const dialog = screen.getByRole('dialog');
    // The error body is a DESCENDANT of the sheet's dialog panel — not a
    // sibling rendered outside it.
    expect(within(dialog).getByText(retryHeading.textContent!)).toBe(
      retryHeading
    );
    expect(
      screen.getByRole('button', { name: /Try again/ })
    ).toBeInTheDocument();
  });
});

describe('FeedbackRatingDrillSheet — failed fetch', () => {
  it('renders the retry card inside the sheet panel, not a bare div beside it', async () => {
    renderInSheet(<FeedbackRatingDrillSheet ayCode="AY2026" segment={null} />);

    const retryHeading = await screen.findByText(/Couldn.t load these ratings/);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(retryHeading.textContent!)).toBe(
      retryHeading
    );
    expect(
      screen.getByRole('button', { name: /Try again/ })
    ).toBeInTheDocument();
  });
});
