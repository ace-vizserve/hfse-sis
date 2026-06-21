'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Mail,
  Search,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  BulkNotifyDialog,
  type BulkNotifyItem,
} from '@/components/p-files/bulk-notify-dialog';
import type { AdmissionsCompleteness } from '@/lib/admissions/dashboard';
import type { StudentCompleteness } from '@/lib/p-files/queries';
import {
  DOCUMENT_SLOTS,
  type DocumentStatus,
} from '@/lib/p-files/document-config';
import { TABLE_COPY } from '@/lib/copy/data-table';

// ─── Module discriminator ─────────────────────────────────────────────────────

type Module = 'p-files' | 'admissions';

// ─── Status filter types ──────────────────────────────────────────────────────

/** Admissions chase: 4 actionable statuses + 'all'. */
export type AdmissionsStatusFilter =
  | 'all'
  | 'to-follow'
  | 'rejected'
  | 'uploaded'
  | 'expired';
/** P-Files renewal: only 'expired' + 'all'. */
export type PFilesStatusFilter = 'all' | 'expired';

// ─── Slot dot rendering ───────────────────────────────────────────────────────

function StatusDot({ status }: { status: DocumentStatus }) {
  switch (status) {
    case 'valid':
      return (
        <span
          className="inline-block size-2.5 rounded-full bg-brand-mint"
          title="On file"
        />
      );
    case 'uploaded':
      return (
        <span
          className="inline-block size-2.5 rounded-full bg-brand-amber"
          title="Pending review"
        />
      );
    case 'rejected':
      return (
        <span
          className="inline-block size-2.5 rounded-full bg-destructive"
          title="Rejected"
        />
      );
    case 'to-follow':
      return (
        <span
          className="inline-block size-2.5 rounded-full bg-primary"
          title="To follow"
        />
      );
    case 'expired':
      return (
        <span
          className="inline-block size-2.5 rounded-full bg-destructive"
          title="Expired"
        />
      );
    case 'missing':
      return (
        <span
          className="inline-block size-2.5 rounded-full border border-border bg-muted"
          title="Missing"
        />
      );
    case 'na':
      return (
        <span
          className="inline-block size-2.5 rounded-full bg-muted"
          title="N/A"
        />
      );
  }
}

// ─── Completeness % badge ─────────────────────────────────────────────────────

function CompletePct({ pct }: { pct: number }) {
  return (
    <Badge
      variant="outline"
      className={`font-mono text-[10px] tabular-nums ${
        pct === 100
          ? 'border-brand-mint bg-gradient-to-b from-brand-mint/25 to-brand-mint/10 text-ink'
          : pct >= 70
            ? 'border-primary/30 bg-gradient-to-b from-primary/15 to-primary/5 text-primary'
            : pct >= 40
              ? 'border-brand-amber/40 bg-gradient-to-b from-brand-amber/15 to-brand-amber/5 text-brand-amber'
              : 'border-destructive/30 bg-gradient-to-b from-destructive/15 to-destructive/5 text-destructive'
      }`}
    >
      {pct}%
    </Badge>
  );
}

function pct(total: number, complete: number): number {
  return total > 0 ? Math.round((complete / total) * 100) : 0;
}

// ─── Slot header abbreviation (shared by both modules) ────────────────────────

function abbreviateSlotLabel(label: string): string {
  return label
    .replace('Mother ', 'M/')
    .replace('Father ', 'F/')
    .replace('Guardian ', 'G/')
    .replace('Passport', 'PP')
    .replace('Student ', 'S/');
}

// ─── BulkNotifyItem builders (module-specific) ────────────────────────────────

function admissionsBulkTargets(
  student: AdmissionsCompleteness
): BulkNotifyItem[] {
  const slotMeta = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));
  const out: BulkNotifyItem[] = [];
  for (const slot of student.slots) {
    if (
      slot.status === 'to-follow' ||
      slot.status === 'rejected' ||
      slot.status === 'uploaded' ||
      slot.status === 'expired'
    ) {
      out.push({
        enroleeNumber: student.enroleeNumber,
        studentName: student.fullName,
        slotKey: slot.key,
        slotLabel: slotMeta.get(slot.key)?.label ?? slot.label,
      });
    }
  }
  return out;
}

function pfilesBulkTargets(
  student: StudentCompleteness,
  windowDays: number | null
): BulkNotifyItem[] {
  const slotMeta = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));
  const todayMs = Date.now();
  const horizonMs = windowDays ? todayMs + windowDays * 86_400_000 : null;
  const out: BulkNotifyItem[] = [];
  for (const slot of student.slots) {
    if (slot.status === 'expired') {
      out.push({
        enroleeNumber: student.enroleeNumber,
        studentName: student.fullName,
        slotKey: slot.key,
        slotLabel: slotMeta.get(slot.key)?.label ?? slot.label,
      });
      continue;
    }
    if (horizonMs !== null && slot.status === 'valid' && slot.expiryDate) {
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

// ─── Common row base (fields shared by both row types) ───────────────────────

type CommonRow = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  level: string | null;
  total: number;
  complete: number;
  expired: number;
  toFollow?: number;
  rejected?: number;
  uploaded?: number;
  slots: {
    key: string;
    label: string;
    status: DocumentStatus;
    expiryDate: string | null;
  }[];
};

// ─── Module-discriminated overloads ──────────────────────────────────────────

type AdmissionsProps = {
  module: 'admissions';
  students: AdmissionsCompleteness[];
  ayCode?: string;
  initialStatusFilter?: AdmissionsStatusFilter;
  bulkRemindEnabled?: boolean;
  bulkRemindWindowDays?: never;
};

type PFilesProps = {
  module: 'p-files';
  students: StudentCompleteness[];
  ayCode?: string;
  initialStatusFilter?: PFilesStatusFilter;
  bulkRemindEnabled?: boolean;
  bulkRemindWindowDays?: number;
};

type Props = AdmissionsProps | PFilesProps;

// ─── Sort state ───────────────────────────────────────────────────────────────

type SortKey = 'name' | 'level' | 'pct' | 'status4' | null;
type SortDir = 'asc' | 'desc';

// ─── Sortable column header button ───────────────────────────────────────────

function SortButton({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === sortKey;
  const Icon = isActive
    ? currentDir === 'asc'
      ? ArrowUp
      : ArrowDown
    : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
    >
      {label}
      <Icon
        className={`size-3 ${isActive ? 'text-foreground' : 'text-muted-foreground/60'}`}
      />
    </button>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DocumentCompletenessTable(props: Props) {
  const { module, students, ayCode, bulkRemindEnabled = false } = props;
  const bulkRemindWindowDays =
    'bulkRemindWindowDays' in props
      ? (props.bulkRemindWindowDays ?? null)
      : null;

  // Status filter — typed loosely internally since the valid options differ
  const [statusFilter, setStatusFilter] = React.useState<string>(
    props.initialStatusFilter ?? 'all'
  );
  const [search, setSearch] = React.useState('');
  const [levelFilter, setLevelFilter] = React.useState('all');
  // P-Files only: section sub-filter
  const [sectionFilter, setSectionFilter] = React.useState('all');
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [sortKey, setSortKey] = React.useState<SortKey>(null);
  const [sortDir, setSortDir] = React.useState<SortDir>('asc');

  const querySuffix = ayCode ? `?ay=${encodeURIComponent(ayCode)}` : '';

  const levels = React.useMemo(
    () =>
      [
        ...new Set(
          students.map((s) => s.level).filter((l): l is string => !!l)
        ),
      ].sort(),
    [students]
  );

  // Section list is only relevant for P-Files
  const sections = React.useMemo(() => {
    if (module !== 'p-files') return [];
    const base =
      levelFilter === 'all'
        ? (students as StudentCompleteness[])
        : (students as StudentCompleteness[]).filter(
            (s) => s.level === levelFilter
          );
    return [
      ...new Set(base.map((s) => s.section).filter((s): s is string => !!s)),
    ].sort();
  }, [module, students, levelFilter]);

  const filtered = React.useMemo(() => {
    return students.filter((s) => {
      if (levelFilter !== 'all' && s.level !== levelFilter) return false;
      if (module === 'p-files' && sectionFilter !== 'all') {
        if ((s as StudentCompleteness).section !== sectionFilter) return false;
      }
      if (search) {
        const needle = search.toLowerCase();
        const haystack =
          `${s.fullName} ${s.studentNumber ?? ''} ${s.enroleeNumber}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (
        statusFilter === 'to-follow' &&
        ((s as AdmissionsCompleteness).toFollow ?? 0) === 0
      )
        return false;
      if (
        statusFilter === 'rejected' &&
        ((s as AdmissionsCompleteness).rejected ?? 0) === 0
      )
        return false;
      if (
        statusFilter === 'uploaded' &&
        ((s as AdmissionsCompleteness).uploaded ?? 0) === 0
      )
        return false;
      if (statusFilter === 'expired' && s.expired === 0) return false;
      return true;
    });
  }, [students, search, levelFilter, sectionFilter, module, statusFilter]);

  // Reset to page 0 when filters or sort change
  React.useEffect(() => {
    setPageIndex(0);
  }, [search, levelFilter, sectionFilter, statusFilter, sortKey, sortDir]);

  // Drop selections that no longer match the visible filtered set
  React.useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(filtered.map((s) => s.enroleeNumber));
      const next = new Set<string>();
      for (const id of prev) if (visibleIds.has(id)) next.add(id);
      return next;
    });
  }, [filtered]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = React.useMemo(() => {
    if (sortKey === null) return filtered;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'name') {
        cmp = a.fullName.localeCompare(b.fullName, undefined, {
          sensitivity: 'base',
        });
      } else if (sortKey === 'level') {
        const al = a.level ?? '';
        const bl = b.level ?? '';
        cmp = al.localeCompare(bl, undefined, { sensitivity: 'base' });
      } else if (sortKey === 'pct') {
        // pct helper guards divide-by-zero (returns 0 when total===0)
        cmp = pct(a.total, a.complete) - pct(b.total, b.complete);
      } else if (sortKey === 'status4') {
        // 4th col: applicationStatus (admissions) or section (p-files)
        const av =
          module === 'admissions'
            ? ((a as AdmissionsCompleteness).applicationStatus ?? '')
            : ((a as StudentCompleteness).section ?? '');
        const bv =
          module === 'admissions'
            ? ((b as AdmissionsCompleteness).applicationStatus ?? '')
            : ((b as StudentCompleteness).section ?? '');
        cmp = av.localeCompare(bv, undefined, { sensitivity: 'base' });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, module]);

  const pageCount = Math.max(Math.ceil(sorted.length / pageSize), 1);
  const paged = sorted.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

  const pageIds = React.useMemo(
    () => paged.map((s) => s.enroleeNumber),
    [paged]
  );
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected =
    !allPageSelected && pageIds.some((id) => selected.has(id));

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

  const bulkItems = React.useMemo(() => {
    if (!bulkRemindEnabled || selected.size === 0)
      return [] as BulkNotifyItem[];
    const out: BulkNotifyItem[] = [];
    for (const s of filtered) {
      if (!selected.has(s.enroleeNumber)) continue;
      if (module === 'admissions') {
        out.push(...admissionsBulkTargets(s as AdmissionsCompleteness));
      } else {
        out.push(
          ...pfilesBulkTargets(s as StudentCompleteness, bulkRemindWindowDays)
        );
      }
    }
    return out;
  }, [bulkRemindEnabled, selected, filtered, module, bulkRemindWindowDays]);

  const hasFilter =
    search.length > 0 ||
    levelFilter !== 'all' ||
    (module === 'p-files' && sectionFilter !== 'all') ||
    statusFilter !== 'all';

  const slotHeaders = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of students) {
      for (const slot of s.slots) {
        if (!seen.has(slot.key)) seen.set(slot.key, slot.label);
      }
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }));
  }, [students]);

  // Module-specific strings
  const identifierLabel = module === 'admissions' ? 'Applicant' : 'Student';
  const emptyLabel =
    module === 'admissions'
      ? 'No applicants match the current filters.'
      : 'No students match the current filters.';
  const countLabel = module === 'admissions' ? 'applicant' : 'student';
  const cardTitle =
    module === 'admissions'
      ? 'Applicant Document Completeness'
      : 'Document Completeness';
  const cardDescription =
    module === 'admissions'
      ? 'Pre-enrolment scope — Submitted / Ongoing Verification / Processing. Click a row to view the application.'
      : 'Per-student breakdown. Click a row to view details.';

  function actionHref(enroleeNumber: string): string {
    return module === 'admissions'
      ? `/admissions/applications/${enroleeNumber}${querySuffix}`
      : `/p-files/${enroleeNumber}${querySuffix}`;
  }

  // How many fixed columns before slot columns (used for colSpan on empty state)
  // Checkbox + Identifier + Level + (Status|Section) + slots + % + Action
  const fixedColCount = 5 + (bulkRemindEnabled ? 1 : 0);

  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle>{cardTitle}</CardTitle>
        <CardDescription>{cardDescription}</CardDescription>

        {/* ── Toolbar ── */}
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

          {/* Level filter */}
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

          {/* P-Files: section sub-filter */}
          {module === 'p-files' && (
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
          )}

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {module === 'admissions' ? (
                <>
                  <SelectItem value="to-follow">
                    {TABLE_COPY.awaitingParentReply}
                  </SelectItem>
                  <SelectItem value="rejected">
                    {TABLE_COPY.sentBackToParent}
                  </SelectItem>
                  <SelectItem value="uploaded">
                    {TABLE_COPY.awaitingValidation}
                  </SelectItem>
                  <SelectItem value="expired">
                    {TABLE_COPY.lapsedReupload}
                  </SelectItem>
                </>
              ) : (
                <SelectItem value="expired">
                  {TABLE_COPY.lapsedReupload}
                </SelectItem>
              )}
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
                      checked={
                        allPageSelected
                          ? true
                          : somePageSelected
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(v) => togglePage(v === true)}
                    />
                  </TableHead>
                )}
                <TableHead className="sticky left-0 bg-muted/40 px-4">
                  <SortButton
                    label={identifierLabel}
                    sortKey="name"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead className="whitespace-nowrap px-2">
                  <SortButton
                    label="Level"
                    sortKey="level"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                </TableHead>

                {/* 4th column: applicationStatus (admissions) vs Section (p-files) */}
                {module === 'admissions' ? (
                  <TableHead className="whitespace-nowrap px-2">
                    <SortButton
                      label="Status"
                      sortKey="status4"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                ) : (
                  <TableHead className="whitespace-nowrap px-2">
                    <SortButton
                      label="Section"
                      sortKey="status4"
                      currentKey={sortKey}
                      currentDir={sortDir}
                      onSort={handleSort}
                    />
                  </TableHead>
                )}

                {slotHeaders.map((h) => (
                  <TableHead
                    key={h.key}
                    className="px-1 text-center"
                    title={h.label}
                  >
                    <span className="inline-block max-w-[60px] truncate text-[10px]">
                      {abbreviateSlotLabel(h.label)}
                    </span>
                  </TableHead>
                ))}
                <TableHead className="px-2 text-center">
                  <SortButton
                    label="%"
                    sortKey="pct"
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead className="px-2 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={slotHeaders.length + fixedColCount}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {emptyLabel}
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((s) => {
                  const rowPct = pct(s.total, s.complete);
                  const slotMap = new Map(
                    s.slots.map((sl) => [sl.key, sl.status])
                  );
                  const isSelected = selected.has(s.enroleeNumber);

                  // Identifier link: KD #81 — linkified primary identifier
                  const href = actionHref(s.enroleeNumber);

                  return (
                    <TableRow
                      key={s.enroleeNumber}
                      data-selected={isSelected || undefined}
                    >
                      {bulkRemindEnabled && (
                        <TableCell className="px-2">
                          <Checkbox
                            aria-label={`Select ${s.fullName}`}
                            checked={isSelected}
                            onCheckedChange={(v) =>
                              toggleRow(s.enroleeNumber, v === true)
                            }
                          />
                        </TableCell>
                      )}

                      {/* Linkified primary identifier (KD #81) */}
                      <TableCell className="sticky left-0 bg-background px-4">
                        <Link
                          href={href}
                          className="font-medium text-foreground transition-colors hover:text-primary hover:underline underline-offset-4"
                        >
                          <div className="text-sm">{s.fullName}</div>
                        </Link>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {s.studentNumber ?? s.enroleeNumber}
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-nowrap px-2 text-xs text-muted-foreground">
                        {s.level ?? '—'}
                      </TableCell>

                      {/* 4th col: applicationStatus vs section */}
                      {module === 'admissions' ? (
                        <TableCell className="whitespace-nowrap px-2 text-xs text-muted-foreground">
                          {(s as AdmissionsCompleteness).applicationStatus ??
                            '—'}
                        </TableCell>
                      ) : (
                        <TableCell className="whitespace-nowrap px-2 text-xs text-muted-foreground">
                          {(s as StudentCompleteness).section ?? '—'}
                        </TableCell>
                      )}

                      {slotHeaders.map((h) => {
                        const status = slotMap.get(h.key);
                        return (
                          <TableCell key={h.key} className="px-1 text-center">
                            {status ? (
                              <StatusDot status={status} />
                            ) : (
                              <span className="text-[10px] text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                        );
                      })}

                      <TableCell className="px-2 text-center">
                        <CompletePct pct={rowPct} />
                      </TableCell>

                      {/* Trailing action link preserved for quick navigation without
                          needing to click the name — the name is now also linkified
                          per KD #81 so both paths work. */}
                      <TableCell className="px-2 text-right">
                        <Link
                          href={href}
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
          {filtered.length}{' '}
          {filtered.length === 1 ? countLabel : `${countLabel}s`}
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
              onClick={() =>
                setPageIndex((p) => Math.min(pageCount - 1, p + 1))
              }
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

      {/* Bulk-remind footer — officer/operational roles only */}
      {bulkRemindEnabled && selected.size > 0 && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border bg-card px-6 py-3 shadow-[0_-4px_6px_-2px_oklch(0_0_0/0.04)]">
          <div className="flex items-center gap-3">
            <Mail className="size-4 text-brand-amber" />
            <span className="text-sm">
              {selected.size}{' '}
              {selected.size === 1 ? countLabel : `${countLabel}s`} selected
              {' · '}
              <span className="font-mono text-[11px] text-muted-foreground">
                {bulkItems.length} reminder{bulkItems.length === 1 ? '' : 's'}{' '}
                queued
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
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
          module={module}
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          onSuccess={() => setSelected(new Set())}
        />
      )}
    </Card>
  );
}
