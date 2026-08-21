'use client';

import {
  ArrowLeft,
  CalendarX2,
  CircleCheck,
  CircleX,
  Clock,
  ExternalLink,
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
import { rateTone } from '@/lib/attendance/rate-tone';
import { TrendChart } from '@/components/dashboard/charts/trend-chart';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  isAttendanceAtRisk,
} from '@/lib/attendance/risk';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type Props = {
  enrolments: WideGridEnrolment[];
  /**
   * This term's rate per enrolment, keyed by `enrolmentId`.
   *
   * The list used to carry a name and an index number and nothing else, so the
   * only way to learn anything was to open every student one at a time — Mr Ace,
   * 2026-08-21: "rather than then checking each student". These come from
   * `getRollupForSection`, the same `attendance_records.attendance_pct` the
   * per-student summary reads, so a row and the record behind it always agree.
   */
  attendancePctByEnrolment: Record<string, number | null>;
  termLabel: string;
  termId: string;
  sectionId: string;
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

function RateHeadline({ rate }: { rate: number | null }) {
  const tone = rate == null ? null : rateTone(rate);
  return (
    <div className="shrink-0 text-right">
      <p
        className={`font-serif text-[26px] font-semibold leading-none tabular-nums ${
          tone?.text ?? 'text-muted-foreground'
        }`}
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

// ─── Main component ───────────────────────────────────────────────────────────

export function StudentLookupSheet({
  enrolments,
  attendancePctByEnrolment,
  termLabel,
  termId,
  sectionId,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The per-student summary is an action-triggered READ — fetched only once a
  // student is picked (`enabled`), keyed on the selection + the page's
  // selected term so switching students OR switching terms refetches.
  // Forwards the abort signal so a fast back/forward aborts the stale
  // request. While loading (or with no selection) `summary` is null,
  // preserving the prior skeleton-on-`loading` UX.
  const summaryQuery = useQuery({
    queryKey: queryKeys.attendanceStudentSummary(selectedId ?? '', termId),
    queryFn: ({ signal }) =>
      apiFetch<StudentSummaryResponse>(
        `/api/attendance/student-summary?sectionStudentId=${selectedId}&termId=${termId}`,
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

  // A withdrawn student is never flagged. Their rate stops being a fact about
  // this term the moment they leave, and a leaver in a "needs a look" list is
  // a phone call nobody should make.
  const isFlagged = (e: WideGridEnrolment): boolean =>
    !e.withdrawn &&
    isAttendanceAtRisk(attendancePctByEnrolment[e.enrolmentId] ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enrolments
      .filter((e) => (onlyFlagged ? isFlagged(e) : true))
      .filter((e) => (q ? e.studentName.toLowerCase().includes(q) : true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrolments, query, onlyFlagged, attendancePctByEnrolment]);

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
  const currentTermMonths = summary?.currentTermMonths ?? [];

  function handleDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setQuery('');
      setOnlyFlagged(false);
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
          Look up student
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="font-serif text-xl font-semibold">
            {selected ? 'Attendance record' : 'Attendance lookup'}
          </DialogTitle>
        </DialogHeader>

        {/* ── Search / list view ────────────────────────────────────── */}
        {!selectedId && (
          <>
            <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Type a student name…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                    autoFocus
                  />
                </div>
                {/* The term is named in the option. A narrowed list reading
                    "nobody" otherwise invites "this class has no problems",
                    when what it means is "nobody in THIS term". */}
                <Select
                  value={onlyFlagged ? 'flagged' : 'all'}
                  onValueChange={(v) => setOnlyFlagged(v === 'flagged')}
                >
                  <SelectTrigger className="w-auto shrink-0 gap-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="all">All students</SelectItem>
                    <SelectItem value="flagged">
                      Only flagged · {termLabel}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="w-full justify-center gap-1.5 text-muted-foreground"
              >
                <Link
                  href={`/attendance/${sectionId}/summary?term_id=${termId}`}
                  target="_blank"
                >
                  <ExternalLink className="size-3.5" />
                  View whole term summary
                </Link>
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  {query.trim()
                    ? `No students match “${query}”`
                    : `Nobody is below ${AT_RISK_ATTENDANCE_THRESHOLD_PCT}% in ${termLabel}.`}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((e) => {
                    const pct = attendancePctByEnrolment[e.enrolmentId] ?? null;
                    const flagged = isFlagged(e);
                    return (
                      <li key={e.enrolmentId}>
                        <button
                          onClick={() => setSelectedId(e.enrolmentId)}
                          className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-muted/50"
                        >
                          <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                            {e.indexNumber}
                          </span>
                          <span className="flex-1 text-sm font-medium text-foreground">
                            {e.studentName}
                          </span>
                          {/* The rate belongs on the row, not behind a click.
                            Below the line it is destructive; at or above it is
                            quiet — a healthy class should read as unremarkable
                            rather than as a wall of green. */}
                          <span
                            className={cn(
                              'shrink-0 font-mono text-xs font-semibold tabular-nums',
                              pct == null
                                ? 'text-muted-foreground/50'
                                : flagged
                                  ? 'text-destructive'
                                  : 'text-muted-foreground'
                            )}
                          >
                            {pct == null ? '—' : `${pct}%`}
                          </span>
                          {e.withdrawn && (
                            <Badge variant="secondary" className="text-[10px]">
                              Withdrawn
                            </Badge>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
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
              {/* Identity + rate headline */}
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
                <RateHeadline
                  rate={loading ? null : (currentStat?.rate ?? null)}
                />
              </div>

              {/* Monthly trend chart */}
              <div
                data-testid="rate-trend-chart"
                className="border-t border-border px-3 pb-1 pt-2"
              >
                {loading ? (
                  <div className="h-[100px] animate-pulse rounded-lg bg-muted" />
                ) : currentTermMonths.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    No attendance recorded yet this term.
                  </p>
                ) : (
                  <TrendChart
                    label="Attendance rate"
                    current={currentTermMonths.map((m) => ({
                      x: m.label,
                      y: m.stat.attendancePct ?? 0,
                    }))}
                    height={100}
                    yFormat="percent"
                  />
                )}
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

            {/* ── This term by month ───────────────────────────────── */}
            {!loading && currentTermMonths.length > 0 && (
              <div className="space-y-2.5">
                <Eyebrow>This term by month</Eyebrow>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Month
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Days
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          P
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          L
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          EX
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          A
                        </th>
                        <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          Rate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {currentTermMonths.map((m) => (
                        <tr key={m.month}>
                          <td className="px-4 py-2.5 font-medium text-foreground">
                            {m.label}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.totalDays}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.present}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.late}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.excused}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.absent}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {m.stat.attendancePct != null
                              ? `${m.stat.attendancePct}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

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
