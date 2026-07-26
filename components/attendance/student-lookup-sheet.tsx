'use client';

import {
  ArrowLeft,
  CalendarX2,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Search,
  UserSearch,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import type {
  StudentSummaryResponse,
  TermStat,
} from '@/app/api/attendance/student-summary/route';
import type { WideGridEnrolment } from '@/components/attendance/wide-grid';
import { presentOnlyCount, type RollupRow } from '@/lib/attendance/queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

// ─── Types ───────────────────────────────────────────────────────────────────

type Props = {
  enrolments: WideGridEnrolment[];
  rollups: RollupRow[];
  termLabel: string;
};

type SortKey =
  | 'studentName'
  | 'schoolDays'
  | 'present'
  | 'late'
  | 'excused'
  | 'absent'
  | 'attendancePct';

type RosterRow = {
  enrolment: WideGridEnrolment;
  schoolDays: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  attendancePct: number | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-SG', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// Rate → semantic health band (drives text color everywhere a rate renders).
function rateTone(rate: number): {
  text: string;
  stroke: string;
  label: string;
} {
  if (rate >= 95)
    return {
      text: 'text-brand-mint',
      stroke: 'stroke-brand-mint',
      label: 'Excellent',
    };
  if (rate >= 85)
    return {
      text: 'text-brand-amber',
      stroke: 'stroke-brand-amber',
      label: 'Watch',
    };
  return {
    text: 'text-destructive',
    stroke: 'stroke-destructive',
    label: 'At risk',
  };
}

// Status → Aurora Vault gradient tile recipe (§9.3 status palette).
const TILE: Record<'present' | 'late' | 'absent' | 'excused', string> = {
  present:
    'bg-gradient-to-br from-brand-mint to-brand-sky text-ink shadow-brand-tile-mint',
  late: 'bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile-amber',
  absent:
    'bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive',
  excused:
    'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </p>
  );
}

function RateRing({ rate }: { rate: number | null }) {
  const size = 116;
  const center = size / 2;
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const clamped = rate == null ? 0 : Math.max(0, Math.min(100, rate));
  const offset = circumference * (1 - clamped / 100);
  const tone = rate == null ? null : rateTone(rate);

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="absolute -rotate-90"
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          strokeWidth="9"
          className="stroke-muted"
        />
        {rate != null && (
          <circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${tone?.stroke} transition-[stroke-dashoffset] duration-500 ease-out`}
          />
        )}
      </svg>
      <div className="relative flex flex-col items-center leading-none">
        <p
          className={`font-serif text-xl font-semibold tabular-nums ${tone?.text ?? 'text-muted-foreground'}`}
        >
          {rate != null ? `${rate}%` : '—'}
        </p>
        {tone && (
          <p
            className={`mt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] ${tone.text}`}
          >
            {tone.label}
          </p>
        )}
      </div>
    </div>
  );
}

function BreakdownCell({
  value,
  label,
  icon: Icon,
  tile,
}: {
  value: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tile: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-2 py-4">
      <div
        className={`flex size-8 items-center justify-center rounded-xl ${tile}`}
      >
        <Icon className="size-4" />
      </div>
      <p className="font-serif text-[26px] font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'right',
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey === activeKey;
  return (
    <th
      className={`px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-foreground' : ''}`}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )
        ) : null}
      </button>
    </th>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StudentLookupSheet({ enrolments, rollups, termLabel }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('studentName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // The per-student summary is an action-triggered READ — fetched only once a
  // student is picked (`enabled`), keyed on the selection so switching students
  // refetches. Forwards the abort signal so a fast back/forward aborts the
  // stale request. While loading (or with no selection) `summary` is null,
  // preserving the prior skeleton-on-`loading` UX.
  const summaryQuery = useQuery({
    queryKey: queryKeys.attendanceStudentSummary(selectedId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<StudentSummaryResponse>(
        `/api/attendance/student-summary?sectionStudentId=${selectedId}`,
        { signal }
      ),
    enabled: selectedId !== null,
  });
  // Treat any error the same as the prior `.catch(() => setSummary(null))` —
  // the detail view degrades to the empty/loading-style state rather than
  // surfacing a route error inside the lookup dialog.
  const summary: StudentSummaryResponse | null =
    selectedId !== null && summaryQuery.isSuccess ? summaryQuery.data : null;
  const loading = selectedId !== null && summaryQuery.isPending;

  const selected = enrolments.find((e) => e.enrolmentId === selectedId);

  // ── Roster table (State 1) — joins enrolments with the current-term
  // rollup, then filters by search + sorts by the active column.
  const rollupByEnrolment = useMemo(() => {
    const m = new Map<string, RollupRow>();
    for (const r of rollups) m.set(r.sectionStudentId, r);
    return m;
  }, [rollups]);

  const rosterRows: RosterRow[] = useMemo(
    () =>
      enrolments.map((e) => {
        const r = rollupByEnrolment.get(e.enrolmentId);
        return {
          enrolment: e,
          schoolDays: r?.schoolDays ?? 0,
          present: r ? presentOnlyCount(r) : 0,
          late: r?.daysLate ?? 0,
          excused: r?.daysExcused ?? 0,
          absent: r?.daysAbsent ?? 0,
          attendancePct: r?.attendancePct ?? null,
        };
      }),
    [enrolments, rollupByEnrolment]
  );

  const filtered: RosterRow[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? rosterRows.filter((r) =>
          r.enrolment.studentName.toLowerCase().includes(q)
        )
      : rosterRows;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'studentName') {
        return (
          dir * a.enrolment.studentName.localeCompare(b.enrolment.studentName)
        );
      }
      if (sortKey === 'attendancePct') {
        return dir * ((a.attendancePct ?? -1) - (b.attendancePct ?? -1));
      }
      return dir * (a[sortKey] - b[sortKey]);
    });
  }, [rosterRows, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'studentName' ? 'asc' : 'desc');
    }
  }

  // Current-term stat + previous terms both come from the canonical rollup via
  // the summary API (proration-aware, EX-as-present, school-day based).
  const currentStat: TermStat | null = useMemo(
    () => (summary?.termStats ?? []).find((t) => t.isCurrent) ?? null,
    [summary]
  );
  const previousTerms: TermStat[] = useMemo(
    () =>
      (summary?.termStats ?? []).filter(
        (t) => !t.isCurrent && t.P + t.L + t.A + t.EX > 0
      ),
    [summary]
  );

  function handleDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setQuery('');
      setSelectedId(null);
    }
  }

  function handleBack() {
    setSelectedId(null);
    setQuery('');
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <UserSearch className="size-3.5" />
          Attendance summary
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-serif text-xl font-semibold">
            {selected ? 'Attendance record' : 'Attendance summary'}
          </DialogTitle>
        </DialogHeader>

        {/* ── Roster table (State 1) ────────────────────────────────── */}
        {!selectedId && (
          <>
            <div className="shrink-0 border-b border-border px-4 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Type a student name…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No students match &ldquo;{query}&rdquo;
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border">
                      <SortableTh
                        label="Student"
                        sortKey="studentName"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                        align="left"
                      />
                      <SortableTh
                        label="Days"
                        sortKey="schoolDays"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="P"
                        sortKey="present"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="L"
                        sortKey="late"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="EX"
                        sortKey="excused"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="A"
                        sortKey="absent"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                      <SortableTh
                        label="Rate"
                        sortKey="attendancePct"
                        activeKey={sortKey}
                        dir={sortDir}
                        onSort={toggleSort}
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((row) => {
                      const tone =
                        row.attendancePct == null
                          ? null
                          : rateTone(row.attendancePct);
                      return (
                        <tr
                          key={row.enrolment.enrolmentId}
                          onClick={() =>
                            setSelectedId(row.enrolment.enrolmentId)
                          }
                          className="cursor-pointer transition-colors hover:bg-muted/50"
                        >
                          <td className="px-3 py-2.5">
                            <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                              {row.enrolment.indexNumber}
                            </span>{' '}
                            <span className="text-sm font-medium text-foreground">
                              {row.enrolment.studentName}
                            </span>
                            {row.enrolment.withdrawn && (
                              <Badge
                                variant="secondary"
                                className="ml-2 text-[10px]"
                              >
                                Withdrawn
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.schoolDays}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.present}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.late}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.excused}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-foreground">
                            {row.absent}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono text-sm font-semibold tabular-nums ${
                              tone?.text ?? 'text-muted-foreground'
                            }`}
                          >
                            {row.attendancePct != null
                              ? `${row.attendancePct}%`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="shrink-0 border-t border-border px-6 py-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {filtered.length} student{filtered.length === 1 ? '' : 's'} ·
              current term · click a row for full history
            </div>
          </>
        )}

        {/* ── Detail view ───────────────────────────────────────────── */}
        {selectedId && selected && (
          <div className="flex-1 space-y-6 overflow-y-auto p-6">
            {/* Back */}
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              All students
            </button>

            {/* ── Hero: identity + rate + breakdown in one card ─────── */}
            <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-t from-primary/5 to-card shadow-xs">
              {/* Identity + rate ring */}
              <div className="flex items-center justify-between gap-4 px-5 py-5">
                <div className="min-w-0 space-y-1.5">
                  <Eyebrow>Current term · {termLabel}</Eyebrow>
                  <h2 className="truncate font-serif text-2xl font-semibold leading-tight text-foreground">
                    {selected.studentName}
                  </h2>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xs text-muted-foreground">
                      {selected.studentNumber}
                    </p>
                    {selected.withdrawn && (
                      <Badge variant="secondary" className="text-[10px]">
                        Withdrawn
                      </Badge>
                    )}
                  </div>
                </div>
                <RateRing rate={loading ? null : (currentStat?.rate ?? null)} />
              </div>

              {/* Breakdown strip */}
              {loading ? (
                <div className="grid grid-cols-4 divide-x divide-border border-t border-border bg-card/60">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center gap-2 px-2 py-4"
                    >
                      <div className="size-8 animate-pulse rounded-xl bg-muted" />
                      <div className="h-6 w-6 animate-pulse rounded bg-muted" />
                      <div className="h-2 w-10 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-4 divide-x divide-border border-t border-border bg-card/60">
                  <BreakdownCell
                    value={currentStat?.P ?? 0}
                    label="Present"
                    icon={CircleCheck}
                    tile={TILE.present}
                  />
                  <BreakdownCell
                    value={currentStat?.L ?? 0}
                    label="Late"
                    icon={Clock}
                    tile={TILE.late}
                  />
                  <BreakdownCell
                    value={currentStat?.A ?? 0}
                    label="Absent"
                    icon={CircleX}
                    tile={TILE.absent}
                  />
                  <BreakdownCell
                    value={currentStat?.EX ?? 0}
                    label="Excused"
                    icon={FileText}
                    tile={TILE.excused}
                  />
                </div>
              )}
            </div>

            {/* ── Previous Terms ───────────────────────────────────── */}
            {loading ? (
              <div className="space-y-2.5">
                <Eyebrow>Previous terms</Eyebrow>
                <div className="rounded-xl border border-border px-4 py-6 text-center text-xs text-muted-foreground">
                  Loading…
                </div>
              </div>
            ) : (
              previousTerms.length > 0 && (
                <div className="space-y-2.5">
                  <Eyebrow>Previous terms</Eyebrow>
                  <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Term
                          </th>
                          <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Rate
                          </th>
                          <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Absent
                          </th>
                          <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Late
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {previousTerms.map((t) => (
                          <tr key={t.termId}>
                            <td className="px-4 py-2.5 font-medium text-foreground">
                              {t.label}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-foreground">
                              {t.rate != null ? `${t.rate}%` : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              <span
                                className={
                                  t.A > 0
                                    ? 'font-semibold text-destructive'
                                    : 'text-muted-foreground'
                                }
                              >
                                {t.A}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                              <span
                                className={
                                  t.L > 0
                                    ? 'font-semibold text-brand-amber'
                                    : 'text-muted-foreground'
                                }
                              >
                                {t.L}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {/* ── Recent Absences ──────────────────────────────────── */}
            {!loading && summary && summary.recentAbsences.length > 0 && (
              <div className="space-y-2.5">
                <Eyebrow>Recent absences</Eyebrow>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                  <ul className="divide-y divide-border">
                    {summary.recentAbsences.map((date) => (
                      <li
                        key={date}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive">
                          <CalendarX2 className="size-4" />
                        </div>
                        <p className="flex-1 text-sm font-medium text-foreground">
                          {formatDate(date)}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {date}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* ── Full history ─────────────────────────────────────── */}
            <Button asChild variant="outline" className="w-full">
              <Link href={`/attendance/students/${selected.studentNumber}`}>
                View full attendance details
              </Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
