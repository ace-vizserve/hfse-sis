import { APPLICATION_TERMINAL_STATUSES } from '@/lib/schemas/sis';
import { isEnrolledApplicationStatus } from '@/lib/sync/students';

// What the Class Assignment tile on the admissions record says, and which
// button it offers — decided in one pure place so every state is tested.
//
// A class can be CHOSEN at any application status except Cancelled /
// Withdrawn; the child only JOINS it (class list, class number, start date)
// once the application is Enrolled. See
// docs/superpowers/plans/2026-09-28-class-assignment-any-stage.md, Phase 4.
//
// The tile's "Change section" control for a child already on a class list is
// not decided here — it needs the move dialog's own data and stays where it
// was in `components/sis/enrollment-tab.tsx`.

export type ClassTileMode = 'choose' | 'place';

export type ClassTileState =
  /** Cancelled / Withdrawn: nothing to do, the tile reads as before. */
  | { kind: 'closed' }
  /** On a class list — the existing "Change section" control applies. */
  | { kind: 'in_class' }
  | {
      kind: 'choose' | 'change_choice' | 'awaiting' | 'not_in_class_yet';
      line: string;
      action: { mode: ClassTileMode; label: string };
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
  const chosen = section ? [level, section].filter(Boolean).join(' · ') : null;

  if (isEnrolledApplicationStatus(status)) {
    return chosen
      ? {
          kind: 'not_in_class_yet',
          line: `${chosen} — not in the class yet`,
          action: { mode: 'place', label: 'Assign a class' },
        }
      : {
          kind: 'awaiting',
          line: 'Awaiting class assignment',
          action: { mode: 'place', label: 'Assign a class' },
        };
  }

  return chosen
    ? {
        kind: 'change_choice',
        line: `Joins ${chosen} when enrolled`,
        action: { mode: 'choose', label: 'Change class' },
      }
    : {
        kind: 'choose',
        line: 'No class chosen yet',
        action: { mode: 'choose', label: 'Choose a class' },
      };
}
