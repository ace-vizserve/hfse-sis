/**
 * An excused absence with no reason is not a record of anything.
 *
 * The daily register has always refused to submit one — "Choose a reason for
 * each Excused student to submit" — but the term grid saves on every click
 * rather than at a submit step, so clicking Excused wrote a reasonless EX
 * immediately. That is a difference in plumbing, not in policy, and it showed:
 * of 2,516 EX rows on production, 2,511 carry no reason. (Almost all are the
 * AY2025 paper-register backfill, where the reason was never captured — which
 * is also why this is a UI rule and not a database constraint.)
 *
 * So the Excused tile opens the reasons; a reason saves the mark.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellMarkPalette } from '@/components/attendance/cell-mark-popover';

function setup(overrides: Partial<Parameters<typeof CellMarkPalette>[0]> = {}) {
  const onPick = vi.fn();
  render(
    <CellMarkPalette
      studentName="Reyes, Ana"
      dateLabel="7 Aug"
      status={null}
      exReason={null}
      exNote={null}
      canWriteNc={false}
      vlUsed={0}
      vlAllowance={1}
      compassionateUsed={0}
      compassionateAllowance={5}
      onPick={onPick}
      {...overrides}
    />
  );
  return { onPick, user: userEvent.setup() };
}

describe('the excused mark needs a reason', () => {
  it('saves nothing when Excused is clicked', async () => {
    const { onPick, user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    expect(
      onPick,
      'Clicking Excused must only open the reasons. Saving here is what put ' +
        '2,511 reasonless EX rows on the register.'
    ).not.toHaveBeenCalled();
  });

  it('reveals the reasons when Excused is clicked', async () => {
    const { user } = setup();
    expect(screen.queryByText('MC / Excuse leave')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    expect(screen.getByText('MC / Excuse leave')).toBeTruthy();
  });

  it('saves the mark and the reason together once a reason is picked', async () => {
    const { onPick, user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    await user.click(screen.getByRole('radio', { name: /Vacation leave/ }));
    expect(onPick).toHaveBeenCalledWith('EX', 'vacation');
  });

  it('says what is missing, and will not take a note yet', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Excused' }));

    // The note saves as part of the excused mark, so accepting one before a
    // reason exists would write the very row this guard prevents.
    const note = screen.getByLabelText('Note for Reyes, Ana on 7 Aug');
    expect((note as HTMLTextAreaElement).disabled).toBe(true);
    expect(
      screen.getByText('Choose a reason to mark this student excused.')
    ).toBeTruthy();
  });

  it('takes a note once the mark is complete', () => {
    setup({ status: 'EX', exReason: 'mc' });
    const note = screen.getByLabelText('Note for Reyes, Ana on 7 Aug');
    expect((note as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByText('Saves when you click away.')).toBeTruthy();
  });

  it('opens straight onto the reasons for a mark that is already excused', () => {
    setup({ status: 'EX', exReason: 'mc' });
    expect(screen.getByText('MC / Excuse leave')).toBeTruthy();
  });
});

describe('the other marks are unaffected', () => {
  it.each([
    ['Present', 'P'],
    ['Absent', 'A'],
    ['Late', 'L'],
  ])('%s saves on the first click', async (label, status) => {
    const { onPick, user } = setup();
    await user.click(screen.getByRole('radio', { name: label }));
    expect(onPick).toHaveBeenCalledWith(status, null);
  });

  it('does not re-save the mark that is already set', async () => {
    // A single-select ToggleGroup reports '' when you click the selected item.
    // Writing on that would append a duplicate row to an append-only ledger.
    const { onPick, user } = setup({ status: 'P' });
    await user.click(screen.getByRole('radio', { name: 'Present' }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
