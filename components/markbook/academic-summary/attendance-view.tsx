'use client';

import { Download, FileSpreadsheet } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import { IdentifierLink } from '@/components/ui/identifier-link';
import {
  buildAttendanceRows,
  type AttendanceRow,
  type EnrollmentStatusLabel,
} from '@/lib/markbook/academic-summary-views';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';

// Attendance quick-view (Task 8 of 14, KD #128 pattern).
//
// Mirrors awards-view.tsx exactly: same FilterSelect, downloadCsv, plain
// shadcn <Table>, IdentifierLink, EnrollmentStatusBadge, outline/sm actions bar.
//
// Domain notes:
//   - absent = schoolDays − present − late (computed in buildAttendanceRows).
//   - rate = present / schoolDays × 100, rounded to 1dp; null when schoolDays=0.
//   - EX (excused) days are deferred — tracked in the Attendance module.
//   - Link destination: /attendance/students/{studentNumber} (per KD #81 —
//     attendance per-student page, not Records).

const STATUS_TO_ENROLLMENT: Record<
  EnrollmentStatusLabel,
  'active' | 'late_enrollee' | 'withdrawn'
> = {
  Active: 'active',
  'Late enrollee': 'late_enrollee',
  Withdrawn: 'withdrawn',
};

// Rate band → text color token (design-system §9.3 semantic color discipline).
// ≥ 95  healthy  text-brand-mint
// 85–94.9 warn   text-brand-amber
// < 85  bad      text-destructive
function rateColorClass(rate: number | null): string {
  if (rate == null) return 'text-muted-foreground';
  if (rate >= 95) return 'text-brand-mint';
  if (rate >= 85) return 'text-brand-amber';
  return 'text-destructive';
}

// ── Small download helper (client-side CSV with UTF-8 BOM) ──────────────────
// Mirrors awards-view.tsx downloadCsv exactly.

function downloadCsv(
  filename: string,
  headers: string[],
  rows: string[][]
): void {
  const BOM = '﻿';
  const escape = (v: string) =>
    v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"`
      : v;
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ];
  const blob = new Blob([BOM + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── FilterSelect — mirrors awards-view.tsx FilterSelect shape exactly ────────

function FilterSelect({
  label,
  value,
  onChange,
  options,
  width = 'w-[180px]',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  width?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={`h-9 ${width}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function AttendanceView({ payload }: { payload: MasterfilePayload }) {
  const [termNumber, setTermNumber] = useState<number | null>(null);

  const rows = useMemo(
    () => buildAttendanceRows(payload, { termNumber }),
    [payload, termNumber]
  );

  // Term options: Full year first, then per term.
  const termOptions = useMemo(
    () => [
      { value: '__all__', label: 'Full year' },
      ...payload.terms.map((t) => ({
        value: String(t.termNumber),
        label: `Term ${t.termNumber}`,
      })),
    ],
    [payload.terms]
  );

  // ── Export handlers ──────────────────────────────────────────────────────

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set('ay', payload.ayCode);
    params.set('level', payload.level.id);
    for (const id of payload.selectedSectionIds ?? [])
      params.append('class', id);
    return `/api/markbook/masterfile/export?${params.toString()}`;
  }, [payload.ayCode, payload.level.id, payload.selectedSectionIds]);

  const handleExportCsv = useCallback(() => {
    const termLabel = termNumber == null ? 'FullYear' : `T${termNumber}`;
    const headers = [
      '#',
      'Student',
      'Student number',
      'Class',
      'Status',
      'Late term',
      'Present',
      'Late',
      'Absent',
      'Rate',
      'School days',
    ];
    const csvRows = rows.map((r) => [
      r.indexNumber != null ? String(r.indexNumber) : '',
      r.studentName,
      r.studentNumber ?? '',
      r.sectionName,
      r.status,
      r.lateTermNumber != null ? `T${r.lateTermNumber}` : '',
      String(r.present),
      String(r.late),
      String(r.absent),
      r.rate != null ? r.rate.toFixed(1) + '%' : '',
      String(r.schoolDays),
    ]);
    downloadCsv(
      `Attendance_${payload.ayCode}_${termLabel}.csv`,
      headers,
      csvRows
    );
  }, [rows, termNumber, payload.ayCode]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Controls bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Term"
            value={termNumber == null ? '__all__' : String(termNumber)}
            onChange={(v) => setTermNumber(v === '__all__' ? null : Number(v))}
            options={termOptions}
            width="w-[140px]"
          />
        </div>

        {/* Actions — two outline/sm buttons (one primary CTA max per page; KD §7.3) */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="h-9"
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" className="h-9" asChild>
            <a
              href={exportHref}
              title="Download the full masterfile workbook (all subjects, attendance, comments)"
            >
              <FileSpreadsheet className="size-3.5" />
              Export Excel
            </a>
          </Button>
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-12 pl-5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                #
              </TableHead>
              <TableHead className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Student
              </TableHead>
              <TableHead className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Class
              </TableHead>
              <TableHead className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Status
              </TableHead>
              <TableHead className="text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Present
              </TableHead>
              <TableHead className="text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Late
              </TableHead>
              <TableHead className="text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Absent
              </TableHead>
              <TableHead className="text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Rate
              </TableHead>
              <TableHead className="pr-5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                School days
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No students match this scope.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <AttendanceTableRow
                  key={`${r.studentNumber ?? r.studentName}-${i}`}
                  row={r}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* EX-deferred footnote */}
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        Excused (EX) days are tracked in the Attendance module.
      </p>

      {/* Trust strip */}
      {rows.length > 0 && (
        <p className="border-t border-border pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'student' : 'students'} ·{' '}
          {payload.ayCode} · {payload.level.label}
          {termNumber != null ? ` · Term ${termNumber}` : ' · Full year'}
        </p>
      )}
    </div>
  );
}

// ── Table row subcomponent ───────────────────────────────────────────────────

function AttendanceTableRow({ row }: { row: AttendanceRow }) {
  return (
    <TableRow>
      {/* Index number — informational roll number, muted */}
      <TableCell className="w-12 pl-5">
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          {row.indexNumber ?? '—'}
        </span>
      </TableCell>

      {/* Student — linkified to attendance per-student page (KD #81) */}
      <TableCell>
        <div className="flex flex-col gap-0.5">
          {row.studentNumber ? (
            <IdentifierLink
              href={`/attendance/students/${encodeURIComponent(row.studentNumber)}`}
            >
              {row.studentName}
            </IdentifierLink>
          ) : (
            <span className="font-medium text-foreground">
              {row.studentName}
            </span>
          )}
          {row.studentNumber && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {row.studentNumber}
            </span>
          )}
        </div>
      </TableCell>

      {/* Class */}
      <TableCell className="text-sm text-muted-foreground">
        {row.sectionName}
      </TableCell>

      {/* Status — late enrollee gets a term suffix */}
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <EnrollmentStatusBadge status={STATUS_TO_ENROLLMENT[row.status]} />
          {row.status === 'Late enrollee' && row.lateTermNumber != null && (
            <span className="font-mono text-[10px] font-semibold text-brand-amber">
              · T{row.lateTermNumber}
            </span>
          )}
        </div>
      </TableCell>

      {/* Present — right-aligned, tabular-nums */}
      <TableCell className="text-right">
        <span className="font-mono text-sm tabular-nums text-foreground">
          {row.present}
        </span>
      </TableCell>

      {/* Late */}
      <TableCell className="text-right">
        <span className="font-mono text-sm tabular-nums text-foreground">
          {row.late}
        </span>
      </TableCell>

      {/* Absent */}
      <TableCell className="text-right">
        <span className="font-mono text-sm tabular-nums text-foreground">
          {row.absent}
        </span>
      </TableCell>

      {/* Rate — color-banded by threshold */}
      <TableCell className="text-right">
        {row.rate == null ? (
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            —
          </span>
        ) : (
          <span
            className={`font-mono text-sm font-semibold tabular-nums ${rateColorClass(row.rate)}`}
          >
            {row.rate.toFixed(1)}%
          </span>
        )}
      </TableCell>

      {/* School days */}
      <TableCell className="pr-5 text-right">
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          {row.schoolDays}
        </span>
      </TableCell>
    </TableRow>
  );
}
