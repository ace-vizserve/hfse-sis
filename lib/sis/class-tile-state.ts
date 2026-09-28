import { APPLICATION_TERMINAL_STATUSES } from '@/lib/schemas/sis';
import { isEnrolledApplicationStatus } from '@/lib/sync/students';

// What the Class Assignment tile on the admissions record says, and whether it
// offers a button — decided in one pure place so every state is tested.
//
// Class assignment is Enrolled-only. Before Enrolled there is no button: the
// tile only says whether the admissions row already names a class (set in
// Directus or an older link), which the nightly auto-sync places once the
// application is Enrolled. See
// docs/superpowers/plans/2026-09-28-class-assignment-any-stage.md.
//
// The tile's "Change section" control for a child already on a class list is
// not decided here — it needs the move dialog's own data and stays where it
// was in `components/sis/enrollment-tab.tsx`.

export type ClassTileState =
  /** Cancelled / Withdrawn: nothing to do, the tile reads as before. */
  | { kind: 'closed' }
  /** On a class list — the existing "Change section" control applies. */
  | { kind: 'in_class' }
  /** Not Enrolled yet — a status line, no button. */
  | { kind: 'before_enrolled'; line: string }
  /** Enrolled but not on a class list — "Assign a class" in place. */
  | {
      kind: 'awaiting' | 'not_in_class_yet';
      line: string;
      action: { label: string };
    };

export function classTileState(input: {
  applicationStatus: string | null | undefined;
  classLevel: string | null | undefined;
  classSection: string | null | undefined;
  /** Is the child on a class list this year? */
  inClass: boolean;
}): ClassTileState {
  const status = (input.applicationStatus ?? '').trim();
  if ((APPLICATION_TERMINAL_STATUSES as readonly string[]).includes(status)) {
    return { kind: 'closed' };
  }
  if (input.inClass) return { kind: 'in_class' };

  const level = (input.classLevel ?? '').trim();
  const section = (input.classSection ?? '').trim();
  const named = section ? [level, section].filter(Boolean).join(' · ') : null;

  if (isEnrolledApplicationStatus(status)) {
    return named
      ? {
          kind: 'not_in_class_yet',
          line: `${named} — not in the class yet`,
          action: { label: 'Assign a class' },
        }
      : {
          kind: 'awaiting',
          line: 'Awaiting class assignment',
          action: { label: 'Assign a class' },
        };
  }

  return {
    kind: 'before_enrolled',
    line: named ? `${named} — joins when enrolled` : 'Assigned after enrolment',
  };
}
