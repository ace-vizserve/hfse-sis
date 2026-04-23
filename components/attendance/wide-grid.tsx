'use client';

import Link from 'next/link';

// Attendance wide grid. Rows = students (~30), columns = term school-days
// (~47). Cell count at HFSE scale: ~1,410 per render.
//
// Render-perf invariants — do not regress:
//   1. Each cell uses a NATIVE <select>, not shadcn/Radix Select. Radix
//      Select mounts a Portal per instance; 1,410 portals is catastrophic.
//   2. State lives in a single `cells` Map keyed by `${enrolmentId}|${date}`.
//      Avoid prop-drilling per-cell state — a parent re-render on unrelated
//      state (a new useState added to the parent page, say) cascades into
//      1,410 cell re-renders. The parent today is a pure server component
//      so there's no client state to leak. Keep it that way.
//   3. `columns` and `monthGroups` are `useMemo`'d on (calendar, events).
//      The calendar array identity comes from a server fetch — it only
//      changes on `router.refresh()`. Don't wrap the calendar prop in
//      something that changes reference per render.
//
// If 47 days grows to ~180 (period-level Phase 2), revisit: the grid would
// jump to ~5,400 cells and native selects start to feel sluggish on low-end
// Chromebooks. At that point look at column virtualization (react-window)
// or a paginated-by-week view.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// Local-tz ISO for today. Inline helper — the file doesn't pull from
// lib/attendance/calendar.ts to stay a pure client leaf.
function todayLocalIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

import { Card } from '@/components/ui/card';
import {
  ATTENDANCE_STATUS_LABELS,
  DAY_TYPE_LABELS,
  EX_REASON_LABELS,
  isEncodableDayType,
  type AttendanceStatus,
  type DayType,
  type ExReason,
} from '@/lib/schemas/attendance';
import type { CalendarEventRow, SchoolCalendarRow } from '@/lib/attendance/calendar';

// Column header + cell tinting by day_type. Matches the calendar admin
// legend (see components/attendance/calendar-admin-client.tsx DAY_TYPE_STYLES).
// Scaled down for the dense 1,410-cell grid — lower opacity than the
// month view so the status letter stays readable.
const DAY_TYPE_HEADER_BG: Record<DayType, string> = {
  school_day: 'bg-muted/60 text-foreground',
  public_holiday: 'bg-destructive/10 text-destructive',
  school_holiday: 'bg-amber-500/15 text-amber-900 dark:text-amber-100',
  hbl: 'bg-primary/10 text-primary',
  no_class: 'bg-muted/40 text-muted-foreground',
};
const DAY_TYPE_CELL_BG: Record<DayType, string> = {
  school_day: '',
  public_holiday: 'bg-destructive/5',
  school_holiday: 'bg-amber-500/5',
  hbl: 'bg-primary/5',
  no_class: 'bg-muted/20',
};
import type { DailyEntryRow } from '@/lib/attendance/queries';

export type WideGridEnrolment = {
  enrolmentId: string;
  indexNumber: number;
  studentNumber: string;
  studentName: string;
  busNo: string | null;
  classroomOfficerRole: string | null;
  withdrawn: boolean;
  compassionateUsed: number;
  compassionateAllowance: number;
};

// Dropdown option value shape: "P" | "L" | "EX:mc" | "EX:compassionate" |
// "EX:school_activity" | "A" | "NC" | "" (unmarked)
type OptionValue =
  | ''
  | 'P'
  | 'L'
  | 'EX:mc'
  | 'EX:compassionate'
  | 'EX:school_activity'
  | 'A'
  | 'NC';

const TEACHER_OPTIONS: Array<{ value: OptionValue; label: string }> = [
  { value: '', label: '—' },
  { value: 'P', label: 'P · Present' },
  { value: 'L', label: 'L · Late' },
  { value: 'EX:mc', label: 'EX · MC' },
  { value: 'EX:compassionate', label: 'EX · Compassionate' },
  { value: 'EX:school_activity', label: 'EX · School activity' },
  { value: 'A', label: 'A · Absent' },
];

const REGISTRAR_OPTIONS: Array<{ value: OptionValue; label: string }> = [
  ...TEACHER_OPTIONS,
  { value: 'NC', label: 'NC · No class' },
];

function decodeOption(
  value: OptionValue,
): { status: AttendanceStatus; exReason: ExReason | null } | null {
  if (!value) return null;
  if (value.startsWith('EX:')) {
    return { status: 'EX', exReason: value.slice(3) as ExReason };
  }
  return { status: value as AttendanceStatus, exReason: null };
}

function encodeOption(
  status: AttendanceStatus | null,
  exReason: ExReason | null,
): OptionValue {
  if (status == null) return '';
  if (status === 'EX') return `EX:${exReason ?? 'mc'}` as OptionValue;
  return status;
}

function statusColor(status: AttendanceStatus | null): string {
  switch (status) {
    case 'P':
      return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200';
    case 'L':
      return 'bg-amber-500/15 text-amber-800 dark:text-amber-200';
    case 'EX':
      return 'bg-sky-500/15 text-sky-800 dark:text-sky-200';
    case 'A':
      return 'bg-destructive/15 text-destructive';
    case 'NC':
      return 'bg-muted/60 text-muted-foreground';
    default:
      return 'bg-transparent text-muted-foreground';
  }
}

type CellState = {
  status: AttendanceStatus | null;
  exReason: ExReason | null;
  saving: boolean;
  savedAt: number | null;
};

type GridKey = string; // `${enrolmentId}|${date}`

function keyFor(enrolmentId: string, date: string): GridKey {
  return `${enrolmentId}|${date}`;
}

export function AttendanceWideGrid({
  sectionId,
  termId,
  enrolments,
  calendar,
  events,
  initialDaily,
  canWriteNc,
}: {
  sectionId: string;
  termId: string;
  enrolments: WideGridEnrolment[];
  calendar: SchoolCalendarRow[];
  events: CalendarEventRow[];
  initialDaily: DailyEntryRow[];
  canWriteNc: boolean;
}) {
  // Seed cell state map from the latest-per-(date) rows we already fetched.
  const seed = useMemo(() => {
    const m = new Map<GridKey, CellState>();
    for (const r of initialDaily) {
      const k = keyFor(r.sectionStudentId, r.date);
      // initialDaily is filtered to latest-per-key by the query already.
      m.set(k, {
        status: r.status,
        exReason: r.exReason,
        saving: false,
        savedAt: null,
      });
    }
    return m;
  }, [initialDaily]);

  const [cells, setCells] = useState<Map<GridKey, CellState>>(() => new Map(seed));

  function updateCell(k: GridKey, patch: Partial<CellState>) {
    setCells((current) => {
      const next = new Map(current);
      const prev = next.get(k) ?? { status: null, exReason: null, saving: false, savedAt: null };
      next.set(k, { ...prev, ...patch });
      return next;
    });
  }

  async function writeCell(
    enrolmentId: string,
    date: string,
    status: AttendanceStatus,
    exReason: ExReason | null,
  ) {
    void sectionId; // reserved: future bulk endpoint may use it
    const k = keyFor(enrolmentId, date);
    const prev = cells.get(k) ?? { status: null, exReason: null, saving: false, savedAt: null };
    updateCell(k, { status, exReason, saving: true });
    try {
      const res = await fetch('/api/attendance/daily', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sectionStudentId: enrolmentId,
          termId,
          date,
          status,
          exReason,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'save failed');
      updateCell(k, { saving: false, savedAt: Date.now() });
      setTimeout(() => {
        setCells((current) => {
          const c = current.get(k);
          if (!c || !c.savedAt || Date.now() - c.savedAt < 1400) return current;
          const next = new Map(current);
          next.set(k, { ...c, savedAt: null });
          return next;
        });
      }, 1500);
    } catch (e) {
      updateCell(k, { status: prev.status, exReason: prev.exReason, saving: false });
      toast.error(
        `Could not save: ${e instanceof Error ? e.message : 'error'}`,
      );
    }
  }

  // Today's column — ref + ISO captured once at mount so the auto-scroll
  // effect fires exactly once. On a date change (registrar leaves the tab
  // open past midnight) the ref still points at yesterday's column; not
  // worth complicating for that edge case.
  const todayIso = useMemo(() => todayLocalIso(), []);
  const todayHeaderRef = useRef<HTMLTableCellElement | null>(null);
  useEffect(() => {
    todayHeaderRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, []);

  // Calendar columns in order; each flagged with day_type + event labels.
  const columns = useMemo(() => {
    const evBy = (iso: string) => events.filter((e) => iso >= e.startDate && iso <= e.endDate);
    return calendar.map((c) => ({
      iso: c.date,
      dayType: c.dayType,
      encodable: isEncodableDayType(c.dayType),
      label: c.label,
      events: evBy(c.date),
    }));
  }, [calendar, events]);

  // Group by month for banner rows.
  const monthGroups = useMemo(() => {
    const groups: Array<{ month: string; label: string; dates: typeof columns }> = [];
    for (const col of columns) {
      const key = col.iso.slice(0, 7);
      let g = groups[groups.length - 1];
      if (!g || g.month !== key) {
        const [y, m] = key.split('-');
        const d = new Date(Number(y), Number(m) - 1, 1);
        g = {
          month: key,
          label: d.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' }),
          dates: [],
        };
        groups.push(g);
      }
      g.dates.push(col);
    }
    return groups;
  }, [columns]);

  const options = canWriteNc ? REGISTRAR_OPTIONS : TEACHER_OPTIONS;

  if (columns.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="font-serif text-lg font-semibold text-foreground">
          No calendar configured
        </div>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Attendance can&apos;t be recorded until the registrar configures the school calendar for
          this term. Go to{' '}
          <Link href="/attendance/calendar" className="text-primary underline underline-offset-2">
            Attendance · School calendar
          </Link>{' '}
          and seed the weekdays.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-muted/60">
              {/* Month banner row */}
              <tr>
                <th
                  colSpan={3}
                  className="sticky left-0 z-20 border-b border-r border-border bg-muted/60 px-2 py-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Roster
                </th>
                {monthGroups.map((g) => (
                  <th
                    key={g.month}
                    colSpan={g.dates.length}
                    className="border-b border-r border-border px-2 py-1.5 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    {g.label}
                  </th>
                ))}
                <th className="border-b border-border bg-muted/60" />
              </tr>
              {/* Date row */}
              <tr>
                <th className="sticky left-0 z-20 w-10 border-b border-r border-border bg-muted/60 px-1 py-1 text-right font-mono text-[10px] font-semibold text-muted-foreground">
                  #
                </th>
                <th className="sticky left-10 z-20 w-[180px] border-b border-r border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
                  Student
                </th>
                <th className="sticky left-[220px] z-20 w-[110px] border-b border-r border-border bg-muted/60 px-2 py-1 text-left font-mono text-[10px] font-semibold text-muted-foreground">
                  Comp. leave
                </th>
                {columns.map((c) => {
                  const weekday = new Date(
                    Number(c.iso.slice(0, 4)),
                    Number(c.iso.slice(5, 7)) - 1,
                    Number(c.iso.slice(8, 10)),
                  ).toLocaleDateString('en-SG', { weekday: 'short' });
                  const eventLabel = c.events.map((e) => e.label).join(' · ');
                  const dayTypeTitle = `${DAY_TYPE_LABELS[c.dayType]}${
                    c.label ? ` · ${c.label}` : ''
                  }${eventLabel ? ` · ${eventLabel}` : ''}`;
                  const isToday = c.iso === todayIso;
                  return (
                    <th
                      key={c.iso}
                      ref={isToday ? todayHeaderRef : undefined}
                      title={isToday ? `Today · ${dayTypeTitle}` : dayTypeTitle}
                      className={
                        'border-b border-r border-border px-1 py-1 text-center font-mono text-[10px] font-semibold ' +
                        DAY_TYPE_HEADER_BG[c.dayType] +
                        (isToday ? ' relative ring-2 ring-inset ring-brand-indigo' : '')
                      }
                    >
                      <div className="leading-tight">{c.iso.slice(-2)}</div>
                      <div className="text-[9px] font-normal opacity-70">
                        {weekday.slice(0, 3)}
                      </div>
                      {c.dayType === 'hbl' && (
                        <div className="mt-0.5 font-mono text-[8px] font-bold uppercase tracking-wider">
                          HBL
                        </div>
                      )}
                      {c.events.length > 0 && (
                        <div className="mt-0.5 truncate text-[9px] font-normal text-primary">
                          ★
                        </div>
                      )}
                    </th>
                  );
                })}
                <th className="sticky right-0 z-20 w-10 border-b border-border bg-muted/60" />
              </tr>
            </thead>
            <tbody>
              {enrolments.length === 0 && (
                <tr>
                  <td
                    colSpan={3 + columns.length + 1}
                    className="px-4 py-10 text-center text-muted-foreground"
                  >
                    No students enrolled in this section yet.
                  </td>
                </tr>
              )}
              {enrolments.map((e) => {
                const remaining = e.compassionateAllowance - e.compassionateUsed;
                const quotaClass =
                  remaining <= 0
                    ? 'text-destructive'
                    : remaining <= 1
                    ? 'text-amber-700 dark:text-amber-200'
                    : 'text-muted-foreground';
                return (
                  <tr
                    key={e.enrolmentId}
                    className={
                      'border-b border-border ' +
                      (e.withdrawn ? 'bg-muted/10 text-muted-foreground' : 'hover:bg-muted/20')
                    }
                  >
                    <td className="sticky left-0 z-10 border-r border-border bg-background px-1 py-1 text-right font-mono tabular-nums text-muted-foreground">
                      {e.indexNumber}
                    </td>
                    <td className="sticky left-10 z-10 w-[180px] border-r border-border bg-background px-2 py-1">
                      <div
                        className={
                          'truncate text-[12px] font-medium ' +
                          (e.withdrawn ? 'line-through' : 'text-foreground')
                        }
                        title={e.studentName}
                      >
                        {e.studentName}
                      </div>
                      <div className="flex items-center gap-2 truncate font-mono text-[10px] text-muted-foreground">
                        <span>{e.studentNumber}</span>
                        {e.busNo && (
                          <span title="Bus number">
                            🚌<span className="ml-0.5">{e.busNo}</span>
                          </span>
                        )}
                        {e.classroomOfficerRole && (
                          <span title="Classroom officer">
                            ⭐<span className="ml-0.5">{e.classroomOfficerRole}</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="sticky left-[220px] z-10 w-[110px] border-r border-border bg-background px-2 py-1">
                      <span
                        className={`font-mono text-[10px] tabular-nums ${quotaClass}`}
                        title={`Urgent/compassionate leave used ${e.compassionateUsed} of ${e.compassionateAllowance}`}
                      >
                        {e.compassionateUsed}/{e.compassionateAllowance}
                      </span>
                    </td>
                    {columns.map((c) => {
                      const cell = cells.get(keyFor(e.enrolmentId, c.iso));
                      const status = cell?.status ?? null;
                      const exReason = cell?.exReason ?? null;
                      const currentValue = encodeOption(status, exReason);
                      const disabled = e.withdrawn || !c.encodable;

                      return (
                        <td
                          key={c.iso}
                          className={
                            'border-r border-border text-center align-middle ' +
                            DAY_TYPE_CELL_BG[c.dayType]
                          }
                        >
                          {!c.encodable ? (
                            <span
                              className="block px-1 py-1 text-[10px] text-muted-foreground"
                              title={`${DAY_TYPE_LABELS[c.dayType]}${c.label ? ` · ${c.label}` : ''}`}
                            >
                              —
                            </span>
                          ) : (
                            <div className={'relative ' + statusColor(status)}>
                              <select
                                value={currentValue}
                                disabled={disabled}
                                onChange={(ev) => {
                                  const decoded = decodeOption(ev.target.value as OptionValue);
                                  if (!decoded) return; // "—" unmarks; we don't support that mutation yet
                                  void writeCell(
                                    e.enrolmentId,
                                    c.iso,
                                    decoded.status,
                                    decoded.exReason,
                                  );
                                }}
                                className="w-full appearance-none bg-transparent px-1 py-1 text-center font-mono text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                                title={
                                  status
                                    ? `${ATTENDANCE_STATUS_LABELS[status]}${
                                        status === 'EX' && exReason
                                          ? ` · ${EX_REASON_LABELS[exReason]}`
                                          : ''
                                      }`
                                    : 'Unmarked'
                                }
                              >
                                {options.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.value === ''
                                      ? '—'
                                      : o.value.startsWith('EX:')
                                      ? `E${o.value.slice(3, 4).toUpperCase()}`
                                      : o.value}
                                  </option>
                                ))}
                              </select>
                              {cell?.saving && (
                                <Loader2 className="absolute right-0 top-0 size-2.5 animate-spin text-muted-foreground" />
                              )}
                              {cell?.savedAt && (
                                <CheckCircle2 className="absolute right-0 top-0 size-2.5 text-primary" />
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 bg-background" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <LegendChip color="bg-emerald-500/15 text-emerald-800 dark:text-emerald-200" label="P · Present" />
        <LegendChip color="bg-amber-500/15 text-amber-800 dark:text-amber-200" label="L · Late" />
        <LegendChip color="bg-sky-500/15 text-sky-800 dark:text-sky-200" label="EX · Excused" />
        <LegendChip color="bg-destructive/15 text-destructive" label="A · Absent" />
        {canWriteNc && (
          <LegendChip color="bg-muted/60 text-muted-foreground" label="NC · No class" />
        )}
        <span>· Dropdown shows EM / EC / ES for MC / Compassionate / School-activity.</span>
      </div>
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-0.5 font-mono text-[10px] font-semibold ${color}`}
    >
      {label}
    </span>
  );
}
