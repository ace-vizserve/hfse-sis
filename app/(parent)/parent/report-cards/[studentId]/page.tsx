import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CalendarClock,
  CalendarX,
  Printer,
  ShieldOff,
} from 'lucide-react';
import { getParentSession } from '@/lib/parent/get-parent-session';
import { createServiceClient } from '@/lib/supabase/service';
import { getAllStudentsByParentEmail } from '@/lib/supabase/admissions';
import { buildReportCard } from '@/lib/report-card/build-report-card';
import { ReportCardDocument } from '@/components/report-card/report-card-document';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default async function ParentReportCardPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const session = await getParentSession();
  // Layout already verified the cookie. Trust here.
  const email = session?.email ?? '';

  const service = createServiceClient();

  // 1) Verify parent → student linkage across ALL AYs (KD #4 — student_number
  //    is the stable cross-AY identifier). The dashboard listing already uses
  //    the same cross-AY resolver, so a child visible there is viewable here.
  const admissionsRows = await getAllStudentsByParentEmail(email);
  const allowedStudentNumbers = new Set(admissionsRows.map((r) => r.student_number));

  // 2) Resolve the URL studentId → student_number to check ownership.
  const { data: student } = await service
    .from('students')
    .select('id, student_number')
    .eq('id', studentId)
    .maybeSingle();
  if (!student || !allowedStudentNumbers.has(student.student_number)) {
    notFound();
  }

  // 3) Build the report card payload (service client — parent has no
  //    grading-side RLS access).
  const result = await buildReportCard(service, studentId);
  if (!result.ok) {
    if (result.error.kind === 'student_not_found' || result.error.kind === 'level_not_found') {
      notFound();
    }
    // Render a friendly dedicated page for the cases that can legitimately
    // happen via parent navigation (rather than the raw-text fallbacks the
    // page used to drop in mid-route).
    if (result.error.kind === 'no_current_ay') {
      return (
        <UnavailableState
          variant="generic"
          studentName={null}
          subtitle={null}
          ay={null}
          title="Report cards aren't available right now"
          description="The school hasn't set up the current academic year yet. Please check back later or contact the office if this is unexpected."
        />
      );
    }
    if (result.error.kind === 'not_enrolled_this_ay') {
      return (
        <UnavailableState
          variant="generic"
          studentName={null}
          subtitle={null}
          ay={result.error.ayLabel}
          title="Not enrolled in the current academic year"
          description={`This student isn't enrolled in ${result.error.ayLabel}. Once enrollment is finalised and a publication window opens, the report card will appear here.`}
        />
      );
    }
  }
  if (!result.ok) notFound();
  const payload = result.payload;

  // 4) Gate: at least one publication for this student's section must be
  //    inside its active window. Same gate the dashboard listing applies —
  //    don't let a parent deep-link to a card whose window closed.
  const { data: publications } = await service
    .from('report_card_publications')
    .select('id, term_id, publish_from, publish_until')
    .eq('section_id', payload.section.id);

  // Server component runs per-request; current time is required to verify
  // the publication window.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const activePubs = (publications ?? []).filter((p) => {
    const from = new Date(p.publish_from as string).getTime();
    const until = new Date(p.publish_until as string).getTime();
    return now >= from && now <= until;
  });

  // Derive viewing term from active publications.
  // If T4 is published, show the final card; otherwise show the highest published interim term.
  const activeTermNumbers = activePubs
    .map((p) => {
      const term = payload.terms.find((t) => t.id === (p.term_id as string));
      return term?.term_number ?? 0;
    })
    .filter((n) => n > 0);
  const viewingTermNumber = (
    activeTermNumbers.includes(4) ? 4 : Math.max(...activeTermNumbers, 1)
  ) as 1 | 2 | 3 | 4;

  if (activePubs.length === 0) {
    // Differentiate the three reasons a parent could land here without an
    // active window. The publication row stays in the table when expired
    // (just publish_until in the past); revoke is a DELETE so the row is
    // gone. So a missing-row + expired-row split distinguishes "the
    // window has closed" from "no window has been set yet (or it was
    // revoked entirely)".
    //
    // Date.now() is fine here — force-dynamic page, no client cache.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    const allPubs = publications ?? [];
    const hasAnyPub = allPubs.length > 0;
    const allExpired =
      hasAnyPub &&
      allPubs.every((p) => new Date(p.publish_until as string).getTime() < nowMs);
    const allScheduled =
      hasAnyPub &&
      allPubs.every((p) => new Date(p.publish_from as string).getTime() > nowMs);

    let variant: 'expired' | 'scheduled' | 'revoked';
    let title: string;
    let description: string;
    if (allScheduled) {
      // Pick the soonest start date so the parent has something concrete
      // to plan around (rather than "soon").
      const earliestFrom = Math.min(
        ...allPubs.map((p) => new Date(p.publish_from as string).getTime()),
      );
      const earliestDate = new Date(earliestFrom).toLocaleDateString('en-SG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      variant = 'scheduled';
      title = 'Coming soon';
      description = `The school has scheduled this report card to be available from ${earliestDate}. Check back then to view it.`;
    } else if (allExpired) {
      // Show the latest publish_until so the parent knows when the window
      // closed (in case they're trying to figure out when they should
      // have looked).
      const latestUntil = Math.max(
        ...allPubs.map((p) => new Date(p.publish_until as string).getTime()),
      );
      const latestDate = new Date(latestUntil).toLocaleDateString('en-SG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      variant = 'expired';
      title = 'The viewing window has ended';
      description = `This report card was available until ${latestDate}. Contact the school office if you still need access.`;
    } else {
      // Either the publication was revoked (DELETE — row gone) or it was
      // never published. Indistinguishable from the parent's POV; we
      // frame it neutrally so it works in both cases.
      variant = 'revoked';
      title = 'Report card no longer available';
      description =
        "This report card isn't available to view. It may have been withdrawn, or the school hasn't published it yet. Contact the school office if you have questions.";
    }

    return (
      <UnavailableState
        variant={variant}
        studentName={payload.student.full_name}
        subtitle={`${payload.level.label} · ${payload.section.name}`}
        ay={payload.ay.label}
        title={title}
        description={description}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Parent chrome — hidden when printing. */}
      <div className="mx-auto flex w-full max-w-[8.5in] flex-col gap-6 print:hidden">
        <Link
          href="/parent"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          My children
        </Link>

        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-4">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Report card · {payload.ay.label}
            </p>
            <h1 className="font-serif text-[28px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[38px] md:text-[44px]">
              {payload.student.full_name}.
            </h1>
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {payload.level.label} · {payload.section.name}
            </p>
          </div>
          <div className="hidden text-xs text-muted-foreground md:block">
            <Printer className="mr-1 inline h-3 w-3" />
            Press <kbd className="rounded border border-border bg-card px-1 py-0.5">Ctrl</kbd>
            {' + '}
            <kbd className="rounded border border-border bg-card px-1 py-0.5">P</kbd> to print or
            save as PDF
          </div>
        </header>
      </div>

      <ReportCardDocument payload={payload} viewingTermNumber={viewingTermNumber} />
    </div>
  );
}

// Dedicated empty-state surface for every "report card isn't viewable
// right now" branch — revoked, expired, scheduled, no-current-AY,
// not-enrolled-this-AY, or generic. Same visual recipe across all
// cases (gradient icon tile + serif title + description + back link),
// only the variant + copy differ. Replaces the prior raw-text fallbacks
// that returned mid-route divs.
function UnavailableState({
  variant,
  studentName,
  subtitle,
  ay,
  title,
  description,
}: {
  variant: 'expired' | 'scheduled' | 'revoked' | 'generic';
  studentName: string | null;
  subtitle: string | null;
  ay: string | null;
  title: string;
  description: string;
}) {
  // Per-variant icon + tile gradient. Aurora Vault tokens only —
  // amber for time-bounded states (scheduled / expired), destructive
  // for revoked, indigo for the generic no-AY / not-enrolled cases.
  const variantConfig: Record<
    typeof variant,
    {
      icon: React.ComponentType<{ className?: string }>;
      tileClass: string;
      eyebrow: string;
    }
  > = {
    scheduled: {
      icon: CalendarClock,
      tileClass:
        'bg-gradient-to-br from-brand-amber to-brand-amber/80 shadow-brand-tile-amber',
      eyebrow: 'Scheduled',
    },
    expired: {
      icon: CalendarX,
      tileClass:
        'bg-gradient-to-br from-brand-amber to-brand-amber/80 shadow-brand-tile-amber',
      eyebrow: 'Window closed',
    },
    revoked: {
      icon: ShieldOff,
      tileClass:
        'bg-gradient-to-br from-destructive to-destructive/80 shadow-brand-tile-destructive',
      eyebrow: 'Unavailable',
    },
    generic: {
      icon: ShieldOff,
      tileClass:
        'bg-gradient-to-br from-brand-indigo to-brand-navy shadow-brand-tile',
      eyebrow: 'Unavailable',
    },
  };
  const { icon: Icon, tileClass, eyebrow } = variantConfig[variant];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link
        href="/parent"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        My children
      </Link>

      {/* Optional student header — present when we have payload data
          (revoked / expired / scheduled / not-enrolled). Suppressed on
          the no-current-AY case since there's no AY label to show. */}
      {(studentName || ay) && (
        <header className="space-y-4">
          {ay && (
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Report card · {ay}
            </p>
          )}
          {studentName && (
            <h1 className="font-serif text-[26px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[32px] md:text-[38px]">
              {studentName}.
            </h1>
          )}
          {subtitle && (
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </header>
      )}

      <Card className="@container/card">
        <CardContent className="flex flex-col items-center gap-5 py-10 text-center sm:px-10">
          <div
            className={`flex size-12 items-center justify-center rounded-xl text-white ${tileClass}`}
          >
            <Icon className="size-5" />
          </div>
          <div className="space-y-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </p>
            <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground sm:text-[22px]">
              {title}
            </h2>
            <p className="mx-auto max-w-md text-[14px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/parent">
              <ArrowLeft className="size-3.5" />
              Back to my children
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
