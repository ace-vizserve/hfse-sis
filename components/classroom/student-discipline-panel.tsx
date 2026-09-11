'use client';

import { ArrowLeft, FileText, Link2, ShieldAlert } from 'lucide-react';

import { DisciplineTypeChip } from '@/components/discipline/record-type-chip';
import { Button } from '@/components/ui/button';
import { LabelledRichText } from '@/components/ui/labelled-rich-text';
import { Skeleton } from '@/components/ui/skeleton';
import type { DisciplineRecordRow } from '@/lib/discipline/queries';
import {
  formatRecordDate,
  formatRecordWhen,
  formatShortDate,
  linkHost,
  linkLabel,
} from '@/lib/discipline/display';

// The Discipline tab of the student drawer — action item #7. Christina, 18:20:
// "if we click the name of the student, I was hoping we can also find those
// incidents that the student was involved in for the whole year."
//
// THREE VIEWS, ONE PANEL. The list sits inside the drawer's tabs; the detail
// and the filing form REPLACE the drawer's body, tabs and all, with a back
// button where the tabs were. Not a second Sheet on top of the first — nested
// dialogs are out in this codebase (they trap focus twice and the back gesture
// stops meaning anything), and `at-risk-lookup.tsx` already established the
// swap-in-place shape for exactly this reason.
//
// The panel decides nothing. There is no threshold, no flag, no letter
// generated — the rules live in the school's Student Handbook, which they
// revise on their own schedule. Staff decide; this records it.

/**
 * Which of the two views the discipline surface is showing.
 *
 * ⚠ THERE WAS A THIRD, `form`, AND IT SERVED BOTH FILING AND EDITING. Both
 * left this panel on 2026-09-11. Christina Labrador, T4 training, 10 Sep:
 * *"make it just a view tab for all the teachers, rather than use it to file
 * incidents… We don't use this to file any incident."* Filing moved to the
 * school-wide page at `/classroom/discipline`, and corrections went with it —
 * a tab that is a view tab does not hold a form. Records keeps its own
 * correction path (`components/sis/edit-discipline-record-button.tsx`), which
 * only office roles reach.
 *
 * A record is addressed by id, never held as an object: after a correction
 * elsewhere the list is refetched, and a captured row would keep rendering the
 * values somebody just changed.
 */
export type DisciplineView =
  | { mode: 'list' }
  | { mode: 'detail'; recordId: string };

export const DISCIPLINE_LIST_VIEW: DisciplineView = { mode: 'list' };

/**
 * "Filed by Chandana Dileep · Academics · Slip back 27 May".
 *
 * The slip is only ever part of a letter's story, and only when it has come
 * back — "Slip back —" on a letter sent yesterday would read as a fault.
 */
function metaLine(record: DisciplineRecordRow): string {
  const bits = [`Filed by ${record.filedByName}`];
  if (record.acknowledgedOn) {
    bits.push(`Slip back ${formatShortDate(record.acknowledgedOn)}`);
  }
  return bits.join(' · ');
}

function DisciplineError() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
        <ShieldAlert className="size-4" />
      </div>
      <div className="space-y-1">
        <p className="font-serif text-sm font-semibold text-foreground">
          This student&rsquo;s records could not be loaded
        </p>
        <p className="text-sm text-muted-foreground">
          Close the panel and open it again. If it keeps happening, tell the
          office.
        </p>
      </div>
    </div>
  );
}

/**
 * The list — every incident and letter on this student, newest first.
 *
 * Rendered inside the drawer's `TabsContent`, so it never draws the header or
 * the back button. Only the nature line is a click target; the row itself is
 * not, because a row that is entirely clickable makes the link icon beside the
 * nature look like a second, different action.
 */
export function DisciplineList({
  records,
  isLoading,
  isError,
  onOpen,
}: {
  records: DisciplineRecordRow[];
  isLoading: boolean;
  isError: boolean;
  onOpen: (recordId: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) return <DisciplineError />;

  // Most students will never have a record, so this is the state a teacher
  // sees most often. It has to read as good news, not as a screen that failed
  // to load (§7.6).
  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <FileText className="size-4" />
        </div>
        <p className="font-serif text-base font-semibold text-foreground">
          Nothing on record
        </p>
        <p className="max-w-[34ch] text-sm text-muted-foreground">
          Incidents and letters filed for this student will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border">
        <ul className="divide-y divide-border">
          {records.map((record) => (
            <li key={record.id} className="space-y-1.5 px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.04em] tabular-nums text-muted-foreground">
                  {formatRecordWhen(record.occurredOn, record.occurredAtTime)}
                </span>
                <DisciplineTypeChip type={record.recordType} />
              </div>

              <p className="flex items-baseline gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpen(record.id)}
                  className="rounded-sm text-left text-sm font-medium text-foreground underline decoration-hairline-strong underline-offset-4 transition-colors hover:text-primary hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {record.nature}
                </button>
                {record.documentUrl && (
                  <Link2
                    aria-label="Has a linked document"
                    className="size-3 shrink-0 self-center text-muted-foreground"
                  />
                )}
              </p>

              <p className="text-[13px] text-muted-foreground">
                {metaLine(record)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
      <ArrowLeft className="size-4" />
      Back to records
    </Button>
  );
}

function DisciplineDetail({
  record,
  onBack,
}: {
  record: DisciplineRecordRow;
  onBack: () => void;
}) {
  const isLetter = record.recordType === 'letter';
  const host = linkHost(record.documentUrl);

  return (
    <div className="space-y-4">
      <BackButton onBack={onBack} />
      <div className="h-px bg-border" />

      <div className="flex items-start justify-between gap-3">
        <p className="font-serif text-[19px] font-semibold leading-tight text-foreground">
          {record.nature}
        </p>
        <DisciplineTypeChip type={record.recordType} />
      </div>

      <dl className="space-y-2.5">
        <DetailRow label={isLetter ? 'Date sent' : 'Date'}>
          {formatRecordWhen(record.occurredOn, record.occurredAtTime)}
        </DetailRow>
        {isLetter && (
          <DetailRow label="Slip back">
            {record.acknowledgedOn ? (
              formatRecordDate(record.acknowledgedOn)
            ) : (
              <span className="text-muted-foreground">Not yet</span>
            )}
          </DetailRow>
        )}
        {record.className && (
          <DetailRow label="Class">{record.className}</DetailRow>
        )}
        <DetailRow label="Filed by">{record.filedByName}</DetailRow>
      </dl>

      {(record.details || record.remarks || record.documentUrl) && (
        <div className="h-px bg-border" />
      )}

      {/* No `&&` guard: the component hides itself, label included, when
          there is nothing written. An editor opened and left alone stores an
          empty paragraph, which is truthy — the old guard would have shown a
          heading over blank space. */}
      <LabelledRichText label="What happened" html={record.details} />
      <LabelledRichText label="Remarks" html={record.remarks} />

      {record.documentUrl && (
        <div>
          {/* Named for what it actually is, matching the form. Either way the
              link is the copy that came BACK acknowledged, not the one that
              went out. */}
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {isLetter ? 'Signed slip' : 'Acknowledged report'}
          </p>
          {/* Opened, never fetched. The SIS has no idea whether this link still
              resolves — if someone tidies the folder it fails at click time,
              not at save time, and the row still says what happened, who filed
              it and when. `noopener noreferrer` because the value is pasted. */}
          <a
            href={record.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-muted/40"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-indigo-deep">
              <Link2 className="size-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-primary underline underline-offset-2">
                {linkLabel(record.documentUrl)}
              </span>
              {host && (
                <span className="block font-mono text-[10px] tracking-[0.03em] text-muted-foreground">
                  {host}
                </span>
              )}
            </span>
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * The half of the surface that takes over the drawer body — the detail view.
 * Rendered by the sheet INSTEAD of its tabs, which is what lets a record be
 * read full-height without becoming a second dialog.
 */
export function StudentDisciplineTakeover({
  records,
  view,
  onView,
}: {
  records: DisciplineRecordRow[];
  view: Exclude<DisciplineView, { mode: 'list' }>;
  onView: (next: DisciplineView) => void;
}) {
  const record = records.find((r) => r.id === view.recordId) ?? null;

  // The record it was opened on is gone — deleted is impossible here (there is
  // no delete), so this only happens if the list refetched without it. Send the
  // reader back rather than showing an empty frame.
  if (!record) {
    return (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        <BackButton onBack={() => onView(DISCIPLINE_LIST_VIEW)} />
        <p className="text-sm text-muted-foreground">
          That record is no longer on this student. Go back to the list.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
      <DisciplineDetail
        record={record}
        onBack={() => onView(DISCIPLINE_LIST_VIEW)}
      />
    </div>
  );
}
