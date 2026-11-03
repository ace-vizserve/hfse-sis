'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  CircleCheck,
  Clock,
  FileStack,
  FolderInput,
  Link2,
  ListChecks,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { HubStat } from '@/components/sis/hub-stat';
import { PortalCardHeader } from '@/components/sis/parent-portal/portal-card-header';
import { RecoveryLinkDialog } from '@/components/sis/parent-portal/recovery-link-dialog';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import type {
  ApplicationRow,
  RecoveryLinkStatus,
} from '@/lib/parent-portal/recovery';
import type {
  TransferResponse,
  TransferRowResult,
} from '@/lib/parent-portal/transfer';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

const ROUTE = '/api/sis/admin/parent-portal/transfer';
const QUERY_KEY = 'parent-portal-applications';
const KEEPS_NUMBER = new Set(['Current', 'VizSchool Current']);

function plural(count: number): string {
  return `${count} ${count === 1 ? 'application' : 'applications'}`;
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

// §9.3: mint for done, destructive for a link that no longer works, neutral for
// one still waiting on the family.
function LinkStatusBadge({ status }: { status: RecoveryLinkStatus }) {
  if (status === 'Completed') {
    return (
      <Badge
        variant="outline"
        className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
      >
        <CircleCheck className="h-3 w-3" />
        Completed
      </Badge>
    );
  }
  if (status === 'Expired') {
    return (
      <Badge
        variant="outline"
        className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
      >
        <X className="h-3 w-3" />
        Expired
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="h-6">
      <Clock className="h-3 w-3" />
      Pending
    </Badge>
  );
}

function buildColumns(): ColumnDef<ApplicationRow>[] {
  const columns: ColumnDef<ApplicationRow>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: ({ column }) => (
        <SortableHeader column={column}>Name</SortableHeader>
      ),
      meta: { label: 'Name' },
      enableHiding: false,
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      id: 'level',
      accessorFn: (row) => row.level ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Level</SortableHeader>
      ),
      meta: { label: 'Level' },
      cell: ({ row }) =>
        row.original.level ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'enroleeNumber',
      accessorKey: 'enroleeNumber',
      header: ({ column }) => (
        <SortableHeader column={column}>Enrolee number</SortableHeader>
      ),
      meta: { label: 'Enrolee number' },
      cell: ({ row }) => <Mono>{row.original.enroleeNumber}</Mono>,
    },
    {
      id: 'studentNumber',
      accessorFn: (row) => row.studentNumber ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Student number</SortableHeader>
      ),
      meta: { label: 'Student number' },
      cell: ({ row }) => <Mono>{row.original.studentNumber ?? '—'}</Mono>,
    },
    {
      id: 'category',
      accessorFn: (row) => row.category ?? '',
      header: ({ column }) => (
        <SortableHeader column={column}>Category</SortableHeader>
      ),
      meta: { label: 'Category' },
      cell: ({ row }) =>
        row.original.category ?? (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'application',
      accessorFn: (row) =>
        row.applicationMissing ? 'Application missing' : 'On file',
      header: ({ column }) => (
        <SortableHeader column={column}>Application</SortableHeader>
      ),
      meta: { label: 'Application' },
      cell: ({ row }) =>
        row.original.applicationMissing ? (
          <Badge
            variant="outline"
            className="h-6 whitespace-nowrap border-destructive/40 bg-destructive/10 text-destructive"
          >
            <X className="h-3 w-3" />
            Application missing
          </Badge>
        ) : (
          <span className="text-muted-foreground">On file</span>
        ),
    },
    {
      id: 'linkStatus',
      accessorFn: (row) => row.linkStatus ?? 'No link',
      header: ({ column }) => (
        <SortableHeader column={column}>Recovery link</SortableHeader>
      ),
      meta: { label: 'Recovery link' },
      cell: ({ row }) =>
        row.original.linkStatus ? (
          <LinkStatusBadge status={row.original.linkStatus} />
        ) : (
          <span className="text-muted-foreground">No link</span>
        ),
    },
  ];

  return columns;
}

function YearSelect({
  id,
  value,
  options,
  placeholder,
  className = 'w-full',
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  placeholder: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((ayCode) => (
          <SelectItem key={ayCode} value={ayCode}>
            {ayCode}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OldToNew({ from, to }: { from: string | null; to: string }) {
  if (from === to) return <Mono>{to}</Mono>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Mono>{from ?? '—'}</Mono>
      <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
      <span className="font-mono text-[11px] font-medium tabular-nums text-foreground">
        {to}
      </span>
    </span>
  );
}

// §9.3 for moved and failed. Moved with files left behind is still moved, so it
// takes the amber the sibling pages use for a caution, not the red.
function ResultBadge({ result }: { result: TransferRowResult }) {
  if (!result.ok) {
    return (
      <Badge
        variant="outline"
        className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
      >
        <X className="h-3 w-3" />
        Not moved
      </Badge>
    );
  }
  if (result.warning) {
    return (
      <Badge
        variant="outline"
        className="h-6 border-brand-amber/45 bg-brand-amber/10 text-ink"
      >
        <TriangleAlert className="h-3 w-3" />
        Moved, needs a look
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
    >
      <Check className="h-3 w-3" />
      Moved
    </Badge>
  );
}

type Outcome = {
  sourceAy: string;
  targetAy: string;
  response: TransferResponse;
  /** Names from the rows ticked: a failed move's answer has no row to read. */
  names: Map<string, string>;
  /** Old student numbers, from the same rows. */
  studentNumbers: Map<string, string | null>;
};

function outcomeTitle({ moved, failed }: TransferResponse): string {
  if (failed === 0) return `${plural(moved)} moved`;
  if (moved === 0) return `${plural(failed)} not moved`;
  return `${moved} moved, ${failed} not moved`;
}

function ResultsCard({ outcome }: { outcome: Outcome }) {
  const { response, names, studentNumbers, sourceAy, targetAy } = outcome;
  return (
    <Card className="gap-0 py-0">
      <PortalCardHeader
        className="border-b border-border py-5"
        eyebrow={`${sourceAy} to ${targetAy}`}
        title={outcomeTitle(response)}
        icon={ListChecks}
      />
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Name</TableHead>
            <TableHead>Enrolee number</TableHead>
            <TableHead>Student number</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {response.results.map((result) => {
            const note = result.ok ? result.warning : result.error;
            return (
              <TableRow key={result.enroleeNumber}>
                <TableCell className="whitespace-normal align-top">
                  <p className="font-medium text-foreground">
                    {names.get(result.enroleeNumber) ?? result.enroleeNumber}
                  </p>
                  {note && (
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                      {note}
                    </p>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  {result.ok ? (
                    <OldToNew
                      from={result.enroleeNumber}
                      to={result.newEnroleeNumber}
                    />
                  ) : (
                    <Mono>{result.enroleeNumber}</Mono>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  {result.ok ? (
                    <OldToNew
                      from={result.oldStudentNumber}
                      to={result.newStudentNumber}
                    />
                  ) : (
                    <Mono>
                      {studentNumbers.get(result.enroleeNumber) ?? '—'}
                    </Mono>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <ResultBadge result={result} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

export function ApplicationsTab({
  ayCodes,
  initialAy,
  initialApplications,
  canAct,
}: {
  ayCodes: string[];
  initialAy: string;
  initialApplications: ApplicationRow[];
  canAct: boolean;
}) {
  const [sourceAy, setSourceAy] = useState(initialAy);
  const [targetAy, setTargetAy] = useState('');
  const [picked, setPicked] = useState<ApplicationRow[] | null>(null);
  const [moving, setMoving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [clearTicks, setClearTicks] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  // `opened` remounts the dialog per opening, so each one checks the record
  // afresh. The student stays set while the dialog animates closed.
  const [linkFor, setLinkFor] = useState<ApplicationRow | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [opened, setOpened] = useState(0);

  const queryClient = useQueryClient();
  const run = useWriteAction();

  const list = useQuery({
    queryKey: [QUERY_KEY, sourceAy],
    queryFn: () =>
      apiFetch<{ applications: ApplicationRow[] }>(
        `${ROUTE}?ay=${encodeURIComponent(sourceAy)}`
      ),
    enabled: !!sourceAy,
    initialData:
      sourceAy === initialAy
        ? { applications: initialApplications }
        : undefined,
  });
  const applications = useMemo(
    () => list.data?.applications ?? [],
    [list.data]
  );

  // A record with no application has nothing to move, so it is in neither count.
  const missing = applications.filter((a) => a.applicationMissing).length;
  const keepNumber = applications.filter(
    (a) => !a.applicationMissing && a.category && KEEPS_NUMBER.has(a.category)
  ).length;

  const columns = useMemo(() => buildColumns(), []);

  const mutation = useMutation({
    mutationFn: (values: {
      sourceAy: string;
      targetAy: string;
      enroleeNumbers: string[];
    }) => apiFetch<TransferResponse>(ROUTE, jsonInit('POST', values)),
  });

  // The bulk bar sits at the bottom of a long table; the answer is above it.
  useEffect(() => {
    if (outcome) resultsRef.current?.scrollIntoView({ block: 'nearest' });
  }, [outcome]);

  async function move() {
    if (!picked) return;
    const rows = picked;
    setMoving(true);
    await run(
      () =>
        mutation.mutateAsync({
          sourceAy,
          targetAy,
          enroleeNumbers: rows.map((row) => row.enroleeNumber),
        }),
      {
        pending: `Moving ${plural(rows.length)}…`,
        // The results card says it when anything went wrong, row by row.
        success: (response) =>
          response.failed === 0 &&
          response.results.every((r) => !r.ok || !r.warning)
            ? {
                title: `${plural(response.moved)} moved`,
                description: `From ${sourceAy} to ${targetAy}.`,
              }
            : null,
        onResolved: (response) => {
          setOutcome({
            sourceAy,
            targetAy,
            response,
            names: new Map(rows.map((row) => [row.enroleeNumber, row.name])),
            studentNumbers: new Map(
              rows.map((row) => [row.enroleeNumber, row.studentNumber])
            ),
          });
          setClearTicks((n) => n + 1);
        },
      }
    );
    // Even after an error: an answer lost on the way back may have moved some.
    await queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    setPicked(null);
    setMoving(false);
  }

  return (
    // `contain`: the table scrolls inside its card rather than widening the page.
    <div className="space-y-5" style={{ contain: 'inline-size' }}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <HubStat
          label={`Students in ${sourceAy || 'this year'}`}
          value={applications.length}
          icon={FileStack}
          tone="brand"
          subtext={
            missing > 0
              ? `${missing} with no application on file`
              : 'In the year chosen below'
          }
          emphasize
        />
        <HubStat
          label="Keep their number"
          value={keepNumber}
          icon={Users}
          tone="mint"
          subtext="Current and VizSchool Current"
        />
        <HubStat
          label="Get a new number"
          value={applications.length - missing - keepNumber}
          icon={UserPlus}
          tone="muted"
          subtext="New and VizSchool New"
        />
      </div>

      {outcome && (
        <div ref={resultsRef}>
          <ResultsCard outcome={outcome} />
        </div>
      )}

      <Card>
        <PortalCardHeader
          eyebrow={`${applications.length} student${applications.length === 1 ? '' : 's'}${canAct ? '' : ' · Read-only for your role'}`}
          title={`Applications in ${sourceAy}`}
          icon={FolderInput}
          action={
            <Field orientation="horizontal" className="w-auto gap-2">
              <FieldLabel
                htmlFor="applications-year"
                className="whitespace-nowrap"
              >
                {canAct ? 'From year' : 'Year'}
              </FieldLabel>
              <YearSelect
                id="applications-year"
                value={sourceAy}
                options={ayCodes}
                placeholder="Choose a year"
                className="w-32"
                onChange={setSourceAy}
              />
            </Field>
          }
        />
        <CardContent>
          {list.isError ? (
            <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
                <TriangleAlert className="size-4" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="space-y-1.5">
                  <p className="font-serif text-base font-semibold text-foreground">
                    Could not load the applications for {sourceAy}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {list.error.message}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void list.refetch()}
                >
                  Try again
                </Button>
              </div>
            </div>
          ) : list.isPending ? (
            <Skeleton className="h-96 w-full rounded-xl" />
          ) : (
            <DataTable<ApplicationRow>
              // A new year is a new list: no ticks or level filter carry over.
              key={sourceAy}
              data={applications}
              columns={columns}
              getRowId={(row) => row.enroleeNumber}
              searchKeys={['name', 'enroleeNumber', 'studentNumber']}
              searchPlaceholder="Search name or number…"
              facets={[{ columnId: 'level', label: 'Level' }]}
              initialSort={[{ id: 'name', desc: false }]}
              // Eight columns run off a laptop screen. It stays in the Columns
              // menu and in the search.
              initialColumnVisibility={{ studentNumber: false }}
              pageSize={25}
              selection={
                canAct
                  ? {
                      enabled: true,
                      bulkActions: [
                        {
                          key: 'send-link',
                          label: 'Send link',
                          icon: Link2,
                          secondary: true,
                          // One family's record and emails at a time.
                          showFor: (rows) => rows.length === 1,
                          onTrigger: ([row]) => {
                            setLinkFor(row);
                            setOpened((n) => n + 1);
                            setLinkOpen(true);
                          },
                        },
                        {
                          key: 'move',
                          label: 'Move to another year',
                          icon: ArrowRightLeft,
                          // No application row, nothing to move.
                          showFor: (rows) =>
                            rows.every((row) => !row.applicationMissing),
                          onTrigger: (rows) => {
                            setTargetAy('');
                            setPicked(rows);
                          },
                        },
                      ],
                    }
                  : undefined
              }
              selectionResetSignal={clearTicks}
              emptyState={{
                icon: FolderInput,
                title: `No applications in ${sourceAy}.`,
                body: 'Choose another year.',
              }}
              emptyFilteredState={{
                title: 'No applications match.',
                body: 'Try another name, number or level.',
              }}
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={picked !== null}
        onOpenChange={(open) => {
          if (!open && !moving) setPicked(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">
              Move {plural(picked?.length ?? 0)} to another year?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The application, documents, status and files of each student leave{' '}
              {sourceAy}. Each gets a new enrolee number. Current students keep
              their student number; new students get a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="applications-to-year">To year</FieldLabel>
            <YearSelect
              id="applications-to-year"
              value={targetAy}
              options={ayCodes.filter((ayCode) => ayCode !== sourceAy)}
              placeholder="Choose a year"
              onChange={setTargetAy}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={moving || !targetAy}
              onClick={(e) => {
                // Stays open while it runs: this can take a while.
                e.preventDefault();
                void move();
              }}
            >
              {moving ? 'Moving…' : `Move ${plural(picked?.length ?? 0)}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canAct && linkFor && (
        <RecoveryLinkDialog
          key={opened}
          student={linkFor}
          open={linkOpen}
          onOpenChange={setLinkOpen}
          onChanged={() =>
            queryClient.invalidateQueries({ queryKey: [QUERY_KEY] })
          }
        />
      )}
    </div>
  );
}
