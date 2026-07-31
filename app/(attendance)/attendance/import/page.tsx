import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, FileSpreadsheet } from 'lucide-react';

import { createClient, getSessionUser } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { ImportAttendanceForm } from '@/components/attendance/import-form';

export default async function AttendanceImportPage() {
  // Bulk import is registrar+ only, matching this page's own ROUTE_ACCESS row
  // (`/attendance/import`) exactly. Added by KD #173: the page previously had
  // no guard at all — not even a session read — so its audience had to be
  // inferred from two other files (the ROUTE_ACCESS table and the route-group
  // layout), and neither of those lives anywhere near the bulk writer they were
  // protecting. The page now states its own contract.
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  const supabase = await createClient();

  const { data: ay } = await supabase
    .from('academic_years')
    .select('id, ay_code, label')
    .eq('is_current', true)
    .single();

  const { data: terms } = ay
    ? await supabase
        .from('terms')
        .select('id, label, start_date, end_date, is_current')
        .eq('academic_year_id', ay.id)
        .order('start_date', { ascending: true })
    : { data: [] };

  const termOptions = (
    (terms ?? []) as Array<{
      id: string;
      label: string;
      start_date: string;
      end_date: string;
      is_current: boolean;
    }>
  ).map((t) => ({
    value: t.id,
    label: `${t.label} (${t.start_date.slice(0, 7)} – ${t.end_date.slice(0, 7)})`,
    isCurrent: t.is_current,
  }));

  return (
    <PageShell>
      <Link
        href="/attendance"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Attendance
      </Link>

      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Attendance · Bulk import
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          Import from Excel.
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Upload the term&apos;s attendance workbook — one sheet per section.
          Sheet names should match{' '}
          <code className="font-mono text-[12px] text-foreground">
            section.name
          </code>{' '}
          (or{' '}
          <code className="font-mono text-[12px] text-foreground">
            level code + name
          </code>
          ). Each date column (
          <code className="font-mono text-[12px] text-foreground">Jan 8</code>,{' '}
          <code className="font-mono text-[12px] text-foreground">Feb 15</code>,
          etc.) becomes one ledger row per student. The server recomputes the
          rollup — Excel-computed totals are ignored.
        </p>
      </header>

      <Card className="@container/card">
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Upload
          </CardDescription>
          <CardTitle className="font-serif text-[20px] font-semibold tracking-tight text-foreground">
            Workbook &amp; target term
          </CardTitle>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileSpreadsheet className="size-4" />
          </div>
        </CardHeader>
        <CardContent>
          {termOptions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No terms are seeded for the current academic year. Run the AY
              setup wizard first.
            </div>
          ) : (
            <ImportAttendanceForm
              termOptions={termOptions}
              ayCode={ay?.ay_code ?? ''}
            />
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
