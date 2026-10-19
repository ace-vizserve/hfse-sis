'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ReviewRow } from '@/lib/billing/review.server';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

type Busy = { studentNumber: string; what: string } | null;

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
          <div className="space-y-0.5">
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
        accessorFn: (r) => r.reason,
        header: 'Why',
        meta: { label: 'Why' },
        cell: ({ row }) => (
          <span className="block min-w-48 text-sm text-muted-foreground">
            {row.original.reason}
          </span>
        ),
        enableSorting: false,
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
            <div className="flex flex-wrap gap-1.5">
              {row.original.candidates.map((c) => (
                <Button
                  key={c.customerId}
                  size="sm"
                  variant="outline"
                  disabled={
                    !!busy || c.reason === 'already linked to another student'
                  }
                  loading={
                    busy?.studentNumber === row.original.studentNumber &&
                    busy.what === c.customerId
                  }
                  loadingText="Linking…"
                  className="h-auto py-1 text-left"
                  onClick={() => {
                    setBusy({
                      studentNumber: row.original.studentNumber,
                      what: c.customerId,
                    });
                    void run(
                      () =>
                        link.mutateAsync({
                          studentNumber: row.original.studentNumber,
                          customerId: c.customerId,
                        }),
                      {
                        pending: 'Linking and reading their invoices…',
                        success: (d) =>
                          `${row.original.name} linked to ${d.displayName}`,
                      }
                    ).finally(() => setBusy(null));
                  }}
                >
                  <span>
                    {c.displayName}
                    <span className="ml-1 text-muted-foreground">
                      · {c.reason}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          ),
        enableSorting: false,
      },
      {
        id: 'actions',
        header: () => <div className="text-right">Action</div>,
        meta: { label: 'Action', excludeFromExport: true },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0"
              disabled={!!busy || !row.original.newName}
              onClick={() => setAdd(row.original)}
            >
              Add to QuickBooks
            </Button>
            <span className="h-4 w-px bg-border" aria-hidden />
            <Button
              size="sm"
              variant="link"
              className="h-auto p-0"
              disabled={!!busy}
              onClick={() => {
                setPickKey((k) => k + 1);
                setPick(row.original);
              }}
            >
              Pick another
            </Button>
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [busy, link, run]
  );

  return (
    <>
      <Tabs defaultValue={focusGroup ?? defaultKey} className="gap-4">
        <TabsList variant="line">
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
                initialSearch={
                  focus && g.key === focusGroup ? focus : undefined
                }
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
    </>
  );
}
