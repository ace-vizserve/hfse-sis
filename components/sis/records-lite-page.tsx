import {
  Activity,
  ArrowLeft,
  GraduationCap,
  Home,
  LineChart,
  Mail,
  Phone,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import { UnsyncedActionCard } from '@/components/sis/unsynced-action-card';
import { ApplicationStatusBadge } from '@/components/ui/application-status-badge';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listAssignableSections } from '@/lib/sis/class-assignment';
import {
  getStudentDetail,
  type ApplicationRow,
  type EnrollmentHistoryEntry,
} from '@/lib/sis/queries';
import { createServiceClient } from '@/lib/supabase/service';

// ──────────────────────────────────────────────────────────────────────────
// Records lite page — rendered for students whose admissions history is
// present but who haven't synced into `public.students` yet (typically
// because their admissions `classSection` was never set, so the per-row
// sync gates and silently skips). The full Records page calls in here
// from its "student not found" branch instead of redirecting away.
//
// The page renders enough identity for the registrar to recognize who
// they're looking at, an action card that opens the assign-section
// dialog (Chunk A), and empty-state cards for the four tabs that depend
// on grading-schema data the student doesn't yet have. The Overview +
// Family tabs surface real admissions-side data so the page is never
// totally empty.
// ──────────────────────────────────────────────────────────────────────────

type Props = {
  studentNumber: string;
  history: EnrollmentHistoryEntry[];
  currentEntry: EnrollmentHistoryEntry;
};

// Reusable gradient icon tile — mirrors the same recipe used across the
// full Records page so the lite surface reads with one voice.
function ActionTile({
  icon: Icon,
}: {
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
      <Icon className="size-4" />
    </div>
  );
}

export async function RecordsLitePage({
  studentNumber,
  history,
  currentEntry,
}: Props) {
  // 1. Admissions-side detail — populates Family tab + gives us the
  //    canonical full name to display in the hero. The lite page is
  //    pinned to `currentEntry` (most-recent or AY-current), so we
  //    only fetch this one AY's detail.
  const detail = await getStudentDetail(
    currentEntry.ayCode,
    currentEntry.enroleeNumber
  );

  // Resolve the student name with sensible fallbacks. `getStudentDetail`
  // can fail entirely on a legacy AY whose apps row is so minimal we
  // can't even fetch identity columns — in that case we fall back to
  // the AY-side enroleeFullName via the history entry's level/section,
  // which we don't have here, so we degrade to a placeholder.
  const studentName = detail?.application
    ? buildDisplayName(detail.application)
    : '(no name on file)';

  // 2. Available sections at this student's `levelApplied` for the
  //    current entry's AY, with per-section active counts and the
  //    resolved level (for the dialog's "create section" affordance).
  //    Shared with the /records/unsynced queue via `listAssignableSections`.
  const levelLabel =
    detail?.application?.levelApplied ?? currentEntry.level ?? null;
  const service = createServiceClient();
  const { level, sections: availableSections } = await listAssignableSections(
    service,
    currentEntry.ayCode,
    levelLabel
  );

  return (
    <PageShell>
      <Link
        href="/records/students"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Students
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Records · Awaiting class assignment
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {studentName}
          </h1>
          <Badge
            variant="outline"
            className="h-7 border-border bg-card px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            #{studentNumber}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{currentEntry.level ?? '(level not yet set)'}</span>
          <span className="text-border">·</span>
          <span className="font-mono text-[12px] uppercase tracking-[0.12em]">
            {currentEntry.ayCode}
          </span>
          <span className="text-border">·</span>
          <ApplicationStatusBadge status={currentEntry.status} />
        </div>
      </header>

      <UnsyncedActionCard
        enroleeNumber={currentEntry.enroleeNumber}
        ayCode={currentEntry.ayCode}
        level={level}
        studentName={studentName}
        availableSections={availableSections}
      />

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="family">Family</TabsTrigger>
          <TabsTrigger value="placements">Placements</TabsTrigger>
          <TabsTrigger value="academic">Academic</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <EnrollmentHistoryList history={history} />
        </TabsContent>

        <TabsContent value="family" className="space-y-6">
          {detail?.application ? (
            <FamilyContactSummary app={detail.application} />
          ) : (
            <EmptyStateCard
              icon={Users}
              title="No family contact on file"
              body="Family details live on the current-AY admissions record. Open this student in admissions to add them."
            />
          )}
        </TabsContent>

        <TabsContent value="placements" className="space-y-6">
          <EmptyStateCard
            icon={GraduationCap}
            title="No placements yet"
            body="Class section assignments will appear here once this student is set up for grading."
          />
        </TabsContent>

        <TabsContent value="academic" className="space-y-6">
          <EmptyStateCard
            icon={LineChart}
            title="No academic records yet"
            body="Grades and attendance will appear here once a class section is assigned."
          />
        </TabsContent>

        <TabsContent value="lifecycle" className="space-y-6">
          <EmptyStateCard
            icon={Activity}
            title="No lifecycle data yet"
            body="Stage progress and audit events will appear here once this student is set up."
          />
        </TabsContent>
      </Tabs>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <GraduationCap className="size-3" strokeWidth={2.25} />
        <span>Records lite</span>
        <span className="text-border">·</span>
        <span>Student ID {studentNumber}</span>
      </div>
    </PageShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components — RSC-friendly (no useState / useEffect).
// ──────────────────────────────────────────────────────────────────────────

function buildDisplayName(app: ApplicationRow): string {
  if (app.enroleeFullName && app.enroleeFullName.trim().length > 0) {
    return app.enroleeFullName.trim();
  }
  const parts = [app.lastName, app.firstName, app.middleName].filter(Boolean);
  return parts.length ? parts.join(', ') : '(no name on file)';
}

function EmptyStateCard({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo/15 to-brand-navy/10 text-brand-indigo">
          <Icon className="size-5" />
        </div>
        <div className="space-y-1">
          <p className="font-serif text-[16px] font-semibold tracking-tight text-foreground">
            {title}
          </p>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function EnrollmentHistoryList({
  history,
}: {
  history: EnrollmentHistoryEntry[];
}) {
  const sorted = [...history].sort((a, b) => b.ayCode.localeCompare(a.ayCode));
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Enrolment history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Years on the admissions roster
        </CardTitle>
        <CardAction>
          <ActionTile icon={GraduationCap} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No enrolment history on file.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {sorted.map((h) => (
              <li
                key={`${h.ayCode}-${h.enroleeNumber}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge
                    variant="outline"
                    className="h-5 border-border bg-muted/40 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    {h.ayCode}
                  </Badge>
                  <span className="font-serif text-[14px] text-foreground">
                    {h.level ?? '(level not yet set)'}
                  </span>
                  <span className="font-mono text-[12px] text-muted-foreground">
                    {h.section ? h.section : 'Unassigned'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ApplicationStatusBadge status={h.status} />
                  <Link
                    href={`/admissions/applications/${encodeURIComponent(h.enroleeNumber)}?ay=${encodeURIComponent(h.ayCode)}&tab=enrollment`}
                    className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-brand-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
                  >
                    Open in admissions
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FamilyContactSummary({ app }: { app: ApplicationRow }) {
  const blocks: Array<{
    role: string;
    name: string | null;
    email: string | null;
    mobile: string | null;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      role: 'Mother',
      name: app.motherFullName,
      email: app.motherEmail,
      mobile: app.motherMobile,
      icon: User,
    },
    {
      role: 'Father',
      name: app.fatherFullName,
      email: app.fatherEmail,
      mobile: app.fatherMobile,
      icon: User,
    },
    {
      role: 'Guardian',
      name: app.guardianFullName,
      email: app.guardianEmail,
      mobile: app.guardianMobile,
      icon: ShieldCheck,
    },
  ];
  const visible = blocks.filter((b) => b.name || b.email || b.mobile);
  const hasHome = app.homePhone || app.homeAddress || app.postalCode;

  if (visible.length === 0 && !hasHome) {
    return (
      <EmptyStateCard
        icon={Users}
        title="No family contact on file"
        body="Family details live on the current-AY admissions record. Open this student in admissions to add them."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Family · contact
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Reach out
        </CardTitle>
        <CardAction>
          <ActionTile icon={Users} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {visible.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {visible.map((b) => {
              const Icon = b.icon;
              return (
                <div
                  key={b.role}
                  className="rounded-xl bg-gradient-to-t from-primary/5 to-card p-4 ring-1 ring-inset ring-border shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {b.role}
                      </p>
                      {b.name && (
                        <p className="font-serif text-[14px] font-semibold leading-tight text-foreground">
                          {b.name}
                        </p>
                      )}
                    </div>
                  </div>
                  {(b.email || b.mobile) && (
                    <div className="mt-3 space-y-1.5 border-t border-hairline pt-3">
                      {b.email && (
                        <ContactPill
                          href={`mailto:${b.email}`}
                          icon={Mail}
                          value={b.email}
                        />
                      )}
                      {b.mobile && (
                        <ContactPill
                          href={`tel:${b.mobile}`}
                          icon={Phone}
                          value={b.mobile}
                          mono
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {hasHome && (
          <div className="rounded-xl bg-muted/25 p-4 ring-1 ring-inset ring-border">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Home className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Home
                </p>
                {app.homeAddress && (
                  <p className="text-[13px] leading-tight text-foreground">
                    {app.homeAddress}
                  </p>
                )}
              </div>
              {app.postalCode && (
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] uppercase tracking-[0.12em] tabular-nums"
                >
                  {app.postalCode}
                </Badge>
              )}
            </div>
            {app.homePhone && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                <ContactPill
                  href={`tel:${app.homePhone}`}
                  icon={Phone}
                  value={app.homePhone}
                  mono
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContactPill({
  href,
  icon: Icon,
  value,
  mono = false,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  mono?: boolean;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-2 rounded-lg bg-card px-2.5 py-1.5 text-[13px] text-foreground ring-1 ring-inset ring-border transition-all hover:bg-muted/40 hover:ring-brand-indigo/40 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-indigo/20 to-brand-indigo/5 text-brand-indigo">
        <Icon className="size-3" />
      </span>
      <span
        className={`min-w-0 truncate ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </span>
    </a>
  );
}
