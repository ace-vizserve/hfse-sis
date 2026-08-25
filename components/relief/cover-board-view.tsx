'use client';

import { CalendarClock, CheckCircle2, RefreshCw } from 'lucide-react';

import { BookCoverDialog } from '@/components/relief/book-cover-dialog';
import { EndCoverButton } from '@/components/relief/end-cover-button';
import { SisEmptyState } from '@/components/sis/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { CoverBoard, CoverGroup } from '@/lib/relief/cover-board';
import { coverBadgeClass, formatCoverWindow } from '@/lib/relief/display';
import type { ReliefOption } from '@/components/sis/assignment-relief-control';

// The Cover page's three groups.
//
// ⚠ EACH ROW IS AN ABSENCE, NOT A CLASS. Every other staffing surface in this
// app is class-shaped; this one is not, because cover is not arranged that way.
// "Marrie is out Mon–Fri" is one decision covering N classes, so it is one row
// with the classes listed under it.

function windowLine(g: CoverGroup): string {
  return formatCoverWindow(g.startedOn, g.endedOn) ?? 'Open-ended';
}

function Group({
  g,
  teacherOptions,
}: {
  g: CoverGroup;
  teacherOptions: ReliefOption[];
}) {
  // An ended cover has nothing left to change — its window is already behind
  // us, and re-covering the teacher is a new booking, not an edit of this one.
  const editable = g.status !== 'ended';

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-t border-border px-6 py-4 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className="text-[15px] font-semibold text-foreground">
            {g.coveredTeacherName}
          </p>
          {editable && (
            <>
              <BookCoverDialog
                teacherOptions={teacherOptions}
                editing={{
                  coveredTeacherId: g.coveredTeacherId,
                  coveredTeacherName: g.coveredTeacherName,
                  reliefTeacherId: g.reliefTeacherId,
                  startedOn: g.startedOn,
                  endedOn: g.endedOn,
                  classCount: g.classes.length,
                }}
              />
              <EndCoverButton
                coveredTeacherId={g.coveredTeacherId}
                coveredTeacherName={g.coveredTeacherName}
                reliefTeacherName={g.reliefTeacherName}
                classCount={g.classes.length}
                scheduled={g.status === 'scheduled'}
              />
            </>
          )}
        </div>
        <p className="pt-0.5 text-sm text-muted-foreground">
          {g.status === 'ended' ? 'Was covered by' : 'Away · covered by'}{' '}
          <span className="font-medium text-foreground">
            {g.reliefTeacherName}
          </span>
        </p>
        <ul className="flex flex-wrap gap-1.5 pt-2.5">
          {g.classes.map((c) => (
            <li
              key={c.assignmentId}
              className="rounded-md border border-hairline bg-muted/40 px-2 py-0.5 text-xs text-foreground"
            >
              {c.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge variant="outline" className={`h-6 ${coverBadgeClass(g.status)}`}>
          {g.status === 'scheduled' ? (
            <CalendarClock className="size-3" />
          ) : g.status === 'active' ? (
            <RefreshCw className="size-3" />
          ) : null}
          {g.status === 'active'
            ? 'Covering'
            : g.status === 'scheduled'
              ? 'Booked'
              : 'Ended'}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          {windowLine(g)}
        </span>
        {/* The lapse flag — the one thing this page does that no class-shaped
            screen can, and the reason dates were worth adding at all. */}
        {g.endsInDays !== null && g.endsInDays <= 7 && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-brand-amber">
            <span className="size-1.5 rounded-full bg-current" />
            {g.endsInDays <= 0
              ? 'Ends today'
              : g.endsInDays === 1
                ? 'Ends tomorrow'
                : `Ends in ${g.endsInDays} days`}
          </span>
        )}
        {g.status === 'scheduled' && (
          <span className="text-xs text-muted-foreground">
            No access until then
          </span>
        )}
      </div>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  groups,
  icon,
  emptyTitle,
  emptyBody,
  teacherOptions,
}: {
  eyebrow: string;
  title: string;
  groups: CoverGroup[];
  icon: typeof RefreshCw;
  emptyTitle: string;
  emptyBody: string;
  teacherOptions: ReliefOption[];
}) {
  const Icon = icon;
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-[22px]">{title}</CardTitle>
        <CardAction>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="h-6 tabular-nums">
              {groups.length}
            </Badge>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </div>
        </CardAction>
      </CardHeader>
      {groups.length === 0 ? (
        <SisEmptyState icon={icon} title={emptyTitle} body={emptyBody} />
      ) : (
        <div>
          {groups.map((g) => (
            <Group key={g.key} g={g} teacherOptions={teacherOptions} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function CoverBoardView({
  board,
  teacherOptions,
  recentlyEndedDays,
}: {
  board: CoverBoard;
  teacherOptions: ReliefOption[];
  recentlyEndedDays: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <BookCoverDialog teacherOptions={teacherOptions} />
      </div>

      <Section
        eyebrow="Running today"
        title="Active now"
        icon={RefreshCw}
        groups={board.active}
        emptyTitle="Nobody is covering today"
        emptyBody="Every class is with the teacher who holds it."
        teacherOptions={teacherOptions}
      />

      <Section
        eyebrow="Booked ahead"
        title="Scheduled"
        icon={CalendarClock}
        groups={board.scheduled}
        emptyTitle="Nothing booked ahead"
        emptyBody="When a teacher's leave is approved, book the cover here and it starts and stops on its own."
        teacherOptions={teacherOptions}
      />

      <Section
        eyebrow={`Last ${recentlyEndedDays} days`}
        title="Recently ended"
        icon={CheckCircle2}
        groups={board.recentlyEnded}
        emptyTitle="No cover has finished recently"
        emptyBody={`Cover that ran to its last day shows here for ${recentlyEndedDays} days. Cover somebody stopped early is in the audit log instead.`}
        teacherOptions={teacherOptions}
      />
    </div>
  );
}
