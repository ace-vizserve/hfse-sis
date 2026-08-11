/**
 * The inline "Assign a class now" picker in the Edit Application dialog must
 * appear only when the student can ACTUALLY be enrolled.
 *
 * THE BUG. `canPickSectionNow` checked three things — the stage is
 * `application`, the pending status is `Enrolled`, and the viewer may place
 * students — and never asked whether the five prerequisite stages were done.
 * So a registrar opening a student with five stages still open was offered a
 * class list, could pick a class, hit Save, and lose the lot to the route's
 * 422. The page behind the dialog was saying "Can't Enroll Yet — 5 Stages
 * Still Open" at the same moment.
 *
 * THE SECOND BUG, WHICH HID THE FIRST. `prereqStatuses` is an optional prop and
 * NEITHER call site in `enrollment-tab.tsx` passed it, so `showPrereqChecklist`
 * was permanently false and the dialog's own "N requirements not met yet ·
 * saving will fail" warning was dead code. Nobody saw the warning because it
 * never rendered.
 *
 * WHY THIS TEST IS ABOUT `[]`. The fix cannot be `incompleteCount === 0`:
 * `prereqRows` is ALSO empty when the checklist is not showing, so that reads
 * "we have no idea" as "all clear" — the same shape as the failures fixed in
 * KD #183. The gate has to require that the prerequisites are *known* as well
 * as met, which is what `showPrereqChecklist &&` buys.
 *
 * Mirrors `evaluateEnrolledFlipGate` (lib/schemas/sis.ts), the server-side
 * authority — see enrolled-flip-gate.test.ts. This is the client half.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ENROLLED_PREREQ_STAGES,
  STAGE_TERMINAL_STATUS,
  type StageKey,
} from '@/lib/schemas/sis';

/**
 * The dialog's gate, extracted exactly as the component computes it.
 *
 * Kept as a mirror rather than imported because the real one is derived inline
 * inside a `'use client'` component with form state; the value here is pinning
 * the LOGIC, and the comment above `canPickSectionNow` in
 * components/sis/edit-stage-dialog.tsx points back at this file.
 */
function canPickSectionNow(input: {
  stageKey: StageKey;
  effectiveStatus: string | null;
  canAssignSection: boolean;
  prereqStatuses?: Partial<Record<StageKey, string | null>>;
}): boolean {
  const showPrereqChecklist =
    input.stageKey === 'application' &&
    !!input.prereqStatuses &&
    (input.effectiveStatus === 'Enrolled' ||
      input.effectiveStatus === 'Enrolled (Conditional)');

  const prereqRows = showPrereqChecklist
    ? ENROLLED_PREREQ_STAGES.map((k) => ({
        ok: (input.prereqStatuses?.[k] ?? null) === STAGE_TERMINAL_STATUS[k],
      }))
    : [];
  const incompleteCount = prereqRows.filter((r) => !r.ok).length;
  const prereqsAllMet = showPrereqChecklist && incompleteCount === 0;

  return (
    input.stageKey === 'application' &&
    input.effectiveStatus === 'Enrolled' &&
    input.canAssignSection &&
    prereqsAllMet
  );
}

/** Every prerequisite stage at its terminal value. */
const ALL_MET: Partial<Record<StageKey, string | null>> = Object.fromEntries(
  ENROLLED_PREREQ_STAGES.map((k) => [k, STAGE_TERMINAL_STATUS[k] ?? null])
);

const base = {
  stageKey: 'application' as StageKey,
  effectiveStatus: 'Enrolled',
  canAssignSection: true,
};

describe('the picker only appears when the student can be enrolled', () => {
  it('appears when all five prerequisites are met', () => {
    expect(canPickSectionNow({ ...base, prereqStatuses: ALL_MET })).toBe(true);
  });

  it('stays hidden when one prerequisite is outstanding', () => {
    const oneShort = { ...ALL_MET, fees: null };
    expect(canPickSectionNow({ ...base, prereqStatuses: oneShort })).toBe(
      false
    );
  });

  it('stays hidden when every prerequisite is outstanding — the reported case', () => {
    // The screenshot: "Can't Enroll Yet — 5 Stages Still Open", and the class
    // list offered anyway.
    const noneDone = Object.fromEntries(
      ENROLLED_PREREQ_STAGES.map((k) => [k, null])
    );
    expect(canPickSectionNow({ ...base, prereqStatuses: noneDone })).toBe(
      false
    );
  });

  it('stays hidden when the prerequisites are UNKNOWN', () => {
    // The trap. No `prereqStatuses` means no rows, which means a count of
    // zero incomplete — indistinguishable from "all done" to a bare count
    // check. This is the state every caller was in before the fix.
    expect(canPickSectionNow({ ...base, prereqStatuses: undefined })).toBe(
      false
    );
  });
});

describe('the mirror above is still the code that ships', () => {
  // Without this the suite is self-satisfying: the mirror encodes the fix, so
  // every assertion would keep passing after someone deleted the gate from the
  // component. These read the real source.
  const dialog = readFileSync(
    join(__dirname, '..', '..', 'components', 'sis', 'edit-stage-dialog.tsx'),
    'utf8'
  );
  const tab = readFileSync(
    join(__dirname, '..', '..', 'components', 'sis', 'enrollment-tab.tsx'),
    'utf8'
  );

  it('the dialog still gates the picker on the prerequisites', () => {
    expect(dialog).toContain('const prereqsAllMet =');
    expect(dialog).toMatch(/canPickSectionNow =[\s\S]{0,220}prereqsAllMet/);
  });

  it('the gate requires the prerequisites to be KNOWN, not just uncounted', () => {
    expect(dialog).toMatch(
      /prereqsAllMet =\s*showPrereqChecklist && incompleteCount === 0/
    );
  });

  it('the tab still passes the prerequisites in', () => {
    // The prop is optional, so forgetting it fails silently — which is exactly
    // how the checklist sat dead for as long as it did.
    expect(tab).toContain('prereqStatuses={prereqStatuses}');
  });
});

describe('the other conditions still hold', () => {
  it('stays hidden for a viewer who may not place students', () => {
    expect(
      canPickSectionNow({
        ...base,
        canAssignSection: false,
        prereqStatuses: ALL_MET,
      })
    ).toBe(false);
  });

  it('stays hidden on any stage other than the application', () => {
    expect(
      canPickSectionNow({
        ...base,
        stageKey: 'fees' as StageKey,
        prereqStatuses: ALL_MET,
      })
    ).toBe(false);
  });

  it('stays hidden for Enrolled (Conditional)', () => {
    // Conditional means ALN — trial class + SPED (KD #180) — not "enrolled
    // without a class", so the placement shortcut is not offered there.
    expect(
      canPickSectionNow({
        ...base,
        effectiveStatus: 'Enrolled (Conditional)',
        prereqStatuses: ALL_MET,
      })
    ).toBe(false);
  });

  it('stays hidden while the status is still unset', () => {
    expect(
      canPickSectionNow({
        ...base,
        effectiveStatus: null,
        prereqStatuses: ALL_MET,
      })
    ).toBe(false);
  });
});
