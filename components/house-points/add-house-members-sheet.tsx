'use client';

import { UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { StudentMultiPicker } from '@/components/house-points/student-multi-picker';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { RosterStudent } from '@/lib/house-points/queries';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { MAX_HOUSE_MEMBERS_PER_ADD } from '@/lib/schemas/house-points';
import type { HouseRow } from '@/lib/sis/houses';

// "Add students to {house}" on a house's page: tick students from the year's
// enrolled roll and move them into this house in one go. Current members are
// left out of the list; each option shows the house the student is in now, so
// a move out of another house is never a surprise.
//
// Shell after add-participants-sheet.tsx — the list scrolls, the Cancel / Add
// row stays pinned (KD #227).

/** Current members are filtered out, so nobody shows as already in. */
const NONE: ReadonlySet<string> = new Set();

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-SG')} ${n === 1 ? one : many}`;
}

export function AddHouseMembersSheet({
  houseCode,
  houseName,
  ayCode,
  roster,
  houses,
  memberStudentIds,
}: {
  houseCode: string;
  houseName: string;
  ayCode: string;
  /** The year's ENROLLED roster — `loadEnrolledRoster`. */
  roster: RosterStudent[];
  houses: HouseRow[];
  /** students.id of everyone already in this house. */
  memberStudentIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const run = useWriteAction();

  const candidates = useMemo(() => {
    const members = new Set(memberStudentIds);
    return roster.filter((s) => !members.has(s.studentId));
  }, [roster, memberStudentIds]);

  const tooMany = selected.size > MAX_HOUSE_MEMBERS_PER_ADD;

  function onOpenChange(next: boolean) {
    if (busy) return;
    if (next) setSelected(new Set());
    setOpen(next);
  }

  async function add() {
    if (selected.size === 0 || tooMany) return;
    setBusy(true);
    await run(
      () =>
        apiFetch<{ ok: true; changed: number; skipped: number }>(
          `/api/sis/houses/${encodeURIComponent(houseCode)}/members`,
          jsonInit('POST', {
            ayCode,
            sectionStudentIds: Array.from(selected),
          })
        ),
      {
        pending: 'Adding students…',
        success: (data) => {
          const title = `Added ${plural(data.changed, 'student', 'students')} to ${houseName}`;
          return data.skipped > 0
            ? {
                title,
                description: `${plural(data.skipped, 'was', 'were')} already in ${houseName}.`,
              }
            : title;
        },
        onResolved: () => {
          setOpen(false);
          setSelected(new Set());
        },
      }
    );
    setBusy(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm" className="h-8">
          <UserPlus className="size-4" />
          Add students to {houseName}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {houseName} · {ayCode}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            Add students to {houseName}
          </SheetTitle>
          <SheetDescription>
            Moving a student changes their house for good — the house points
            they have already earned move with them.
          </SheetDescription>
        </SheetHeader>

        <StudentMultiPicker
          roster={candidates}
          houses={houses}
          selected={selected}
          locked={NONE}
          showNoHouse
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
            {tooMany
              ? `Add up to ${MAX_HOUSE_MEMBERS_PER_ADD} students at a time.`
              : selected.size === 0
                ? 'Nobody ticked yet'
                : `${plural(selected.size, 'student', 'students')} ticked`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={add}
              disabled={selected.size === 0 || tooMany}
              loading={busy}
              loadingText="Adding…"
            >
              {selected.size > 1
                ? `Add ${selected.size.toLocaleString('en-SG')} students`
                : 'Add student'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
