'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { BookOpen, UserPlus, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch } from '@/lib/query/fetcher';
import { cn } from '@/lib/utils';

// The Subject heads screen: one row per subject offered this year, each with
// its heads as chips and an inline "Add someone" picker (1–2 fields, so it
// stays in the row — no drawer, no dialog).
//
// ⚠ EVERY CHANGE SENDS THE SUBJECT'S WHOLE LIST. The route sets a subject's
// heads to exactly what it is sent, so adding or removing one person is the
// current list plus or minus that person.
//
// ⚠ THE GAP IS SHOWN PER SUBJECT, AND PER HALF. A subject taught in Primary and
// Secondary whose only head covers Primary still stalls every Secondary
// scheme of work — the approvers screen only says whether ANY head exists.

type Half = 'primary' | 'secondary';

export type SubjectHeadsStaffOption = {
  userId: string;
  email: string;
  displayName: string;
  /** Switched off: still named on a chip, never offered in the picker. */
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

export function SubjectHeadsClient({
  rows,
  staff,
}: {
  rows: SubjectHeadsRow[];
  staff: SubjectHeadsStaffOption[];
}) {
  const byId = new Map(staff.map((s) => [s.userId, s]));
  const gaps = rows.filter(needsAHead).length;

  const columns: ColumnDef<SubjectHeadsRow>[] = [
    {
      id: 'subject',
      accessorFn: (r) => r.name,
      header: ({ column }) => (
        <SortableHeader column={column}>Subject</SortableHeader>
      ),
      meta: { label: 'Subject' },
      cell: ({ row }) => (
        <div className="min-w-[10rem] space-y-0.5">
          <p className="text-[14px] font-medium text-foreground">
            {row.original.name}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {row.original.levelTypes.length > 0
              ? `Taught in ${row.original.levelTypes.map((h) => HALF_LABEL[h]).join(' and ')}`
              : row.original.code}
          </p>
        </div>
      ),
    },
    {
      id: 'heads',
      accessorFn: (r) =>
        r.heads.map((h) => byId.get(h.userId)?.displayName ?? '').join(', '),
      header: 'Subject heads',
      meta: { label: 'Subject heads' },
      enableSorting: false,
      cell: ({ row }) => <HeadsCell row={row.original} staff={staff} />,
    },
    {
      id: 'status',
      accessorFn: (r) => (needsAHead(r) ? 'Needs a head' : 'Set'),
      header: ({ column }) => (
        <SortableHeader column={column}>Status</SortableHeader>
      ),
      meta: { label: 'Status' },
      cell: ({ row }) => <StatusBadge row={row.original} />,
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        {rows.length === 0
          ? 'No subjects are set up for this year yet.'
          : gaps === 0
            ? `Every subject has a head. ${rows.length} ${rows.length === 1 ? 'subject' : 'subjects'} this year.`
            : `${gaps} of ${rows.length} subjects still need a head. Their schemes of work stop at the subject head step until one is set.`}
      </p>
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(r) => r.subjectId}
        searchKeys={['name', 'code']}
        searchPlaceholder="Search subjects"
        initialSort={[{ id: 'subject', desc: false }]}
        hidePagination
        pageSize={200}
        // Two groups, one at a time — no "all" view. The gaps come first
        // because they are the work; a fully set school opens on an empty
        // tab that says so.
        statusTabs={[
          {
            value: 'needs',
            label: 'Needs a head',
            predicate: needsAHead,
            isDefault: true,
            emptyState: {
              icon: BookOpen,
              title: 'Every subject has a head',
              body: 'Open “Has a head” to change who heads a subject.',
            },
          },
          {
            value: 'set',
            label: 'Has a head',
            predicate: (r) => !needsAHead(r),
            emptyState: {
              icon: BookOpen,
              title: 'No subject has a head yet',
              body: 'Add someone to a subject under “Needs a head”.',
            },
          },
        ]}
        emptyState={{
          icon: BookOpen,
          title: 'No subjects this year',
          body: 'Subjects appear here once their weights are set for the current academic year.',
        }}
      />
    </div>
  );
}

function StatusBadge({ row }: { row: SubjectHeadsRow }) {
  if (row.heads.length === 0) {
    return (
      <Badge className="h-6 border-destructive/40 bg-destructive/10 text-destructive">
        No subject head yet
      </Badge>
    );
  }
  const missing = uncoveredHalves(row);
  if (missing.length > 0) {
    return (
      <Badge className="h-6 border-destructive/40 bg-destructive/10 text-destructive">
        Nobody for {missing.map((h) => HALF_LABEL[h]).join(' or ')}
      </Badge>
    );
  }
  return (
    <Badge className="h-6 border-brand-mint bg-brand-mint/30 text-ink">
      Set
    </Badge>
  );
}

function HeadsCell({
  row,
  staff,
}: {
  row: SubjectHeadsRow;
  staff: SubjectHeadsStaffOption[];
}) {
  const run = useWriteAction();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<SubjectHeadsStaffOption | null>(null);
  const [busy, setBusy] = useState(false);
  const byId = new Map(staff.map((s) => [s.userId, s]));

  const scoped = row.heads.some((h) => h.appliesToLevelType !== null);
  const nameOf = (userId: string) =>
    byId.get(userId)?.displayName ?? '(account removed)';

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
      {
        pending,
        success,
        onResolved: () => {
          setOpen(false);
          setChosen(null);
        },
      }
    );
    setBusy(false);
  }

  return (
    <div className="flex min-w-[16rem] flex-wrap items-center gap-2">
      {row.heads.map((head) => (
        <span
          key={`${head.userId}-${head.appliesToLevelType ?? 'all'}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 py-1 pr-1 pl-2.5 text-[13px] text-foreground"
        >
          {nameOf(head.userId)}
          {scoped && (
            <span
              className={cn(
                'text-[11px] font-medium',
                head.appliesToLevelType
                  ? 'text-brand-indigo-deep'
                  : 'text-muted-foreground'
              )}
            >
              {head.appliesToLevelType
                ? HALF_LABEL[head.appliesToLevelType]
                : 'Every level'}
            </span>
          )}
          <Button
            variant="outline"
            size="icon"
            className="size-5"
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
            <X className="size-3" />
          </Button>
        </span>
      ))}

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setChosen(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            <UserPlus className="size-3.5" />
            Add someone
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          {chosen === null ? (
            <Command>
              <CommandInput placeholder="Search staff" />
              <CommandList>
                <CommandEmpty>No staff account matches.</CommandEmpty>
                {candidates.map((person) => (
                  <CommandItem
                    key={person.userId}
                    value={`${person.displayName} ${person.email}`}
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
            <div className="space-y-3 p-4">
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
