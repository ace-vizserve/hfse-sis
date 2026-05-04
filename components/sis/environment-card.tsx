'use client';

import { AlertTriangle, CheckCircle2, FlaskConical, Globe, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Environment = 'production' | 'test';

type SeedSummary = {
  students_inserted: number;
  section_count: number;
} | null;

type StructureSummary = {
  levels_inserted: number;
  subjects_inserted: number;
  sections_inserted: number;
  subject_configs_inserted: number;
  terms_updated: number;
  calendar_days_inserted: number;
  calendar_events_inserted: number;
  school_config_applied: boolean;
  grading_sheets_created: number;
  grading_sheets_totals_set: number;
} | null;

type PopulatedSummary = {
  grade_entries_inserted: number;
  attendance_daily_inserted: number;
  attendance_rollups_built: number;
  evaluation_writeups_inserted: number;
  admissions_apps_inserted: number;
  enrolled_applications_inserted: number;
  teacher_form_adviser_assignments: number;
  teacher_subject_assignments: number;
  discount_codes_inserted: number;
  publications_inserted: number;
} | null;

function describeTestSwitch(
  structure: StructureSummary,
  seed: SeedSummary,
  populated: PopulatedSummary,
): string {
  const parts: string[] = [];
  if (structure) {
    const {
      sections_inserted,
      subject_configs_inserted,
      calendar_days_inserted,
      terms_updated,
      grading_sheets_created,
    } = structure;
    if (sections_inserted > 0) parts.push(`${sections_inserted} sections`);
    if (subject_configs_inserted > 0) parts.push(`${subject_configs_inserted} subject configs`);
    if (terms_updated > 0) parts.push(`${terms_updated} term${terms_updated === 1 ? '' : 's'} dated`);
    if (calendar_days_inserted > 0) parts.push(`${calendar_days_inserted} calendar days`);
    if (grading_sheets_created > 0) parts.push(`${grading_sheets_created} grading sheets`);
  }
  if (seed && seed.students_inserted > 0) {
    parts.push(`${seed.students_inserted} students`);
  }
  if (populated) {
    const {
      grade_entries_inserted,
      attendance_daily_inserted,
      attendance_rollups_built,
      teacher_form_adviser_assignments,
      teacher_subject_assignments,
      evaluation_writeups_inserted,
      enrolled_applications_inserted,
      admissions_apps_inserted,
      discount_codes_inserted,
      publications_inserted,
    } = populated;
    if (grade_entries_inserted > 0) parts.push(`${grade_entries_inserted} grade entries`);
    if (attendance_daily_inserted > 0) {
      parts.push(
        `${attendance_daily_inserted} daily attendance (${attendance_rollups_built} rollups)`,
      );
    }
    if (teacher_form_adviser_assignments > 0) {
      parts.push(`${teacher_form_adviser_assignments} form advisers`);
    }
    if (teacher_subject_assignments > 0) {
      parts.push(`${teacher_subject_assignments} subject teachers`);
    }
    if (evaluation_writeups_inserted > 0) parts.push(`${evaluation_writeups_inserted} writeups`);
    if (enrolled_applications_inserted > 0) {
      parts.push(`${enrolled_applications_inserted} enrolled records`);
    }
    if (admissions_apps_inserted > 0) parts.push(`${admissions_apps_inserted} applications`);
    if (discount_codes_inserted > 0) parts.push(`${discount_codes_inserted} discount codes`);
    if (publications_inserted > 0) parts.push(`${publications_inserted} publication window`);
  }
  if (parts.length === 0) return 'Already fully seeded.';
  return `Seeded ${parts.join(' + ')}.`;
}

export function EnvironmentCard({ current }: { current: Environment | null }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<Environment | null>(null);
  const [resetting, setResetting] = useState(false);

  async function resetTestEnv() {
    setResetting(true);
    try {
      const res = await fetch('/api/sis/admin/environment', { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Reset failed');
      const d = body.deleted as Record<string, number> | undefined;
      const totals = d
        ? [
            d.grade_entries,
            d.attendance_daily,
            d.evaluation_writeups,
            d.section_students,
            d.students_test,
            d.admissions_rows,
          ].reduce((a, b) => a + (b ?? 0), 0)
        : 0;
      toast.success(`Test environment reset. ${totals.toLocaleString('en-SG')} rows cleared + AY dropped.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  async function switchTo(target: Environment) {
    setSubmitting(target);
    try {
      const res = await fetch('/api/sis/admin/environment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Environment switch failed');

      if (target === 'test') {
        const structure = (body.structure ?? null) as StructureSummary;
        const seed = (body.seed ?? null) as SeedSummary;
        const populated = (body.populated ?? null) as PopulatedSummary;
        toast.success('Switched to Test environment.', {
          description: describeTestSwitch(structure, seed, populated),
        });
      } else {
        toast.success('Switched to Production environment.');
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Environment switch failed');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <EnvironmentOption
          target="production"
          icon={Globe}
          title="Production"
          caption="Live student records"
          description="Real rosters, grades, and parent-visible report cards. Every change is recorded against the active academic year."
          active={current === 'production'}
          submitting={submitting === 'production'}
          onSwitch={() => switchTo('production')}
        />
        <EnvironmentOption
          target="test"
          icon={FlaskConical}
          title="Test"
          caption="Disposable UAT data"
          description="Fake students are seeded automatically. Use this mode to exercise grading, attendance, evaluations, and report cards without touching live data."
          active={current === 'test'}
          submitting={submitting === 'test'}
          onSwitch={() => switchTo('test')}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          {/* §7.4 gradient destructive tile — matches the per-environment
              tiles above. shadow-brand-tile-destructive is the brand-tinted
              red glow added in the 26th-pass primitive refresh. */}
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive">
            <Trash2 className="size-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="font-serif text-sm font-semibold text-foreground">
              Reset Test environment
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Deletes every row in the Test AY (grades, attendance, evaluations, applications,
              seeded students) and drops the AY9999 admissions tables. Switches to Production
              first if Test is currently active. Irreversible — use only when you want a clean
              slate for the next switch-to-Test.
            </p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={resetting || submitting !== null}
              className="shrink-0"
            >
              {resetting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {resetting ? 'Resetting…' : 'Reset Test data'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-destructive" />
                Delete the Test environment?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Every grade entry, attendance mark, evaluation write-up, application, publication,
                and seeded test student in AY9999 will be permanently deleted. The test year&apos;s
                admissions data is also wiped. Production data is untouched. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={resetTestEnv}
                disabled={resetting}
              >
                {resetting && <Loader2 className="animate-spin" />}
                Delete Test environment
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function EnvironmentOption({
  target,
  icon: Icon,
  title,
  caption,
  description,
  active,
  submitting,
  onSwitch,
}: {
  target: Environment;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  caption: string;
  description: string;
  active: boolean;
  submitting: boolean;
  onSwitch: () => void;
}) {
  return (
    <div
      className={
        'flex flex-col gap-3 rounded-xl border p-5 transition-colors ' +
        (active
          ? target === 'test'
            ? 'border-brand-amber/40 bg-brand-amber-light/50'
            : 'border-brand-indigo/40 bg-accent/50'
          : 'border-hairline bg-background hover:border-foreground/10')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* §7.4 gradient icon tile — brand-indigo for Production (the
              live default), brand-amber for Test (matches the warning-
              tinted UAT environment indicators across the SIS). */}
          <div
            className={
              'flex size-9 items-center justify-center rounded-xl text-white shadow-brand-tile bg-gradient-to-br ' +
              (target === 'test'
                ? 'from-brand-amber to-brand-amber/80'
                : 'from-brand-indigo to-brand-navy')
            }
          >
            <Icon className="size-4" />
          </div>
          <div>
            <div className="font-serif text-base font-semibold tracking-tight text-foreground">
              {title}
            </div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {caption}
            </div>
          </div>
        </div>
        {active ? (
          <Badge variant="success">
            <CheckCircle2 className="size-3" />
            Current
          </Badge>
        ) : null}
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>

      {!active && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant={target === 'test' ? 'warning' : 'default'}
              disabled={submitting}
              size="sm"
            >
              {submitting && <Loader2 className="animate-spin" />}
              Switch to {title}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                {target === 'test' && (
                  <AlertTriangle className="size-4 text-brand-amber" aria-hidden="true" />
                )}
                Switch to {title} environment?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {target === 'test' ? (
                  <>
                    Every module will start reading and writing the Test environment. If this is
                    the first time, fake student data is seeded automatically. Live production
                    data is not touched.
                  </>
                ) : (
                  <>
                    Every module will return to the live Production environment. Test data stays
                    intact and is reused the next time you switch to Test.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant={target === 'test' ? 'warning' : 'default'}
                onClick={onSwitch}
                disabled={submitting}
              >
                {submitting && <Loader2 className="animate-spin" />}
                Switch to {title}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
