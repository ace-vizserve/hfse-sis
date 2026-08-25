// How a relief cover READS on screen, in one place.
//
// ⚠ SINCE MIGRATION 123 A COVER'S NAME NO LONGER MEANS THE PERSON HAS ACCESS.
// A cover booked on Monday for the following week is a real row with a real
// substitute on it, and grants nothing until its start date. So every surface
// that names a covering teacher has to say WHICH of the two it is showing.
//
// Get that wrong and the screen shows a name, somebody assumes that teacher can
// take the register, and they cannot — which is migration 115's failure wearing
// a different coat: the screen saying one thing and the gate doing another.
//
// Four surfaces name a covering teacher — the staff page, the class Teachers
// tab, the Classroom staff panel and the Cover page — so this is one helper
// rather than four `if`s that can drift apart.

import { isReliefLive } from '@/lib/auth/teacher-assignments';
import { sgToday } from '@/lib/dates';

/**
 * `active` — running today; the substitute has the class now.
 * `scheduled` — booked, start date not reached; grants nothing yet.
 * `ended` — the end date has passed; grants nothing any more.
 *
 * ⚠ `active` MUST mean exactly what `isReliefLive` means. The two are pinned
 * together by `__tests__/auth/relief-window-parity.test.ts` — if this ever says
 * `active` where the predicate says not-live, a screen would promise access the
 * gate refuses.
 */
export type ReliefStatus = 'active' | 'scheduled' | 'ended';

export function reliefStatus(
  startedOn: string | null | undefined,
  endedOn: string | null | undefined,
  today: string = sgToday()
): ReliefStatus {
  if (endedOn && endedOn < today) return 'ended';
  if (startedOn && startedOn > today) return 'scheduled';
  return 'active';
}

/** `"3 Sep"` — day and month, no year. Windows are days or weeks, never years. */
export function formatCoverDate(iso: string | null | undefined): string {
  return iso ? shortDate(iso) : '';
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The window in words, or null when there is nothing to say.
 *
 * Both dates null is the ordinary open-ended cover that has always existed, and
 * it gets no text at all — writing "from whenever this was set, until somebody
 * ends it" on every row would bury the ones that genuinely are time-boxed.
 */
export function formatCoverWindow(
  startedOn: string | null | undefined,
  endedOn: string | null | undefined
): string | null {
  if (startedOn && endedOn) {
    return startedOn === endedOn
      ? shortDate(startedOn)
      : `${shortDate(startedOn)} – ${shortDate(endedOn)}`;
  }
  if (startedOn) return `from ${shortDate(startedOn)}`;
  if (endedOn) return `until ${shortDate(endedOn)}`;
  return null;
}

/**
 * What the badge says. The teacher's name is the subject in every case, because
 * that is what a reader is scanning for — the status qualifies it.
 *
 * Plain words rather than a status vocabulary: "covering" and "covers from
 * 3 Sep" tell a school administrator what is true without them learning that
 * "scheduled" is a thing this system has.
 */
export function coverBadgeLabel(
  reliefTeacherName: string,
  startedOn: string | null | undefined,
  endedOn: string | null | undefined,
  today: string = sgToday()
): string {
  const status = reliefStatus(startedOn, endedOn, today);
  const window = formatCoverWindow(startedOn, endedOn);

  if (status === 'scheduled') {
    return `${reliefTeacherName} covers ${startedOn ? `from ${shortDate(startedOn)}` : 'later'}`;
  }
  if (status === 'ended') {
    return `${reliefTeacherName} covered ${window ?? ''}`.trim();
  }
  // Active. An end date is worth showing — it is the next thing anyone asks —
  // but an open-ended cover stays the plain sentence it has always been.
  return endedOn
    ? `${reliefTeacherName} covering until ${shortDate(endedOn)}`
    : `${reliefTeacherName} covering`;
}

/**
 * The §9.3 badge recipe per status, as one concept in two weights.
 *
 * Cover stays AMBER throughout — it is neither healthy-normal (mint) nor broken
 * (destructive), it is a fact worth noticing on a row you are reading for
 * another reason. What changes is the WEIGHT: filled amber is in force now,
 * hollow amber is on the books but not yet real. Same hue so a reader groups
 * them as the same kind of thing; different fill so they never confuse which
 * one grants access.
 */
export function coverBadgeClass(status: ReliefStatus): string {
  if (status === 'active') {
    return 'border-brand-amber bg-brand-amber-light text-ink';
  }
  // Scheduled and ended both grant nothing. Hollow, and muted.
  return 'border-brand-amber/40 bg-transparent text-muted-foreground';
}

/** True when this cover is only booked — nothing has been granted yet. */
export function isScheduledCover(
  startedOn: string | null | undefined,
  endedOn: string | null | undefined,
  today: string = sgToday()
): boolean {
  return reliefStatus(startedOn, endedOn, today) === 'scheduled';
}

// Re-exported so a display surface never reaches for the auth module directly
// and never re-implements the comparison.
export { isReliefLive };
