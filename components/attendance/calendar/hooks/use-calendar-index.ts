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
    const pad = (n: number) => String(n).padStart(2, '0');
    for (const e of events) {
      // Local-date iteration (matches the views' parseIso/formatIso idiom) so
      // chip placement can't drift from cell keys across timezones.
      const [sy, sm, sd] = e.startDate.split('-').map(Number);
      const [ey, em, ed] = e.endDate.split('-').map(Number);
      const d = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (d.getTime() <= end.getTime()) {
        const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const arr = eventsByIso.get(iso);
        if (arr) arr.push(e);
        else eventsByIso.set(iso, [e]);
        d.setDate(d.getDate() + 1);
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
