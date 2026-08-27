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
import { cleanup, render, screen } from '@testing-library/react';
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

/**
 * The 2026-08-27 redesign. Mr Ace: *"i personally dont like this"*, then
 * *"like a modern UI"*. The panel became one segmented track over a hairline
 * rule instead of boxes inside boxes — but the rules above are unchanged, and
 * every test in this file predates the rebuild and still passes.
 */
describe('the segmented track', () => {
  it('hides No class from a teacher and shows it to a registrar', () => {
    setup({ canWriteNc: false });
    expect(screen.queryByRole('radio', { name: 'No class' })).toBeNull();

    cleanup();
    setup({ canWriteNc: true });
    expect(screen.getByRole('radio', { name: 'No class' })).toBeTruthy();
  });

  it('saves No class on the first click, like any other mark', async () => {
    const { onPick, user } = setup({ canWriteNc: true });
    await user.click(screen.getByRole('radio', { name: 'No class' }));
    expect(onPick).toHaveBeenCalledWith('NC', null);
  });

  it('says a plain mark saves immediately, and stops saying so once Excused opens', async () => {
    const { user } = setup();
    expect(screen.getByText('Saves as soon as you pick.')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    expect(screen.queryByText('Saves as soon as you pick.')).toBeNull();
  });
});

describe('quotas read as what is left, not as a fraction', () => {
  it('counts down the remaining allowance', async () => {
    const { user } = setup({ vlUsed: 0, vlAllowance: 1 });
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    // "0/1 term" was the smallest grey text on the old panel. It is the one
    // warning that has to land BEFORE the click.
    expect(screen.getByText('1 left')).toBeTruthy();
  });

  it('says none left when the allowance is spent', async () => {
    const { user } = setup({ compassionateUsed: 5, compassionateAllowance: 5 });
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    expect(screen.getByText('none left')).toBeTruthy();
  });

  it('still lets a spent reason be picked — the quota warns, it does not block', async () => {
    // Nobody has said an over-quota excusal is forbidden, and a teacher facing
    // a real sixth compassionate day must be able to record it.
    const { onPick, user } = setup({
      compassionateUsed: 5,
      compassionateAllowance: 5,
    });
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    await user.click(screen.getByRole('radio', { name: /Urgent/ }));
    expect(onPick).toHaveBeenCalledWith('EX', 'compassionate');
  });

  it('shows no allowance against a medical certificate', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    expect(
      screen.getByRole('radio', { name: 'MC / Excuse leave' })
    ).toBeTruthy();
  });
});

describe('a day a parent filed for', () => {
  const FILING = {
    dateRange: '27–31 Aug 2026',
    kind: 'absence' as const,
    hasEvidence: true,
    approvedBy: 'Ms Lhen Mendoza',
    href: '/attendance/declarations?filing=abc',
  };

  // An approved family holiday. It writes `EX` / `vacation` exactly as an
  // absence writes `EX` / `mc`, so it must reach this panel the same way —
  // it did not, for a whole day, and the consequence was not cosmetic: with
  // no filing on the cell the override confirmation never fired at all.
  const TRAVEL_FILING = {
    dateRange: '27 Aug – 3 Sep 2026',
    kind: 'travel' as const,
    // Always false for travel; the schema forbids a holiday carrying evidence.
    hasEvidence: false,
    approvedBy: 'Ms Elaine Wee',
    href: '/attendance/declarations?req=xyz',
  };

  it('says so in one line, and links to the filing', () => {
    setup({ status: 'EX', exReason: 'mc', filing: FILING });
    expect(screen.getByText(/Excused by a parent's filing/)).toBeTruthy();
    expect(screen.getByText(/27–31 Aug 2026/)).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe(FILING.href);
  });

  it('keeps the panel to one line about the filing', () => {
    // Mr Ace, on the five-line version: "then the popover content will have
    // many details its hard to read". Who approved it and what an override
    // does both moved into the confirmation, where they are the reason to
    // stop and think rather than badges nobody reads at rest.
    setup({ status: 'EX', exReason: 'mc', filing: FILING });
    expect(screen.queryByText(/Approved by/)).toBeNull();
    expect(screen.queryByText(/won't change what the parent sent/)).toBeNull();
  });

  it('replaces the note field rather than sitting beside it', () => {
    // The parent's own note is on the filing. Asking the teacher to write a
    // second explanation under the first is how the two end up disagreeing.
    setup({ status: 'EX', exReason: 'mc', filing: FILING });
    expect(screen.queryByLabelText('Note for Reyes, Ana on 7 Aug')).toBeNull();
  });

  it('asks before overriding a day the school approved', async () => {
    const { onPick, user } = setup({
      status: 'EX',
      exReason: 'mc',
      filing: FILING,
    });
    await user.click(screen.getByRole('radio', { name: 'Absent' }));

    expect(
      onPick,
      'Nothing may be written until the teacher answers.'
    ).not.toHaveBeenCalled();
    expect(screen.getByText(/Ms Lhen Mendoza approved this day/)).toBeTruthy();
    // ⚠ The WHOLE sentence, spaces included. A regex starting at "won't"
    // matches "absentwon't" just as happily — JSX drops the space around an
    // expression that sits at the end of a line, and the mark name is an
    // expression in the middle of this sentence.
    expect(
      screen.getByText('Marking it absent won’t change what the parent sent.')
    ).toBeTruthy();
  });

  it('writes the new mark once confirmed', async () => {
    const { onPick, user } = setup({
      status: 'EX',
      exReason: 'mc',
      filing: FILING,
    });
    await user.click(screen.getByRole('radio', { name: 'Absent' }));
    await user.click(screen.getByRole('button', { name: /Mark absent/i }));
    expect(onPick).toHaveBeenCalledWith('A', null);
  });

  it('leaves the day excused when the teacher backs out', async () => {
    const { onPick, user } = setup({
      status: 'EX',
      exReason: 'mc',
      filing: FILING,
    });
    await user.click(screen.getByRole('radio', { name: 'Absent' }));
    await user.click(screen.getByRole('button', { name: /Keep excused/i }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/Excused by a parent's filing/)).toBeTruthy();
  });

  it('asks on the keyboard shortcut too', async () => {
    // A guard only the mouse respects is not a guard — the letter keys exist
    // precisely so a teacher can move fast without looking.
    const { onPick, user } = setup({
      status: 'EX',
      exReason: 'mc',
      filing: FILING,
    });
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    await user.keyboard('a');
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/approved this day as excused/)).toBeTruthy();
  });

  it('does not ask when the teacher excused the day themselves', async () => {
    // No filing covers this day, so there is nothing to override and the
    // question would be noise. Asking routinely is how a warning stops working.
    const { onPick, user } = setup({ status: 'EX', exReason: 'mc' });
    await user.click(screen.getByRole('radio', { name: 'Absent' }));
    expect(onPick).toHaveBeenCalledWith('A', null);
  });

  it('does not ask when the day is not excused yet', async () => {
    const { onPick, user } = setup({ status: 'P', filing: FILING });
    await user.click(screen.getByRole('radio', { name: 'Absent' }));
    expect(onPick).toHaveBeenCalledWith('A', null);
  });

  it('states the absence of proof rather than leaving it blank', () => {
    // A parent may file without a certificate. A teacher reading only
    // "excused by a filing" would assume one exists.
    setup({
      status: 'EX',
      exReason: 'mc',
      filing: { ...FILING, hasEvidence: false },
    });
    expect(screen.getByText(/no certificate/)).toBeTruthy();
  });

  it('stays out of the way on a day nobody filed for', () => {
    setup({ status: 'EX', exReason: 'mc' });
    expect(screen.queryByText('A parent filed for this day')).toBeNull();
    expect(screen.getByLabelText('Note for Reyes, Ana on 7 Aug')).toBeTruthy();
  });

  // ── an approved family holiday ─────────────────────────────────────────
  //
  // Travel was excluded from `loadCellFilingsForSection` on the reasoning that
  // it "marks nothing" — true for a few hours on 2026-08-27, and false from
  // the moment KD #199 shipped. The filter outlived its reason, and nothing
  // caught it because every test here filed an absence.

  it('names a holiday as a holiday, and never mentions a certificate', () => {
    // ⚠ "no certificate" would be a lie of a particular kind: it implies a
    // document is missing, when a holiday has none to give.
    setup({ status: 'EX', exReason: 'vacation', filing: TRAVEL_FILING });
    expect(
      screen.getByText(/Excused by a parent's travel filing/)
    ).toBeTruthy();
    expect(screen.getByText(/27 Aug – 3 Sep 2026/)).toBeTruthy();
    expect(screen.queryByText(/certificate/)).toBeNull();
  });

  it('asks before overriding an approved holiday', async () => {
    // THE REASON THIS FIX MATTERS. Without the filing on the cell the guard
    // never fires, so a teacher could overwrite a holiday two people approved
    // with no warning whatsoever.
    const { onPick, user } = setup({
      status: 'EX',
      exReason: 'vacation',
      filing: TRAVEL_FILING,
    });
    await user.click(screen.getByRole('radio', { name: 'Absent' }));

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/Ms Elaine Wee approved this day/)).toBeTruthy();
  });

  it('asks on the keyboard shortcut for a holiday too', async () => {
    const { onPick, user } = setup({
      status: 'EX',
      exReason: 'vacation',
      filing: TRAVEL_FILING,
    });
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    await user.keyboard('a');
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/approved this day as excused/)).toBeTruthy();
  });
});
