// lib/attendance/event-scope.ts
// Plain-English descriptions of who a calendar event is for. Pure.
//
// Split out of the dialog so the wording is testable on its own — this is the
// sentence a school admin reads to check they picked the right classes, and it
// is the only confirmation they get before saving.
import { LEVEL_CODES, LEVEL_LABELS, type LevelCode } from '@/lib/sis/levels';

/** Level codes in the canonical P1→S4 order, duplicates dropped. */
export function sortLevels(codes: readonly LevelCode[]): LevelCode[] {
  return [...new Set(codes)].sort(
    (a, b) => LEVEL_CODES.indexOf(a) - LEVEL_CODES.indexOf(b)
  );
}

/** True when the codes form an unbroken run of the canonical order. */
export function isContiguousRun(codes: readonly LevelCode[]): boolean {
  if (codes.length < 2) return true;
  const idx = sortLevels(codes).map((c) => LEVEL_CODES.indexOf(c));
  return idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
}

/**
 * The sentence under the picker.
 *
 * Says it the way the school says it — "Primary Six only", "Primary Four to
 * Secondary Four" — rather than listing codes back at someone who just clicked
 * them. A run is described by its ends because that is how HFSE's own calendar
 * writes it ("UpperPri - Secondary"); a scattered set has no such shorthand, so
 * it names them.
 */
export function describeLevelScope(codes: readonly LevelCode[]): string {
  const sorted = sortLevels(codes);
  if (sorted.length === 0) return 'Everyone.';
  if (sorted.length === LEVEL_CODES.length) return 'Everyone.';
  if (sorted.length === 1) return `${LEVEL_LABELS[sorted[0]]} only.`;
  // Two levels read as a pair, not a range — HFSE's own calendar writes
  // "Primary Two and Three Fieldtrip", never "Primary Two to Three".
  if (sorted.length === 2) {
    return `${LEVEL_LABELS[sorted[0]]} and ${LEVEL_LABELS[sorted[1]]}.`;
  }
  if (isContiguousRun(sorted)) {
    return `${LEVEL_LABELS[sorted[0]]} to ${LEVEL_LABELS[sorted[sorted.length - 1]]}.`;
  }
  return `${sorted.map((c) => LEVEL_LABELS[c]).join(', ')}.`;
}

/**
 * Whether the chosen levels straddle both halves of the school.
 *
 * Worth saying out loud in the UI: `audience` can only be all / primary /
 * secondary, so a mixed scope degrades to 'all' and the screens that still read
 * `audience` will show the event to everyone until they move to `levels`.
 * Silently storing something the user cannot see the effect of is the bug this
 * whole change exists to fix, so it is not repeated here.
 */
export function spansBothBands(codes: readonly LevelCode[]): boolean {
  return (
    codes.some((c) => c.startsWith('P')) && codes.some((c) => c.startsWith('S'))
  );
}

/**
 * Does this event belong on THIS section's register?
 *
 * The question the teacher's sheet and the register export have always been
 * asking, and could only answer at band granularity until migration 158. "P6
 * Fieldtrip" stamped an SE tag on every P1 teacher's column because primary was
 * as narrow as the answer could get.
 *
 * Precedence runs narrowest first, matching how the scope was stored:
 *   1. classes, when the event names them;
 *   2. levels, when it names those;
 *   3. otherwise `audience`, which is what every pre-158 row has.
 *
 * A section whose level is unknown sees only whole-school events — the same
 * defensive answer `levelTypeForAudienceLookup` already gives for an
 * unrecognised level.
 */
export function eventAppliesToSection(
  event: {
    audience: 'all' | 'primary' | 'secondary';
    levels: readonly LevelCode[] | null;
    sectionIds: readonly string[] | null;
  },
  section: { levelCode: LevelCode | null; sectionId: string | null }
): boolean {
  if (event.sectionIds && event.sectionIds.length > 0) {
    return (
      section.sectionId !== null && event.sectionIds.includes(section.sectionId)
    );
  }
  if (event.levels && event.levels.length > 0) {
    return (
      section.levelCode !== null && event.levels.includes(section.levelCode)
    );
  }
  if (event.audience === 'all') return true;
  if (section.levelCode === null) return false;
  const band = section.levelCode.startsWith('P') ? 'primary' : 'secondary';
  return event.audience === band;
}

/** "2 classes." / "1 class." — the class-mode counterpart. */
export function describeClassScope(count: number): string {
  if (count === 0) return 'No classes chosen yet.';
  return count === 1 ? '1 class.' : `${count} classes.`;
}
