'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import { formatStamp } from '@/lib/events/display';
import {
  formatAnswer,
  formatSignature,
  questionColumns,
} from '@/lib/events/export-columns';
import type { EventForm, EventQuestion } from '@/lib/events/form';
import type { NotRegisteredRow, RegistrationRow } from '@/lib/events/staff';

// One event's children in three tabs: Registered, Not joining, Not registered
// yet. The form's questions become columns, so the CSV carries them too.

type Tab = 'registered' | 'not_joining' | 'not_registered';

type Row = {
  key: string;
  tab: Tab;
  studentNumber: string;
  studentName: string;
  className: string;
  registeredBy: string;
  email: string;
  handphone: string;
  reason: string;
  registeredAt: string;
  answers: Record<string, string>;
};

export function RegistrationsTable({
  eventTitle,
  form,
  registered,
  notJoining,
  notRegistered,
}: {
  eventTitle: string;
  form: EventForm;
  registered: RegistrationRow[];
  notJoining: RegistrationRow[];
  notRegistered: NotRegisteredRow[];
}) {
  const qCols = useMemo(() => questionColumns(form), [form]);
  const questions = useMemo(() => {
    const m = new Map<string, EventQuestion>();
    for (const s of form.sections) for (const q of s.questions) m.set(q.id, q);
    return m;
  }, [form]);

  const rows = useMemo<Row[]>(() => {
    const fromReg = (r: RegistrationRow, tab: Tab): Row => {
      const answers: Record<string, string> = {};
      for (const c of qCols) {
        const q = questions.get(c.id);
        if (q?.type === 'signature') {
          answers[c.id] = formatSignature(r.signature);
          continue;
        }
        const source = c.scope === 'family' ? r.familyAnswers : r.answers;
        answers[c.id] = formatAnswer(q, source[c.id]);
      }
      return {
        key: `${tab}:${r.studentNumber}`,
        tab,
        studentNumber: r.studentNumber,
        studentName: r.studentName,
        className: r.className,
        registeredBy: r.registeredBy.name,
        email: r.registeredBy.email,
        handphone: r.handphone,
        reason: r.reason ?? '',
        registeredAt: r.updatedAt,
        answers,
      };
    };
    return [
      ...registered.map((r) => fromReg(r, 'registered')),
      ...notJoining.map((r) => fromReg(r, 'not_joining')),
      ...notRegistered.map<Row>((r) => ({
        key: `not_registered:${r.studentNumber}`,
        tab: 'not_registered',
        studentNumber: r.studentNumber,
        studentName: r.studentName,
        className: r.className,
        registeredBy: '',
        email: '',
        handphone: '',
        reason: '',
        registeredAt: '',
        answers: {},
      })),
    ];
  }, [registered, notJoining, notRegistered, qCols, questions]);

  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const cols: ColumnDef<Row, unknown>[] = [
      {
        id: 'student',
        accessorFn: (r) => r.studentName,
        header: ({ column }) => (
          <SortableHeader column={column}>Student</SortableHeader>
        ),
        meta: { label: 'Student' },
        enableHiding: false,
        cell: ({ row }) => (
          <div className="min-w-44">
            <div className="font-medium">{row.original.studentName}</div>
          </div>
        ),
      },
      {
        id: 'studentNumber',
        accessorFn: (r) => r.studentNumber,
        header: 'Student number',
        meta: { label: 'Student number' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[13px] text-muted-foreground">
            {row.original.studentNumber}
          </span>
        ),
      },
      {
        id: 'class',
        accessorFn: (r) => r.className,
        header: ({ column }) => (
          <SortableHeader column={column}>Class</SortableHeader>
        ),
        meta: { label: 'Class' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {row.original.className}
          </span>
        ),
      },
      {
        id: 'registeredBy',
        accessorFn: (r) => r.registeredBy,
        header: ({ column }) => (
          <SortableHeader column={column}>Registered by</SortableHeader>
        ),
        meta: { label: 'Registered by' },
        cell: ({ row }) =>
          row.original.registeredBy ? (
            <div className="min-w-40">
              <div className="text-sm">{row.original.registeredBy}</div>
            </div>
          ) : null,
      },
      {
        id: 'parentEmail',
        accessorFn: (r) => r.email,
        header: 'Parent email',
        meta: { label: 'Parent email' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.email}
          </span>
        ),
      },
      {
        id: 'handphone',
        accessorFn: (r) => r.handphone,
        header: 'Handphone',
        meta: { label: 'Handphone' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[13px] tabular-nums text-muted-foreground">
            {row.original.handphone}
          </span>
        ),
      },
      {
        id: 'reason',
        accessorFn: (r) => r.reason,
        header: 'Reason',
        meta: { label: 'Reason' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block min-w-48 text-sm text-muted-foreground">
            {row.original.reason}
          </span>
        ),
      },
    ];
    for (const c of qCols) {
      cols.push({
        id: `q:${c.id}`,
        accessorFn: (r) => r.answers[c.id] ?? '',
        header: () => <span className="block min-w-48">{c.label}</span>,
        meta: { label: c.label },
        enableSorting: false,
        cell: ({ row }) => {
          const v = row.original.answers[c.id];
          return v ? (
            <span className="block min-w-48 text-sm">{v}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      });
    }
    cols.push({
      id: 'registeredAt',
      accessorFn: (r) => r.registeredAt,
      header: ({ column }) => (
        <SortableHeader column={column}>Registered</SortableHeader>
      ),
      meta: { label: 'Registered' },
      cell: ({ row }) =>
        row.original.tab === 'not_registered' ? (
          <Badge
            variant="outline"
            className="h-6 border-brand-amber bg-brand-amber/20 px-2.5 text-xs font-medium text-ink"
          >
            Not registered yet
          </Badge>
        ) : (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatStamp(row.original.registeredAt)}
          </span>
        ),
    });
    return cols;
  }, [qCols]);

  // A form with many questions makes a very wide table. inline-size containment stops it
  // stretching the page, so it scrolls sideways inside its own box.
  return (
    <div style={{ contain: 'inline-size' }}>
      <DataTable<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.key}
        initialColumnVisibility={{ reason: notJoining.length > 0 }}
        searchKeys={[
          (r) => r.studentName,
          (r) => r.studentNumber,
          (r) => r.registeredBy,
        ]}
        searchPlaceholder="Search by student or parent"
        statusTabs={[
          {
            value: 'registered',
            label: 'Registered',
            predicate: (r) => r.tab === 'registered',
            isDefault: true,
            emptyState: {
              icon: Users,
              title: 'No one has registered yet.',
              body: 'Children appear here as parents register them.',
            },
          },
          {
            value: 'not-joining',
            label: 'Not joining',
            predicate: (r) => r.tab === 'not_joining',
            emptyState: {
              icon: Users,
              title: 'No one has said they are not joining.',
            },
          },
          {
            value: 'not-registered',
            label: 'Not registered yet',
            predicate: (r) => r.tab === 'not_registered',
            emptyState: { icon: Users, title: 'Every child has answered.' },
          },
        ]}
        url={{ enabled: true, namespace: 'registrations' }}
        pageSize={50}
        csv={{
          filename: `${eventTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-registrations.csv`,
        }}
        emptyState={{ icon: Users, title: 'No children for this event.' }}
        emptyFilteredState={{
          title: 'Nothing matches.',
          body: 'Pick another tab or clear the search.',
        }}
      />
    </div>
  );
}
