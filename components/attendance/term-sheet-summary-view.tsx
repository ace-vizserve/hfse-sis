'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { Column, ColumnDef } from '@tanstack/react-table';
import {
  CalendarCheck,
  CalendarX,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Percent,
  TriangleAlert,
  Users,
} from 'lucide-react';

import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { exportCsv } from '@/components/ui/data-table/csv';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { rateTone } from '@/lib/attendance/rate-tone';
import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  isAttendanceAtRisk,
} from '@/lib/attendance/risk';
import {
  poolStats,
  type SummaryStat,
  type TermSummaryRow,
} from '@/lib/attendance/sheet-summary';
import { cn } from '@/lib/utils';

// Term Sheet Summary — ① metric cards → ② one DataTable. The server computes
// every student's numbers (buildTermSummaryRows); this component picks which
// period's stat a row shows, filters and sorts, and pools the rows still
// shown into the cards — so the cards always describe what the table shows.

const WHOLE_TERM = 'term';

const EMPTY_STAT: SummaryStat = {
  totalDays: 0,
  present: 0,
  late: 0,
  excused: 0,
  absent: 0,
  attendancePct: null,
};

const STATUS_ACTIVE = 'Active';
const STATUS_WITHDRAWN = 'Withdrawn';

const BAND_BELOW = `Below ${AT_RISK_ATTENDANCE_THRESHOLD_PCT}%`;
const BAND_WATCH = `Watch (${AT_RISK_ATTENDANCE_THRESHOLD_PCT}–95%)`;
const BAND_GOOD = '95% and up';
const BAND_NONE = 'No marks yet';

function rateBandOf(pct: number | null): string {
  if (pct == null) return BAND_NONE;
  if (pct < AT_RISK_ATTENDANCE_THRESHOLD_PCT) return BAND_BELOW;
  if (pct < 95) return BAND_WATCH;
  return BAND_GOOD;
}

type PeriodRow = {
  id: string;
  indexNumber: number;
  studentName: string;
  status: string;
  band: string;
  days: number;
  present: number;
  late: number;
  excused: number;
  absent: number;
  // undefined (never null) = no marks yet, so it sorts last either way.
  rate?: number;
};

const inList = (
  row: { getValue: (id: string) => unknown },
  id: string,
  value: unknown
) =>
  !Array.isArray(value) ||
  value.length === 0 ||
  value.includes(row.getValue(id));

// Numeric columns: header and figure both sit on the right edge of the
// column (the billing tables' `flex justify-end` header pattern). `-mr-2`
// cancels the sort button's own padding so its arrow ends where the digits
// end, rather than the label sitting left while the figures sit right.
function NumHeader({
  column,
  children,
}: {
  column: Column<PeriodRow, unknown>;
  children: ReactNode;
}) {
  return (
    <div className="flex justify-end">
      <SortableHeader column={column} align="right" className="-mr-2">
        {children}
      </SortableHeader>
    </div>
  );
}

function NumCell({ value }: { value: number }) {
  return (
    <span className="block text-right font-mono text-sm tabular-nums text-foreground">
      {value}
    </span>
  );
}

const COLUMNS: ColumnDef<PeriodRow>[] = [
  {
    id: 'index',
    accessorKey: 'indexNumber',
    header: ({ column }) => <SortableHeader column={column}>#</SortableHeader>,
    meta: { label: 'Index number' },
    cell: ({ row }) => (
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {row.original.indexNumber}
      </span>
    ),
  },
  {
    accessorKey: 'studentName',
    header: ({ column }) => (
      <SortableHeader column={column}>Student</SortableHeader>
    ),
    meta: { label: 'Student' },
    cell: ({ row }) => (
      <span className="font-medium text-foreground">
        {row.original.studentName}
        {row.original.status === STATUS_WITHDRAWN && (
          <Badge variant="secondary" className="ml-2 text-[10px]">
            Withdrawn
          </Badge>
        )}
      </span>
    ),
  },
  {
    // Filter-only columns — hidden by default (the Student cell already
    // tags a withdrawn student); the Columns menu can still show them.
    accessorKey: 'status',
    header: 'Status',
    filterFn: inList,
  },
  {
    accessorKey: 'band',
    header: 'Rate band',
    filterFn: inList,
  },
  {
    accessorKey: 'days',
    header: ({ column }) => <NumHeader column={column}>Days</NumHeader>,
    meta: { label: 'Days' },
    cell: ({ row }) => <NumCell value={row.original.days} />,
  },
  {
    accessorKey: 'present',
    header: ({ column }) => <NumHeader column={column}>Present</NumHeader>,
    meta: { label: 'Present' },
    cell: ({ row }) => <NumCell value={row.original.present} />,
  },
  {
    accessorKey: 'late',
    header: ({ column }) => <NumHeader column={column}>Late</NumHeader>,
    meta: { label: 'Late' },
    cell: ({ row }) => <NumCell value={row.original.late} />,
  },
  {
    accessorKey: 'excused',
    header: ({ column }) => <NumHeader column={column}>Excused</NumHeader>,
    meta: { label: 'Excused' },
    cell: ({ row }) => <NumCell value={row.original.excused} />,
  },
  {
    accessorKey: 'absent',
    header: ({ column }) => <NumHeader column={column}>Absent</NumHeader>,
    meta: { label: 'Absent' },
    cell: ({ row }) => <NumCell value={row.original.absent} />,
  },
  {
    accessorKey: 'rate',
    header: ({ column }) => <NumHeader column={column}>Rate</NumHeader>,
    meta: { label: 'Rate' },
    sortUndefined: 'last',
    cell: ({ row }) => {
      const pct = row.original.rate;
      return (
        <span
          className={cn(
            'block text-right font-mono text-sm font-semibold tabular-nums',
            pct == null ? 'text-muted-foreground' : rateTone(pct).text
          )}
        >
          {pct == null ? '—' : `${pct}%`}
        </span>
      );
    },
  },
];

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// The CSV carries the table's own columns, in the table's order.
const CSV_COLUMNS: Array<{
  header: string;
  accessor: (r: PeriodRow) => string | number | null;
}> = [
  { header: '#', accessor: (r) => r.indexNumber },
  { header: 'Student', accessor: (r) => r.studentName },
  { header: 'Status', accessor: (r) => r.status },
  { header: 'Days', accessor: (r) => r.days },
  { header: 'Present', accessor: (r) => r.present },
  { header: 'Late', accessor: (r) => r.late },
  { header: 'Excused', accessor: (r) => r.excused },
  { header: 'Absent', accessor: (r) => r.absent },
  { header: 'Rate', accessor: (r) => r.rate ?? null },
];

const byIndex = (a: PeriodRow, b: PeriodRow) => a.indexNumber - b.indexNumber;

/** Start a file download from a GET URL (the route sets the file name). */
function download(href: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function TermSheetSummaryView({
  rows,
  months,
  sectionId,
  termId,
  sectionName,
  termLabel,
}: {
  rows: TermSummaryRow[];
  months: { month: string; label: string }[];
  sectionId: string;
  termId: string;
  sectionName: string;
  termLabel: string;
}) {
  const [period, setPeriod] = useState<string>(WHOLE_TERM);
  const periodLabel =
    period === WHOLE_TERM
      ? 'Whole term'
      : (months.find((m) => m.month === period)?.label ?? 'Whole term');

  const tableRows: PeriodRow[] = useMemo(
    () =>
      rows.map((r) => {
        const stat =
          period === WHOLE_TERM
            ? r.term
            : (r.months.find((m) => m.month === period)?.stat ?? EMPTY_STAT);
        return {
          id: r.enrolment.enrolmentId,
          indexNumber: r.enrolment.indexNumber,
          studentName: r.enrolment.studentName,
          status: r.enrolment.withdrawn ? STATUS_WITHDRAWN : STATUS_ACTIVE,
          band: rateBandOf(stat.attendancePct),
          days: stat.totalDays,
          present: stat.present,
          late: stat.late,
          excused: stat.excused,
          absent: stat.absent,
          rate: stat.attendancePct ?? undefined,
        };
      }),
    [rows, period]
  );

  // The cards follow the table: the period picked AND the rows the search and
  // filters leave. Same pooling and same at-risk / perfect rules as the
  // server's class overview, applied to just those rows.
  const [shownRows, setShownRows] = useState<PeriodRow[] | null>(null);
  const cards = useMemo(() => {
    const shown = shownRows ?? tableRows;
    const term = poolStats(
      shown.map((r) => ({
        totalDays: r.days,
        present: r.present,
        late: r.late,
        excused: r.excused,
        absent: r.absent,
        attendancePct: r.rate ?? null,
      }))
    );
    const active = shown.filter((r) => r.status === STATUS_ACTIVE);
    return {
      term,
      atRisk: active.filter((r) => isAttendanceAtRisk(r.rate ?? null)).length,
      perfect: active.filter((r) => r.days > 0 && r.absent === 0).length,
      active: active.length,
      filtered: shownRows !== null && shownRows.length !== tableRows.length,
    };
  }, [shownRows, tableRows]);
  const { term } = cards;
  const when = period === WHOLE_TERM ? 'this term' : `in ${periodLabel}`;
  const whoActive = `of ${cards.active} active ${
    cards.active === 1 ? 'student' : 'students'
  }${cards.filtered ? ' shown' : ''}`;

  // ── Export ── one menu for what's shown / the whole year, plus "Export
  // selected" in the footer bar for ticked students. Excel comes from the
  // register export route, narrowed to the period and students; CSV is the
  // table's own rows, built here.
  const shown = shownRows ?? tableRows;
  const excelUrl = (studentIds: string[] | null) => {
    const q = new URLSearchParams({ term_id: termId });
    if (period !== WHOLE_TERM) q.set('month', period);
    if (studentIds) q.set('students', studentIds.join(','));
    return `/api/attendance/${sectionId}/export?${q.toString()}`;
  };
  const csvName = (suffix?: string) =>
    `term-sheet-summary-${slug(sectionName)}-${slug(termLabel)}-${slug(periodLabel)}${
      suffix ? `-${suffix}` : ''
    }.csv`;
  // The whole class needs no student list; only a narrowed table sends one.
  const shownIds =
    shown.length === tableRows.length ? null : shown.map((r) => r.id);
  const studentsWord = (n: number) =>
    `${n}-${n === 1 ? 'student' : 'students'}`;

  const exportMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <Download className="size-3.5" />
          Export
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={shown.length === 0}
          onSelect={() => download(excelUrl(shownIds))}
        >
          <FileSpreadsheet className="size-4" />
          Excel — what&apos;s shown
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            download(`/api/attendance/${sectionId}/export?scope=year`)
          }
        >
          <FileSpreadsheet className="size-4" />
          Excel — whole year
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={shown.length === 0}
          onSelect={() =>
            exportCsv(
              [...shown].sort(byIndex),
              CSV_COLUMNS,
              csvName(shownIds ? studentsWord(shown.length) : undefined)
            )
          }
        >
          <FileText className="size-4" />
          CSV — what&apos;s shown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Class attendance rate"
          value={term.attendancePct ?? '—'}
          format="percent"
          icon={Percent}
          subtext={`${term.totalDays.toLocaleString('en-SG')} student-days marked ${when}`}
        />
        <MetricCard
          label="Below the at-risk line"
          value={cards.atRisk}
          icon={TriangleAlert}
          subtext={`Students under ${AT_RISK_ATTENDANCE_THRESHOLD_PCT}% ${when}`}
        />
        <MetricCard
          label="Perfect attendance"
          value={cards.perfect}
          icon={CalendarCheck}
          subtext={`No absences ${when}, ${whoActive}`}
        />
        <MetricCard
          label="Absences"
          value={term.absent}
          icon={CalendarX}
          subtext={`${when[0].toUpperCase()}${when.slice(1)} · ${term.late} late ${term.late === 1 ? 'mark' : 'marks'}`}
        />
      </div>

      <DataTable<PeriodRow>
        data={tableRows}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        onFilteredRowsChange={setShownRows}
        searchKeys={['studentName']}
        searchPlaceholder="Search students…"
        facets={[
          {
            columnId: 'status',
            label: 'Status',
            valueOptions: [STATUS_ACTIVE, STATUS_WITHDRAWN],
          },
          {
            columnId: 'band',
            label: 'Rate band',
            valueOptions: [BAND_BELOW, BAND_WATCH, BAND_GOOD, BAND_NONE],
          },
        ]}
        toolbarLeading={
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 w-[160px]" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WHOLE_TERM}>Whole term</SelectItem>
              {months.map((m) => (
                <SelectItem key={m.month} value={m.month}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        toolbarTrailing={exportMenu}
        selection={{
          enabled: true,
          bulkActions: [
            {
              key: 'export-excel',
              label: 'Export selected to Excel',
              icon: FileSpreadsheet,
              onTrigger: (selected) =>
                download(excelUrl(selected.map((r) => r.id))),
            },
            {
              key: 'export-csv',
              label: 'Export selected to CSV',
              icon: FileText,
              onTrigger: (selected) =>
                exportCsv(
                  [...selected].sort(byIndex),
                  CSV_COLUMNS,
                  csvName(studentsWord(selected.length))
                ),
            },
          ],
        }}
        initialSort={[{ id: 'index', desc: false }]}
        initialColumnVisibility={{ status: false, band: false }}
        pageSize={50}
        emptyState={{
          icon: Users,
          title: 'No students enrolled in this section yet.',
        }}
        emptyFilteredState={{
          title: 'No students match these filters.',
          body: 'Clear a filter or the search to see more students.',
        }}
      />
    </div>
  );
}
