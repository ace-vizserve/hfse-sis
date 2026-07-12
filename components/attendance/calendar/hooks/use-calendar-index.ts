'use client';
import { useMemo } from 'react';

import {
  type CalendarChip,
  DAY_TYPE_LEGEND_COLOR,
  EVENT_CATEGORY_LEGEND_COLOR,
} from '@/components/attendance/calendar/calendar-cell';
import type {
  CalendarEventRow,
  SchoolCalendarRow,
} from '@/lib/attendance/calendar';
import {
  dayStatusLabel,
  sameStatus,
  storageToDayStatus,
} from '@/lib/attendance/calendar-operational';
import { AUDIENCE_LABELS, type Audience } from '@/lib/schemas/attendance';

export type CalendarIndex = {
  /** Per date: readable, color-coded chips (school overrides + events). */
  entriesByIso: Map<string, CalendarChip[]>;
  /** Per date: events whose span includes it (used by the day sheet). */
  eventsByIso: Map<string, CalendarEventRow[]>;
  /** Every date with at least one school_calendar row (any audience). */
  hasRowByIso: Set<string>;
};

function statusOf(row: SchoolCalendarRow) {
  return storageToDayStatus({
    dayType: row.dayType,
    hblOverlay: row.hblOverlay,
  });
}

export function useCalendarIndex(
  calendar: SchoolCalendarRow[],
  events: CalendarEventRow[],
  // Retained for signature stability; chips always show both levels when they
  // diverge, so the page audience no longer changes what a cell renders.
  _audience: Audience
): CalendarIndex {
  return useMemo(() => {
    // Group school_calendar rows by date → audience.
    const byDateAud = new Map<
      string,
      Partial<Record<Audience, SchoolCalendarRow>>
    >();
    // A date is "present" if it has ANY row, any audience, any day_type —
    // used by the Phase 2 redesign to flag dates that will block attendance
    // entry (no row = the grid has nothing to render for that date).
    const hasRowByIso = new Set<string>();
    for (const r of calendar) {
      const cur = byDateAud.get(r.date) ?? {};
      cur[r.audience] = r;
      byDateAud.set(r.date, cur);
      hasRowByIso.add(r.date);
    }

    const entriesByIso = new Map<string, CalendarChip[]>();

    // School-status chips. A plain school day shows nothing; an override shows a
    // readable chip. When Primary/Secondary diverge, BOTH are shown explicitly.
    for (const [iso, aud] of byDateAud) {
      const chips: CalendarChip[] = [];
      const allRow = aud.all ?? null;
      const pRow = aud.primary ?? null;
      const sRow = aud.secondary ?? null;

      if (pRow || sRow) {
        const pEff = pRow ?? allRow;
        const sEff = sRow ?? allRow;
        const pStatus = pEff
          ? statusOf(pEff)
          : ({ kind: 'open', hbl: false } as const);
        const sStatus = sEff
          ? statusOf(sEff)
          : ({ kind: 'open', hbl: false } as const);
        if (sameStatus(pStatus, sStatus)) {
          // Both levels agree — show one chip, no level prefix.
          chips.push({
            key: `${iso}:both`,
            label: dayStatusLabel(pStatus),
            color: DAY_TYPE_LEGEND_COLOR[pEff?.dayType ?? 'school_day'],
          });
        } else {
          chips.push({
            key: `${iso}:primary`,
            label: `${AUDIENCE_LABELS.primary}: ${dayStatusLabel(pStatus)}`,
            color: DAY_TYPE_LEGEND_COLOR[pEff?.dayType ?? 'school_day'],
          });
          chips.push({
            key: `${iso}:secondary`,
            label: `${AUDIENCE_LABELS.secondary}: ${dayStatusLabel(sStatus)}`,
            color: DAY_TYPE_LEGEND_COLOR[sEff?.dayType ?? 'school_day'],
          });
        }
      } else if (allRow) {
        // Show every in-term day — a plain school day reads "School day".
        const st = statusOf(allRow);
        chips.push({
          key: `${iso}:all`,
          label: dayStatusLabel(st),
          color: DAY_TYPE_LEGEND_COLOR[allRow.dayType],
        });
      }
      if (chips.length) entriesByIso.set(iso, chips);
    }

    // Expand events per covered day (local-date iteration, tz-safe) and append.
    const eventsByIso = new Map<string, CalendarEventRow[]>();
    const pad = (n: number) => String(n).padStart(2, '0');
    for (const e of events) {
      const [sy, sm, sd] = e.startDate.split('-').map(Number);
      const [ey, em, ed] = e.endDate.split('-').map(Number);
      const d = new Date(sy, sm - 1, sd);
      const end = new Date(ey, em - 1, ed);
      while (d.getTime() <= end.getTime()) {
        const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const evArr = eventsByIso.get(iso);
        if (evArr) evArr.push(e);
        else eventsByIso.set(iso, [e]);

        const chips = entriesByIso.get(iso) ?? [];
        chips.push({
          key: `${iso}:ev:${e.id}`,
          label:
            e.audience === 'all'
              ? e.label
              : `${e.label} · ${AUDIENCE_LABELS[e.audience]}`,
          color: EVENT_CATEGORY_LEGEND_COLOR[e.category],
        });
        entriesByIso.set(iso, chips);

        d.setDate(d.getDate() + 1);
      }
    }

    return { entriesByIso, eventsByIso, hasRowByIso };
  }, [calendar, events]);
}
