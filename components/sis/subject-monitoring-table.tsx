'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { LevelRow } from '@/lib/sis/levels';
import {
  classifyProfile,
  ProfileLegendChip,
} from '@/components/sis/weight-profile';

// =====================================================================
// "All subjects" monitoring table — third tab on /sis/admin/subjects.
// A flat, one-row-per-subject scan surface: the tree (This year) and the
// drift list (Structure Defaults) both organize around a *dimension*
// (level, or template field) — this tab organizes around the *subject*,
// answering "what's taught, and how is it configured" at a glance without
// drilling into level groups. Same data the page already loaded; only the
// interaction differs (client-side sort vs drag).
//
// Visual language is inherited, not reinvented: subject cells reuse the
// tree's mono-code + serif-name pairing, and the WW·PT·QA cell reuses
// ProfileLegendChip (weight-profile.tsx) — the exact chip the tree's
// SubjectChip and the drift list already speak, so a subject's weight
// profile reads identically no matter which tab you're on. Only the
// "Reports as" cell is interactive here (click to edit the mapping); the
// row itself does not carry a full-row click affordance, since a click
// anywhere in a data-dense table row would be ambiguous about what it
// opens.
// =====================================================================

type Subject = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
};
type Config = {
  id: string;
  academic_year_id: string;
  subject_id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};

type SortKey = 'subject' | 'gradeType';
type SortDir = 'asc' | 'desc';

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
        className={cn(
          'size-3',
          isActive ? 'text-foreground' : 'text-muted-foreground/60'
        )}
      />
    </button>
  );
}

export function SubjectMonitoringTable({
  subjects,
  levels,
  configBySubjectId,
  levelIdsBySubjectId,
  reportSubjectIdBySubjectId,
  onOpenEdit,
  onOpenCreate,
}: {
  subjects: Subject[];
  levels: LevelRow[];
  configBySubjectId: Map<string, Config>;
  levelIdsBySubjectId: Map<string, Set<string>>;
  reportSubjectIdBySubjectId: Map<string, string>;
  onOpenEdit: (subject: Subject, config: Config) => void;
  onOpenCreate: (subject: Subject) => void;
}) {
  const [sortKey, setSortKey] = React.useState<SortKey>('subject');
  const [sortDir, setSortDir] = React.useState<SortDir>('asc');

  const levelsById = React.useMemo(
    () => new Map(levels.map((l) => [l.id, l])),
    [levels]
  );
  const subjectsById = React.useMemo(
    () => new Map(subjects.map((s) => [s.id, s])),
    [subjects]
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = React.useMemo(() => {
    return [...subjects].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'subject') {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      } else if (sortKey === 'gradeType') {
        // Letter first, then Numeric, within each ties fall back to name.
        cmp = Number(a.is_examinable) - Number(b.is_examinable);
        if (cmp === 0) {
          cmp = a.name.localeCompare(b.name, undefined, {
            sensitivity: 'base',
          });
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [subjects, sortKey, sortDir]);

  if (subjects.length === 0) {
    return (
      <Card className="items-center py-10 text-center">
        <p className="px-6 text-sm text-muted-foreground">
          No subjects in the catalog yet.
        </p>
      </Card>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>
              <SortButton
                label="Subject"
                sortKey="subject"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
            </TableHead>
            <TableHead>Levels</TableHead>
            <TableHead>
              <SortButton
                label="Grade type"
                sortKey="gradeType"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
              />
            </TableHead>
            <TableHead>WW · PT · QA</TableHead>
            <TableHead>Reports as</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((subject) => {
            const config = configBySubjectId.get(subject.id) ?? null;
            const levelIds = levelIdsBySubjectId.get(subject.id);
            const rowLevels = levelIds
              ? Array.from(levelIds)
                  .map((id) => levelsById.get(id))
                  .filter((l): l is LevelRow => !!l)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
              : [];

            const reportTargetId =
              reportSubjectIdBySubjectId.get(subject.id) ?? subject.id;
            const reportsToSelf = reportTargetId === subject.id;
            const reportTarget = reportsToSelf
              ? null
              : (subjectsById.get(reportTargetId) ?? null);

            return (
              <TableRow key={subject.id}>
                <TableCell>
                  <div className="flex flex-col gap-0.5 leading-tight">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {subject.code}
                    </span>
                    <span className="font-serif text-[14px] font-semibold text-foreground">
                      {subject.name}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="font-mono text-xs text-muted-foreground">
                  {rowLevels.length > 0
                    ? rowLevels.map((l) => l.code).join(', ')
                    : 'Unassigned'}
                </TableCell>

                <TableCell>
                  <Badge variant="secondary">
                    {subject.is_examinable ? 'Numeric' : 'Letter'}
                  </Badge>
                </TableCell>

                <TableCell>
                  {config ? (
                    <ProfileLegendChip
                      profile={classifyProfile(
                        Math.round(config.ww_weight * 100),
                        Math.round(config.pt_weight * 100),
                        Math.round(config.qa_weight * 100)
                      )}
                      label={`${Math.round(config.ww_weight * 100)}·${Math.round(config.pt_weight * 100)}·${Math.round(config.qa_weight * 100)}`}
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-brand-amber/50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.14em] text-brand-amber">
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-brand-amber"
                        aria-hidden
                      />
                      No weights set
                    </span>
                  )}
                </TableCell>

                <TableCell>
                  <button
                    type="button"
                    onClick={() => {
                      if (config) onOpenEdit(subject, config);
                      else onOpenCreate(subject);
                    }}
                    className="-mx-2 -my-1 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
                    title={
                      reportsToSelf
                        ? `${subject.name} reports as itself — click to change`
                        : `${subject.name} reports as ${reportTarget?.name ?? 'another subject'} — click to change`
                    }
                  >
                    {reportsToSelf ? (
                      <span className="text-muted-foreground/70">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-ink-5" aria-hidden>
                          →
                        </span>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                          {reportTarget?.code ?? '—'}
                        </span>
                        <span className="font-serif text-[13px] font-semibold text-foreground">
                          {reportTarget?.name ?? 'Unknown subject'}
                        </span>
                      </span>
                    )}
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
