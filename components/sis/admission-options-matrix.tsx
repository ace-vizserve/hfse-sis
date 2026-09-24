'use client';

import { CircleCheck, CircleOff, FilterX } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

import { AdmissionOptionSessionSwitch } from '@/components/sis/admission-option-session-switch';
import {
  AdmissionOptionRowMenu,
  type SheetLevel,
} from '@/components/sis/admission-option-sheet';
import { AdmissionOptionsBulkBar } from '@/components/sis/admission-options-bulk-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import {
  ADMISSION_SCHEDULES,
  NO_ADMIN_OPTION_FILTER,
  STAFF_SCHEDULE_LABEL,
  adminComboKey,
  countAdminCombosByTrack,
  filterAdminGroups,
  isAdminOptionFilterActive,
  optionDisplayName,
  summarizeClosedSessions,
  type AdminOptionCombo,
  type AdminOptionFilter,
  type AdminOptionGroup,
  type AdminOptionTrackFilter,
  type NameReach,
} from '@/lib/admissions/options';

// The matrix on /sis/admin/admission-options: every class type of every level
// in one table, one column per session, so a year's 60-odd switches line up
// and a pattern ("every Global class Morning only", "close Standard Morning at
// P3 and P6") is a filter, a tick-all and one bulk write instead of a scroll.
//
// Filters are local state over the rows the page already loaded — nothing is
// refetched. Selection is kept by row key and intersected with what is shown,
// so a row hidden by a filter is never changed by the bulk bar.
//
// Rows stay grouped the way the old level cards grouped them: the SIS level
// first (what the name COUNTS AS), then the parent-facing level name, then its
// class types. The drawer and row menu are unchanged.

const COLS = 3 + ADMISSION_SCHEDULES.length + 1;

const TRACK_TABS: Array<{ value: AdminOptionTrackFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'Global', label: 'Global' },
  { value: 'Standard', label: 'Standard' },
];

export function AdmissionOptionsMatrix({
  groups,
  ayCode,
  levels,
  nameReach,
}: {
  groups: AdminOptionGroup[];
  ayCode: string;
  levels: readonly SheetLevel[];
  nameReach: Record<string, NameReach>;
}) {
  const [filter, setFilter] = useState<AdminOptionFilter>(
    NO_ADMIN_OPTION_FILTER
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const visible = useMemo(
    () => filterAdminGroups(groups, filter),
    [groups, filter]
  );
  const trackCounts = useMemo(
    () => countAdminCombosByTrack(groups, filter),
    [groups, filter]
  );
  const closed = useMemo(() => summarizeClosedSessions(groups), [groups]);

  const visibleCombos = visible.flatMap((g) => g.combos);
  const selectedCombos = visibleCombos.filter((c) =>
    selected.has(adminComboKey(c))
  );
  const allShown =
    visibleCombos.length > 0 && selectedCombos.length === visibleCombos.length;
  const someShown = selectedCombos.length > 0 && !allShown;

  function toggleRow(combo: AdminOptionCombo, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(adminComboKey(combo));
      else next.delete(adminComboKey(combo));
      return next;
    });
  }

  function toggleAllShown(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of visibleCombos) {
        if (on) next.add(adminComboKey(c));
        else next.delete(adminComboKey(c));
      }
      return next;
    });
  }

  function toggleLevel(code: string, on: boolean) {
    setFilter((f) => ({
      ...f,
      levelCodes: on
        ? [...f.levelCodes, code]
        : f.levelCodes.filter((c) => c !== code),
    }));
  }

  const filtered = isAdminOptionFilterActive(filter);

  return (
    <div className="space-y-4">
      <ClosedNow
        closed={closed}
        onShowClosed={() =>
          setFilter({ ...NO_ADMIN_OPTION_FILTER, closedOnly: true })
        }
      />

      {/* Toolbar — 09a §8 data-table layout: facets left, status tabs right. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {groups.map((g) => {
            const on = filter.levelCodes.includes(g.levelCode);
            return (
              <Toggle
                key={g.levelId}
                variant="outline"
                size="sm"
                pressed={on}
                onPressedChange={(v) => toggleLevel(g.levelCode, v)}
                aria-label={`${g.levelCode} — ${g.levelLabel}`}
                className="px-2.5 font-mono text-[11px] font-semibold"
              >
                {g.levelCode}
              </Toggle>
            );
          })}
          <div className="ml-1 flex items-center gap-2 pl-2 sm:border-l sm:border-border">
            <Switch
              id="admission-options-closed-only"
              checked={filter.closedOnly}
              onCheckedChange={(v) =>
                setFilter((f) => ({ ...f, closedOnly: Boolean(v) }))
              }
            />
            <Label
              htmlFor="admission-options-closed-only"
              className="whitespace-nowrap text-[13px] font-medium"
            >
              Closed only
            </Label>
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilter(NO_ADMIN_OPTION_FILTER)}
            >
              <FilterX className="size-3.5" />
              Clear filters
            </Button>
          )}
        </div>
        <Tabs
          value={filter.track}
          onValueChange={(v) =>
            setFilter((f) => ({ ...f, track: v as AdminOptionTrackFilter }))
          }
        >
          <TabsList>
            {TRACK_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <span className="tabular-nums opacity-70">
                  {trackCounts[t.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        {/* One scroll surface for both axes, so the header can stick while
            the page itself never scrolls sideways. */}
        <div className="max-h-[75vh] overflow-auto">
          <Table noWrapper className="min-w-[760px]">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={
                      allShown ? true : someShown ? 'indeterminate' : false
                    }
                    onCheckedChange={(v) => toggleAllShown(v === true)}
                    disabled={visibleCombos.length === 0}
                    aria-label="Select every class shown"
                  />
                </TableHead>
                <TableHead className="min-w-[200px]">Class</TableHead>
                <TableHead className="w-24">Track</TableHead>
                {ADMISSION_SCHEDULES.map((s) => (
                  <TableHead key={s} className="w-28 text-center">
                    {STAFF_SCHEDULE_LABEL[s]}
                  </TableHead>
                ))}
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={COLS}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    <p>No classes match these filters.</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => setFilter(NO_ADMIN_OPTION_FILTER)}
                    >
                      Clear filters
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((group) => (
                  <LevelRows
                    key={group.levelId}
                    group={group}
                    ayCode={ayCode}
                    levels={levels}
                    nameReach={nameReach}
                    selected={selected}
                    onToggle={toggleRow}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {selectedCombos.length > 0 && (
        <AdmissionOptionsBulkBar
          ayCode={ayCode}
          combos={selectedCombos}
          onDone={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}

/** One SIS level: its header row, then each parent-facing name and its class types. */
function LevelRows({
  group,
  ayCode,
  levels,
  nameReach,
  selected,
  onToggle,
}: {
  group: AdminOptionGroup;
  ayCode: string;
  levels: readonly SheetLevel[];
  nameReach: Record<string, NameReach>;
  selected: ReadonlySet<string>;
  onToggle: (combo: AdminOptionCombo, on: boolean) => void;
}) {
  // Parent-facing names in the order their first class type appears.
  const byName = new Map<string, AdminOptionCombo[]>();
  for (const c of group.combos) {
    const list = byName.get(c.levelLabel) ?? [];
    list.push(c);
    byName.set(c.levelLabel, list);
  }
  const sessions = group.combos.flatMap((c) => c.sessions);
  const open = sessions.filter((s) => s.isOpen).length;

  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell colSpan={COLS} className="px-4 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex items-baseline gap-2.5">
              <span className="font-serif text-[17px] font-semibold tracking-tight text-foreground">
                {group.levelLabel}
              </span>
              <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                {group.levelCode}
              </span>
            </div>
            <span className="text-[12px] text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">
                {open}
              </span>{' '}
              of {sessions.length} sessions open
            </span>
          </div>
        </TableCell>
      </TableRow>
      {[...byName.entries()].map(([name, combos]) => (
        <Fragment key={name}>
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={COLS}
              className="whitespace-normal px-4 pb-1 pt-3 text-[12px] text-muted-foreground"
            >
              <span className="sr-only">Parents see: </span>
              {name}
            </TableCell>
          </TableRow>
          {combos.map((combo) => {
            const key = adminComboKey(combo);
            const isSelected = selected.has(key);
            const what = optionDisplayName(
              combo.levelLabel,
              combo.classTypeLabel
            );
            return (
              <TableRow
                key={key}
                data-state={isSelected ? 'selected' : undefined}
              >
                <TableCell className="pl-4">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(v) => onToggle(combo, v === true)}
                    aria-label={`Select ${what}`}
                  />
                </TableCell>
                <TableCell className="whitespace-normal text-[14px] font-medium text-foreground">
                  {combo.classTypeLabel}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="h-5 border-border bg-card px-2 text-[11px] font-medium text-muted-foreground"
                  >
                    {combo.track}
                  </Badge>
                </TableCell>
                {ADMISSION_SCHEDULES.map((schedule) => {
                  const s = combo.sessions.find((x) => x.schedule === schedule);
                  return (
                    <TableCell key={schedule} className="text-center">
                      {s ? (
                        <div className="inline-flex justify-center">
                          <AdmissionOptionSessionSwitch
                            optionId={s.id}
                            schedule={s.schedule}
                            isOpen={s.isOpen}
                            levelLabel={combo.levelLabel}
                            classTypeLabel={combo.classTypeLabel}
                            hideLabel
                          />
                        </div>
                      ) : (
                        <>
                          <span aria-hidden className="text-muted-foreground">
                            —
                          </span>
                          <span className="sr-only">
                            No {STAFF_SCHEDULE_LABEL[schedule]} session
                          </span>
                        </>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="pr-4 text-right">
                  <AdmissionOptionRowMenu
                    ayCode={ayCode}
                    levels={levels}
                    target={{
                      levelLabel: combo.levelLabel,
                      classTypeLabel: combo.classTypeLabel,
                      levelId: combo.levelId,
                      track: combo.track,
                      nameReach: nameReach[combo.levelLabel] ?? {
                        options: 1,
                        ayCodes: [ayCode],
                      },
                    }}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </Fragment>
      ))}
    </>
  );
}

/** Beyond this many classes a session's closed list collapses to a count. */
const CLOSED_LIST_MAX = 4;

/** "Closed right now" — what parents cannot pick, one line per session. */
function ClosedNow({
  closed,
  onShowClosed,
}: {
  closed: ReturnType<typeof summarizeClosedSessions>;
  onShowClosed: () => void;
}) {
  if (closed.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleCheck className="size-4 text-brand-mint" />
        Every session is open.
      </p>
    );
  }
  return (
    <div className="flex items-start gap-4 rounded-xl border border-brand-indigo-soft bg-accent/60 p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <CircleOff className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-serif text-base font-semibold text-foreground">
          Closed right now
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {closed.map((line) => {
            const n = line.entries.length;
            return (
              <li key={line.schedule}>
                <span className="font-medium text-foreground">
                  {STAFF_SCHEDULE_LABEL[line.schedule]}:
                </span>{' '}
                {n <= CLOSED_LIST_MAX ? (
                  line.entries
                    .map((e) => `${e.levelLabel} · ${e.classTypeLabel}`)
                    .join(', ')
                ) : (
                  <>
                    {n} classes
                    {line.onlyTrack ? ` (all ${line.onlyTrack})` : ''}
                    <Button
                      variant="link"
                      size="sm"
                      className="ml-1 h-auto p-0 align-baseline text-sm"
                      onClick={onShowClosed}
                    >
                      Show them
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
