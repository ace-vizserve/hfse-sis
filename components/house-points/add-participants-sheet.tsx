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
import type { HouseRow } from '@/lib/sis/houses';

// "Add students" on a student event: tick everyone who took part, then add
// them in one go. Students already on the sheet are shown ticked and can't be
// ticked again; removing one is done from the sheet itself.
//
// Sheet shell after new-event-sheet.tsx — the list scrolls, the Cancel / Add
// row stays pinned (KD #227).

/** AddEntriesSchema's ceiling for one request. */
const MAX_PER_ADD = 500;

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-SG')} ${n === 1 ? one : many}`;
}

export function AddParticipantsSheet({
  eventId,
  eventName,
  roster,
  houses,
  enteredIds,
}: {
  eventId: string;
  eventName: string;
  /** The year's ENROLLED roster — `loadEnrolledRoster`. */
  roster: RosterStudent[];
  houses: HouseRow[];
  /** section_student ids already on this event's sheet. */
  enteredIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const run = useWriteAction();

  const locked = useMemo(() => new Set(enteredIds), [enteredIds]);
  const tooMany = selected.size > MAX_PER_ADD;

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
        apiFetch<{ ok: true; added: number; skipped: number }>(
          `/api/house-points/events/${encodeURIComponent(eventId)}/entries`,
          jsonInit('POST', { sectionStudentIds: Array.from(selected) })
        ),
      {
        pending: 'Adding students…',
        success: (data) => {
          const title = `Added ${plural(data.added, 'student', 'students')}`;
          return data.skipped > 0
            ? {
                title,
                description: `${plural(data.skipped, 'was', 'were')} already on the sheet.`,
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
        <Button>
          <UserPlus className="size-4" />
          Add students
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eventName}
          </p>
          <SheetTitle className="font-serif text-[22px] leading-tight tracking-tight">
            Add students
          </SheetTitle>
          <SheetDescription>
            Tick everyone who took part. You pick their awards on the sheet once
            they are added.
          </SheetDescription>
        </SheetHeader>

        <StudentMultiPicker
          roster={roster}
          houses={houses}
          selected={selected}
          locked={locked}
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
              ? `Add up to ${MAX_PER_ADD} students at a time.`
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
