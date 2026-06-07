'use client';

import { Download, FileSpreadsheet, Printer } from 'lucide-react';
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
  buildAwardsRows,
  type AwardsRow,
  type EnrollmentStatusLabel,
} from '@/lib/markbook/academic-summary-views';
import type { AwardTier } from '@/lib/markbook/masterfile-dashboard';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';

// Awards quick-view (Task 7 of 14, KD #128 pattern).
//
// Table approach: plain shadcn <Table> primitives — no TanStack. Per-class
// ≤ 50 rows; full level a few hundred. The Attendance and Comments sibling
// views (Tasks 8 + 9) should mirror this exact approach.
//
// Count == drill (KD #124): buildAwardsRows shares the same awardTierForRow
// predicate as computeMasterfileDashboard, so this list always matches the
// hub donut counts.

// ── Award tier palette — matches DONUT_COLORS in masterfile-dashboard.tsx ──
// gold=brand-amber, silver=ink-4, bronze=brand-bronze, notEligible=muted
const TIER_CONFIG: Record<AwardTier, { label: string; className: string }> = {
  gold: {
    label: 'Gold',
    className:
      'inline-flex items-center rounded-full bg-brand-amber/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-amber',
  },
  silver: {
    label: 'Silver',
    className:
      'inline-flex items-center rounded-full bg-ink-4/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-4',
  },
  bronze: {
    label: 'Bronze',
    className:
      'inline-flex items-center rounded-full bg-brand-bronze/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-bronze',
  },
  notEligible: {
    label: 'Not eligible',
    className:
      'inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground',
  },
};

const STATUS_TO_ENROLLMENT: Record<
  EnrollmentStatusLabel,
  'active' | 'late_enrollee' | 'withdrawn'
> = {
  Active: 'active',
  'Late enrollee': 'late_enrollee',
  Withdrawn: 'withdrawn',
};

// Tier filter options (full-year mode only).
type TierFilter = AwardTier | 'all';
const TIER_FILTER_OPTIONS: { value: TierFilter; label: string }[] = [
  { value: 'all', label: 'All tiers' },
  { value: 'gold', label: 'Gold' },
  { value: 'silver', label: 'Silver' },
  { value: 'bronze', label: 'Bronze' },
  { value: 'notEligible', label: 'Not eligible' },
];

// ── Small download helper (client-side CSV with UTF-8 BOM) ──────────────────

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

// ── FilterSelect — mirrors masterfile-view.tsx FilterSelect shape exactly ──

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

export function AwardsView({ payload }: { payload: MasterfilePayload }) {
  const [subjectId, setSubjectId] = useState<string>('overall');
  const [termNumber, setTermNumber] = useState<number | null>(null);
  const [tier, setTier] = useState<TierFilter>('all');

  // Build rows — sorted best-first by score, nulls last.
  const rows = useMemo(
    () => buildAwardsRows(payload, { subjectId, termNumber, tier }),
    [payload, subjectId, termNumber, tier]
  );

  // Score display precision:
  //   per-term quarterly → integer (0dp)
  //   full-year overall GA → 1dp
  //   full-year subject overall → 2dp
  const scoreDp = termNumber != null ? 0 : subjectId === 'overall' ? 1 : 2;

  // Subject options: Overall first, then all subjects from the payload.
  const subjectOptions = useMemo(
    () => [
      { value: 'overall', label: 'Overall Academic Award' },
      ...payload.subjects.map((s) => ({ value: s.id, label: s.name })),
    ],
    [payload.subjects]
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

  const showAwardColumn = termNumber == null;

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
    const headers = [
      'Student',
      'Student number',
      'Class',
      'Status',
      'Late term',
      'Score',
      ...(showAwardColumn ? ['Award'] : []),
    ];
    const csvRows = rows.map((r) => [
      r.studentName,
      r.studentNumber ?? '',
      r.sectionName,
      r.status,
      r.lateTermNumber != null ? `T${r.lateTermNumber}` : '',
      r.score != null ? r.score.toFixed(scoreDp) : '',
      ...(showAwardColumn
        ? [r.tier != null ? TIER_CONFIG[r.tier].label : '']
        : []),
    ]);

    const subjectLabel =
      subjectId === 'overall'
        ? 'Overall'
        : (payload.subjects.find((s) => s.id === subjectId)?.code ?? 'Subject');
    const termLabel = termNumber == null ? 'FullYear' : `T${termNumber}`;
    downloadCsv(
      `Awards_${payload.ayCode}_${subjectLabel}_${termLabel}.csv`,
      headers,
      csvRows
    );
  }, [rows, showAwardColumn, scoreDp, subjectId, termNumber, payload]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Controls bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Subject"
            value={subjectId}
            onChange={setSubjectId}
            options={subjectOptions}
            width="w-[220px]"
          />
          <FilterSelect
            label="Term"
            value={termNumber == null ? '__all__' : String(termNumber)}
            onChange={(v) => setTermNumber(v === '__all__' ? null : Number(v))}
            options={termOptions}
            width="w-[140px]"
          />
          {showAwardColumn && (
            <FilterSelect
              label="Tier"
              value={tier}
              onChange={(v) => setTier(v as TierFilter)}
              options={TIER_FILTER_OPTIONS}
              width="w-[150px]"
            />
          )}
        </div>

        {/* Actions — three outline/sm buttons (one primary CTA max per page; KD §7.3) */}
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
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => window.print()}
          >
            <Printer className="size-3.5" />
            Print
          </Button>
        </div>
      </div>

      {/* Provisional note — shown only in per-term mode */}
      {termNumber != null && (
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Provisional — awards finalise once Term 4 grades are complete.
        </p>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="pl-5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Student
              </TableHead>
              <TableHead className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Class
              </TableHead>
              <TableHead className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Status
              </TableHead>
              <TableHead className="text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Score
              </TableHead>
              {showAwardColumn && (
                <TableHead className="pr-5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                  Award
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showAwardColumn ? 5 : 4}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No students match this scope.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <AwardsTableRow
                  key={`${r.studentNumber ?? r.studentName}-${i}`}
                  row={r}
                  scoreDp={scoreDp}
                  showAwardColumn={showAwardColumn}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Trust strip */}
      {rows.length > 0 && (
        <p className="border-t border-border pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'student' : 'students'} ·{' '}
          {payload.ayCode} · {payload.level.label}
          {termNumber != null
            ? ` · Term ${termNumber} (provisional)`
            : ' · Full year'}
        </p>
      )}
    </div>
  );
}

// ── Table row subcomponent ───────────────────────────────────────────────────

function AwardsTableRow({
  row,
  scoreDp,
  showAwardColumn,
}: {
  row: AwardsRow;
  scoreDp: number;
  showAwardColumn: boolean;
}) {
  return (
    <TableRow>
      {/* Student — linkified per KD #81 */}
      <TableCell className="pl-5">
        <div className="flex flex-col gap-0.5">
          {row.studentNumber ? (
            <IdentifierLink
              href={`/records/students/${encodeURIComponent(row.studentNumber)}`}
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

      {/* Score — right-aligned, tabular-nums */}
      <TableCell className="text-right">
        {row.score == null ? (
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            —
          </span>
        ) : (
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {row.score.toFixed(scoreDp)}
          </span>
        )}
      </TableCell>

      {/* Award tier — full-year mode only */}
      {showAwardColumn && (
        <TableCell className="pr-5 text-right">
          {row.tier == null ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              —
            </span>
          ) : (
            <span className={TIER_CONFIG[row.tier].className}>
              {TIER_CONFIG[row.tier].label}
            </span>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
