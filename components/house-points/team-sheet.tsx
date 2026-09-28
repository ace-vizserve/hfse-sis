'use client';

import { Users } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { StudentMultiPicker } from '@/components/house-points/student-multi-picker';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { HouseChip } from '@/components/ui/house-chip';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { teamHouses } from '@/lib/house-points/compute';
import {
  studentsOnOtherTeams,
  type TeamMembership,
} from '@/lib/house-points/team-membership';
import type { RosterStudent } from '@/lib/house-points/queries';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import type { HouseRow } from '@/lib/sis/houses';

// A team on a team event: its name and who is on it. One drawer for both
// jobs — "Add team" in the page header (uncontrolled, brings its own trigger)
// and the pencil on a team's row (controlled by the score sheet, which owns
// the row). Members can come from any class: a team event ranks across the
// whole event.
//
// While ticking, the drawer shows which houses the team's points will go to,
// counted once per house — the rule the sheet itself follows, seen before the
// team is saved rather than after.
//
// Sheet shell after add-participants-sheet.tsx — the list scrolls, the
// Cancel / Save row stays pinned (KD #227).

/** TeamInputSchema's limits. */
const MAX_MEMBERS = 30;
const NAME_MAX = 80;

export type EditableTeam = {
  id: string;
  name: string;
  /** Every member's section_student id, enrolled or not. */
  memberIds: string[];
};

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-SG')} ${n === 1 ? one : many}`;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function TeamSheet({
  eventId,
  eventName,
  roster,
  houses,
  memberships,
  team = null,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  eventId: string;
  eventName: string;
  /** The year's ENROLLED roster — `loadEnrolledRoster`. */
  roster: RosterStudent[];
  houses: HouseRow[];
  /** Every team membership in this event, for one-team-per-student. */
  memberships: TeamMembership[];
  /** Set → edit this team. Unset → add a new one. */
  team?: EditableTeam | null;
  /** Controlled open state; without it the drawer renders its own "Add team" trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const controlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlled ? controlledOpen : uncontrolledOpen;

  const nameId = useId();
  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  // One team per student per event: anyone on ANOTHER team of this event
  // is shown but cannot be ticked. This team's own members stay selectable.
  // The team routes refuse the same students (lib/house-points/team-membership.ts).
  const onOtherTeams = useMemo(
    () => studentsOnOtherTeams(memberships, team?.id ?? null),
    [memberships, team]
  );
  const rosterIds = useMemo(
    () => new Set(roster.map((s) => s.sectionStudentId)),
    [roster]
  );
  const rosterById = useMemo(
    () => new Map(roster.map((s) => [s.sectionStudentId, s])),
    [roster]
  );
  const housesById = useMemo(
    () => new Map(houses.map((h) => [h.id, h])),
    [houses]
  );

  // The picker only lists this year's enrolled students, so a member who has
  // since left can't be shown ticked. They stay on the team unless the list
  // is changed — then the new list is saved as ticked, without them.
  const startingIds = useMemo(
    () => new Set((team?.memberIds ?? []).filter((id) => rosterIds.has(id))),
    [team, rosterIds]
  );
  const notOnRoll = (team?.memberIds.length ?? 0) - startingIds.size;

  const [name, setName] = useState(team?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(startingIds)
  );

  // Reset the form each time the drawer opens — adjusting state during render
  // rather than in an effect, so the first open frame is never stale.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? (team?.id ?? 'new') : null;
  if (openedFor !== openKey) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      setName(team?.name ?? '');
      setSelected(new Set(startingIds));
    }
  }

  function setOpen(next: boolean) {
    if (busy) return;
    if (controlled) controlledOnOpenChange?.(next);
    else setUncontrolledOpen(next);
  }

  const trimmed = name.trim();
  const tooMany = selected.size > MAX_MEMBERS;
  const nameChanged = team ? trimmed !== team.name : true;
  const membersChanged = team ? !sameSet(selected, startingIds) : true;
  const canSave =
    trimmed.length > 0 &&
    selected.size > 0 &&
    !tooMany &&
    (nameChanged || membersChanged);

  const pointsGoTo = useMemo(
    () =>
      teamHouses(
        Array.from(selected, (id) => ({
          houseId: rosterById.get(id)?.houseId ?? null,
        }))
      ),
    [selected, rosterById]
  );
  const sharesAHouse = pointsGoTo.some((h) => h.memberCount > 1);

  async function save() {
    if (!canSave) return;
    setBusy(true);
    const result = team
      ? await run(
          () =>
            apiFetch<{ ok: true; changed: boolean }>(
              `/api/house-points/teams/${encodeURIComponent(team.id)}`,
              jsonInit('PATCH', {
                ...(nameChanged ? { name: trimmed } : {}),
                ...(membersChanged
                  ? { sectionStudentIds: Array.from(selected) }
                  : {}),
              })
            ),
          { pending: 'Saving the team…', success: `Saved ${trimmed}` }
        )
      : await run(
          () =>
            apiFetch<{ ok: true; teamId: string; entryId: string }>(
              `/api/house-points/events/${encodeURIComponent(eventId)}/teams`,
              jsonInit('POST', {
                name: trimmed,
                sectionStudentIds: Array.from(selected),
              })
            ),
          { pending: 'Adding the team…', success: `Added ${trimmed}` }
        );
    setBusy(false);
    if (result !== undefined) setOpen(false);
  }

  const status = tooMany
    ? `A team can have up to ${MAX_MEMBERS} students.`
    : selected.size === 0
      ? 'Nobody ticked yet'
      : trimmed.length === 0
        ? 'Name the team to save it'
        : `${plural(selected.size, 'student', 'students')} on the team`;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!controlled && (
        <SheetTrigger asChild>
          <Button>
            <Users className="size-4" />
            Add team
          </Button>
        </SheetTrigger>
      )}

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eventName}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            {team ? 'Edit team' : 'Add a team'}
          </SheetTitle>
          <SheetDescription>
            Name the team and tick who is on it. They can come from any class.
            Its points go to each house among its students, once per house.
          </SheetDescription>
        </SheetHeader>

        <div className="shrink-0 space-y-4 border-b border-border px-6 py-5">
          <Field>
            <FieldLabel htmlFor={nameId}>Team name</FieldLabel>
            <Input
              id={nameId}
              value={name}
              maxLength={NAME_MAX}
              autoComplete="off"
              placeholder="e.g. Relay team A"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="space-y-1.5" aria-live="polite">
            <p className="text-[13px] font-medium text-foreground">
              Points go to
            </p>
            {pointsGoTo.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {selected.size === 0
                  ? 'The houses of the students you tick.'
                  : 'None of the ticked students is in a house yet.'}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {pointsGoTo.map((h) => {
                  const house = housesById.get(h.houseId);
                  return house ? (
                    <HouseChip
                      key={h.houseId}
                      name={house.name}
                      colourToken={house.colourToken}
                    />
                  ) : null;
                })}
                {sharesAHouse && (
                  <span className="text-xs text-muted-foreground">
                    Counted once per house
                  </span>
                )}
              </div>
            )}
          </div>

          {notOnRoll > 0 && (
            <p className="rounded-lg border border-brand-indigo-soft bg-accent px-3 py-2 text-xs text-foreground">
              {plural(
                notOnRoll,
                'student on this team is',
                'students on this team are'
              )}{' '}
              no longer enrolled, so {notOnRoll === 1 ? "isn't" : "aren't"}{' '}
              listed below. They stay on the team unless you change who is on
              it.
            </p>
          )}
        </div>

        <StudentMultiPicker
          roster={roster}
          houses={houses}
          selected={selected}
          locked={EMPTY}
          unavailable={onOtherTeams}
          unavailableLabel="On another team"
          onChange={setSelected}
          className="flex-1 px-6 py-5"
        />

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-6 py-4">
          <p
            className={
              tooMany
                ? 'text-sm text-destructive'
                : 'text-sm text-muted-foreground'
            }
            aria-live="polite"
          >
            {status}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={!canSave}
              loading={busy}
              loadingText={team ? 'Saving…' : 'Adding…'}
            >
              {team ? 'Save team' : 'Add team'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const EMPTY: ReadonlySet<string> = new Set();
