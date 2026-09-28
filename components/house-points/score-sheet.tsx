'use client';

import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Flag,
  Pencil,
  Trash2,
  Users,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { EventHeaderTotals } from '@/components/house-points/event-header-totals';
import { PlaceBadge } from '@/components/house-points/place-badge';
import {
  TeamSheet,
  type EditableTeam,
} from '@/components/house-points/team-sheet';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import { HouseChip } from '@/components/ui/house-chip';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  houseTotals,
  resolveEntries,
  teamHouses,
  type EntrantKind,
  type Place,
  type PlacementMode,
  type RankWithin,
  type ResolvedEntry,
} from '@/lib/house-points/compute';
import { parseScore } from '@/lib/house-points/parse-score';
import type { EventRow, RosterStudent } from '@/lib/house-points/queries';
import { toSheetEntries } from '@/lib/house-points/sheet-entries';
import { membershipsOf } from '@/lib/house-points/team-membership';
import { formatPoints } from '@/lib/house-points/standings';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { HouseRow } from '@/lib/sis/houses';
import { cn } from '@/lib/utils';

// An event's score sheet — "basically a grading sheet". Type a score (or pick
// a place) and the Placement and Points columns fill in on their own, with the
// four house totals above moving in step.
//
// WHY THE MATHS RUNS HERE AS WELL AS ON THE SERVER. Nothing is stored but the
// raw score or the picked place (points are computed, never saved), so the
// sheet runs the SAME pure `resolveEntries` / `houseTotals` the server loaders
// use, across the whole event after every change. Ties therefore settle live:
// type a second 46 and both rows read 1st at once. The server never trusts
// these figures — it recomputes them itself on every read.
//
// Custom Table rather than DataTable (09 §5 step 5): a numeric grid editor
// with Blank ≠ Zero inputs, the same reason /grading/[id] is custom.

type Props = {
  eventId: string;
  eventName: string;
  /** The year's enrolled roster — only loaded for writers on a team event (the edit-team drawer picks from it). */
  roster: RosterStudent[];
  entrantKind: EntrantKind;
  placementMode: PlacementMode;
  rankWithin: RankWithin;
  maxScore: number | null;
  places: Place[];
  rows: EventRow[];
  houses: HouseRow[];
  canEdit: boolean;
};

type EntryPatch = { score: number | null } | { placeId: string | null };

type EntryPatchResponse = {
  ok: true;
  changed?: boolean;
  entry?: { id: string; score: number | null; placeId: string | null };
};

/** The Select's value for "No placement" — a place id is always a uuid. */
const NO_PLACE = 'none';

const collator = new Intl.Collator('en-SG', {
  numeric: true,
  sensitivity: 'base',
});

/** Display order: class, then student name. The loader returns entry order. */
function compareStudentRows(a: EventRow, b: EventRow): number {
  const sa = a.student;
  const sb = b.student;
  if (!sa || !sb) return sa ? -1 : sb ? 1 : 0;
  return (
    collator.compare(sa.sectionName, sb.sectionName) ||
    collator.compare(sa.name, sb.name)
  );
}

// ─── Sorting ────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type SortState<K extends string> = { key: K; dir: SortDir } | null;
type SortValue = string | number | null;

/** Blanks last in either direction; numbers by value, text by the collator. */
function compareSortValues(a: SortValue, b: SortValue, dir: SortDir): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  const c =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : collator.compare(String(a), String(b));
  return dir === 'asc' ? c : -c;
}

/**
 * Click-to-sort for the sheet's plain tables.
 *
 * THE ORDER IS A SNAPSHOT. It is taken from the live figures when a header is
 * clicked (and, on the student sheet, when the class tab changes), then held
 * while scores are typed — so a row never jumps away from the box being typed
 * into, and Enter still moves down the rows as they are shown. Click the
 * header again to sort by the new figures. Ties keep the default order; a row
 * added since the snapshot goes to the bottom. With no header chosen the
 * table keeps its default order.
 */
function useSnapshotSort<K extends string>(
  rows: EventRow[],
  valueOf: (row: EventRow, key: K) => SortValue
) {
  const [sort, setSort] = useState<SortState<K>>(null);
  const [order, setOrder] = useState<Map<string, number> | null>(null);

  function snapshot(next: SortState<K>) {
    if (!next) {
      setOrder(null);
      return;
    }
    const ranked = [...rows].sort((a, b) =>
      compareSortValues(valueOf(a, next.key), valueOf(b, next.key), next.dir)
    );
    setOrder(new Map(ranked.map((r, i) => [r.entryId, i])));
  }

  function toggle(key: K) {
    const next: SortState<K> = {
      key,
      dir: sort?.key === key && sort.dir === 'asc' ? 'desc' : 'asc',
    };
    setSort(next);
    snapshot(next);
  }

  const ordered = useMemo(() => {
    if (!order) return rows;
    const last = Number.MAX_SAFE_INTEGER;
    return [...rows].sort(
      (a, b) => (order.get(a.entryId) ?? last) - (order.get(b.entryId) ?? last)
    );
  }, [rows, order]);

  return { sort, toggle, resort: () => snapshot(sort), ordered };
}

/** A clickable column head that looks exactly like the DataTable's SortableHeader. */
function SortHead<K extends string>({
  sortKey,
  sort,
  onSort,
  align = 'left',
  className,
  children,
}: {
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
  className?: string;
  children: ReactNode;
}) {
  const dir = sort?.key === sortKey ? sort.dir : null;
  const Icon =
    dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      className={className}
      aria-sort={
        dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'
      }
    >
      <div className={cn(align === 'right' && 'flex justify-end')}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSort(sortKey)}
          className={cn(
            '-ml-3 h-7 gap-1 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]',
            align === 'right' && 'ml-0 mr-0'
          )}
        >
          {children}
          <Icon className="h-3 w-3 opacity-60" aria-hidden />
        </Button>
      </div>
    </TableHead>
  );
}

/** The live points a row earns, or null while it has no score / place. */
function livePoints(
  row: EventRow,
  resolved: ResolvedEntry | undefined,
  placementMode: PlacementMode
): number | null {
  const blank =
    placementMode === 'score' ? row.score === null : row.placeId === null;
  return blank || !resolved ? null : resolved.points;
}

/** The live placement's position in the place list, or null for none. */
function livePlaceOrder(
  row: EventRow,
  resolved: ResolvedEntry | undefined,
  placementMode: PlacementMode
): number | null {
  const blank =
    placementMode === 'score' ? row.score === null : row.placeId === null;
  return blank ? null : (resolved?.place?.sortOrder ?? null);
}

export function ScoreSheet({
  eventId,
  eventName,
  roster,
  entrantKind,
  placementMode,
  rankWithin,
  maxScore,
  places,
  rows: serverRows,
  houses,
  canEdit,
}: Props) {
  // Local copy of the rows — edited optimistically, merged with what the
  // server confirms. When the page re-renders with new rows (a student added
  // or removed), the copy is replaced: adjusting state during render rather
  // than in an effect, so there is no frame showing the stale list.
  const [rows, setRows] = useState<EventRow[]>(serverRows);
  const [syncedFrom, setSyncedFrom] = useState(serverRows);
  if (syncedFrom !== serverRows) {
    setSyncedFrom(serverRows);
    setRows(serverRows);
  }
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const run = useWriteAction();

  const sortedPlaces = useMemo(
    () => [...places].sort((a, b) => a.sortOrder - b.sortOrder),
    [places]
  );

  const resolvedById = useMemo(() => {
    const resolved = resolveEntries(
      toSheetEntries({ rankWithin, rows }),
      places,
      placementMode
    );
    return new Map(resolved.map((r) => [r.id, r]));
  }, [rows, places, placementMode, rankWithin]);

  const totals = useMemo(
    () =>
      houseTotals(
        Array.from(resolvedById.values()),
        houses.map((h) => h.id)
      ),
    [resolvedById, houses]
  );

  const entrantsByHouse = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of resolvedById.values()) {
      for (const id of entry.houseIds) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [resolvedById]);

  function patchRow(entryId: string, patch: Partial<EventRow>) {
    setRows((current) =>
      current.map((r) => (r.entryId === entryId ? { ...r, ...patch } : r))
    );
  }

  /**
   * Save one row. The change is shown at once (placements and totals
   * recompute from it), then confirmed by the server, then reverted if the
   * server refused it. No page refresh: everything the save moves is derived
   * from rows already in memory — the same reasoning as the grading grid.
   */
  async function saveEntry(entryId: string, patch: EntryPatch, who: string) {
    const before = rowsRef.current.find((r) => r.entryId === entryId);
    if (!before) return;
    const previous = { score: before.score, placeId: before.placeId };
    if ('score' in patch && patch.score === previous.score) return;
    if ('placeId' in patch && patch.placeId === previous.placeId) return;

    patchRow(entryId, patch);
    const result = await run(
      () =>
        apiFetch<EntryPatchResponse>(
          `/api/house-points/entries/${encodeURIComponent(entryId)}`,
          jsonInit('PATCH', patch)
        ),
      {
        pending: 'Saving…',
        // The row itself shows the saved value, its place and its points — a
        // toast per score would be noise.
        success: () => null,
        refresh: false,
        onResolved: (data) => {
          if (data.entry) {
            patchRow(entryId, {
              score: data.entry.score,
              placeId: data.entry.placeId,
            });
          }
        },
        error: (err) =>
          `Couldn't save ${who}. ${
            err instanceof Error && err.message
              ? err.message
              : 'Something went wrong.'
          }`,
      }
    );
    if (result === undefined) patchRow(entryId, previous);
  }

  const header = (
    <EventHeaderTotals
      houses={houses}
      totals={totals}
      entrantsByHouse={entrantsByHouse}
      entrantKind={entrantKind}
      placementMode={placementMode}
      rankWithin={rankWithin}
      places={places}
    />
  );

  if (entrantKind === 'team') {
    return (
      <div className="space-y-6">
        {header}
        <TeamTable
          eventId={eventId}
          eventName={eventName}
          rows={rows}
          roster={roster}
          houses={houses}
          placementMode={placementMode}
          maxScore={maxScore}
          places={sortedPlaces}
          resolvedById={resolvedById}
          canEdit={canEdit}
          onSave={saveEntry}
        />
      </div>
    );
  }

  if (entrantKind === 'house') {
    return (
      <div className="space-y-6">
        {header}
        <HouseSheet
          eventId={eventId}
          rows={rows}
          houses={houses}
          places={sortedPlaces}
          resolvedById={resolvedById}
          canEdit={canEdit}
          onPick={(row, placeId, who) =>
            saveEntry(row.entryId, { placeId }, who)
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <StudentSheet
        rows={rows}
        houses={houses}
        placementMode={placementMode}
        rankWithin={rankWithin}
        maxScore={maxScore}
        places={sortedPlaces}
        resolvedById={resolvedById}
        canEdit={canEdit}
        onSave={saveEntry}
      />
    </div>
  );
}

// ─── Students ───────────────────────────────────────────────────────────────

type Group = { key: string; label: string; count: number };

function groupOf(
  row: EventRow,
  rankWithin: RankWithin
): { key: string; label: string } {
  const s = row.student;
  if (!s) return { key: 'unknown', label: 'No class' };
  if (rankWithin === 'section')
    return { key: s.sectionId, label: s.sectionName };
  return { key: s.levelId, label: s.levelLabel || 'No level' };
}

type StudentSortKey = 'name' | 'house' | 'score' | 'placement' | 'points';

function StudentSheet({
  rows,
  houses,
  placementMode,
  rankWithin,
  maxScore,
  places,
  resolvedById,
  canEdit,
  onSave,
}: {
  rows: EventRow[];
  houses: HouseRow[];
  placementMode: PlacementMode;
  rankWithin: RankWithin;
  maxScore: number | null;
  places: Place[];
  resolvedById: Map<string, ResolvedEntry>;
  canEdit: boolean;
  onSave: (entryId: string, patch: EntryPatch, who: string) => Promise<void>;
}) {
  const run = useWriteAction();
  const [removing, setRemoving] = useState<EventRow | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const housesById = useMemo(
    () => new Map(houses.map((h) => [h.id, h])),
    [houses]
  );
  const byClass = useMemo(() => [...rows].sort(compareStudentRows), [rows]);
  const {
    sort,
    toggle: onSort,
    resort,
    ordered: sorted,
  } = useSnapshotSort<StudentSortKey>(byClass, (row, key) => {
    const resolved = resolvedById.get(row.entryId);
    switch (key) {
      case 'name':
        return row.student?.name ?? null;
      case 'house': {
        const id = row.student?.houseId;
        return (id && housesById.get(id)?.name) || null;
      }
      case 'score':
        return row.score;
      case 'placement':
        return livePlaceOrder(row, resolved, placementMode);
      case 'points':
        return livePoints(row, resolved, placementMode);
    }
  });

  // One group at a time, always set, no "All" — the tab IS the ranking scope,
  // so the table on screen is exactly the set of students competing for the
  // same places. A whole-event ranking has one group and needs no tabs.
  const grouped = rankWithin !== 'event';
  const groups = useMemo<Group[]>(() => {
    if (!grouped) return [];
    const map = new Map<string, Group>();
    for (const row of sorted) {
      const { key, label } = groupOf(row, rankWithin);
      const g = map.get(key);
      if (g) g.count += 1;
      else map.set(key, { key, label, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) =>
      collator.compare(a.label, b.label)
    );
  }, [grouped, sorted, rankWithin]);

  const [chosenGroup, setChosenGroup] = useState<string | null>(null);
  // A chosen group that no longer exists (its last student was removed)
  // falls back to the first one — never to nothing.
  const activeGroup =
    groups.find((g) => g.key === chosenGroup)?.key ?? groups[0]?.key ?? null;
  const visible = grouped
    ? sorted.filter((r) => groupOf(r, rankWithin).key === activeGroup)
    : sorted;

  const isScore = placementMode === 'score';
  const showClassUnderName = rankWithin !== 'section';

  async function confirmRemove() {
    if (!removing) return;
    const who = removing.student?.name ?? 'this student';
    setRemoveBusy(true);
    await run(
      () =>
        apiFetch<{ ok: true }>(
          `/api/house-points/entries/${encodeURIComponent(removing.entryId)}`,
          jsonInit('DELETE')
        ),
      {
        pending: 'Removing…',
        success: `Removed ${who}`,
        onResolved: () => setRemoving(null),
      }
    );
    setRemoveBusy(false);
  }

  if (rows.length === 0) {
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Users}
          title="No students entered yet"
          body={
            canEdit
              ? 'Choose Add students to enter everyone who took part. Their scores go here, and placements and points follow.'
              : 'Students appear here once they are entered.'
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {grouped && groups.length > 0 && (
        <Tabs
          value={activeGroup ?? undefined}
          onValueChange={(v) => {
            setChosenGroup(v);
            resort();
          }}
        >
          <TabsList
            className="h-auto max-w-full flex-wrap"
            aria-label={rankWithin === 'section' ? 'Class' : 'Level'}
          >
            {groups.map((g) => (
              <TabsTrigger key={g.key} value={g.key} className="gap-1.5">
                {g.label}
                <span className="font-mono text-[10px] tabular-nums opacity-70">
                  {g.count}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-12 text-right">#</TableHead>
              <SortHead sortKey="name" sort={sort} onSort={onSort}>
                Student
              </SortHead>
              <SortHead sortKey="house" sort={sort} onSort={onSort}>
                House
              </SortHead>
              <SortHead
                sortKey={isScore ? 'score' : 'placement'}
                sort={sort}
                onSort={onSort}
                className={isScore ? 'w-40' : 'w-52'}
              >
                {isScore ? 'Score' : 'Placement'}
              </SortHead>
              {isScore && (
                <SortHead sortKey="placement" sort={sort} onSort={onSort}>
                  Placement
                </SortHead>
              )}
              <SortHead
                sortKey="points"
                sort={sort}
                onSort={onSort}
                align="right"
                className="w-20"
              >
                Points
              </SortHead>
              {canEdit && (
                <TableHead className="w-12">
                  <span className="sr-only">Remove</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row, index) => {
              const s = row.student;
              const who = s?.name ?? 'this student';
              const house = s?.houseId ? housesById.get(s.houseId) : undefined;
              const resolved = resolvedById.get(row.entryId);
              return (
                <TableRow key={row.entryId}>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate text-sm font-medium text-foreground">
                        {s?.name ?? 'Unknown student'}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {s ? (
                          <>
                            {s.studentNumber}
                            {showClassUnderName && ` · ${s.sectionName}`}
                          </>
                        ) : (
                          'No longer on the roster'
                        )}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {house ? (
                      <HouseChip
                        name={house.name}
                        colourToken={house.colourToken}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        No house
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isScore ? (
                      <div className="flex items-center gap-2">
                        <ScoreInput
                          value={row.score}
                          max={maxScore ?? Number.POSITIVE_INFINITY}
                          plaintext={!canEdit}
                          label={`Score for ${who}`}
                          onCommit={(value) =>
                            onSave(row.entryId, { score: value }, who)
                          }
                        />
                        {maxScore !== null && (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            / {formatPoints(maxScore)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <PlaceSelect
                        value={row.placeId}
                        places={places}
                        plaintext={!canEdit}
                        label={`Placement for ${who}`}
                        onChange={(placeId) =>
                          onSave(row.entryId, { placeId }, who)
                        }
                      />
                    )}
                  </TableCell>
                  {isScore && (
                    <TableCell>
                      <AutoPlacement row={row} resolved={resolved} />
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <AutoPoints
                      row={row}
                      resolved={resolved}
                      placementMode={placementMode}
                    />
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${who}`}
                        onClick={() => setRemoving(row)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* On the page canvas, not inside a drawer, so a confirm dialog is not
          nested in anything. */}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !removeBusy) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing?.student?.name ?? 'this student'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their score and placement for this event are deleted, and their
              house loses any points they earned here. You can add them again
              later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={removeBusy}
              onClick={() => setRemoving(null)}
            >
              Keep them
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={removeBusy}
              loadingText="Removing…"
              onClick={confirmRemove}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Teams ──────────────────────────────────────────────────────────────────

/** Members shown under a team's name before "Show all". */
const MEMBERS_SHOWN = 4;

/**
 * A team event's sheet. One table, never tabbed: a team's members can come
 * from any class, so every team competes against every other in the event.
 * Each row names the team and who is on it, takes its score (or place), and
 * says which houses its points go to — once per house, however many of its
 * students share one.
 */
function TeamTable({
  eventId,
  eventName,
  rows,
  roster,
  houses,
  placementMode,
  maxScore,
  places,
  resolvedById,
  canEdit,
  onSave,
}: {
  eventId: string;
  eventName: string;
  rows: EventRow[];
  roster: RosterStudent[];
  houses: HouseRow[];
  placementMode: PlacementMode;
  maxScore: number | null;
  places: Place[];
  resolvedById: Map<string, ResolvedEntry>;
  canEdit: boolean;
  onSave: (entryId: string, patch: EntryPatch, who: string) => Promise<void>;
}) {
  const run = useWriteAction();
  // The team stays set after the drawer closes, so its title doesn't flip to
  // "Add a team" while the drawer slides away.
  const [editing, setEditing] = useState<EditableTeam | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(
    null
  );
  const [removeBusy, setRemoveBusy] = useState(false);

  const housesById = useMemo(
    () => new Map(houses.map((h) => [h.id, h])),
    [houses]
  );
  const byName = useMemo(
    () =>
      [...rows].sort((a, b) =>
        collator.compare(a.team?.name ?? '', b.team?.name ?? '')
      ),
    [rows]
  );
  const {
    sort,
    toggle: onSort,
    ordered: sorted,
  } = useSnapshotSort<'name' | 'points'>(byName, (row, key) =>
    key === 'name'
      ? (row.team?.name ?? null)
      : livePoints(row, resolvedById.get(row.entryId), placementMode)
  );
  const isScore = placementMode === 'score';
  const memberships = useMemo(() => membershipsOf(rows), [rows]);
  // A team row grows with its member list, so its cells sit at the top. Plain
  // text cells drop 6px to share a centre line with the 32px score box or
  // place picker beside them; read-only, there are no boxes to line up with.
  const lineUp = canEdit ? 'pt-4.5' : undefined;

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    // Through the TEAM route, never the entry's: deleting the team cascades
    // its members and its entry, where deleting only the entry would leave
    // the team and its member rows behind.
    await run(
      () =>
        apiFetch<{ ok: true }>(
          `/api/house-points/teams/${encodeURIComponent(removing.id)}`,
          jsonInit('DELETE')
        ),
      {
        pending: 'Removing…',
        success: `Removed ${removing.name}`,
        onResolved: () => setRemoving(null),
      }
    );
    setRemoveBusy(false);
  }

  if (rows.length === 0) {
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={UsersRound}
          title="No teams entered yet"
          body={
            canEdit
              ? 'Choose Add team to name each team and tick who is on it. Their scores go here, and placements and points follow.'
              : 'Teams appear here once they are entered.'
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-12 text-right">#</TableHead>
              <SortHead sortKey="name" sort={sort} onSort={onSort}>
                Team
              </SortHead>
              <TableHead className={isScore ? 'w-40' : 'w-52'}>
                {isScore ? 'Score' : 'Placement'}
              </TableHead>
              {isScore && <TableHead>Placement</TableHead>}
              <SortHead
                sortKey="points"
                sort={sort}
                onSort={onSort}
                align="right"
                className="w-20"
              >
                Points
              </SortHead>
              <TableHead>Points to houses</TableHead>
              {canEdit && (
                <TableHead className="w-24">
                  <span className="sr-only">Edit or remove</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row, index) => {
              const team = row.team;
              const who = team?.name ?? 'this team';
              const resolved = resolvedById.get(row.entryId);
              const blank = isScore ? row.score === null : row.placeId === null;
              const earned = blank || !resolved ? null : resolved.points;
              const credited = teamHouses(team?.members ?? []);
              const sharesAHouse = credited.some((h) => h.memberCount > 1);
              return (
                <TableRow key={row.entryId} className="[&>td]:align-top">
                  <TableCell
                    className={cn(
                      lineUp,
                      'text-right font-mono text-xs tabular-nums text-muted-foreground'
                    )}
                  >
                    {index + 1}
                  </TableCell>
                  <TableCell className={cn(lineUp, 'whitespace-normal')}>
                    <p className="text-sm font-medium text-foreground">
                      {team?.name ?? 'Unknown team'}
                    </p>
                    <TeamMembers members={team?.members ?? []} />
                  </TableCell>
                  <TableCell>
                    {isScore ? (
                      <div className="flex items-center gap-2">
                        <ScoreInput
                          value={row.score}
                          max={maxScore ?? Number.POSITIVE_INFINITY}
                          plaintext={!canEdit}
                          label={`Score for ${who}`}
                          onCommit={(value) =>
                            onSave(row.entryId, { score: value }, who)
                          }
                        />
                        {maxScore !== null && (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            / {formatPoints(maxScore)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <PlaceSelect
                        value={row.placeId}
                        places={places}
                        plaintext={!canEdit}
                        label={`Placement for ${who}`}
                        onChange={(placeId) =>
                          onSave(row.entryId, { placeId }, who)
                        }
                      />
                    )}
                  </TableCell>
                  {isScore && (
                    <TableCell className={lineUp}>
                      <AutoPlacement row={row} resolved={resolved} />
                    </TableCell>
                  )}
                  <TableCell className={cn(lineUp, 'text-right')}>
                    <AutoPoints
                      row={row}
                      resolved={resolved}
                      placementMode={placementMode}
                    />
                  </TableCell>
                  <TableCell className={cn(lineUp, 'whitespace-normal')}>
                    {credited.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No house among its students
                      </span>
                    ) : (
                      <div className="space-y-1.5">
                        <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
                          {credited.map((h) => {
                            const house = housesById.get(h.houseId);
                            if (!house) return null;
                            return (
                              <li
                                key={h.houseId}
                                className="inline-flex items-center gap-1.5"
                              >
                                <HouseChip
                                  name={house.name}
                                  colourToken={house.colourToken}
                                />
                                {earned !== null && (
                                  <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                                    +{formatPoints(earned)}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {sharesAHouse && (
                          <p className="text-[11px] text-muted-foreground">
                            Counted once per house
                          </p>
                        )}
                      </div>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      {team && (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-foreground"
                            aria-label={`Edit ${who}`}
                            onClick={() => {
                              setEditing({
                                id: team.id,
                                name: team.name,
                                memberIds: team.members.map(
                                  (m) => m.sectionStudentId
                                ),
                              });
                              setEditOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Remove ${who}`}
                            onClick={() =>
                              setRemoving({ id: team.id, name: team.name })
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Both on the page canvas, never inside one another: the edit drawer
          holds no confirm, and the remove confirm opens from the row. */}
      {canEdit && (
        <TeamSheet
          eventId={eventId}
          eventName={eventName}
          roster={roster}
          houses={houses}
          memberships={memberships}
          team={editing}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !removeBusy) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing?.name ?? 'this team'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the team, its members and its score or placement.
              Points it earned come off the house totals.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={removeBusy}
              onClick={() => setRemoving(null)}
            >
              Keep the team
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={removeBusy}
              loadingText="Removing…"
              onClick={confirmRemove}
            >
              Remove team
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A team's students under its name — name and class, a long team folded. */
function TeamMembers({ members }: { members: RosterStudent[] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(
    () => [...members].sort((a, b) => collator.compare(a.name, b.name)),
    [members]
  );
  if (sorted.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">Nobody on this team</p>
    );
  }
  const folded = sorted.length > MEMBERS_SHOWN + 1 && !expanded;
  const shown = folded ? sorted.slice(0, MEMBERS_SHOWN) : sorted;
  return (
    <div className="mt-1.5">
      <ul className="space-y-0.5">
        {shown.map((m) => (
          <li
            key={m.sectionStudentId}
            className="flex min-w-0 items-baseline gap-2 text-xs"
          >
            <span className="truncate text-foreground">{m.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {m.sectionName}
            </span>
          </li>
        ))}
      </ul>
      {sorted.length > MEMBERS_SHOWN + 1 && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 py-0.5 text-xs"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? 'Show fewer'
            : `Show all ${sorted.length.toLocaleString('en-SG')}`}
        </Button>
      )}
    </div>
  );
}

// ─── Houses ─────────────────────────────────────────────────────────────────

function HouseSheet({
  eventId,
  rows,
  houses,
  places,
  resolvedById,
  canEdit,
  onPick,
}: {
  eventId: string;
  rows: EventRow[];
  houses: HouseRow[];
  places: Place[];
  resolvedById: Map<string, ResolvedEntry>;
  canEdit: boolean;
  onPick: (row: EventRow, placeId: string | null, who: string) => void;
}) {
  const rowByHouse = new Map(
    rows.filter((r) => r.houseId).map((r) => [r.houseId as string, r])
  );
  const missing = houses.filter((h) => !rowByHouse.has(h.id));
  const housesById = new Map(houses.map((h) => [h.id, h]));
  // Default order: the houses' own order, as before.
  const houseRows = houses
    .filter((h) => rowByHouse.has(h.id))
    .map((h) => rowByHouse.get(h.id) as EventRow);
  const {
    sort,
    toggle: onSort,
    ordered,
  } = useSnapshotSort<'name' | 'points'>(houseRows, (row, key) =>
    key === 'name'
      ? ((row.houseId && housesById.get(row.houseId)?.name) ?? null)
      : livePoints(row, resolvedById.get(row.entryId), 'pick')
  );

  if (rows.length === 0) {
    return (
      <Card className="py-0">
        <DataTableEmptyState
          icon={Flag}
          title="The houses aren't on this sheet yet"
          body={
            canEdit
              ? 'Set up the houses to add all four to the sheet, then pick where each one placed.'
              : 'The houses appear here once they are set up.'
          }
          className={canEdit ? 'pb-4' : undefined}
        />
        {canEdit && (
          <div className="flex justify-center pb-12">
            <SetupHousesButton
              eventId={eventId}
              houseIds={missing.map((h) => h.id)}
            />
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {canEdit && missing.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-indigo-soft bg-accent px-5 py-3">
          <p className="text-sm text-foreground">
            {missing.map((h) => h.name).join(', ')}{' '}
            {missing.length === 1 ? "isn't" : "aren't"} on this sheet yet.
          </p>
          <SetupHousesButton
            eventId={eventId}
            houseIds={missing.map((h) => h.id)}
            label="Add the missing houses"
            variant="outline"
          />
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <SortHead sortKey="name" sort={sort} onSort={onSort}>
                House
              </SortHead>
              <TableHead className="w-60">Placement</TableHead>
              <SortHead
                sortKey="points"
                sort={sort}
                onSort={onSort}
                align="right"
                className="w-20"
              >
                Points
              </SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered
              .map((row) => ({
                row,
                house: housesById.get(row.houseId as string) as HouseRow,
              }))
              .map(({ row, house }) => {
                const resolved = resolvedById.get(row.entryId);
                return (
                  <TableRow key={row.entryId}>
                    <TableCell>
                      <HouseChip
                        name={house.name}
                        colourToken={house.colourToken}
                        className="text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <PlaceSelect
                        value={row.placeId}
                        places={places}
                        plaintext={!canEdit}
                        label={`Placement for ${house.name}`}
                        onChange={(placeId) => onPick(row, placeId, house.name)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <AutoPoints
                        row={row}
                        resolved={resolved}
                        placementMode="pick"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/**
 * Puts the houses on a house event's sheet. An explicit click, never a write
 * during render: the page is a read, and opening it must not change anything.
 */
function SetupHousesButton({
  eventId,
  houseIds,
  label = 'Set up houses',
  variant = 'default',
}: {
  eventId: string;
  houseIds: string[];
  label?: string;
  variant?: 'default' | 'outline';
}) {
  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function setUp() {
    setBusy(true);
    await run(
      () =>
        apiFetch<{ ok: true; added: number; skipped: number }>(
          `/api/house-points/events/${encodeURIComponent(eventId)}/entries`,
          jsonInit('POST', { houseIds })
        ),
      {
        pending: 'Setting up houses…',
        success: 'Houses set up',
      }
    );
    setBusy(false);
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={variant === 'outline' ? 'sm' : 'default'}
      loading={busy}
      loadingText="Setting up…"
      disabled={houseIds.length === 0}
      onClick={setUp}
    >
      {!busy && <Flag className="size-4" />}
      {label}
    </Button>
  );
}

// ─── Cells ──────────────────────────────────────────────────────────────────

/**
 * A score box, after ScoreInput in components/grading/score-entry-grid.tsx: a
 * local draft, committed on blur or Enter, blank ≠ zero, and flagged
 * (`aria-invalid`) the moment it goes over the highest possible score. Enter
 * also moves to the next row's box, the way a grading sheet is typed down.
 */
function ScoreInput({
  value,
  max,
  plaintext,
  label,
  onCommit,
}: {
  value: number | null;
  max: number;
  plaintext: boolean;
  label: string;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(display(value));
  const [lastValue, setLastValue] = useState(value);
  // Re-sync the draft when the value changes underneath it — a failed save
  // reverted, or the server echoed back what was typed. A draft that already
  // reads as the new value is left alone.
  if (lastValue !== value) {
    setLastValue(value);
    if (parseScore(text, max).value !== value) setText(display(value));
  }

  if (plaintext) {
    return (
      <span className="inline-block min-w-14 font-mono text-sm tabular-nums text-foreground">
        {value === null ? '—' : formatPoints(value)}
      </span>
    );
  }

  const parsed = parseScore(text, max);

  function commit() {
    const result = parseScore(text, max);
    if (result.error) {
      // Nothing is sent. The box goes back to what is saved and says why.
      toast.error(result.error);
      setText(display(value));
      return;
    }
    onCommit(result.value);
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      aria-invalid={parsed.error ? true : undefined}
      data-score-input=""
      value={text}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const current = e.currentTarget;
        const all = Array.from(
          document.querySelectorAll<HTMLInputElement>('[data-score-input]')
        );
        const next = all[all.indexOf(current) + 1];
        if (next) next.focus();
        else current.blur();
      }}
      className="h-8 w-20 px-2 text-right font-mono tabular-nums aria-[invalid=true]:bg-destructive/5"
    />
  );
}

function display(value: number | null): string {
  return value === null ? '' : String(value);
}

function PlaceSelect({
  value,
  places,
  plaintext,
  label,
  onChange,
}: {
  value: string | null;
  places: Place[];
  plaintext: boolean;
  label: string;
  onChange: (placeId: string | null) => void;
}) {
  const current = value ? places.find((p) => p.id === value) : undefined;
  if (plaintext) {
    return current ? (
      <PlaceBadge place={current} />
    ) : (
      <span className="text-xs text-muted-foreground">No placement</span>
    );
  }
  return (
    <Select
      value={value ?? NO_PLACE}
      onValueChange={(v) => onChange(v === NO_PLACE ? null : v)}
    >
      <SelectTrigger className="h-8 w-full max-w-56" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {places.map((place) => (
          <SelectItem key={place.id} value={place.id}>
            {place.label}
          </SelectItem>
        ))}
        <SelectItem value={NO_PLACE}>No placement</SelectItem>
      </SelectContent>
    </Select>
  );
}

function AutoPlacement({
  row,
  resolved,
}: {
  row: EventRow;
  resolved: ResolvedEntry | undefined;
}) {
  if (row.score === null) {
    return <span className="text-xs text-muted-foreground">No score yet</span>;
  }
  if (!resolved?.place) {
    return <span className="text-xs text-muted-foreground">Not placed</span>;
  }
  return <PlaceBadge place={resolved.place} />;
}

function AutoPoints({
  row,
  resolved,
  placementMode,
}: {
  row: EventRow;
  resolved: ResolvedEntry | undefined;
  placementMode: PlacementMode;
}) {
  const blank =
    placementMode === 'score' ? row.score === null : row.placeId === null;
  if (blank || !resolved) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="font-serif text-base font-semibold tabular-nums text-foreground">
      {formatPoints(resolved.points)}
    </span>
  );
}
