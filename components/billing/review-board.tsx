'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Link2, UserPlus } from 'lucide-react';

import { PickCustomerSheet } from '@/components/billing/pick-customer-sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ReviewRow } from '@/lib/billing/review.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { formatSgd } from '@/lib/qbo/format';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Busy = { studentNumber: string; what: string } | null;
type Bulk = { kind: 'link' | 'add'; rows: ReviewRow[] } | null;

const TAKEN = 'already linked to another student';

// The reason in a few words, for the Why column and its filter; the full
// sentence shows on hover.
function whyLabel(reason: string): string {
  if (reason.startsWith('No QuickBooks customer')) return 'No match';
  if (reason.startsWith('The matching customer is already linked'))
    return 'Match already linked';
  if (reason.startsWith('The typed invoice number'))
    return 'Invoice under another name';
  if (reason.startsWith('More than one')) return 'Several matches';
  return 'Needs a check';
}

// The one suggestion a bulk Link can use: a student with exactly one
// customer still free to link. Two or more need a person to choose.
function soleCandidate(r: ReviewRow) {
  const free = r.candidates.filter((c) => c.reason !== TAKEN);
  return free.length === 1 ? free[0] : null;
}

export function ReviewBoard({
  groups,
  defaultKey,
  focus,
}: {
  groups: Array<{ key: string; label: string; rows: ReviewRow[] }>;
  defaultKey: string;
  /** `?student=` — open on that student's group, searched for them. */
  focus: string | null;
}) {
  const run = useWriteAction();
  const [busy, setBusy] = React.useState<Busy>(null);
  const [pick, setPick] = React.useState<ReviewRow | null>(null);
  const [add, setAdd] = React.useState<ReviewRow | null>(null);
  const [pickKey, setPickKey] = React.useState(0);
  const [bulk, setBulk] = React.useState<Bulk>(null);
  const [reset, setReset] = React.useState(0);
  const focusGroup = focus
    ? groups.find((g) => g.rows.some((r) => r.studentNumber === focus))?.key
    : undefined;

  const link = useMutation({
    mutationFn: (v: { studentNumber: string; customerId: string }) =>
      apiFetch<{ displayName: string }>(
        `/api/billing/students/${encodeURIComponent(v.studentNumber)}/link`,
        jsonInit('POST', { customerId: v.customerId })
      ),
  });
  const create = useMutation({
    mutationFn: (studentNumber: string) =>
      apiFetch<{ displayName: string }>(
        `/api/billing/students/${encodeURIComponent(studentNumber)}/customer`,
        jsonInit('POST', {})
      ),
  });

  // Bulk Link / Add: one student at a time, so QuickBooks is never asked for
  // many writes at once; the ones that fail are named in the toast.
  async function runBulk(kind: 'link' | 'add', rows: ReviewRow[]) {
    const targets =
      kind === 'link'
        ? rows.filter((r) => soleCandidate(r))
        : rows.filter((r) => r.newName);
    if (targets.length === 0) return;
    await run(
      async () => {
        const failed: string[] = [];
        for (const r of targets) {
          try {
            if (kind === 'link')
              await link.mutateAsync({
                studentNumber: r.studentNumber,
                customerId: soleCandidate(r)!.customerId,
              });
            else await create.mutateAsync(r.studentNumber);
          } catch (e) {
            failed.push(
              `${r.name}: ${e instanceof Error ? e.message : 'not saved'}`
            );
          }
        }
        if (failed.length === targets.length)
          throw new Error(failed.join(' · '));
        return { done: targets.length - failed.length, failed };
      },
      {
        pending:
          kind === 'link'
            ? `Linking ${targets.length} ${targets.length === 1 ? 'student' : 'students'}…`
            : `Adding ${targets.length} ${targets.length === 1 ? 'student' : 'students'} to QuickBooks…`,
        success: (d) => {
          const verb = kind === 'link' ? 'linked' : 'added to QuickBooks';
          return d.failed.length
            ? {
                title: `${d.done} ${verb}, ${d.failed.length} not`,
                description: d.failed.join(' · '),
              }
            : `${d.done} ${d.done === 1 ? 'student' : 'students'} ${verb}`;
        },
        onResolved: () => setReset((n) => n + 1),
      }
    );
  }

  const bulkTargets = bulk
    ? bulk.kind === 'link'
      ? bulk.rows.filter((r) => soleCandidate(r))
      : bulk.rows.filter((r) => r.newName)
    : [];
  const bulkSkipped = bulk ? bulk.rows.length - bulkTargets.length : 0;

  const linkTo = React.useCallback(
    (row: ReviewRow, customerId: string, displayName: string) => {
      setBusy({ studentNumber: row.studentNumber, what: customerId });
      void run(
        () =>
          link.mutateAsync({ studentNumber: row.studentNumber, customerId }),
        {
          pending: 'Linking and reading their invoices…',
          success: (d) =>
            `${row.name} linked to ${d.displayName ?? displayName}`,
        }
      ).finally(() => setBusy(null));
    },
    [link, run]
  );

  // Student · Why (short, a facet) · the QuickBooks customers that could be
  // theirs, one line each with what QuickBooks holds and its own Link ·
  // Action: Pick another, ▾ Add to QuickBooks.
  const columns = React.useMemo<ColumnDef<ReviewRow, unknown>[]>(
    () => [
      {
        id: 'student',
        accessorFn: (r) => r.name,
        header: ({ column }) => (
          <SortableHeader column={column}>Student</SortableHeader>
        ),
        meta: { label: 'Student' },
        cell: ({ row }) => (
          <div className="min-w-52 space-y-0.5">
            <div className="font-medium text-foreground">
              {row.original.name}
            </div>
            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {row.original.studentNumber}
              {row.original.level ? ` · ${row.original.level}` : ''}
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: 'why',
        accessorFn: (r) => whyLabel(r.reason),
        header: ({ column }) => (
          <SortableHeader column={column}>Why</SortableHeader>
        ),
        meta: { label: 'Why' },
        filterFn: (row, id, value: string[]) =>
          !value?.length || value.includes(row.getValue<string>(id)),
        cell: ({ row }) => (
          <span
            className="whitespace-nowrap text-sm text-foreground"
            title={row.original.reason}
          >
            {whyLabel(row.original.reason)}
          </span>
        ),
      },
      {
        id: 'suggested',
        accessorFn: (r) => r.candidates.map((c) => c.displayName).join(', '),
        header: 'Suggested customers',
        meta: { label: 'Suggested customers' },
        cell: ({ row }) =>
          row.original.candidates.length === 0 ? (
            <span className="text-sm text-muted-foreground">None</span>
          ) : (
            <ul className="min-w-80 divide-y divide-hairline">
              {row.original.candidates.map((c) => {
                const taken = c.reason === TAKEN;
                const d = c.details;
                return (
                  <li
                    key={c.customerId}
                    className="flex items-center gap-4 py-1.5 first:pt-0 last:pb-0"
                  >
                    {/* What QuickBooks holds, so look-alike names can be
                        told apart: the parents and the open balance. */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {c.displayName}
                      </div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {d
                          ? [
                              d.companyName ?? 'No parents listed',
                              `${formatSgd(d.balance)} open`,
                              !d.active && 'Inactive in QuickBooks',
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : 'Details couldn’t be read'}
                      </div>
                    </div>
                    {taken ? (
                      <span className="shrink-0 text-[12px] text-muted-foreground">
                        Linked to another student
                      </span>
                    ) : (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto shrink-0 p-0"
                        disabled={!!busy}
                        loading={
                          busy?.studentNumber === row.original.studentNumber &&
                          busy.what === c.customerId
                        }
                        loadingText="Linking…"
                        onClick={() =>
                          linkTo(row.original, c.customerId, c.displayName)
                        }
                      >
                        Link
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          ),
        enableSorting: false,
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Action</div>,
        meta: { label: 'Action', excludeFromExport: true },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              disabled={!!busy}
              onClick={() => {
                setPickKey((k) => k + 1);
                setPick(row.original);
              }}
            >
              Pick another
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={!!busy}
                  aria-label={`More for ${row.original.name}`}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  disabled={!row.original.newName}
                  onSelect={() => setAdd(row.original)}
                >
                  <UserPlus className="size-4" />
                  Add to QuickBooks
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [busy, linkTo]
  );

  return (
    <>
      <Tabs defaultValue={focusGroup ?? defaultKey} className="gap-4">
        <TabsList>
          {groups.map((g) => (
            <TabsTrigger key={g.key} value={g.key}>
              {g.label}{' '}
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {g.rows.length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map((g) => (
          <TabsContent key={g.key} value={g.key}>
            {g.rows.length === 0 ? (
              <Card className="py-0">
                <DataTableEmptyState
                  icon={CheckCircle2}
                  title={`Nobody to review in ${g.label}`}
                  body="Every student in this group is linked to their QuickBooks customer."
                />
              </Card>
            ) : (
              <DataTable<ReviewRow>
                data={g.rows}
                columns={columns}
                getRowId={(r) => r.studentNumber}
                searchKeys={[(r) => r.name, (r) => r.studentNumber]}
                searchPlaceholder="Search name or student number"
                facets={[
                  {
                    columnId: 'why',
                    label: 'Why',
                    valueOptions: [
                      ...new Set(g.rows.map((r) => whyLabel(r.reason))),
                    ].sort(),
                  },
                ]}
                initialSearch={
                  focus && g.key === focusGroup ? focus : undefined
                }
                selection={{
                  enabled: true,
                  bulkActions: [
                    {
                      key: 'link',
                      label: 'Link to suggested customer',
                      icon: Link2,
                      onTrigger: (selected) =>
                        setBulk({ kind: 'link', rows: selected }),
                    },
                    {
                      key: 'add',
                      label: 'Add to QuickBooks',
                      icon: UserPlus,
                      onTrigger: (selected) =>
                        setBulk({ kind: 'add', rows: selected }),
                    },
                  ],
                }}
                selectionResetSignal={reset}
                initialSort={[{ id: 'student', desc: false }]}
                pageSize={25}
                emptyFilteredState={{
                  title: 'No students match.',
                  body: 'Clear the search to see everyone in this group.',
                }}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>

      {pick && (
        <PickCustomerSheet
          key={pickKey}
          open
          onOpenChange={(o) => !o && setPick(null)}
          studentNumber={pick.studentNumber}
          studentName={pick.name}
          initialSearch={pick.name.split(',')[0] ?? ''}
        />
      )}

      <AlertDialog open={!!add} onOpenChange={(o) => !o && setAdd(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add {add?.name} to QuickBooks?</AlertDialogTitle>
            <AlertDialogDescription>
              A new QuickBooks customer named “{add?.newName}” is created, with
              the parents as Company name, and linked to this student. Only do
              this when they really have no customer yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const row = add!;
                setAdd(null);
                setBusy({ studentNumber: row.studentNumber, what: 'add' });
                void run(() => create.mutateAsync(row.studentNumber), {
                  pending: 'Adding to QuickBooks…',
                  success: (d) =>
                    `${d.displayName} added to QuickBooks and linked`,
                }).finally(() => setBusy(null));
              }}
            >
              Add to QuickBooks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!bulk} onOpenChange={(o) => !o && setBulk(null)}>
        <AlertDialogContent>
          {bulkTargets.length === 0 ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {bulk?.kind === 'link'
                    ? 'These students need a person to choose'
                    : 'These students can’t be added'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {bulk?.kind === 'link'
                    ? 'Each one has no suggested customer, or more than one. Click the right suggestion in their row, or use Pick another.'
                    : 'None of them has a first and last name on record to name the customer.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {bulk?.kind === 'link'
                    ? `Link ${bulkTargets.length} ${bulkTargets.length === 1 ? 'student' : 'students'} to their suggested customer?`
                    : `Add ${bulkTargets.length} ${bulkTargets.length === 1 ? 'student' : 'students'} to QuickBooks?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {bulk?.kind === 'link'
                    ? 'Each student is linked to the one QuickBooks customer suggested for them, and their invoices are read.'
                    : 'A new QuickBooks customer is created for each student, with the parents as Company name, and linked to them. Only do this when they really have no customer yet.'}
                  {bulkSkipped > 0 &&
                    ` ${bulkSkipped} of the ${bulk?.rows.length} selected ${bulkSkipped === 1 ? 'is' : 'are'} left out: ${
                      bulk?.kind === 'link'
                        ? 'they have no suggestion, or more than one, so choose for them in their row.'
                        : 'they have no first and last name on record.'
                    }`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const b = bulk!;
                    setBulk(null);
                    void runBulk(b.kind, b.rows);
                  }}
                >
                  {bulk?.kind === 'link' ? 'Link' : 'Add to QuickBooks'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
