import { FileText } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';

import {
  FileDisciplineRecordButton,
  type DisciplineFilingStudent,
} from '@/components/classroom/file-discipline-record-button';
import { DisciplineTypeChip } from '@/components/discipline/record-type-chip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadClassroomAccess } from '@/lib/classroom/queries';
import { canReadRoster } from '@/lib/classroom/scope';
import { formatRecordDate, formatRecordWhen } from '@/lib/discipline/display';
import { listDisciplineForSection } from '@/lib/discipline/queries';
import { createClient, getSessionUser } from '@/lib/supabase/server';

type RosterRow = {
  index_number: number;
  student: {
    student_number: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
  } | null;
};

// Everything filed for one class — the second half of Christina's ask (#7).
// Newest first, every student in the class, one row per record.
//
// Not term-scoped: a disciplinary record hangs off a date, not off a term, and
// the same student's May incident and June letter belong on one list. The
// ?term_id= in the URL is only there because the tab nav preserves it.
//
// Nothing wider than this is built. Leadership already sees every filing
// school-wide on the Records activity log, and nobody has asked for more.
export default async function ClassroomDisciplinePage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  const { id: userId, role } = sessionUser;

  // Same floor as the API and the tab: any capability on this section at all.
  // Filing is open to whoever was in charge at the venue, so reading is too.
  const { capability } = await loadClassroomAccess(role, userId, sectionId);
  if (!canReadRoster(capability)) notFound();

  const supabase = await createClient();
  const [records, { data: sectionRow }, { data: rosterRows }] =
    await Promise.all([
      listDisciplineForSection(sectionId),
      supabase
        .from('sections')
        .select('name')
        .eq('id', sectionId)
        .maybeSingle(),
      // The roster is here for the filing button's student picker, not for the
      // table — a filing is always about one child, and the class page is the
      // one surface that does not already have one open.
      supabase
        .from('section_students')
        .select(
          'index_number, student:students(student_number, last_name, first_name, middle_name)'
        )
        .eq('section_id', sectionId)
        .neq('enrollment_status', 'withdrawn')
        .order('index_number'),
    ]);

  const sectionName = (sectionRow as { name: string } | null)?.name ?? null;
  const students: DisciplineFilingStudent[] = (
    (rosterRows ?? []) as unknown as RosterRow[]
  )
    .filter((r) => r.student?.student_number)
    .map((r) => ({
      studentNumber: r.student!.student_number,
      studentName: [
        r.student!.last_name,
        r.student!.first_name,
        r.student!.middle_name,
      ]
        .filter(Boolean)
        .join(', '),
      indexNumber: r.index_number,
    }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Discipline
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
            {records.length}
          </span>
        </h2>
        {records.length > 0 && (
          <FileDisciplineRecordButton
            sectionId={sectionId}
            sectionName={sectionName}
            students={students}
          />
        )}
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
          <div className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileText className="size-4" />
          </div>
          <p className="font-serif text-base font-semibold text-foreground">
            Nothing filed for this class
          </p>
          <p className="max-w-[42ch] text-sm text-muted-foreground">
            Anything filed for a student in this class will be listed here.
          </p>
          <FileDisciplineRecordButton
            sectionId={sectionId}
            sectionName={sectionName}
            students={students}
            variant="empty-state"
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Date</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>What kind</TableHead>
                <TableHead>Slip back</TableHead>
                <TableHead>Filed by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                    {formatRecordWhen(record.occurredOn, record.occurredAtTime)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium text-foreground">
                    {record.studentName ?? '—'}
                  </TableCell>
                  <TableCell>
                    <DisciplineTypeChip type={record.recordType} />
                  </TableCell>
                  <TableCell>{record.nature}</TableCell>
                  {/* Three states, three treatments. A returned slip is a
                      date. A letter still waiting takes the informational
                      accent — NOT destructive red, because nobody has asked to
                      chase these and red would sound an alarm the school never
                      rang. An incident has nothing to acknowledge, so it gets a
                      muted dash rather than a word. */}
                  <TableCell className="whitespace-nowrap">
                    {record.recordType !== 'letter' ? (
                      <span className="text-ink-5">—</span>
                    ) : record.acknowledgedOn ? (
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatRecordDate(record.acknowledgedOn)}
                      </span>
                    ) : (
                      <span className="font-mono text-xs font-semibold text-brand-indigo-deep">
                        Not yet
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {record.filedByName}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
