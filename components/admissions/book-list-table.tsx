'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { BookOpen, Package } from 'lucide-react';
import { useMemo } from 'react';

import {
  AddBookListItemButton,
  BookListItemActions,
  type BookListLevel,
} from '@/components/admissions/book-list-item-sheet';
import { DataTable } from '@/components/ui/data-table';
import { SortableHeader } from '@/components/ui/data-table/sortable-header';
import type { LevelSupplyGroup } from '@/lib/sis/supplies/level-counts';
import type { SupplyClassType, SupplyKind } from '@/lib/sis/supplies/types';
import { cn } from '@/lib/utils';

// The one level's books and supplies on /admissions/book-list, as the shared
// DataTable (plan 2026-10-28-books-supplies-tracker.md, Phases 3 and 4). Rows
// arrive in the list's own order — books by subject, then supplies — and stay
// that way until a column is sorted. Writers get Add book / Add supply in the
// toolbar and Edit / Remove on each row; read-only viewers get neither.

export type BookListRow = {
  id: string;
  kind: SupplyKind;
  /** The group it sits in: the book's subject ("Books" when it has none), or "Supplies". */
  group: string;
  title: string;
  subject: string | null;
  publisher: string | null;
  isbn: string | null;
  classType: SupplyClassType | null;
  levelId: string | null;
  given: number;
  students: number;
  handedOver: number;
  /** Position in the list's own order. */
  order: number;
};

/**
 * Flattens the page's groups into rows, keeping the list's order. Called here,
 * in the client table — a server page cannot call a client module's function.
 */
function bookListRows(groups: LevelSupplyGroup[]): BookListRow[] {
  return groups
    .flatMap((g) => g.items.map((i) => ({ ...i, group: g.name })))
    .map((r, order) => ({
      id: r.id,
      kind: r.kind,
      group: r.group,
      title: r.title,
      subject: r.subject,
      publisher: r.publisher,
      isbn: r.isbn,
      classType: r.classType,
      levelId: r.levelId,
      given: r.given,
      students: r.students,
      handedOver: r.handedOver,
      order,
    }));
}

function trackLabel(r: BookListRow): string {
  if (r.kind === 'supply') return '';
  return r.classType ?? 'Both';
}

export function BookListTable({
  groups,
  ayCode,
  level,
  subjects,
  track,
  canEdit,
  showCounts,
}: {
  /** The level's list as `loadLevelSupplies` groups it. */
  groups: LevelSupplyGroup[];
  ayCode: string;
  level: BookListLevel;
  subjects: string[];
  /** The track tab being viewed; null = the level has no split. */
  track: SupplyClassType | null;
  canEdit: boolean;
  /** False while the level has no students — the Given column then hides. */
  showCounts: boolean;
}) {
  const rows = useMemo(() => bookListRows(groups), [groups]);
  const columns = useMemo<ColumnDef<BookListRow, unknown>[]>(() => {
    const cols: ColumnDef<BookListRow, unknown>[] = [
      {
        id: 'subject',
        accessorFn: (r) => r.group,
        header: ({ column }) => (
          <SortableHeader column={column}>Subject</SortableHeader>
        ),
        meta: { label: 'Subject' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {row.original.group}
          </span>
        ),
      },
      {
        id: 'title',
        accessorFn: (r) => r.title,
        header: ({ column }) => (
          <SortableHeader column={column}>Title</SortableHeader>
        ),
        meta: { label: 'Title' },
        enableHiding: false,
        cell: ({ row }) => (
          <span className="inline-block min-w-48 font-medium text-foreground">
            {row.original.title}
          </span>
        ),
      },
      {
        id: 'publisher',
        accessorFn: (r) => r.publisher ?? '',
        header: 'Publisher',
        meta: { label: 'Publisher' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.publisher ?? ''}
          </span>
        ),
      },
      {
        id: 'isbn',
        accessorFn: (r) => r.isbn ?? '',
        header: 'ISBN',
        meta: { label: 'ISBN' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-[13px] tabular-nums text-muted-foreground">
            {row.original.isbn ?? ''}
          </span>
        ),
      },
    ];
    if (level.levelType === 'primary') {
      cols.push({
        id: 'track',
        accessorFn: trackLabel,
        header: 'Track',
        meta: { label: 'Track' },
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {trackLabel(row.original)}
          </span>
        ),
      });
    }
    cols.push({
      id: 'given',
      accessorFn: (r) => `${r.given} of ${r.students}`,
      sortingFn: (a, b) =>
        a.original.given - b.original.given ||
        a.original.students - b.original.students,
      header: ({ column }) => (
        <SortableHeader column={column}>Given</SortableHeader>
      ),
      meta: { label: 'Given' },
      cell: ({ row }) => {
        const r = row.original;
        const pct = r.students ? Math.round((r.given / r.students) * 100) : 0;
        const all = r.students > 0 && r.given === r.students;
        return (
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            <span
              className={cn(
                'text-xs tabular-nums',
                all ? 'font-semibold text-foreground' : 'text-muted-foreground'
              )}
            >
              <span className="font-semibold text-foreground">{r.given}</span>{' '}
              of {r.students}
            </span>
            <div
              role="progressbar"
              aria-label={`${r.title} given`}
              aria-valuemin={0}
              aria-valuemax={r.students}
              aria-valuenow={r.given}
              className="h-1.5 w-12 overflow-hidden rounded-full bg-hairline"
            >
              <div
                className="h-full rounded-full bg-brand-mint"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    });
    if (canEdit) {
      cols.push({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { label: 'Actions', excludeFromExport: true },
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <BookListItemActions
            item={row.original}
            ayCode={ayCode}
            level={level}
            subjects={subjects}
          />
        ),
      });
    }
    return cols;
  }, [ayCode, level, subjects, canEdit]);

  return (
    <DataTable<BookListRow>
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      initialColumnVisibility={{ given: showCounts }}
      searchKeys={[
        (r) => r.title,
        (r) => r.isbn ?? '',
        (r) => r.publisher ?? '',
      ]}
      searchPlaceholder="Search by title, ISBN or publisher"
      statusTabs={[
        { value: 'all', label: 'All', predicate: () => true, isDefault: true },
        {
          value: 'books',
          label: 'Books',
          predicate: (r) => r.kind === 'book',
          emptyState: {
            icon: BookOpen,
            title: `No books on the list for ${level.label}.`,
            body: canEdit
              ? 'Add one with Add book.'
              : 'Its supplies are under Supplies.',
          },
        },
        {
          value: 'supplies',
          label: 'Supplies',
          predicate: (r) => r.kind === 'supply',
          emptyState: {
            icon: Package,
            title: `No supplies on the list for ${level.label}.`,
            body: canEdit ? 'Add one with Add supply.' : undefined,
          },
        },
      ]}
      toolbarTrailing={
        canEdit ? (
          <>
            <AddBookListItemButton
              kind="book"
              ayCode={ayCode}
              level={level}
              subjects={subjects}
              defaultTrack={track}
            />
            <AddBookListItemButton
              kind="supply"
              ayCode={ayCode}
              level={level}
              subjects={subjects}
              defaultTrack={null}
            />
          </>
        ) : undefined
      }
      url={{ enabled: true, namespace: 'book-list' }}
      pageSize={100}
      csv={{
        filename: `book-list-${ayCode}-${level.label.replace(/\s+/g, '-')}${
          track ? `-${track}` : ''
        }.csv`,
      }}
      emptyState={{
        icon: BookOpen,
        title: `Nothing on ${ayCode}'s list for ${level.label}.`,
        body: canEdit
          ? 'Add a book or a supply, or pick another level.'
          : 'Pick another level to see its books and supplies.',
      }}
      emptyFilteredState={{
        title: 'Nothing matches.',
        body: 'Pick another tab or clear the search.',
      }}
    />
  );
}
