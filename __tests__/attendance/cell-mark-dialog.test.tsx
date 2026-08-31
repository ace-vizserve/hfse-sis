/**
 * An excused absence with no reason is not a record of anything.
 *
 * The daily register has always refused to submit one — "Choose a reason for
 * each Excused student to submit" — but the term grid saves on every click
 * rather than at a submit step, so clicking Excused wrote a reasonless EX
 * immediately. That is a difference in plumbing, not in policy, and it showed:
 * of 2,516 EX rows on production, 2,511 carry no reason.
 *
 * So the Excused tile opens the reasons; a reason saves the mark.
 *
 * ── The container changed on 2026-08-31 and the rules did not ─────────────
 *
 * Mr Ace: *"its not a sheet its a dialog"*. The marking palette moved out of a
 * popover into a centred dialog — nothing about WHAT it saves moved with it,
 * which is why every test below predates the move and still passes. The three
 * that changed are the NC ones (the mark is gone from the track) and the note's
 * label (the header now writes the date out in full).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellMarkDialog } from '@/components/attendance/cell-mark-dialog';

// The excused body now carries the medical-certificate control, and its write
// lifecycle (`useWriteAction`) reaches `useRouter` — which throws outright
// without an app router mounted. Same three-line stub the daily-register suite
// uses; nothing below asserts on navigation.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/attendance/section-1',
  useSearchParams: () => new URLSearchParams(),
}));

// The long date the grid now passes — see `cellDateLabel` in wide-grid.tsx.
const DATE_LABEL = 'Friday, 7 August 2026';
const NOTE_LABEL = `Note for Reyes, Ana on ${DATE_LABEL}`;

function setup(overrides: Partial<Parameters<typeof CellMarkDialog>[0]> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CellMarkDialog
      open
      onOpenChange={onOpenChange}
      studentName="Reyes, Ana"
      sectionStudentId="11111111-1111-4111-8111-111111111111"
      date="2026-08-07"
      indexNumber={12}
      dateLabel={DATE_LABEL}
      status={null}
      exReason={null}
      exNote={null}
      vlUsed={0}
      vlAllowance={1}
      compassionateUsed={0}
      compassionateAllowance={5}
      onPick={onPick}
      {...overrides}
    />
  );
  return { onPick, onOpenChange, user: userEvent.setup() };
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
    const note = screen.getByLabelText(NOTE_LABEL);
    expect((note as HTMLTextAreaElement).disabled).toBe(true);
    expect(
      screen.getByText('Choose a reason to mark this student excused.')
    ).toBeTruthy();
  });

  it('takes a note once the mark is complete', () => {
    setup({ status: 'EX', exReason: 'mc' });
    const note = screen.getByLabelText(NOTE_LABEL);
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
  it('says a plain mark saves immediately, and stops saying so once Excused opens', async () => {
    const { user } = setup();
    expect(screen.getByText('Saves as soon as you pick.')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    expect(screen.queryByText('Saves as soon as you pick.')).toBeNull();
  });

  it('names the student and writes the day out in full', () => {
    // The dialog is no longer anchored to the cell it came from, so the header
    // is the only thing confirming WHICH student and WHICH day is being
    // marked. The roster number is how teachers actually address a student
    // (KD: index_number), so it travels with the name.
    setup();
    expect(screen.getByRole('heading', { name: 'Reyes, Ana' })).toBeTruthy();
    expect(screen.getByText(`No. 12 · ${DATE_LABEL}`)).toBeTruthy();
  });
});

/**
 * "No class" left the track on 2026-08-31.
 *
 * Mr Ace: *"there is no NC type of attendance mark"*. A day the class did not
 * meet belongs to the school calendar, not to a student's row — the register
 * card above the grid already links to the page that sets it.
 *
 * ⚠ THE TWO HALVES OF THIS ARE DIFFERENT CLAIMS. Removing a way to PICK a mark
 * is not removing a way to SHOW one, and the second would be data loss on
 * screen: imports, holidays and not-yet-enrolled rows have written real NC
 * rows. The display half is proved in `wide-grid-nc-cell.test.tsx`, against the
 * grid that actually paints them.
 */
describe('no class is not a mark a person picks', () => {
  it('is nowhere on the track, and no longer answers its keyboard shortcut', async () => {
    const { onPick, user } = setup();

    expect(screen.queryByRole('radio', { name: 'No class' })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(4);

    // "n" used to stamp NC. It must now do nothing at all rather than fall
    // through to some other mark.
    await user.click(screen.getByRole('radio', { name: 'Present' }));
    onPick.mockClear();
    await user.keyboard('n');
    expect(onPick).not.toHaveBeenCalled();
  });
});

/**
 * The certificate slot — the second reason this stopped being a popover, and
 * live since 2026-08-31.
 *
 * Mr Ace: *"the simplest way is just allow the SIS users to upload the MC."*
 * The band is a real control now, and what these pin is WHEN it is offered.
 * The control's own behaviour has its own suite
 * (`__tests__/attendance/medical-certificate-field.test.tsx`).
 */
describe('the medical certificate slot', () => {
  it('appears on a day that is marked excused', () => {
    setup({ status: 'EX', exReason: 'mc' });
    expect(screen.getByText('Medical certificate')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Choose a file/i })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Save certificate/i })
    ).toBeTruthy();
  });

  it('does NOT appear merely because Excused was clicked', async () => {
    // ⚠ ARMING EXCUSED IS NOT MARKING IT. Clicking the segment only opens the
    // reasons; nothing is on record until one is picked, and offering to
    // attach proof to a day carrying no mark is the reasonless EX the note
    // field is disabled to prevent.
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Excused' }));
    expect(screen.queryByText('Medical certificate')).toBeNull();
  });

  it('is replaced by the record once a certificate is on the day', () => {
    // Whether the parent filed it or the office attached it, the answer to
    // "is there a certificate" is the same — so the empty control goes.
    setup({
      status: 'EX',
      exReason: 'mc',
      filing: {
        dateRange: '7 Aug 2026',
        kind: 'absence',
        hasEvidence: true,
        approvedBy: 'Ms Lhen Mendoza',
        recordedBySchool: false,
        href: '/attendance/declarations?req=r1',
      },
    });
    expect(screen.getByText('Certificate on file')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Choose a file/i })).toBeNull();
  });

  it('is absent on a family holiday, which cannot carry one', () => {
    // `student_declarations_type_shape_chk` forbids evidence on a travel row
    // outright, so the band is absent rather than present-and-refusing — the
    // same absence-only rule FilingCard follows.
    setup({
      status: 'EX',
      exReason: 'vacation',
      filing: {
        dateRange: '24–27 Aug 2026',
        kind: 'travel',
        hasEvidence: false,
        approvedBy: 'Ms Lhen Mendoza',
        recordedBySchool: false,
        href: '/attendance/declarations?req=r2',
      },
    });
    expect(screen.queryByText('Medical certificate')).toBeNull();
  });

  it('stays out of the way of a plain mark', async () => {
    // Nine marks in ten are "P". The rare case must not set the size of the
    // common one — that was the 2026-08-27 note and it survives the move.
    const { user } = setup();
    await user.click(screen.getByRole('radio', { name: 'Present' }));
    expect(screen.queryByText('Medical certificate')).toBeNull();
  });
});

/**
 * Undoing a mark — migration 134.
 *
 * A clear is not a fifth thing on the track. It is the way out of a choice
 * already made, so it sits in the dialog's footer, stays quieter than the four
 * marks, and does not exist at all on a cell nobody has marked.
 */
describe('clearing a mark', () => {
  it('is not offered on a cell that has no mark', () => {
    // An action that does nothing is worse than no action — and here it would
    // sit on the panel a teacher meets most often, the empty one.
    setup({ status: null });
    expect(screen.queryByRole('button', { name: /Clear mark/i })).toBeNull();
  });

  it('is offered once the cell carries a mark', () => {
    setup({ status: 'P' });
    expect(screen.getByRole('button', { name: /Clear mark/i })).toBeTruthy();
  });

  it('sends a null status carrying no reason and no note', async () => {
    // ⚠ The three nulls are the contract, not tidiness:
    // `attendance_daily_cleared_has_no_reason_chk` refuses a cleared row that
    // still holds an excuse, so a reason surviving here is a 500 in the grid.
    const { onPick, user } = setup({ status: 'EX', exReason: 'mc' });
    await user.click(screen.getByRole('button', { name: /Clear mark/i }));
    expect(onPick).toHaveBeenCalledWith(null, null, null);
  });

  it('replaces the "saves as soon as you pick" line rather than stacking on it', () => {
    // Two lines of micro-copy in one footer is the clutter the 2026-08-27
    // redesign was asked to remove. The reader of "saves as soon as you pick"
    // is someone who has not picked yet.
    setup({ status: 'P' });
    expect(screen.queryByText('Saves as soon as you pick.')).toBeNull();
    expect(screen.getByText('Returns the day to unmarked.')).toBeTruthy();
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
    // A PARENT filed this one. The school's own certificate uploads set this
    // true and are shown differently — see the group below.
    recordedBySchool: false,
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
    recordedBySchool: false,
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
    //
    // ⚠ THE DIALOG'S EXTRA ROOM IS NOT AN INVITATION TO PUT THEM BACK. It
    // went to the note and the certificate slot, which are things a teacher
    // does — not to detail they only read past.
    setup({ status: 'EX', exReason: 'mc', filing: FILING });
    expect(screen.queryByText(/Approved by/)).toBeNull();
    expect(screen.queryByText(/won't change what the parent sent/)).toBeNull();
  });

  it('replaces the note field rather than sitting beside it', () => {
    // The parent's own note is on the filing. Asking the teacher to write a
    // second explanation under the first is how the two end up disagreeing.
    setup({ status: 'EX', exReason: 'mc', filing: FILING });
    expect(screen.queryByLabelText(NOTE_LABEL)).toBeNull();
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

  it('asks inside the dialog it is already in, never in a second one', async () => {
    // ⚠ NESTED DIALOGS ARE A STANDING NO on this project: the two focus traps
    // fight, and dismissing the inner one can dismiss both. The confirmation
    // takes over the body of this dialog instead — which is also why the mark
    // track and the footer are gone while the question is up. One dialog, one
    // question, one way out.
    const { user } = setup({ status: 'EX', exReason: 'mc', filing: FILING });
    await user.click(screen.getByRole('radio', { name: 'Absent' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('radio', { name: 'Present' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Clear mark/i })).toBeNull();
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
    // Backing out restores the palette exactly as it was — the day is still
    // excused, and the track is there to change it again.
    expect(screen.getByRole('radio', { name: 'Excused' })).toBeTruthy();
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

  it('asks before CLEARING a day the school approved', async () => {
    // Blanking an approved day is the same interruption as re-marking one —
    // a guard only some paths respect is not a guard. The verb changes,
    // because "Marking it cleared" is not English.
    const { onPick, user } = setup({
      status: 'EX',
      exReason: 'mc',
      filing: FILING,
    });
    await user.click(screen.getByRole('button', { name: /Clear mark/i }));

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/Ms Lhen Mendoza approved this day/)).toBeTruthy();
    expect(
      screen.getByText('Clearing it won’t change what the parent sent.')
    ).toBeTruthy();
  });

  it('clears once confirmed', async () => {
    const { onPick, user } = setup({
      status: 'EX',
      exReason: 'mc',
      filing: FILING,
    });
    await user.click(screen.getByRole('button', { name: /Clear mark/i }));
    await user.click(screen.getByRole('button', { name: /Clear the mark/i }));
    expect(onPick).toHaveBeenCalledWith(null, null, null);
  });

  it('does not ask when the teacher marked the day themselves', async () => {
    // No filing on the cell, so there is nothing to override.
    const { onPick, user } = setup({ status: 'EX', exReason: 'mc' });
    await user.click(screen.getByRole('button', { name: /Clear mark/i }));
    expect(onPick).toHaveBeenCalledWith(null, null, null);
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
    expect(screen.getByLabelText(NOTE_LABEL)).toBeTruthy();
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
    //
    // ⚠ The heading of the upload slot is excluded deliberately. It is the
    // name of a band in the form, not a claim about this filing.
    setup({ status: 'EX', exReason: 'vacation', filing: TRAVEL_FILING });
    expect(
      screen.getByText(/Excused by a parent's travel filing/)
    ).toBeTruthy();
    expect(screen.getByText(/27 Aug – 3 Sep 2026/)).toBeTruthy();
    expect(screen.queryByText(/· certificate/)).toBeNull();
    expect(screen.queryByText(/no certificate/)).toBeNull();
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
