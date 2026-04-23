import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, CalendarRange, FilePlus2, RefreshCw, Trash2, UserCheck } from 'lucide-react';

import { AyDeleteDialog } from '@/components/sis/ay-delete-dialog';
import { NewAyButton } from '@/components/sis/ay-setup-wizard';
import { AySwitchActiveDialog } from '@/components/sis/ay-switch-active-dialog';
import { GenerateSheetsDialog } from '@/components/sis/generate-sheets-dialog';
import { TermDatesEditor } from '@/components/sis/term-dates-editor';
import { CopyTeacherAssignmentsDialog } from '@/components/sis/copy-teacher-assignments-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  checkAyEmpty,
  getCopyForwardPreview,
  listAcademicYears,
  listTermsByAy,
  type AcademicYearListItem,
  type TermRow,
} from '@/lib/sis/ay-setup/queries';
import { getSessionUser } from '@/lib/supabase/server';

export default async function AySetupPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');

  const role = sessionUser.role;
  if (role !== 'school_admin' && role !== 'admin' && role !== 'superadmin') {
    redirect('/sis');
  }

  const ays = await listAcademicYears();
  const termsByAy = await listTermsByAy();
  const activeAyCode = ays.find((a) => a.is_current)?.ay_code ?? null;

  // Preview for the "New AY" wizard. Uses a throwaway code so the query
  // just pulls the most-recent existing AY.
  const preview = await getCopyForwardPreview('__NEW__');

  // Pre-compute blockers for each AY (only matters when superadmin sees
  // the Delete button — cheap enough to always fetch for HFSE's handful
  // of AYs).
  const blockersByAy: Record<string, string[]> = {};
  if (role === 'superadmin') {
    await Promise.all(
      ays.map(async (ay) => {
        const res = await checkAyEmpty(ay.ay_code);
        blockersByAy[ay.ay_code] = res.blockers;
      }),
    );
  }

  return (
    <PageShell>
      <Link
        href="/sis"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Dashboard
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Records · AY Setup
          </p>
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            Academic years.
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            Create new academic years, switch the active AY, and retire empty ones.
            Creating an AY inserts the reference rows (terms, sections, subject
            configs) and provisions the four AY-prefixed admissions tables in a
            single transaction.
          </p>
        </div>
        <NewAyButton preview={preview} />
      </header>

      <Card className="overflow-hidden p-0">
        <CardHeader className="border-b border-hairline bg-muted/40 px-6 py-4">
          <CardTitle className="font-serif text-base font-semibold">All academic years</CardTitle>
          <CardDescription className="text-xs">
            Ordered newest first. Row counts refresh on page load.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="w-full">
          <Table noWrapper>
            <TableHeader>
              <TableRow className="bg-muted/20 hover:bg-muted/20">
                <TableHead>AY code</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Terms</TableHead>
                <TableHead className="text-right">Sections</TableHead>
                <TableHead className="text-right">Subject configs</TableHead>
                <TableHead className="text-right">Students rostered</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ays.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-8 text-center text-sm text-muted-foreground">
                    No academic years yet. Click <strong>New AY</strong> to create the first.
                  </TableCell>
                </TableRow>
              ) : (
                ays.map((ay) => (
                  <AyRow
                    key={ay.ay_code}
                    ay={ay}
                    activeAyCode={activeAyCode}
                    role={role}
                    blockers={blockersByAy[ay.ay_code] ?? []}
                    terms={termsByAy[ay.id] ?? []}
                    otherAys={ays
                      .filter((o) => o.ay_code !== ay.ay_code)
                      .map((o) => ({ ayCode: o.ay_code, label: o.label }))}
                  />
                ))
              )}
            </TableBody>
          </Table>
          <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>

      <section className="rounded-xl border border-hairline bg-white p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
          <CalendarRange className="size-3" /> Rollover checklist
        </p>
        <ol className="ml-4 list-decimal space-y-1">
          <li>
            <strong>Create the new AY</strong> here — inserts all reference rows + admissions tables
            in one transaction. The switcher picks it up immediately across every AY-scoped page.
            (admin + superadmin)
          </li>
          <li>
            <strong>Verify the parent-portal team</strong> is ready to write to the new admissions
            tables. The canonical DDL is frozen in{' '}
            <code className="rounded bg-muted px-1 py-0.5">docs/context/10-parent-portal.md</code>.
          </li>
          <li>
            <strong>Switch active</strong> on the new AY when ready. (admin + superadmin)
          </li>
          <li>
            <strong>Optional:</strong> delete a mis-created AY if it&apos;s still empty. (superadmin
            only)
          </li>
        </ol>
      </section>
    </PageShell>
  );
}

function AyRow({
  ay,
  activeAyCode,
  role,
  blockers,
  terms,
  otherAys,
}: {
  ay: AcademicYearListItem;
  activeAyCode: string | null;
  role: 'school_admin' | 'admin' | 'superadmin';
  blockers: string[];
  terms: TermRow[];
  otherAys: Array<{ ayCode: string; label: string }>;
}) {
  const termsWithDates = terms.filter((t) => t.start_date && t.end_date).length;
  const termsTotal = terms.length;
  const datesStatus =
    termsTotal === 0
      ? 'No terms'
      : termsWithDates === termsTotal
      ? `${termsWithDates}/${termsTotal} set`
      : `${termsWithDates}/${termsTotal} set`;
  const datesIncomplete = termsTotal > 0 && termsWithDates < termsTotal;
  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
        {ay.ay_code}
      </TableCell>
      <TableCell className="text-sm">{ay.label}</TableCell>
      <TableCell>
        {ay.is_current ? (
          <Badge className="border-transparent bg-brand-mint text-foreground">Active</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Inactive
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{ay.counts.terms}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">{ay.counts.sections}</TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {ay.counts.subject_configs}
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {ay.counts.section_students}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <TermDatesEditor ayCode={ay.ay_code} ayLabel={ay.label} terms={terms}>
            <Button
              size="sm"
              variant="outline"
              className={
                'h-7 text-xs ' +
                (datesIncomplete
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-200'
                  : '')
              }
              title={datesIncomplete ? `Term dates: ${datesStatus}` : `Term dates (${datesStatus})`}
            >
              <CalendarRange className="mr-1 size-3" />
              Dates
              <span className="ml-1 font-mono text-[10px] tabular-nums">{datesStatus}</span>
            </Button>
          </TermDatesEditor>
          {otherAys.length > 0 && (
            <CopyTeacherAssignmentsDialog
              targetAyCode={ay.ay_code}
              sourceOptions={otherAys}
            >
              <Button size="sm" variant="outline" className="h-7 text-xs" title="Copy teachers from another AY">
                <UserCheck className="mr-1 size-3" />
                Copy teachers
              </Button>
            </CopyTeacherAssignmentsDialog>
          )}
          {ay.counts.subject_configs > 0 && ay.counts.sections > 0 && (
            <GenerateSheetsDialog scope={{ kind: 'ay', ayId: ay.id, ayCode: ay.ay_code }}>
              <Button size="sm" variant="outline" className="h-7 text-xs" title="Generate every missing grading sheet for this AY">
                <FilePlus2 className="mr-1 size-3" />
                Generate sheets
              </Button>
            </GenerateSheetsDialog>
          )}
          {!ay.is_current && (
            <AySwitchActiveDialog targetAyCode={ay.ay_code} currentAyCode={activeAyCode}>
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <RefreshCw className="mr-1 size-3" /> Switch active
              </Button>
            </AySwitchActiveDialog>
          )}
          {role === 'superadmin' && (
            <AyDeleteDialog ayCode={ay.ay_code} blockers={blockers}>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                title={blockers.length > 0 ? `Cannot delete: ${blockers.join(', ')}` : undefined}
              >
                <Trash2 className="mr-1 size-3" /> Delete
              </Button>
            </AyDeleteDialog>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
