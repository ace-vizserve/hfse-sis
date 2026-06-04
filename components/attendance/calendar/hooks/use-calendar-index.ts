'use client';
import { useMemo } from 'react';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import type { Audience } from '@/lib/schemas/attendance';

export type CalendarIndex = {
  byDate: Map<string, SchoolCalendarRow>; // audience-precedence applied (primary > secondary > all)
  eventsByIso: Map<string, CalendarEventRow[]>; // multi-day events expanded per covered day
  audienceBadgeByIso: Map<string, Audience[]>; // override badges, only when viewing 'all'
};

const rank = (a: Audience) => (a === 'primary' ? 2 : a === 'secondary' ? 1 : 0);

export function useCalendarIndex(
  calendar: SchoolCalendarRow[],
  events: CalendarEventRow[],
  audience: Audience
): CalendarIndex {
  return useMemo(() => {
    const byDate = new Map<string, SchoolCalendarRow>();
    for (const r of calendar) {
      const cur = byDate.get(r.date);
      if (!cur || rank(r.audience) > rank(cur.audience)) byDate.set(r.date, r);
    }

    const eventsByIso = new Map<string, CalendarEventRow[]>();
    for (const e of events) {
      const d = new Date(e.startDate);
      const end = new Date(e.endDate);
      while (d.getTime() <= end.getTime()) {
        const iso = d.toISOString().slice(0, 10);
        const arr = eventsByIso.get(iso);
        if (arr) arr.push(e);
        else eventsByIso.set(iso, [e]);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }

    const audienceBadgeByIso = new Map<string, Audience[]>();
    if (audience === 'all') {
      for (const r of calendar) {
        if (r.audience === 'all') continue;
        const arr = audienceBadgeByIso.get(r.date) ?? [];
        if (!arr.includes(r.audience)) arr.push(r.audience);
        audienceBadgeByIso.set(r.date, arr);
        arr.sort((a, b) => (a === 'primary' ? -1 : b === 'primary' ? 1 : 0));
      }
    }
    return { byDate, eventsByIso, audienceBadgeByIso };
  }, [calendar, events, audience]);
}
