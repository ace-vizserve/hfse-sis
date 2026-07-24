// lib/sis/backfill/attendance/event-audience.ts
// Pure derivation of the calendar_events.audience value for AY2026 T3
// backfill events, from per-section level codes + row-11 date tags. Split
// out from build-attendance-import-t3.ts for independent unit testing
// (that file's other logic is entangled with the Excel-parsing pipeline).
//
// A date+category (e.g. "2026-08-20 term_exam") is audience='all' only
// when BOTH primary and secondary sections actually carried the tag for
// that date — otherwise it's scoped to whichever single level type carried
// it. A date/category combination with no locatable tag owner defensively
// resolves to 'all' (never silently drops an event's audience).
import { LEVEL_TYPE_BY_CODE, type LevelCode } from '../../levels';

export type EventCategory = 'term_exam' | 'school_event';
export type Audience = 'all' | 'primary' | 'secondary';

export type SectionDateTag = {
  levelCode: string;
  dateTagsByRawDate: Record<string, string | undefined>;
};

const TAG_TO_CATEGORY: Record<string, EventCategory> = {
  EX: 'term_exam',
  SE: 'school_event',
};

/**
 * For each date+category, determine which level TYPES (primary/secondary)
 * actually carried that tag across the parsed section sheets, then resolve:
 * both types present -> 'all'; only primary -> 'primary'; only secondary ->
 * 'secondary'; neither locatable -> 'all' (defensive fallback).
 */
export function buildEventAudienceMap(
  sections: SectionDateTag[],
  datesByRaw: Record<string, string> // rawDate -> isoDate
): Map<string, Audience> {
  const levelTypesByKey = new Map<string, Set<'primary' | 'secondary'>>();
  for (const [rawDate, isoDate] of Object.entries(datesByRaw)) {
    for (const section of sections) {
      const tag = (section.dateTagsByRawDate[rawDate] ?? '').trim();
      const category = TAG_TO_CATEGORY[tag];
      if (!category) continue;
      const lt = LEVEL_TYPE_BY_CODE[section.levelCode as LevelCode];
      if (lt !== 'primary' && lt !== 'secondary') continue;
      const key = `${isoDate}::${category}`;
      const set =
        levelTypesByKey.get(key) ?? new Set<'primary' | 'secondary'>();
      set.add(lt);
      levelTypesByKey.set(key, set);
    }
  }
  const resolved = new Map<string, Audience>();
  for (const [key, types] of levelTypesByKey) {
    const hasP = types.has('primary');
    const hasS = types.has('secondary');
    resolved.set(key, hasP && hasS ? 'all' : hasP ? 'primary' : 'secondary');
  }
  return resolved;
}

export function audienceFor(
  map: Map<string, Audience>,
  isoDate: string,
  category: EventCategory
): Audience {
  return map.get(`${isoDate}::${category}`) ?? 'all';
}
