import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardList,
  FileCheck,
  GraduationCap,
  HandHeart,
  Mail,
  MessageSquare,
  UserCircle2,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fragment } from "react";

import { DocumentsViewer } from "@/components/sis/documents-viewer";
import { EnrollmentHistoryChips } from "@/components/sis/enrollment-history-chips";
import { EnrollmentTab } from "@/components/sis/enrollment-tab";
import { FamilyTab } from "@/components/sis/family-tab";
import { ProfileTab } from "@/components/sis/profile-tab";
import { ApplicationStatusBadge } from "@/components/sis/status-badge";
import { StpApplicationCard } from "@/components/sis/stp-application-card";
import { StudentLifecycleTimeline } from "@/components/sis/student-lifecycle-timeline";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentAcademicYear, listAyCodes } from "@/lib/academic-year";
import { freshenAyDocuments } from "@/lib/p-files/freshen-document-statuses";
import { getStudentLifecycle } from "@/lib/sis/process";
import {
  getEnrollmentHistory,
  getSectionIdByLevelAndName,
  getStudentDetail,
  STP_CONDITIONAL_SLOT_KEYS,
} from "@/lib/sis/queries";
import { getSessionUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { cn } from "@/lib/utils";

const FUNNEL_STAGES = ["Inquiry", "Applied", "Interviewed", "Offered", "Accepted"] as const;
const ENROLLED_STATES = ["Enrolled", "Enrolled (Conditional)"];

function funnelIndexFor(status: string | null): number {
  const v = (status ?? "").trim().toLowerCase();
  if (!v) return -1;
  if (ENROLLED_STATES.some((e) => e.toLowerCase() === v)) return FUNNEL_STAGES.length;
  const idx = FUNNEL_STAGES.findIndex((s) => s.toLowerCase() === v);
  return idx;
}

export default async function SisStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ enroleeNumber: string }>;
  searchParams: Promise<{ ay?: string; tab?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");
  if (
    sessionUser.role !== "admissions" &&
    sessionUser.role !== "registrar" &&
    sessionUser.role !== "school_admin" &&
    sessionUser.role !== "superadmin"
  ) {
    redirect("/");
  }

  const { enroleeNumber } = await params;
  const { ay: ayParam, tab: tabParam } = await searchParams;

  const service = createServiceClient();
  const currentAy = await getCurrentAcademicYear(service);
  if (!currentAy) {
    return (
      <PageShell>
        <div className="text-sm text-destructive">No current academic year configured.</div>
      </PageShell>
    );
  }

  const ayCodes = await listAyCodes(service);
  const selectedAy = ayParam && ayCodes.includes(ayParam) ? ayParam : currentAy.ay_code;

  // Auto-flip any expired-but-still-Valid doc statuses for this AY before
  // the page reads them. Cached 60s; existing PATCH routes invalidate via
  // the sis:${ayCode} tag.
  await freshenAyDocuments(selectedAy);

  const detail = await getStudentDetail(selectedAy, enroleeNumber);
  if (!detail) notFound();

  const { application, status, documents } = detail;

  const history = application.studentNumber ? await getEnrollmentHistory(application.studentNumber) : [];

  // Resolve the assigned section's UUID for the Enrollment tab's
  // "Move to another section →" CTA. Null when class isn't assigned yet
  // (pre-Enrolled) or the section was renamed/dropped after AY rollover —
  // EnrollmentTab hides the CTA gracefully on null.
  const currentSectionId =
    status?.classLevel && status?.classSection
      ? await getSectionIdByLevelAndName(selectedAy, status.classLevel, status.classSection)
      : null;

  const fullName =
    application.enroleeFullName ??
    [application.lastName, application.firstName, application.middleName].filter(Boolean).join(" ") ??
    "(no name on file)";

  const tab = ["profile", "family", "enrollment", "documents", "lifecycle"].includes(tabParam ?? "")
    ? (tabParam as "profile" | "family" | "enrollment" | "documents" | "lifecycle")
    : "profile";

  const lifecycleSnapshot = await getStudentLifecycle(selectedAy, enroleeNumber);
  const lifecycleHistory = lifecycleSnapshot.studentNumber
    ? await getEnrollmentHistory(lifecycleSnapshot.studentNumber)
    : [];

  // Document completion for the hero stats strip. Mirrors the DocumentsTab
  // visibility filter — when the parent didn't opt into the STP sub-flow,
  // the 3 STP-conditional slots roll out of the denominator so the "X of N"
  // count matches what the registrar actually has to chase.
  const stpKeysForHero = new Set<string>(STP_CONDITIONAL_SLOT_KEYS);
  const heroDocuments = application.stpApplicationType
    ? documents
    : documents.filter((d) => !stpKeysForHero.has(d.key));
  const docsTotal = heroDocuments.length;
  const docsOnFile = heroDocuments.filter((d) => !!d.url).length;
  const { expiringSoon: docsExpiringSoon, expired: docsExpired } = countExpiryBuckets(heroDocuments);

  const funnelIdx = funnelIndexFor(status?.applicationStatus ?? null);
  const currentStageLabel =
    funnelIdx === FUNNEL_STAGES.length
      ? "Enrolled"
      : funnelIdx >= 0
        ? FUNNEL_STAGES[funnelIdx]
        : (status?.applicationStatus ?? "Not staged");

  // Most recent activity across all stages, for the "last activity" card.
  const stageUpdates: Array<string | null | undefined> = [
    status?.applicationUpdatedDate,
    status?.registrationUpdatedDate,
    status?.documentUpdatedDate,
    status?.assessmentUpdatedDate,
    status?.contractUpdatedDate,
    status?.feeUpdatedDate,
    status?.classUpdatedDate,
    status?.suppliesUpdatedDate,
    status?.orientationUpdatedDate,
  ];
  const lastActivity = stageUpdates
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);

  return (
    <PageShell>
      <Link
        href={{ pathname: "/admissions/applications", query: { ay: selectedAy } }}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        Applications · {selectedAy}
      </Link>

      {/* Hero */}
      <header className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Admissions · Application
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[34px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[40px]">
            {fullName}
          </h1>
          <ApplicationStatusBadge status={status?.applicationStatus ?? null} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Badge
            variant="outline"
            className="h-6 border-border bg-white px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">
            Enrolee · {application.enroleeNumber}
          </Badge>
          {application.studentNumber && (
            <Badge
              variant="outline"
              className="h-6 border-border bg-white px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground">
              Student · {application.studentNumber}
            </Badge>
          )}
          {(status?.classLevel || status?.classSection) && (
            <Badge
              variant="outline"
              className="h-6 border-brand-mint bg-brand-mint/20 px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink">
              {[status?.classLevel, status?.classSection].filter(Boolean).join(" · ")}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="h-6 border-border bg-white px-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {selectedAy}
          </Badge>
        </div>
      </header>

      {/* Funnel progress */}
      {funnelIdx >= 0 && <FunnelProgress currentIndex={funnelIdx} />}

      {history.length > 1 && <EnrollmentHistoryChips history={history} currentAyCode={selectedAy} />}

      {/* At-a-glance stats */}
      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-4">
          <StatCard
            label="Current stage"
            value={currentStageLabel}
            icon={UserCircle2}
            footnote={
              lastActivity
                ? `Last updated ${new Date(lastActivity).toLocaleDateString("en-SG", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}`
                : "No stage updates yet"
            }
          />
          <StatCard
            label="Level applied"
            value={application.levelApplied ?? status?.classLevel ?? "—"}
            icon={GraduationCap}
            footnote={
              status?.classSection ? `Section ${status.classSection}` : (application.classType ?? "No section assigned")
            }
          />
          <StatCard
            label="Documents"
            value={`${docsOnFile} / ${docsTotal}`}
            icon={FileCheck}
            footnote={
              docsExpired > 0
                ? `${docsExpired} expired · replace in P-Files`
                : docsExpiringSoon > 0
                  ? `${docsExpiringSoon} expiring in 60d`
                  : docsOnFile === docsTotal
                    ? "All slots filled"
                    : `${docsTotal - docsOnFile} slot${docsTotal - docsOnFile === 1 ? "" : "s"} open`
            }
          />
          <StatCard
            label="Enrolee type"
            value={status?.enroleeType ?? "New applicant"}
            icon={ClipboardList}
            footnote={
              status?.enrolmentDate
                ? `Enrolled ${new Date(status.enrolmentDate).toLocaleDateString("en-SG", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}`
                : (application.category ?? "Not classified")
            }
          />
        </div>
      </section>

      <Tabs defaultValue={tab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="family">Family</TabsTrigger>
          <TabsTrigger value="enrollment">Enrollment</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileTab
            app={application}
            ayCode={selectedAy}
            enroleeNumber={application.enroleeNumber}
          />
        </TabsContent>

        <TabsContent value="family" className="space-y-6">
          <FamilyTab app={application} ayCode={selectedAy} enroleeNumber={application.enroleeNumber} />
        </TabsContent>

        <TabsContent value="enrollment" className="space-y-6">
          <EnrollmentTab
            status={status}
            app={application}
            ayCode={selectedAy}
            enroleeNumber={application.enroleeNumber}
            statusFetchError={detail.statusFetchError}
            currentSectionId={currentSectionId}
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-6">
          {application.stpApplicationType && (
            <StpApplicationCard
              application={application}
              documents={documents}
              ayCode={selectedAy}
            />
          )}
          <DocumentsViewer
            application={{
              stpApplicationType: application.stpApplicationType,
              applicationStatus: status?.applicationStatus ?? null,
              motherEmail: application.motherEmail,
              fatherEmail: application.fatherEmail,
              guardianEmail: application.guardianEmail,
            }}
            documents={documents}
            enroleeNumber={application.enroleeNumber}
            ayCode={selectedAy}
          />
        </TabsContent>

        <TabsContent value="lifecycle" className="space-y-6">
          <StudentLifecycleTimeline snapshot={lifecycleSnapshot} history={lifecycleHistory} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

const EXPIRY_SOON_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function countExpiryBuckets(documents: readonly { expiry?: string | null }[]): {
  expiringSoon: number;
  expired: number;
} {
  const now = Date.now();
  let expiringSoon = 0;
  let expired = 0;
  for (const d of documents) {
    if (!d.expiry) continue;
    const t = new Date(d.expiry).getTime();
    if (Number.isNaN(t)) continue;
    if (t <= now) expired += 1;
    else if (t - now < EXPIRY_SOON_WINDOW_MS) expiringSoon += 1;
  }
  return { expiringSoon, expired };
}

function FunnelProgress({ currentIndex }: { currentIndex: number }) {
  const stages: Array<{ label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { label: "Inquiry", icon: Mail },
    { label: "Applied", icon: ClipboardList },
    { label: "Interviewed", icon: MessageSquare },
    { label: "Offered", icon: HandHeart },
    { label: "Accepted", icon: CheckCircle2 },
    { label: "Enrolled", icon: GraduationCap },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        const past = i < currentIndex;
        const current = i === currentIndex;
        return (
          <Fragment key={stage.label}>
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors",
                past && "border-brand-mint bg-brand-mint/30 text-ink",
                current && "border-brand-indigo bg-brand-indigo text-white shadow-sm",
                !past && !current && "border-border bg-muted/40 text-muted-foreground",
              )}>
              {past ? <Check className="size-3" /> : <Icon className="size-3" />}
              {stage.label}
            </div>
            {i < stages.length - 1 && (
              <div
                className={cn("h-px w-3 shrink-0 sm:w-5", i < currentIndex ? "bg-brand-mint" : "bg-border")}
                aria-hidden="true"
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  footnote,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  footnote: string;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </CardDescription>
        <CardTitle className="font-serif text-[22px] font-semibold leading-tight tracking-tight text-foreground @[200px]/card:text-[26px]">
          {value}
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardFooter className="text-xs text-muted-foreground">{footnote}</CardFooter>
    </Card>
  );
}
