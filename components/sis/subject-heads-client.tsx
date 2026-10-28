'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { BookOpen, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

// The Subject heads screen: a §8 data table (one row per subject offered this
// year) inside a titled card, like the Staff table — search, Status and
// "Taught in" filters, Export CSV, Columns — and an outline "Edit" per row that
// opens a drawer to add or remove heads.
//
// ⚠ A COLUMN PER HALF, NOT ONE "HEADS" COLUMN. Who approves a Secondary scheme
// of work is the question; a head for every level shows in both columns, a
// half-only head in its own, and a half nobody covers says so in red.
//
// ⚠ EVERY CHANGE SENDS THE SUBJECT'S WHOLE LIST. The route sets a subject's
// heads to exactly what it is sent, so adding or removing one person is the
// current list plus or minus that person.

type Half = 'primary' | 'secondary';

export type SubjectHeadsStaffOption = {
  userId: string;
  email: string;
  displayName: string;
  /** Switched off: still named in the list, never offered in the picker. */
  disabled: boolean;
};

export type SubjectHeadsRow = {
  subjectId: string;
  code: string;
  name: string;
  levelTypes: Half[];
  heads: Array<{ userId: string; appliesToLevelType: Half | null }>;
};

const HALF_LABEL: Record<Half, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
};

const STATUS_READY = 'Has a head';
const STATUS_GAP = 'Needs a head';

/** The halves this subject is taught in that no head covers. */
function uncoveredHalves(row: SubjectHeadsRow): Half[] {
  if (row.heads.some((h) => h.appliesToLevelType === null)) return [];
  return row.levelTypes.filter(
    (half) => !row.heads.some((h) => h.appliesToLevelType === half)
  );
}

function needsAHead(row: SubjectHeadsRow): boolean {
  return row.heads.length === 0 || uncoveredHalves(row).length > 0;
}

const statusOf = (r: SubjectHeadsRow) =>
  needsAHead(r) ? STATUS_GAP : STATUS_READY;

const taughtIn = (r: SubjectHeadsRow) => r.levelTypes.map((h) => HALF_LABEL[h]);

/** Facet match on a value the row holds one of (or several of). */
function oneOf(pick: (r: SubjectHeadsRow) => string[]) {
  return (row: { original: SubjectHeadsRow }, _id: string, value: string[]) =>
    !value?.length || value.some((v) => pick(row.original).includes(v));
}

export function SubjectHeadsClient({
  rows,
  staff,
  ayCode,
}: {
  rows: SubjectHeadsRow[];
  staff: SubjectHeadsStaffOption[];
  ayCode: string | null;
}) {
  const byId = new Map(staff.map((s) => [s.userId, s]));
  const nameOf = (userId: string) =>
    byId.get(userId)?.displayName ?? '(account removed)';
  const gaps = rows.filter(needsAHead).length;
  // The id, not the row: the row is re-read from `rows` after each save's
  // refresh, so the drawer always shows what is stored.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = rows.find((r) => r.subjectId === editingId) ?? null;

  /** Who approves this half's schemes of work. */
  const headsFor = (r: SubjectHeadsRow, half: Half) =>
    r.heads
      .filter(
        (h) => h.appliesToLevelType === null || h.appliesToLevelType === half
      )
      .map((h) => nameOf(h.userId));

  const halfColumn = (half: Half): ColumnDef<SubjectHeadsRow> => ({
    id: half,
    accessorFn: (r) =>
      r.levelTypes.includes(half) ? headsFor(r, half).join(', ') : '',
    header: `${HALF_LABEL[half]} head`,
    meta: { label: `${HALF_LABEL[half]} head` },
    enableSorting: false,
    cell: ({ row }) => {
      const r = row.original;
      if (!r.levelTypes.includes(half)) {
        return <span className="text-[13px] text-muted-foreground">—</span>;
      }
      const names = headsFor(r, half);
      if (names.length === 0) {
        return <span className="text-[13px] text-destructive">Nobody yet</span>;
      }
      // Two names, then a count — any one of them approves, and the drawer
      // lists everybody.
      const extra = names.length - 2;
      return (
        <span className="text-[13px] text-foreground">
          {names.slice(0, 2).join(', ')}
          {extra > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="ml-1 rounded text-muted-foreground underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  +{extra} more
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <ul className="space-y-0.5">
                  {names.slice(2).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      );
    },
  });

  const columns: ColumnDef<SubjectHeadsRow>[] = [
    {
      id: 'subject',
      accessorFn: (r) => r.name,
      header: ({ column }) => (
        <SortableHeader column={column}>Subject</SortableHeader>
      ),
      meta: { label: 'Subject' },
      cell: ({ row }) => (
        <span className="text-[14px] font-medium text-foreground">
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'code',
      accessorFn: (r) => r.code,
      header: ({ column }) => (
        <SortableHeader column={column}>Code</SortableHeader>
      ),
      meta: { label: 'Code' },
      cell: ({ row }) => (
        <span className="font-mono text-[12px] text-muted-foreground">
          {row.original.code}
        </span>
      ),
    },
    {
      id: 'taught',
      accessorFn: (r) => taughtIn(r).join(' and '),
      header: 'Taught in',
      meta: { label: 'Taught in' },
      enableSorting: false,
      filterFn: oneOf(taughtIn),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-[13px] text-muted-foreground">
          {taughtIn(row.original).join(' and ') || '—'}
        </span>
      ),
    },
    halfColumn('primary'),
    halfColumn('secondary'),
    {
      id: 'status',
      accessorFn: statusOf,
      header: ({ column }) => (
        <SortableHeader column={column}>Status</SortableHeader>
      ),
      meta: { label: 'Status' },
      filterFn: oneOf((r) => [statusOf(r)]),
      cell: ({ row }) =>
        needsAHead(row.original) ? (
          <Badge className="h-6 whitespace-nowrap border-destructive/40 bg-destructive/10 text-destructive">
            {STATUS_GAP}
          </Badge>
        ) : (
          <Badge className="h-6 whitespace-nowrap border-brand-mint bg-brand-mint/30 text-ink">
            {STATUS_READY}
          </Badge>
        ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingId(row.original.subjectId)}
            aria-label={`Edit heads of ${row.original.name}`}
          >
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {rows.length} {rows.length === 1 ? 'subject' : 'subjects'} this year
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            <span className="inline-flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <BookOpen className="size-4" />
              </div>
              Subjects
            </span>
          </CardTitle>
          {rows.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {gaps === 0
                ? 'Every subject has a head.'
                : `${gaps} of ${rows.length} still need a head. Their schemes of work stop at the subject head step until one is set.`}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(r) => r.subjectId}
            searchKeys={['name', 'code']}
            searchPlaceholder="Search subjects"
            facets={[
              {
                columnId: 'status',
                label: 'Status',
                valueOptions: [STATUS_GAP, STATUS_READY],
              },
              {
                columnId: 'taught',
                label: 'Taught in',
                valueOptions: ['Primary', 'Secondary'],
              },
            ]}
            csv={{ filename: `subject-heads-${ayCode ?? 'year'}` }}
            initialSort={[{ id: 'subject', desc: false }]}
            hidePagination={rows.length <= 20}
            emptyState={{
              icon: BookOpen,
              title: 'No subjects this year',
              body: 'Subjects appear here once their weights are set for the current academic year.',
            }}
            emptyFilteredState={{
              title: 'No subjects match.',
              body: 'Clear the search or the filters.',
            }}
          />
        </CardContent>
      </Card>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => !open && setEditingId(null)}
      >
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-md">
          {editing && (
            <HeadsEditor key={editing.subjectId} row={editing} staff={staff} />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function HeadsEditor({
  row,
  staff,
}: {
  row: SubjectHeadsRow;
  staff: SubjectHeadsStaffOption[];
}) {
  const run = useWriteAction();
  const [chosen, setChosen] = useState<SubjectHeadsStaffOption | null>(null);
  const [busy, setBusy] = useState(false);
  const byId = new Map(staff.map((s) => [s.userId, s]));

  const scoped = row.heads.some((h) => h.appliesToLevelType !== null);
  const nameOf = (userId: string) =>
    byId.get(userId)?.displayName ?? '(account removed)';
  const missing = row.heads.length > 0 ? uncoveredHalves(row) : [];

  // Somebody who already heads the subject for every level has nothing left to
  // be given; anyone else can still be added (e.g. Primary, then Secondary).
  const candidates = staff.filter(
    (s) =>
      !s.disabled &&
      !row.heads.some(
        (h) => h.userId === s.userId && h.appliesToLevelType === null
      )
  );

  // "Every level" always; a half only when the subject is taught in BOTH —
  // limiting a Primary-only subject's head to Primary changes nothing.
  const scopeOptions = (
    person: SubjectHeadsStaffOption
  ): Array<Half | null> => {
    const held = row.heads
      .filter((h) => h.userId === person.userId)
      .map((h) => h.appliesToLevelType);
    const halves = row.levelTypes.length > 1 ? row.levelTypes : [];
    return [null, ...halves.filter((h) => !held.includes(h))];
  };

  async function save(
    heads: SubjectHeadsRow['heads'],
    pending: string,
    success: string
  ) {
    setBusy(true);
    await run(
      () =>
        apiFetch('/api/sis-admin/subject-heads', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject_id: row.subjectId,
            heads: heads.map((h) => ({
              user_id: h.userId,
              applies_to_level_type: h.appliesToLevelType,
            })),
          }),
        }),
      { pending, success, onResolved: () => setChosen(null) }
    );
    setBusy(false);
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-serif text-xl font-semibold tracking-tight">
          {row.name}
        </SheetTitle>
        <SheetDescription>
          {row.levelTypes.length > 0
            ? `Taught in ${taughtIn(row).join(' and ')}. `
            : ''}
          Its heads approve its schemes of work.
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 pb-6">
        <section className="space-y-2">
          <h3 className="text-[13px] font-medium text-foreground">
            Subject heads
          </h3>
          {row.heads.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nobody yet. Add someone below.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {row.heads.map((head) => (
                <li
                  key={`${head.userId}-${head.appliesToLevelType ?? 'all'}`}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-foreground">
                      {nameOf(head.userId)}
                    </span>
                    {scoped && (
                      <span
                        className={cn(
                          'text-[12px]',
                          head.appliesToLevelType
                            ? 'text-brand-indigo-deep'
                            : 'text-muted-foreground'
                        )}
                      >
                        {head.appliesToLevelType
                          ? `${HALF_LABEL[head.appliesToLevelType]} only`
                          : 'Every level'}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8"
                    disabled={busy}
                    aria-label={`Remove ${nameOf(head.userId)} as a head of ${row.name}`}
                    onClick={() =>
                      save(
                        row.heads.filter((h) => h !== head),
                        'Removing…',
                        `${nameOf(head.userId)} is no longer a head of ${row.name}.`
                      )
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {missing.length > 0 && (
            <Badge className="h-6 whitespace-nowrap border-destructive/40 bg-destructive/10 text-destructive">
              Nobody for {missing.map((h) => HALF_LABEL[h]).join(' or ')}
            </Badge>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-[13px] font-medium text-foreground">
            Add someone
          </h3>
          {chosen === null ? (
            <Command className="rounded-lg border border-border">
              <CommandInput placeholder="Search staff" />
              <CommandList className="max-h-64">
                <CommandEmpty>No staff account matches.</CommandEmpty>
                {candidates.map((person) => (
                  <CommandItem
                    key={person.userId}
                    value={`${person.displayName} ${person.email}`}
                    disabled={busy}
                    onSelect={() => {
                      // One choice only: nothing more to ask, add them.
                      const options = scopeOptions(person);
                      if (options.length === 1) {
                        void save(
                          [
                            ...row.heads.filter(
                              (h) => h.userId !== person.userId
                            ),
                            { userId: person.userId, appliesToLevelType: null },
                          ],
                          'Adding…',
                          `${person.displayName} now heads ${row.name}.`
                        );
                        return;
                      }
                      setChosen(person);
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px] text-foreground">
                        {person.displayName}
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground">
                        {person.email}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          ) : (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-foreground">
                    {chosen.displayName}
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {chosen.email}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[12px]"
                  onClick={() => setChosen(null)}
                >
                  Change
                </Button>
              </div>
              <p className="text-[13px] font-medium text-foreground">
                Which levels do they head {row.name} for?
              </p>
              <div className="grid gap-2">
                {scopeOptions(chosen).map((option) => (
                  <Button
                    key={option ?? 'all'}
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    disabled={busy}
                    onClick={() =>
                      save(
                        // "Every level" replaces any half they held; a half is
                        // added beside what they hold.
                        option === null
                          ? [
                              ...row.heads.filter(
                                (h) => h.userId !== chosen.userId
                              ),
                              {
                                userId: chosen.userId,
                                appliesToLevelType: null,
                              },
                            ]
                          : [
                              ...row.heads,
                              {
                                userId: chosen.userId,
                                appliesToLevelType: option,
                              },
                            ],
                        'Adding…',
                        option
                          ? `${chosen.displayName} now heads ${row.name} for ${HALF_LABEL[option]}.`
                          : `${chosen.displayName} now heads ${row.name}.`
                      )
                    }
                  >
                    {option ? `${HALF_LABEL[option]} only` : 'Every level'}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
