'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Mail,
  Search,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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
import { BulkNotifyDialog, type BulkNotifyItem } from '@/components/p-files/bulk-notify-dialog';
import type { StudentCompleteness } from '@/lib/p-files/queries';
import { DOCUMENT_SLOTS, type DocumentStatus } from '@/lib/p-files/document-config';

export type StatusFilter = 'all' | 'complete' | 'missing' | 'expired' | 'uploaded';

function StatusDot({ status }: { status: DocumentStatus }) {
  switch (status) {
    case 'valid':
      return <span className="inline-block size-2.5 rounded-full bg-brand-mint" title="On file" />;
    case 'uploaded':
      return <span className="inline-block size-2.5 rounded-full bg-brand-amber" title="Pending review" />;
    case 'expired':
      return <span className="inline-block size-2.5 rounded-full bg-destructive" title="Expired" />;
    case 'missing':
      return <span className="inline-block size-2.5 rounded-full border border-border bg-muted" title="Missing" />;
    case 'na':
      return <span className="inline-block size-2.5 rounded-full bg-muted" title="N/A" />;
  }
}

function completenessPercent(s: StudentCompleteness): number {
  return s.total > 0 ? Math.round((s.complete / s.total) * 100) : 0;
}

// Build the bulk-reminder targets for a single row. Returns one entry
// per slot that's eligible for a reminder under the current filter:
//   - Expired status (always actionable)
//   - Rejected status (always actionable)
//   - Valid + expiry within `windowDays` (when windowDays is set — i.e.
//     the page is in a `?expiring=N` focused view)
function targetsForRow(
  student: StudentCompleteness,
  windowDays: number | null,
): BulkNotifyItem[] {
  const slotMeta = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));
  const todayMs = Date.now();
  const horizonMs = windowDays ? todayMs + windowDays * 86_400_000 : null;
  const out: BulkNotifyItem[] = [];
  for (const slot of student.slots) {
    if (slot.status === 'expired' || slot.status === 'rejected') {
      out.push({
        enroleeNumber: student.enroleeNumber,
        studentName: student.fullName,
        slotKey: slot.key,
        slotLabel: slotMeta.get(slot.key)?.label ?? slot.label,
      });
      continue;
    }
    if (
      horizonMs !== null &&
      slot.status === 'valid' &&
      slot.expiryDate
    ) {
      const t = new Date(slot.expiryDate).getTime();
      if (t >= todayMs && t <= horizonMs) {
        out.push({
          enroleeNumber: student.enroleeNumber,
          studentName: student.fullName,
          slotKey: slot.key,
          slotLabel: slotMeta.get(slot.key)?.label ?? slot.label,
        });
      }
    }
  }
  return out;
}

export function CompletenessTable({
  students,
  ayCode,
  initialStatusFilter,
  bulkRemindEnabled = false,
  bulkRemindWindowDays,
}: {
  students: StudentCompleteness[];
  /**
   * Current-scope AY. Threaded through to `/p-files/[enroleeNumber]` as
   * `?ay=...` so historical-AY browsing on the dashboard resolves against
   * the right admissions table on the detail page.
   */
  ayCode?: string;
  /**
   * Preset status filter from a sidebar Quicklink (`?status=missing` /
   * `expired` / `uploaded` / `complete`). The user can still change it
   * via the toolbar `Select`; we just seed the initial state.
   */
  initialStatusFilter?: StatusFilter;
  /**
   * When true, render the row-selection checkbox column + sticky bulk
   * "Send reminders" footer. Page enables this for `?status=expired` and
   * `?expiring=N` views.
   */
  bulkRemindEnabled?: boolean;
  /**
   * Optional 30/60/90-day window — when set, slot eligibility for a
   * bulk reminder also includes Valid slots whose expiry falls within
   * the window. When null, only Expired / Rejected count.
   */
  bulkRemindWindowDays?: number;
}) {
  const querySuffix = ayCode ? `?ay=${encodeURIComponent(ayCode)}` : '';
  const [search, setSearch] = React.useState('');
  const [levelFilter, setLevelFilter] = React.useState('all');
  const [sectionFilter, setSectionFilter] = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>(
    initialStatusFilter ?? 'all',
  );
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const windowDaysOrNull = bulkRemindWindowDays ?? null;

  const levels = React.useMemo(
    () => [...new Set(students.map((s) => s.level).filter((l): l is string => !!l))].sort(),
    [students],
  );

  const sections = React.useMemo(() => {
    const base = levelFilter === 'all' ? students : students.filter((s) => s.level === levelFilter);
    return [...new Set(base.map((s) => s.section).filter((s): s is string => !!s))].sort();
  }, [students, levelFilter]);

  const filtered = React.useMemo(() => {
    return students.filter((s) => {
      if (levelFilter !== 'all' && s.level !== levelFilter) return false;
      if (sectionFilter !== 'all' && s.section !== sectionFilter) return false;
      if (search) {
        const needle = search.toLowerCase();
        const haystack = `${s.fullName} ${s.studentNumber ?? ''} ${s.enroleeNumber}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      switch (statusFilter) {
        case 'complete':
          if (s.complete !== s.total) return false;
          break;
        case 'missing':
          if (s.missing === 0) return false;
          break;
        case 'expired':
          if (s.expired === 0) return false;
          break;
        case 'uploaded':
          if (s.uploaded === 0) return false;
          break;
      }
      return true;
    });
  }, [students, search, levelFilter, sectionFilter, statusFilter]);

  // Reset to page 0 when filters change
  React.useEffect(() => {
    setPageIndex(0);
  }, [search, levelFilter, sectionFilter, statusFilter]);

  // Drop selections that no longer match the visible filtered set.
  React.useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(filtered.map((s) => s.enroleeNumber));
      const next = new Set<string>();
      for (const id of prev) if (visibleIds.has(id)) next.add(id);
      return next;
    });
  }, [filtered]);

  const pageCount = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const paged = filtered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const pageIds = React.useMemo(() => paged.map((s) => s.enroleeNumber), [paged]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = !allPageSelected && pageIds.some((id) => selected.has(id));

  function togglePage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Expand selected students into BulkNotifyItem[] (one entry per
  // eligible slot per student, scoped by the active window filter).
  const bulkItems = React.useMemo(() => {
    if (!bulkRemindEnabled || selected.size === 0) return [] as BulkNotifyItem[];
    const idSet = selected;
    const out: BulkNotifyItem[] = [];
    for (const s of filtered) {
      if (!idSet.has(s.enroleeNumber)) continue;
      out.push(...targetsForRow(s, windowDaysOrNull));
    }
    return out;
  }, [bulkRemindEnabled, selected, filtered, windowDaysOrNull]);

  const hasFilter =
    search.length > 0 || levelFilter !== 'all' || sectionFilter !== 'all' || statusFilter !== 'all';

  const slotHeaders = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of students) {
      for (const slot of s.slots) {
        if (!seen.has(slot.key)) seen.set(slot.key, slot.label);
      }
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  }, [students]);

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>Document Completeness</CardTitle>
        <CardDescription>Per-student breakdown. Click a row to view details.</CardDescription>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto sm:min-w-[240px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or number…"
              className="pl-8"
            />
          </div>

          <Select
            value={levelFilter}
            onValueChange={(v) => {
              setLevelFilter(v);
              setSectionFilter('all');
            }}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {levels.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sectionFilter} onValueChange={setSectionFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              {sections.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
              <SelectItem value="missing">Has missing</SelectItem>
              <SelectItem value="expired">Has expired</SelectItem>
              <SelectItem value="uploaded">Pending review</SelectItem>
            </SelectContent>
          </Select>

          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setLevelFilter('all');
                setSectionFilter('all');
                setStatusFilter('all');
              }}
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
          )}

          <div className="ml-auto font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {filtered.length} of {students.length}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {bulkRemindEnabled && (
                  <TableHead className="w-10 px-2">
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                      onCheckedChange={(v) => togglePage(v === true)}
                    />
                  </TableHead>
                )}
                <TableHead className="sticky left-0 bg-muted/40 px-4">Student</TableHead>
                <TableHead className="whitespace-nowrap px-2">Level</TableHead>
                <TableHead className="whitespace-nowrap px-2">Section</TableHead>
                {slotHeaders.map((h) => (
                  <TableHead key={h.key} className="px-1 text-center" title={h.label}>
                    <span className="inline-block max-w-[60px] truncate text-[10px]">
                      {h.label
                        .replace('Mother ', 'M/')
                        .replace('Father ', 'F/')
                        .replace('Guardian ', 'G/')
                        .replace('Passport', 'PP')
                        .replace('Student ', 'S/')}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="px-2 text-center">%</TableHead>
                <TableHead className="px-2 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={slotHeaders.length + 5 + (bulkRemindEnabled ? 1 : 0)}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No students match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((s) => {
                  const pct = completenessPercent(s);
                  const slotMap = new Map(s.slots.map((sl) => [sl.key, sl.status]));
                  const isSelected = selected.has(s.enroleeNumber);
                  return (
                    <TableRow key={s.enroleeNumber} data-selected={isSelected || undefined}>
                      {bulkRemindEnabled && (
                        <TableCell className="px-2">
                          <Checkbox
                            aria-label={`Select ${s.fullName}`}
                            checked={isSelected}
                            onCheckedChange={(v) => toggleRow(s.enroleeNumber, v === true)}
                          />
                        </TableCell>
                      )}
                      <TableCell className="sticky left-0 bg-background px-4">
                        <div className="text-sm font-medium">{s.fullName}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {s.studentNumber ?? s.enroleeNumber}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 text-xs text-muted-foreground">
                        {s.level ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 text-xs text-muted-foreground">
                        {s.section ?? '—'}
                      </TableCell>
                      {slotHeaders.map((h) => {
                        const status = slotMap.get(h.key);
                        return (
                          <TableCell key={h.key} className="px-1 text-center">
                            {status ? (
                              <StatusDot status={status} />
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="px-2 text-center">
                        <Badge
                          variant="outline"
                          className={`font-mono text-[10px] tabular-nums ${
                            pct === 100
                              ? 'border-brand-mint bg-brand-mint/20 text-ink'
                              : pct >= 70
                                ? 'border-primary/30 bg-primary/10 text-primary'
                                : pct >= 40
                                  ? 'border-brand-amber/40 bg-brand-amber/10 text-brand-amber'
                                  : 'border-destructive/30 bg-destructive/10 text-destructive'
                          }`}
                        >
                          {pct}%
                        </Badge>
                      </TableCell>
                      <TableCell className="px-2 text-right">
                        <Link
                          href={`/p-files/${s.enroleeNumber}${querySuffix}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          View
                          <ArrowUpRight className="size-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* Pagination */}
      <div className="flex flex-col-reverse items-start gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? 'student' : 'students'}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Rows per page
            </span>
            <Select
              value={`${pageSize}`}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPageIndex(0);
              }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={`${n}`}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
            Page {pageIndex + 1} of {pageCount}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPageIndex(0)}
              disabled={pageIndex === 0}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={pageIndex === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
              disabled={pageIndex >= pageCount - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              onClick={() => setPageIndex(pageCount - 1)}
              disabled={pageIndex >= pageCount - 1}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {bulkRemindEnabled && selected.size > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-[0_-4px_6px_-2px_oklch(0_0_0/0.04)]">
          <div className="flex items-center gap-3">
            <Mail className="size-4 text-brand-amber" />
            <span className="text-sm">
              {selected.size} student{selected.size === 1 ? '' : 's'} selected
              {' · '}
              <span className="font-mono text-[11px] text-muted-foreground">
                {bulkItems.length} reminder{bulkItems.length === 1 ? '' : 's'} queued
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              onClick={() => setBulkOpen(true)}
              disabled={bulkItems.length === 0}
            >
              <Mail className="size-3.5" />
              Send reminders
            </Button>
          </div>
        </div>
      )}

      {bulkRemindEnabled && (
        <BulkNotifyDialog
          items={bulkItems}
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          onSuccess={() => setSelected(new Set())}
        />
      )}
    </Card>
  );
}
