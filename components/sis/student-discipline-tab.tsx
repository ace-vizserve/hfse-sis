import { FileText, Link2 } from 'lucide-react';

import { DisciplineTypeChip } from '@/components/discipline/record-type-chip';
import { EditDisciplineRecordButton } from '@/components/sis/edit-discipline-record-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  formatRecordDate,
  formatRecordWhen,
  linkHost,
  linkLabel,
} from '@/lib/discipline/display';
import type { DisciplineRecordRow } from '@/lib/discipline/queries';

// The student's disciplinary record on their permanent-record page (#7).
//
// NO FILING HERE, but corrections are allowed. New records flow through
// Classroom, because the school files by whoever was in charge at the venue
// and teachers cannot open Records at all. Editing is different: leadership
// could always correct anyone's filing (`canManageAnyDisciplineRecord`, and
// the PATCH route honours it) and until 2026-08-21 had nowhere to do it — the
// permission existed and the button did not.
//
// Not an async component and it fetches nothing — the page loads the rows in
// the batch it already runs, so this tab costs no extra round trip and cannot
// serialise behind the others.
//
// Cross-year, matching what the Classroom drawer reads: `studentNumber` is the
// stable id (Hard Rule #4) and a student's behavioural history does not restart
// in August. The class on each row is where it happened, so the year reads off
// the record itself.

function Prose({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="whitespace-pre-wrap pt-1 text-sm leading-relaxed text-ink-3">
        {children}
      </p>
    </div>
  );
}

export function StudentDisciplineTab({
  records,
  canEdit = false,
}: {
  records: DisciplineRecordRow[];
  /**
   * May this reader correct a filing? Defaults to FALSE so a caller that
   * forgets it renders read-only rather than an Edit button whose PATCH would
   * 403 (KD #173). Every role this page admits is `oversight`, so the Records
   * page passes true.
   */
  canEdit?: boolean;
}) {
  if (records.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2.5 py-10 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileText className="size-4" />
          </div>
          <p className="font-serif text-base font-semibold text-foreground">
            Nothing on record
          </p>
          <p className="max-w-[46ch] text-sm text-muted-foreground">
            No incident or letter has been filed for this student. Filing
            happens in Classroom, on the class the student belongs to.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-5">
        <CardDescription>Behaviour</CardDescription>
        <CardTitle className="font-serif text-[22px]">
          Disciplinary records
        </CardTitle>
      </CardHeader>

      <ul className="divide-y divide-border">
        {records.map((record) => (
          <li key={record.id} className="space-y-3 px-6 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.04em] tabular-nums text-muted-foreground">
                  {formatRecordWhen(record.occurredOn, record.occurredAtTime)}
                </p>
                <p className="font-serif text-base font-semibold leading-snug text-foreground">
                  {record.nature}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <DisciplineTypeChip type={record.recordType} />
                {canEdit && <EditDisciplineRecordButton record={record} />}
              </div>
            </div>

            <p className="text-[13px] text-muted-foreground">
              {[
                record.className,
                `Filed by ${record.filedByName}`,
                record.recordType === 'letter'
                  ? record.acknowledgedOn
                    ? `Slip back ${formatRecordDate(record.acknowledgedOn)}`
                    : 'Slip not back yet'
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            {/* Shown in full rather than behind a click. Leadership opening a
                permanent record came to read it, not to expand four rows one
                at a time. */}
            {record.details && (
              <Prose label="What happened">{record.details}</Prose>
            )}
            {record.remarks && <Prose label="Remarks">{record.remarks}</Prose>}

            {record.documentUrl && (
              <a
                href={record.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-fit max-w-full items-center gap-2 text-sm text-primary hover:underline"
              >
                <Link2 className="size-3.5 shrink-0" />
                <span className="truncate">
                  {linkLabel(record.documentUrl)}
                </span>
                {linkHost(record.documentUrl) && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {linkHost(record.documentUrl)}
                  </span>
                )}
              </a>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
