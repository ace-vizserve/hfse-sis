'use client';

import { Download, ExternalLink } from 'lucide-react';
import Link from 'next/link';
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
import { StatusBadge } from '@/components/ui/status-badge';
import { EnrollmentStatusBadge } from '@/components/ui/enrollment-status-badge';
import { IdentifierLink } from '@/components/ui/identifier-link';
import {
  buildCommentRows,
  type CommentRow,
  type CommentStatus,
} from '@/lib/markbook/academic-summary-views';
import type { MasterfilePayload } from '@/lib/markbook/masterfile';

// Comments quick-view (Task 9 of 14, KD #128 pattern).
//
// Mirrors awards-view.tsx and attendance-view.tsx exactly: same FilterSelect,
// downloadCsv, plain shadcn <Table>, IdentifierLink, outline/sm actions bar.
//
// Domain notes:
//   - T1–T3 only (KD #49 — T4 has no FCA comment).
//   - Submitted = non-empty text + submitted flag (KD #120/#129).
//   - Draft     = non-empty text + not submitted.
//   - Missing   = no/empty entry.
//   - Editing stays in Evaluation (KD #49/#126) — this view is READ-ONLY.
//   - Deep-link per row → /evaluation/sections/{sectionId} (per KD #81;
//     route verified at app/(evaluation)/evaluation/sections/[sectionId]).

// Comment-status → StatusBadge tone (§9.3 semantic color discipline).
//   Submitted → healthy (mint — positive/complete)
//   Draft     → warning (amber — in-progress/incomplete)
//   Missing   → locked  (destructive — blocked/absent)
//   N.A.      → muted   (neutral — not applicable, KD #148; never destructive,
//                        since a term the student wasn't enrolled for is not
//                        a problem to chase)
const COMMENT_STATUS_TONE: Record<
  CommentStatus,
  'healthy' | 'warning' | 'locked' | 'muted'
> = {
  Submitted: 'healthy',
  Draft: 'warning',
  Missing: 'locked',
  'N.A.': 'muted',
};

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

// ── Status filter options ────────────────────────────────────────────────────

type StatusFilter = CommentStatus | 'all';

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Missing', label: 'Missing' },
  { value: 'N.A.', label: 'N.A. (not enrolled that term)' },
];

// ── Main component ──────────────────────────────────────────────────────────

export function CommentsView({ payload }: { payload: MasterfilePayload }) {
  const [termNumber, setTermNumber] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  // Expanded rows: key = `${studentNumber}:${termNumber}` (or name fallback)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () =>
      buildCommentRows(payload, {
        termNumber,
        status: status === 'all' ? 'all' : status,
      }),
    [payload, termNumber, status]
  );

  // Section-id lookup: name → id (for deep-linking to the evaluation section
  // editor at /evaluation/sections/{sectionId}).
  const sectionIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of payload.sections) map.set(s.name, s.id);
    return map;
  }, [payload.sections]);

  // Term options: T1–T3 only (KD #49 — T4 excluded).
  const termOptions = useMemo(
    () => [
      { value: '__all__', label: 'All terms' },
      ...payload.terms
        .filter((t) => t.termNumber >= 1 && t.termNumber <= 3)
        .map((t) => ({
          value: String(t.termNumber),
          label: `Term ${t.termNumber}`,
        })),
    ],
    [payload.terms]
  );

  // ── Expand/collapse toggle ───────────────────────────────────────────────

  function rowKey(r: CommentRow): string {
    return `${r.studentNumber ?? r.studentName}:${r.termNumber}`;
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Export handler ────────────────────────────────────────────────────────

  const handleExportCsv = useCallback(() => {
    const termLabel = termNumber == null ? 'T1-T3' : `T${termNumber}`;
    const headers = [
      '#',
      'Student',
      'Student number',
      'Class',
      'Term',
      'Comment status',
      'Adviser',
      'Comment',
    ];
    const csvRows = rows.map((r) => [
      r.indexNumber != null ? String(r.indexNumber) : '',
      r.studentName,
      r.studentNumber ?? '',
      r.sectionName,
      `T${r.termNumber}`,
      r.commentStatus,
      r.adviser ?? '',
      r.text ?? '',
    ]);
    downloadCsv(
      `Comments_${payload.ayCode}_${termLabel}.csv`,
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
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            options={STATUS_FILTER_OPTIONS}
            width="w-[160px]"
          />
        </div>

        {/* Actions — outline/sm (one primary CTA max per page; KD §7.3) */}
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
            <Link href="/evaluation">
              <ExternalLink className="size-3.5" />
              Open Evaluation Module
            </Link>
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
                Term
              </TableHead>
              <TableHead className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Status
              </TableHead>
              <TableHead className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Adviser
              </TableHead>
              <TableHead className="pr-5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
                Comment
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No write-ups match this scope.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => {
                const key = rowKey(r);
                const isExpanded = expanded.has(key);
                const sectionId = sectionIdByName.get(r.sectionName);
                const evalHref = sectionId
                  ? `/evaluation/sections/${sectionId}`
                  : '/evaluation/sections';

                return (
                  <CommentsTableRow
                    key={`${key}-${i}`}
                    row={r}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleExpand(key)}
                    evalHref={evalHref}
                  />
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footnote — read-only reminder */}
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        Read-only — edit write-ups in the Evaluation module.
      </p>

      {/* Trust strip */}
      {rows.length > 0 && (
        <p className="border-t border-border pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'write-up' : 'write-ups'} ·{' '}
          {payload.ayCode} · {payload.level.label}
          {termNumber != null ? ` · Term ${termNumber}` : ' · Terms 1–3'}
        </p>
      )}
    </div>
  );
}

// ── Table row subcomponent ───────────────────────────────────────────────────

function CommentsTableRow({
  row,
  isExpanded,
  onToggleExpand,
  evalHref,
}: {
  row: CommentRow;
  isExpanded: boolean;
  onToggleExpand: () => void;
  evalHref: string;
}) {
  return (
    <TableRow>
      {/* Index number — informational roll number, muted */}
      <TableCell className="w-12 pl-5">
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          {row.indexNumber ?? '—'}
        </span>
      </TableCell>

      {/* Student — linkified to Records per KD #81 */}
      <TableCell>
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
          {/* Late-enrollee term suffix */}
          {row.status === 'Late enrollee' && row.lateTermNumber != null && (
            <span className="font-mono text-[10px] font-semibold text-brand-amber">
              · T{row.lateTermNumber}
            </span>
          )}
        </div>
      </TableCell>

      {/* Class */}
      <TableCell className="text-sm text-muted-foreground">
        {row.sectionName}
      </TableCell>

      {/* Term */}
      <TableCell>
        <span className="font-mono text-sm tabular-nums text-foreground">
          T{row.termNumber}
        </span>
      </TableCell>

      {/* Comment status badge */}
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={COMMENT_STATUS_TONE[row.commentStatus]}>
            {row.commentStatus}
          </StatusBadge>
          {/* Enrollment sub-status (muted, secondary) */}
          {row.status !== 'Active' && (
            <EnrollmentStatusBadge
              status={
                row.status === 'Withdrawn' ? 'withdrawn' : 'late_enrollee'
              }
            />
          )}
        </div>
      </TableCell>

      {/* Adviser */}
      <TableCell className="text-sm text-muted-foreground">
        {row.adviser ?? '—'}
      </TableCell>

      {/* Comment — expandable, with Evaluation deep-link */}
      <TableCell className="pr-5">
        {row.text == null ? (
          <span className="font-mono text-[11px] text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-col gap-1">
            <p
              className={
                isExpanded
                  ? 'text-sm leading-relaxed text-foreground whitespace-pre-wrap'
                  : 'line-clamp-2 text-sm leading-relaxed text-foreground'
              }
            >
              {row.text}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onToggleExpand}
                className="cursor-pointer text-xs text-primary hover:underline"
              >
                {isExpanded ? 'Collapse' : 'Expand'}
              </button>
              <Link
                href={evalHref}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden />
                Open in Evaluation
              </Link>
            </div>
          </div>
        )}
        {/* For missing write-ups: still offer the Evaluation deep-link */}
        {row.text == null && (
          <Link
            href={evalHref}
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden />
            Open in Evaluation
          </Link>
        )}
      </TableCell>
    </TableRow>
  );
}
