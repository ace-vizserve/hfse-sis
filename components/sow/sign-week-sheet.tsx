'use client';

import { Check, MessageSquareText } from 'lucide-react';
import { useState } from 'react';

import { formatRange, formatWeekdayDay } from '@/components/sow/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RichText } from '@/components/ui/rich-text';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';
import { isEmptyRichText, proseLength } from '@/lib/rich-text';
import { ASSIGNMENT_ROLE_LABELS } from '@/lib/schemas/teacher-assignment';
import { CHECK_LABELS, SIGNOFF_REMARKS_MAX } from '@/lib/sow/check-options';
import type {
  GridCell,
  GridCheck,
  GridRow,
  SowPlans,
} from '@/lib/sow/oversight';

type SowPlan = SowPlans[string][number];
import { cn } from '@/lib/utils';

// "Review and sign a week" (board 11): one class's week as the subject head
// reads it — the planned row, each teacher's check and note, any relief note
// — then "Sign Week N" or "Ask the teacher" with the supervisor's remarks.
//
// The drawer is open to everyone who can see the grid; only a head of the
// subject (`row.canSign`) gets the remarks box and the two actions. The
// server decides again (`recordSignoff`).

// §9.3 tones, the same three the weekly check uses (components/sow/week-checks).
const MINT = 'h-6 border-brand-mint bg-brand-mint/30 text-ink';
const AMBER = 'h-6 border-brand-amber/40 bg-brand-amber/10 text-ink';

/** "Fri 10 Apr" for a moment, on Singapore's calendar. */
function when(ts: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Singapore',
  }).format(new Date(ts));
}

export function SignWeekSheet({
  target,
  onOpenChange,
}: {
  /** The class and week being reviewed; null = closed. */
  target: { row: GridRow; cell: GridCell; plan: SowPlan | null } | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {/* Keyed so each week opens with an empty remarks box. */}
        {target && (
          <Review
            key={`${target.row.id}|${target.cell.weekNumber}`}
            row={target.row}
            cell={target.cell}
            plan={target.plan}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Review({
  row,
  cell,
  plan,
  onDone,
}: {
  row: GridRow;
  cell: GridCell;
  /** The planned row, from the page's one-per-scheme `plans` map. */
  plan: SowPlan | null;
  onDone: () => void;
}) {
  const run = useWriteAction();
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState<'signed' | 'asked' | null>(null);
  const n = cell.weekNumber;
  const signed = cell.signed;
  const empty = isEmptyRichText(remarks);
  const tooLong = proseLength(remarks) > SIGNOFF_REMARKS_MAX;

  // Every teacher who takes the class, with their check or none; then anyone
  // who checked but no longer holds the class (their word still counts).
  const byTeacher = new Map(cell.checks.map((c) => [c.teacherUserId, c]));
  const people: {
    key: string;
    role: string;
    name: string;
    check: GridCheck | null;
  }[] = [
    ...row.teachers.map((t) => ({
      key: t.userId,
      role: ASSIGNMENT_ROLE_LABELS[t.role],
      name: t.name,
      check: byTeacher.get(t.userId) ?? null,
    })),
    ...cell.checks
      .filter((c) => !row.teachers.some((t) => t.userId === c.teacherUserId))
      .map((c) => ({
        key: c.teacherUserId,
        role: 'Teacher',
        name: c.name,
        check: c,
      })),
  ];

  async function send(kind: 'signed' | 'asked') {
    setBusy(kind);
    await run(
      () =>
        apiFetch(
          `/api/sow/${row.sowId}/signoffs`,
          jsonInit('POST', {
            weekNumber: n,
            sectionId: row.sectionId,
            kind,
            remarks,
          })
        ),
      {
        pending:
          kind === 'signed' ? `Signing Week ${n}…` : 'Asking the teacher…',
        success: kind === 'signed' ? `Week ${n} signed` : 'Sent to the teacher',
        onResolved: onDone,
      }
    );
    setBusy(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="shrink-0 gap-1.5 border-b border-border px-6 pb-5 pt-6 pr-14">
        <p className="text-[13px] text-muted-foreground">
          {row.className} · {row.subjectName} · {row.track}
        </p>
        <SheetTitle className="font-serif text-[24px] leading-tight tracking-tight">
          Week {n} · {formatRange(cell.startsOn, cell.endsOn)}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Read how the week went, then sign it or ask the teacher.
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <section className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">Planned</p>
          <p className="text-sm font-medium text-foreground">
            {plan?.topic || 'No topic'}
          </p>
          {plan?.activities && !isEmptyRichText(plan.activities) && (
            <RichText
              html={plan.activities}
              className="text-[13px] text-ink-3"
            />
          )}
        </section>

        <section className="space-y-3" aria-label="Teachers' checks">
          {people.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nobody is assigned to teach this subject in {row.className}.
            </p>
          )}
          {people.map((p) => (
            <div
              key={p.key}
              className="space-y-1.5 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-foreground">
                  {p.role}
                </span>
                {p.check ? (
                  <Badge
                    variant="outline"
                    className={p.check.option === 'as_planned' ? MINT : AMBER}
                  >
                    {CHECK_LABELS[p.check.option]}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-6',
                      cell.ended
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : 'text-muted-foreground'
                    )}
                  >
                    Not checked
                  </Badge>
                )}
              </div>
              {p.check?.note && !isEmptyRichText(p.check.note) && (
                <RichText html={p.check.note} className="text-sm text-ink-2" />
              )}
              <p className="text-xs text-muted-foreground">
                {p.name}
                {p.check ? ` · ${when(p.check.recordedAt)}` : ''}
              </p>
            </div>
          ))}
        </section>

        {cell.reliefNotes.map((r, i) => (
          <div
            key={i}
            className="space-y-1 rounded-lg border border-brand-indigo-soft/40 bg-accent px-4 py-3 text-[13px] text-brand-indigo-deep"
          >
            <p className="font-semibold">
              Relief, {formatWeekdayDay(r.taughtOn)} ({r.name}):
            </p>
            <RichText html={r.note} className="text-[13px]" />
          </div>
        ))}

        {cell.signoff && (
          <div
            className={cn(
              'flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px]',
              cell.signoff.kind === 'signed'
                ? 'border-brand-mint bg-brand-mint/20'
                : 'border-brand-indigo-soft/40 bg-accent'
            )}
          >
            {cell.signoff.kind === 'signed' ? (
              <Check className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
            ) : (
              <MessageSquareText
                className="mt-0.5 size-4 shrink-0 text-brand-indigo-deep"
                aria-hidden
              />
            )}
            <div className="min-w-0 space-y-1">
              <p className="font-medium text-foreground">
                {cell.signoff.kind === 'signed'
                  ? `Signed by ${cell.signoff.by} · ${when(cell.signoff.at)}`
                  : `${cell.signoff.by} asked the teacher · ${when(cell.signoff.at)}`}
              </p>
              {cell.signoff.remarks && (
                <RichText
                  html={cell.signoff.remarks}
                  className="text-[13px] text-ink-2"
                />
              )}
            </div>
          </div>
        )}

        {row.canSign ? (
          <div className="space-y-1.5">
            <label
              htmlFor="supervisor-remarks"
              className="text-sm font-semibold text-foreground"
            >
              Supervisor&rsquo;s remarks
            </label>
            <RichTextEditor
              id="supervisor-remarks"
              rows={3}
              maxLength={SIGNOFF_REMARKS_MAX}
              placeholder="e.g. Noted, catch up on Practical 2 in Week 4."
              value={remarks}
              onChange={setRemarks}
            />
            <p className="text-xs text-muted-foreground">
              Asking the teacher needs remarks; signing doesn&rsquo;t.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Only the subject head signs off weeks.
          </p>
        )}
      </div>

      <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-6 py-4">
        {row.canSign ? (
          <>
            <Button
              variant="outline"
              onClick={() => void send('asked')}
              disabled={empty || tooLong || busy !== null}
              loading={busy === 'asked'}
              loadingText="Asking…"
            >
              Ask the teacher
            </Button>
            {!signed && (
              <Button
                onClick={() => void send('signed')}
                disabled={tooLong || busy !== null}
                loading={busy === 'signed'}
                loadingText="Signing…"
              >
                Sign Week {n}
              </Button>
            )}
          </>
        ) : (
          <SheetClose asChild>
            <Button variant="outline">Close</Button>
          </SheetClose>
        )}
      </SheetFooter>
    </div>
  );
}
