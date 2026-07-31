import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ClassroomTimeline } from '@/components/classroom/classroom-timeline';
import type { TimelineEvent } from '@/lib/classroom/timeline';

let seq = 0;
const ev = (
  action: string,
  createdAt: string,
  context: Record<string, unknown> = {},
  actorEmail = 'ana@hfse.edu.sg'
): TimelineEvent => ({
  id: `e${(seq += 1)}`,
  action,
  actorEmail,
  context,
  createdAt,
});

const NAMES = {
  'ana@hfse.edu.sg': 'Ana Reyes',
  'joann@hfse.edu.sg': 'Joann Cruz',
};
const TODAY = '2026-07-31';

const renderTimeline = (events: TimelineEvent[]) =>
  render(
    <ClassroomTimeline
      events={events}
      actorNames={NAMES}
      todaySg={TODAY}
      limit={50}
    />
  );

describe('ClassroomTimeline', () => {
  it('collapses a run into one row carrying its count', () => {
    // The defect this replaced: seven identical rows, whose repetition became
    // the loudest thing on the page.
    renderTimeline([
      ev('evaluation.writeup.submit', '2026-07-31T06:41:00Z'),
      ev('evaluation.writeup.submit', '2026-07-31T06:39:00Z'),
      ev('evaluation.writeup.submit', '2026-07-31T06:37:00Z'),
    ]);
    expect(screen.getByText('×3')).toBeInTheDocument();
    // One row, not three.
    expect(screen.getAllByText('Write-up submitted')).toHaveLength(1);
  });

  it('expands a run to its individual entries on request', async () => {
    const user = userEvent.setup();
    renderTimeline([
      ev('evaluation.writeup.submit', '2026-07-31T06:41:00Z'),
      ev('evaluation.writeup.submit', '2026-07-31T06:39:00Z'),
    ]);
    const toggle = screen.getByRole('button', { name: /show 2 entries/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('button', { name: /hide entries/i })
    ).toBeInTheDocument();
  });

  it('shows no count or expander for a single event', () => {
    renderTimeline([ev('sheet.lock', '2026-07-31T01:05:00Z')]);
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /show \d+ entries/i })
    ).not.toBeInTheDocument();
  });

  it('names the actor instead of printing their email', () => {
    renderTimeline([ev('sheet.lock', '2026-07-31T01:05:00Z')]);
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByText('ana@hfse.edu.sg')).not.toBeInTheDocument();
  });

  it('falls back to the email when the actor is not a known staff member', () => {
    // A cron or a departed account must still render something truthful.
    renderTimeline([
      ev('sheet.lock', '2026-07-31T01:05:00Z', {}, 'ghost@hfse.edu.sg'),
    ]);
    expect(screen.getByText('ghost@hfse.edu.sg')).toBeInTheDocument();
  });

  // The humanizer returns '—' when a context carries nothing summarisable
  // (KD #121). A dash is not information.
  it('omits the detail line rather than printing a dash', () => {
    renderTimeline([ev('sheet.lock', '2026-07-31T01:05:00Z', {})]);
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('groups under Today and Yesterday headings', () => {
    renderTimeline([
      ev('entry.update', '2026-07-31T03:00:00Z'),
      ev('sheet.lock', '2026-07-30T03:00:00Z'),
    ]);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('counts events, not runs, in the day heading', () => {
    renderTimeline([
      ev('evaluation.writeup.submit', '2026-07-31T06:41:00Z'),
      ev('evaluation.writeup.submit', '2026-07-31T06:39:00Z'),
    ]);
    expect(screen.getByText('2 events')).toBeInTheDocument();
  });

  it('filters to one kind when a chip is pressed, and back off again', async () => {
    const user = userEvent.setup();
    renderTimeline([
      ev('entry.update', '2026-07-31T05:00:00Z', { field: 'ww_scores' }),
      ev('sheet.lock', '2026-07-31T01:00:00Z'),
    ]);
    expect(screen.getByText('Sheet locked')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Grades/ }));
    expect(screen.queryByText('Sheet locked')).not.toBeInTheDocument();

    // Pressing the active chip clears the filter rather than trapping the user.
    await user.click(screen.getByRole('button', { name: /^Grades/ }));
    expect(screen.getByText('Sheet locked')).toBeInTheDocument();
  });

  it('offers a chip only for kinds actually present', () => {
    renderTimeline([ev('sheet.lock', '2026-07-31T01:05:00Z')]);
    expect(screen.getByRole('button', { name: /^Sheets/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Write-ups/ })
    ).not.toBeInTheDocument();
  });

  it('shows the empty state when the class has no history', () => {
    renderTimeline([]);
    expect(
      screen.getByText('Nothing recorded for this class yet.')
    ).toBeInTheDocument();
  });

  it('marks the window as truncated only when it is full', () => {
    const { unmount } = renderTimeline([
      ev('sheet.lock', '2026-07-31T01:00:00Z'),
    ]);
    expect(screen.getByText(/Most recent 1$/)).toBeInTheDocument();
    unmount();

    const many = Array.from({ length: 50 }, (_, i) =>
      ev('sheet.lock', `2026-07-31T0${i % 9}:00:00Z`)
    );
    renderTimeline(many);
    expect(screen.getByText(/Most recent 50\+/)).toBeInTheDocument();
  });
});

describe('ClassroomTimeline — accessibility', () => {
  it('exposes the active filter as a pressed state', async () => {
    const user = userEvent.setup();
    renderTimeline([ev('sheet.lock', '2026-07-31T01:05:00Z')]);
    const all = screen.getByRole('button', { name: /^All/ });
    const sheets = screen.getByRole('button', { name: /^Sheets/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');

    await user.click(sheets);
    expect(sheets).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the kind readable without relying on the dot colour', () => {
    // Colour encodes kind on the spine, but the action name is text on every
    // row — never colour-only.
    renderTimeline([ev('sheet.lock', '2026-07-31T01:05:00Z')]);
    const row = screen.getByText('Sheet locked').closest('div');
    expect(within(row as HTMLElement).getByText('Sheet locked')).toBeVisible();
  });
});
