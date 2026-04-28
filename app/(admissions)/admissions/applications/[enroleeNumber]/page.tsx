import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock,
  ExternalLink,
  FileCheck,
  FileText,
  Globe,
  GraduationCap,
  HandHeart,
  Heart,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  ShieldCheck,
  Sparkles,
  Tags,
  User,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fragment } from "react";

import { CompassionateAllowanceInline } from "@/components/sis/compassionate-allowance-inline";
import { DocumentValidationActions } from "@/components/sis/document-validation-actions";
import { EditFamilySheet } from "@/components/sis/edit-family-sheet";
import { EditProfileSheet } from "@/components/sis/edit-profile-sheet";
import { EditStageDialog } from "@/components/sis/edit-stage-dialog";
import { EnrollmentHistoryChips } from "@/components/sis/enrollment-history-chips";
import { FieldGrid, type Field } from "@/components/sis/field-grid";
import { ApplicationStatusBadge, StageStatusBadge } from "@/components/sis/status-badge";
import { StpApplicationCard } from "@/components/sis/stp-application-card";
import { StudentAttendanceTab } from "@/components/sis/student-attendance-tab";
import { StudentLifecycleTimeline } from "@/components/sis/student-lifecycle-timeline";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getCurrentAcademicYear, listAyCodes } from "@/lib/academic-year";
import {
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_LABELS,
  STAGE_TERMINAL_STATUS,
  type ParentSlot,
  type ProfileUpdateInput,
  type StageKey,
} from "@/lib/schemas/sis";
import { freshenAyDocuments } from "@/lib/sis/freshen-document-statuses";
import { getStudentLifecycle } from "@/lib/sis/process";
import {
  getEnrollmentHistory,
  getStudentDetail,
  STP_CONDITIONAL_SLOT_KEYS,
  type ApplicationRow,
  type DocumentSlot,
  type StatusRow,
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
    sessionUser.role !== "admin" &&
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

  // Look up the student's compassionate-leave allowance from the grading
  // schema (via studentNumber). Null when the student hasn't been synced yet
  // or has no studentNumber — disables the inline editor with a reason.
  let allowance: number | null = null;
  let allowanceDisabledReason: string | null = null;
  if (application.studentNumber) {
    const { data: stu } = await service
      .from("students")
      .select("urgent_compassionate_allowance")
      .eq("student_number", application.studentNumber)
      .maybeSingle();
    if (stu) {
      allowance = (stu as { urgent_compassionate_allowance: number | null }).urgent_compassionate_allowance ?? 5;
    } else {
      allowanceDisabledReason = "Not yet synced to grading schema";
    }
  } else {
    allowanceDisabledReason = "No studentNumber assigned yet";
  }

  const fullName =
    application.enroleeFullName ??
    [application.lastName, application.firstName, application.middleName].filter(Boolean).join(" ") ??
    "(no name on file)";

  const tab = ["profile", "family", "enrollment", "documents", "attendance", "lifecycle"].includes(tabParam ?? "")
    ? (tabParam as "profile" | "family" | "enrollment" | "documents" | "attendance" | "lifecycle")
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
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileTab
            app={application}
            ayCode={selectedAy}
            enroleeNumber={application.enroleeNumber}
            allowance={allowance}
            allowanceDisabledReason={allowanceDisabledReason}
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
          <DocumentsTab
            application={application}
            documents={documents}
            enroleeNumber={application.enroleeNumber}
            ayCode={selectedAy}
          />
        </TabsContent>

        <TabsContent value="attendance" className="space-y-6">
          <StudentAttendanceTab studentNumber={application.studentNumber} fullName={fullName} />
        </TabsContent>

        <TabsContent value="lifecycle" className="space-y-6">
          <StudentLifecycleTimeline snapshot={lifecycleSnapshot} history={lifecycleHistory} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function ProfileTab({
  app,
  ayCode,
  enroleeNumber,
  allowance,
  allowanceDisabledReason,
}: {
  app: ApplicationRow;
  ayCode: string;
  enroleeNumber: string;
  allowance: number | null;
  allowanceDisabledReason: string | null;
}) {
  // Pre-populate the editor sheet with the current values. The schema and
  // sheet decide which fields are editable; the page just hands over the row.
  const initial: Partial<ProfileUpdateInput> = {
    firstName: app.firstName,
    middleName: app.middleName,
    lastName: app.lastName,
    preferredName: app.preferredName,
    enroleeFullName: app.enroleeFullName,
    category: app.category as ProfileUpdateInput['category'],
    nric: app.nric,
    birthDay: app.birthDay,
    gender: app.gender,
    nationality: app.nationality,
    primaryLanguage: app.primaryLanguage,
    religion: app.religion,
    religionOther: app.religionOther,
    passportNumber: app.passportNumber,
    passportExpiry: app.passportExpiry,
    pass: app.pass,
    passExpiry: app.passExpiry,
    homePhone: app.homePhone,
    homeAddress: app.homeAddress,
    postalCode: app.postalCode,
    livingWithWhom: app.livingWithWhom,
    contactPerson: app.contactPerson,
    contactPersonNumber: app.contactPersonNumber,
    parentMaritalStatus: app.parentMaritalStatus,
    levelApplied: app.levelApplied,
    preferredSchedule: app.preferredSchedule,
    classType: app.classType,
    paymentOption: app.paymentOption,
    availSchoolBus: app.availSchoolBus as ProfileUpdateInput['availSchoolBus'],
    availStudentCare: app.availStudentCare as ProfileUpdateInput['availStudentCare'],
    studentCareProgram: app.studentCareProgram,
    availUniform: app.availUniform as ProfileUpdateInput['availUniform'],
    additionalLearningNeeds: app.additionalLearningNeeds,
    otherLearningNeeds: app.otherLearningNeeds,
    previousSchool: app.previousSchool,
    howDidYouKnowAboutHFSEIS: app.howDidYouKnowAboutHFSEIS,
    otherSource: app.otherSource,
    referrerName: app.referrerName,
    referrerMobile: app.referrerMobile,
    contractSignatory: app.contractSignatory,
    discount1: app.discount1,
    discount2: app.discount2,
    discount3: app.discount3,
  };

  const identityFields: Field[] = [
    { label: "Category", value: app.category },
    { label: "Preferred name", value: app.preferredName },
    { label: "NRIC / FIN", value: app.nric },
    { label: "Date of birth", value: app.birthDay, asDate: true },
    { label: "Gender", value: app.gender },
    { label: "Nationality", value: app.nationality },
    { label: "Religion", value: app.religion ?? app.religionOther },
    { label: "Primary language", value: app.primaryLanguage },
  ];
  const travelFields: Field[] = [
    { label: "Passport number", value: app.passportNumber },
    { label: "Passport expiry", value: app.passportExpiry, asDate: true },
    { label: "Pass type", value: app.pass },
    { label: "Pass expiry", value: app.passExpiry, asDate: true },
  ];
  const contactFields: Field[] = [
    { label: "Home phone", value: app.homePhone },
    { label: "Home address", value: app.homeAddress, wide: true },
    { label: "Postal code", value: app.postalCode },
    { label: "Living with", value: app.livingWithWhom },
    { label: "Contact person", value: app.contactPerson },
    { label: "Contact number", value: app.contactPersonNumber },
    { label: "Parent marital status", value: app.parentMaritalStatus },
  ];
  const preferencesFields: Field[] = [
    { label: "Level applied", value: app.levelApplied },
    { label: "Preferred schedule", value: app.preferredSchedule },
    { label: "Class type", value: app.classType },
    { label: "Payment option", value: app.paymentOption },
    { label: "School bus", value: app.availSchoolBus },
    { label: "Student care", value: app.availStudentCare },
    { label: "Student care program", value: app.studentCareProgram },
    { label: "Uniform", value: app.availUniform },
    { label: "Additional learning needs", value: app.additionalLearningNeeds, wide: true, multiline: true },
    { label: "Other learning needs", value: app.otherLearningNeeds, wide: true, multiline: true },
    { label: "Previous school", value: app.previousSchool },
    { label: "Referral source", value: app.howDidYouKnowAboutHFSEIS },
    { label: "Other source", value: app.otherSource },
    { label: "Referrer name", value: app.referrerName },
    { label: "Referrer mobile", value: app.referrerMobile },
    { label: "Contract signatory", value: app.contractSignatory },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Applicant profile
          </p>
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Identity, contact &amp; preferences
          </h2>
        </div>
        <EditProfileSheet ayCode={ayCode} enroleeNumber={enroleeNumber} initial={initial} />
      </div>
      <CompassionateAllowanceInline
        enroleeNumber={enroleeNumber}
        initial={allowance}
        disabled={!!allowanceDisabledReason}
        disabledReason={allowanceDisabledReason ?? undefined}
      />
      <ProfileSectionCard eyebrow="Identity" title="Personal & demographic" icon={User} fields={identityFields} />
      <ProfileSectionCard
        eyebrow="Travel documents"
        title="Student passport & pass"
        icon={Globe}
        fields={travelFields}
      />
      <ProfileSectionCard eyebrow="Contact" title="Household & emergency" icon={Phone} fields={contactFields} />
      <ProfileSectionCard
        eyebrow="Application preferences"
        title="Level, schedule & services"
        icon={Tags}
        fields={preferencesFields}
      />
    </div>
  );
}

// Count of fields with a non-empty value. Shared count convention:
// booleans are counted only when explicitly set (null reads as missing).
function countFilled(fields: Field[]): number {
  return fields.filter((f) => {
    if (typeof f.value === "boolean") return f.value !== null;
    return f.value !== null && f.value !== undefined && !(typeof f.value === "string" && f.value.trim() === "");
  }).length;
}

function ProfileSectionCard({
  eyebrow,
  title,
  icon: Icon,
  fields,
}: {
  eyebrow: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: Field[];
}) {
  const total = fields.length;
  const filled = countFilled(fields);
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-base font-semibold tracking-tight text-foreground">{title}</CardTitle>
        <CardAction>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-muted-foreground">
              {filled} / {total}
            </span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="pt-6">
        <FieldGrid fields={fields} />
      </CardContent>
    </Card>
  );
}

function FamilyTab({ app, ayCode, enroleeNumber }: { app: ApplicationRow; ayCode: string; enroleeNumber: string }) {
  return (
    <div className="space-y-4">
      <ParentCard
        title="Father"
        eyebrow="Parent · Primary"
        icon={User}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        parentSlot="father"
        initial={{
          fatherFullName: app.fatherFullName,
          fatherFirstName: app.fatherFirstName,
          fatherLastName: app.fatherLastName,
          fatherNric: app.fatherNric,
          fatherBirthDay: app.fatherBirthDay,
          fatherMobile: app.fatherMobile,
          fatherEmail: app.fatherEmail,
          fatherNationality: app.fatherNationality,
          fatherCompanyName: app.fatherCompanyName,
          fatherPosition: app.fatherPosition,
          fatherPassport: app.fatherPassport,
          fatherPassportExpiry: app.fatherPassportExpiry,
          fatherPass: app.fatherPass,
          fatherPassExpiry: app.fatherPassExpiry,
          fatherWhatsappTeamsConsent: app.fatherWhatsappTeamsConsent,
        }}
        fields={[
          { label: "Full name", value: app.fatherFullName },
          { label: "NRIC / FIN", value: app.fatherNric },
          { label: "Date of birth", value: app.fatherBirthDay, asDate: true },
          { label: "Mobile", value: app.fatherMobile },
          { label: "Email", value: app.fatherEmail, wide: true },
          { label: "Nationality", value: app.fatherNationality },
          { label: "Company", value: app.fatherCompanyName },
          { label: "Position", value: app.fatherPosition },
          { label: "Passport", value: app.fatherPassport },
          { label: "Passport expiry", value: app.fatherPassportExpiry, asDate: true },
          { label: "Pass type", value: app.fatherPass },
          { label: "Pass expiry", value: app.fatherPassExpiry, asDate: true },
          { label: "WhatsApp / Teams consent", value: app.fatherWhatsappTeamsConsent },
        ]}
      />
      <ParentCard
        title="Mother"
        eyebrow="Parent · Primary"
        icon={User}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        parentSlot="mother"
        initial={{
          motherFullName: app.motherFullName,
          motherFirstName: app.motherFirstName,
          motherLastName: app.motherLastName,
          motherNric: app.motherNric,
          motherBirthDay: app.motherBirthDay,
          motherMobile: app.motherMobile,
          motherEmail: app.motherEmail,
          motherNationality: app.motherNationality,
          motherCompanyName: app.motherCompanyName,
          motherPosition: app.motherPosition,
          motherPassport: app.motherPassport,
          motherPassportExpiry: app.motherPassportExpiry,
          motherPass: app.motherPass,
          motherPassExpiry: app.motherPassExpiry,
          motherWhatsappTeamsConsent: app.motherWhatsappTeamsConsent,
        }}
        fields={[
          { label: "Full name", value: app.motherFullName },
          { label: "NRIC / FIN", value: app.motherNric },
          { label: "Date of birth", value: app.motherBirthDay, asDate: true },
          { label: "Mobile", value: app.motherMobile },
          { label: "Email", value: app.motherEmail, wide: true },
          { label: "Nationality", value: app.motherNationality },
          { label: "Company", value: app.motherCompanyName },
          { label: "Position", value: app.motherPosition },
          { label: "Passport", value: app.motherPassport },
          { label: "Passport expiry", value: app.motherPassportExpiry, asDate: true },
          { label: "Pass type", value: app.motherPass },
          { label: "Pass expiry", value: app.motherPassExpiry, asDate: true },
          { label: "WhatsApp / Teams consent", value: app.motherWhatsappTeamsConsent },
        ]}
      />
      <ParentCard
        title="Guardian"
        eyebrow="Family · Optional"
        icon={ShieldCheck}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        parentSlot="guardian"
        optional
        initial={{
          guardianFullName: app.guardianFullName,
          guardianMobile: app.guardianMobile,
          guardianEmail: app.guardianEmail,
          guardianNationality: app.guardianNationality,
          guardianPassport: app.guardianPassport,
          guardianPassportExpiry: app.guardianPassportExpiry,
          guardianPass: app.guardianPass,
          guardianPassExpiry: app.guardianPassExpiry,
          guardianWhatsappTeamsConsent: app.guardianWhatsappTeamsConsent,
        }}
        fields={[
          { label: "Full name", value: app.guardianFullName },
          { label: "Mobile", value: app.guardianMobile },
          { label: "Email", value: app.guardianEmail, wide: true },
          { label: "Nationality", value: app.guardianNationality },
          { label: "Passport", value: app.guardianPassport },
          { label: "Passport expiry", value: app.guardianPassportExpiry, asDate: true },
          { label: "Pass type", value: app.guardianPass },
          { label: "Pass expiry", value: app.guardianPassExpiry, asDate: true },
          { label: "WhatsApp / Teams consent", value: app.guardianWhatsappTeamsConsent },
        ]}
      />
    </div>
  );
}

function ParentCard({
  title,
  eyebrow,
  icon: Icon,
  fields,
  optional,
  ayCode,
  enroleeNumber,
  parentSlot,
  initial,
}: {
  title: string;
  eyebrow: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: Field[];
  optional?: boolean;
  ayCode: string;
  enroleeNumber: string;
  parentSlot: ParentSlot;
  initial: Record<string, unknown>;
}) {
  const allEmpty = fields.every((f) => {
    if (typeof f.value === "boolean") return f.value === null;
    return f.value === null || f.value === undefined || (typeof f.value === "string" && f.value.trim() === "");
  });

  // Compute filled-field count for the eyebrow subtext, ignoring booleans
  // (consents default to null which reads as "missing" in practice).
  const nonEmpty = fields.filter((f) => {
    if (typeof f.value === "boolean") return f.value !== null;
    return f.value !== null && f.value !== undefined && !(typeof f.value === "string" && f.value.trim() === "");
  }).length;

  return (
    <Card className="@container/card flex flex-col">
      <CardHeader className="border-b border-border">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">{title}</CardTitle>
        <CardAction>
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-xl text-white shadow-brand-tile",
              optional
                ? "bg-gradient-to-br from-muted-foreground/70 to-muted-foreground"
                : "bg-gradient-to-br from-brand-indigo to-brand-navy",
            )}>
            <Icon className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1 pt-6">
        {allEmpty ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-xl bg-muted">
              <Icon className="size-5 text-muted-foreground" />
            </div>
            <p className="font-serif text-sm font-semibold text-foreground">No {title.toLowerCase()} on file</p>
            <p className="max-w-[200px] text-xs leading-relaxed text-muted-foreground">
              {optional
                ? "Guardian is optional — add only if a non-parent adult is involved."
                : "Add contact + identity details to unlock parent-portal linkage."}
            </p>
          </div>
        ) : (
          <FieldGrid fields={fields} />
        )}
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2 border-t border-border pt-5 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{allEmpty ? "—" : `${nonEmpty} of ${fields.length} fields`}</span>
        <EditFamilySheet ayCode={ayCode} enroleeNumber={enroleeNumber} parent={parentSlot} initial={initial} />
      </CardFooter>
    </Card>
  );
}

function EnrollmentTab({
  status,
  app,
  ayCode,
  enroleeNumber,
  statusFetchError,
}: {
  status: StatusRow | null;
  app: ApplicationRow;
  ayCode: string;
  enroleeNumber: string;
  statusFetchError: boolean;
}) {
  // `status` can be null either because the row is legitimately missing OR
  // because the status fetch errored (typically duplicate rows — see
  // StudentDetail.statusFetchError). In both cases we still render the full
  // 9-stage timeline with null values so admissions has a working surface;
  // the amber alert below signals when the null is caused by a fetch error
  // so the team knows the edit they're about to make may collide with
  // duplicate rows and should be investigated rather than worked around.

  // Null-tolerant alias so every stage read below works whether the status
  // row exists, is missing, or failed to fetch. Compile-time shape matches
  // StatusRow; at runtime unset fields read back as undefined — downstream
  // consumers (StageStatusBadge, new Date(...) gates, FieldGrid) treat
  // undefined like null, so the timeline renders cleanly with muted "step N"
  // markers.
  const s = status ?? ({} as StatusRow);

  const stages: Array<{
    key: StageKey;
    label: string;
    status: string | null;
    remarks: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
    extras?: Field[];
    extrasInitial: Record<string, string | null>;
  }> = [
    {
      key: "application",
      label: "Application",
      status: s.applicationStatus,
      remarks: s.applicationRemarks,
      updatedAt: s.applicationUpdatedDate,
      updatedBy: s.applicationUpdatedBy,
      extras: [
        { label: "Enrolment date", value: s.enrolmentDate, asDate: true },
        { label: "Enrolee type", value: s.enroleeType },
      ],
      extrasInitial: {},
    },
    {
      key: "registration",
      label: "Registration",
      status: s.registrationStatus,
      remarks: s.registrationRemarks,
      updatedAt: s.registrationUpdatedDate,
      updatedBy: s.registrationUpdatedBy,
      extras: [
        { label: "Invoice", value: s.registrationInvoice },
        { label: "Payment date", value: s.registrationPaymentDate, asDate: true },
      ],
      extrasInitial: {
        invoice: s.registrationInvoice,
        paymentDate: s.registrationPaymentDate,
      },
    },
    {
      key: "documents",
      label: "Documents",
      status: s.documentStatus,
      remarks: s.documentRemarks,
      updatedAt: s.documentUpdatedDate,
      updatedBy: s.documentUpdatedBy,
      extrasInitial: {},
    },
    {
      key: "assessment",
      label: "Assessment",
      status: s.assessmentStatus,
      remarks: s.assessmentRemarks,
      updatedAt: s.assessmentUpdatedDate,
      updatedBy: s.assessmentUpdatedBy,
      extras: [
        { label: "Schedule", value: s.assessmentSchedule, asDate: true },
        { label: "Math", value: s.assessmentGradeMath as string | number | null },
        { label: "English", value: s.assessmentGradeEnglish as string | number | null },
        { label: "Medical", value: s.assessmentMedical },
      ],
      extrasInitial: {
        schedule: s.assessmentSchedule,
        math: s.assessmentGradeMath != null ? String(s.assessmentGradeMath) : null,
        english: s.assessmentGradeEnglish != null ? String(s.assessmentGradeEnglish) : null,
        medical: s.assessmentMedical,
      },
    },
    {
      key: "contract",
      label: "Contract",
      status: s.contractStatus,
      remarks: s.contractRemarks,
      updatedAt: s.contractUpdatedDate,
      updatedBy: s.contractUpdatedBy,
      extrasInitial: {},
    },
    {
      key: "fees",
      label: "Fees",
      status: s.feeStatus,
      remarks: s.feeRemarks,
      updatedAt: s.feeUpdatedDate,
      updatedBy: s.feeUpdatedBy,
      extras: [
        { label: "Invoice", value: s.feeInvoice },
        { label: "Payment date", value: s.feePaymentDate, asDate: true },
        { label: "Start date", value: s.feeStartDate, asDate: true },
      ],
      extrasInitial: {
        invoice: s.feeInvoice,
        paymentDate: s.feePaymentDate,
        startDate: s.feeStartDate,
      },
    },
    {
      key: "class",
      label: "Class assignment",
      status: s.classStatus,
      remarks: s.classRemarks,
      updatedAt: s.classUpdatedDate,
      updatedBy: s.classUpdatedBy,
      extras: [
        { label: "Class AY", value: s.classAY },
        { label: "Level", value: s.classLevel },
        { label: "Section", value: s.classSection },
      ],
      extrasInitial: {
        classAY: s.classAY,
        classLevel: s.classLevel,
        classSection: s.classSection,
      },
    },
    {
      key: "supplies",
      label: "Supplies",
      status: s.suppliesStatus,
      remarks: s.suppliesRemarks,
      updatedAt: s.suppliesUpdatedDate,
      updatedBy: s.suppliesUpdatedBy,
      extras: [{ label: "Claimed date", value: s.suppliesClaimedDate, asDate: true }],
      extrasInitial: { claimedDate: s.suppliesClaimedDate },
    },
    {
      key: "orientation",
      label: "Orientation",
      status: s.orientationStatus,
      remarks: s.orientationRemarks,
      updatedAt: s.orientationUpdatedDate,
      updatedBy: s.orientationUpdatedBy,
      extras: [{ label: "Schedule", value: s.orientationScheduleDate, asDate: true }],
      extrasInitial: { scheduleDate: s.orientationScheduleDate },
    },
  ];

  // Lookup by stage key.
  const stageByKey = new Map(stages.map((st) => [st.key, st]));
  const prereqSequence: StageKey[] = [...ENROLLED_PREREQ_STAGES];
  const applicationStage = stageByKey.get("application")!;
  // Snapshot of the 5 prereq stage statuses, for the EditStageDialog
  // advisory checklist when admin flips the application status to Enrolled.
  // Server still re-validates on submit (KD-style soft-gate UI).
  const prereqStatusesForApplication: Partial<Record<StageKey, string | null>> = {};
  for (const k of ENROLLED_PREREQ_STAGES) {
    prereqStatusesForApplication[k] = stageByKey.get(k)?.status ?? null;
  }
  const postList = (["class", "supplies", "orientation"] as StageKey[]).map((k) => stageByKey.get(k)!);

  // Phase groupings. The 5 prereq stages split into two workflow phases:
  //   Intake — qualifying the applicant (Registration, Documents, Assessment)
  //   Commitments — binding decisions (Contract, Fees)
  // The Enrollment decision card sits between Commitments and Start as the
  // gate into post-enrollment. Sequential locking still applies ACROSS
  // phases (Contract depends on Assessment, etc.) — the grouping is purely
  // visual and the StepRow lock state is driven by the full prereqSequence.
  const intakeKeys: StageKey[] = ["registration", "documents", "assessment"];
  const commitmentsKeys: StageKey[] = ["contract", "fees"];
  const intakeList = intakeKeys.map((k) => stageByKey.get(k)!);
  const commitmentsList = commitmentsKeys.map((k) => stageByKey.get(k)!);

  // Compute per-prereq lock state + identify the "active" (next-action) step.
  // Stages now run in parallel — different team members touch documents,
  // assessment, contract, fees, registration on different days. The only
  // locks remaining are the terminal states themselves:
  //   - done        = current status equals this stage's terminal value
  //   - cancelled   = current status is 'Cancelled'
  //   - unlocked    = otherwise (still open / awaiting input)
  // The FIRST 'unlocked' stage in sequence is highlighted as "active" — a
  // hint, not a hard gate. The OUTER Enrolled-flip gate (all 5 prereqs at
  // their terminal values) remains enforced server-side.
  type LockState = "done" | "cancelled" | "unlocked";
  function lockFor(key: StageKey): LockState {
    const cur = (s as Record<string, string | null>)[STAGE_COLUMN_MAP[key].statusCol] ?? null;
    if (cur === "Cancelled") return "cancelled";
    const terminal = STAGE_TERMINAL_STATUS[key];
    if (terminal && cur === terminal) return "done";
    return "unlocked";
  }
  const prereqLocks = prereqSequence.map((k) => lockFor(k));
  const activeIndex = prereqLocks.findIndex((l) => l === "unlocked");
  const prereqDoneCount = prereqLocks.filter((l) => l === "done").length;
  const prereqPct = Math.round((prereqDoneCount / prereqSequence.length) * 100);
  const allPrereqsDone = prereqDoneCount === prereqSequence.length;

  // Enrollment state summary for the decision card.
  const applicationStatusValue = s.applicationStatus ?? null;
  const isEnrolled = applicationStatusValue === "Enrolled" || applicationStatusValue === "Enrolled (Conditional)";
  const isTerminalApp = isEnrolled || applicationStatusValue === "Cancelled" || applicationStatusValue === "Withdrawn";

  // Exhaustive decision state. Drives the whole decision-card rendering:
  // border tint, eyebrow badge, hero block, and CTA wording.
  type DecisionState = "enrolled" | "enrolledConditional" | "ready" | "blocked" | "cancelled" | "withdrawn";
  const decisionState: DecisionState =
    applicationStatusValue === "Enrolled"
      ? "enrolled"
      : applicationStatusValue === "Enrolled (Conditional)"
        ? "enrolledConditional"
        : applicationStatusValue === "Cancelled"
          ? "cancelled"
          : applicationStatusValue === "Withdrawn"
            ? "withdrawn"
            : allPrereqsDone
              ? "ready"
              : "blocked";

  // Blockers for the Enrolled flip (re-uses the same data as prereqLocks).
  const blockers = prereqSequence
    .map((k, i) => ({ key: k, lock: prereqLocks[i] }))
    .filter((b) => b.lock !== "done" && b.lock !== "cancelled");

  // The next step admissions needs to push forward on, when blocked.
  const nextActionKey = activeIndex >= 0 ? prereqSequence[activeIndex] : null;

  return (
    <div className="space-y-6">
      {statusFetchError && (
        <div className="flex items-start gap-3 rounded-xl border border-brand-amber/40 bg-brand-amber-light/40 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand-amber" />
          <div className="space-y-1 text-xs leading-relaxed">
            <p className="font-medium text-foreground">Status row lookup returned an error.</p>
            <p className="text-muted-foreground">
              This usually means multiple rows exist in{" "}
              <code className="font-mono">{ayCode.toLowerCase()}_enrolment_status</code> for this enrolee — the schema
              allows duplicates. The timeline below may not reflect reality; contact an engineer to dedupe before using
              this pipeline.
            </p>
          </div>
        </div>
      )}

      {/* Phase 1 — Intake */}
      <PhaseStepCard
        eyebrow="Phase 1 · Intake"
        title="Qualification"
        subtitle="Registration, documents & assessment — verifying the applicant."
        icon={ClipboardList}
        stages={intakeList}
        // Indices into prereqSequence so StepRow shows the correct global step
        // number (1, 2, 3) and reads its lock/active state from prereqLocks.
        stageIndices={intakeKeys.map((k) => prereqSequence.indexOf(k))}
        prereqLocks={prereqLocks}
        activeIndex={activeIndex}
        progressLabel={
          allPrereqsDone
            ? `${prereqDoneCount} of ${prereqSequence.length} prereqs complete`
            : `${prereqDoneCount} of ${prereqSequence.length} prereqs`
        }
        progressPct={prereqPct}
        allPrereqsDone={allPrereqsDone}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
      />

      {/* Phase 2 — Commitments */}
      <PhaseStepCard
        eyebrow="Phase 2 · Commitments"
        title="Contract & payment"
        subtitle="Binding decisions — sign the contract and clear fees."
        icon={ShieldCheck}
        stages={commitmentsList}
        stageIndices={commitmentsKeys.map((k) => prereqSequence.indexOf(k))}
        prereqLocks={prereqLocks}
        activeIndex={activeIndex}
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
      />

      {/* Enrollment gate — sits between Phase 2 and Phase 3 as the single
          transition into post-enrollment. Unified single-color treatment
          (brand-indigo): state is communicated through icon + copy, not
          color rotation. Follows ui-ux-pro-max visual-hierarchy rule and
          the project's horizontal-flex + solid-tint pattern used by
          ParentCard / ProfileSectionCard / PhaseStepCard on this page. */}
      <Card className={cn(decisionState === "ready" && "shadow-sm")}>
        <CardHeader className="border-b border-border">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Enrollment gate
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            {decisionState === "enrolled" && "Enrolled"}
            {decisionState === "enrolledConditional" && "Enrolled (Conditional)"}
            {decisionState === "ready" && "Ready to enroll"}
            {decisionState === "blocked" && `${blockers.length} prereq${blockers.length === 1 ? "" : "s"} remaining`}
            {decisionState === "cancelled" && "Application cancelled"}
            {decisionState === "withdrawn" && "Application withdrawn"}
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              {decisionState === "enrolled" && <CheckCircle2 className="size-5" />}
              {decisionState === "enrolledConditional" && <ShieldCheck className="size-5" />}
              {decisionState === "ready" && <ArrowRight className="size-5" />}
              {decisionState === "blocked" && <Lock className="size-5" />}
              {(decisionState === "cancelled" || decisionState === "withdrawn") && <X className="size-5" />}
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {/* Enrolled / Conditional — class-assigned hero. */}
          {(decisionState === "enrolled" || decisionState === "enrolledConditional") && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-muted/20 p-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <GraduationCap className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                {s.classLevel && s.classSection ? (
                  <>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Class assigned
                    </p>
                    <p className="font-serif text-xl font-semibold leading-tight tracking-tight text-foreground">
                      {s.classLevel} · {s.classSection}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {decisionState === "enrolled" ? "Enrolled" : "Enrolled (Conditional)"}
                    </p>
                    <p className="font-serif text-lg font-semibold leading-tight text-foreground">
                      Class placement pending
                    </p>
                  </>
                )}
                {applicationStage.updatedAt && (
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
                    {decisionState === "enrolled" ? "Enrolled" : "Marked conditional"}{" "}
                    {new Date(applicationStage.updatedAt).toLocaleDateString("en-SG", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                    {applicationStage.updatedBy && (
                      <span className="ml-1.5 normal-case text-muted-foreground/80">
                        by {applicationStage.updatedBy}
                      </span>
                    )}
                  </p>
                )}
              </div>
              <EditStageDialog
                ayCode={ayCode}
                enroleeNumber={enroleeNumber}
                stageKey="application"
                initialStatus={applicationStage.status}
                initialRemarks={applicationStage.remarks}
                initialExtras={applicationStage.extrasInitial}
                prereqStatuses={prereqStatusesForApplication}
              />
            </div>
          )}
          {decisionState === "enrolledConditional" && (
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              Registrar override — the standard prereq gate was bypassed. Finish the remaining prereqs to drop the
              conditional tag.
            </p>
          )}

          {/* Ready CTA — all 5 prereqs clear; flip the application status. */}
          {decisionState === "ready" && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-muted/20 p-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <Sparkles className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  All 5 prerequisites complete
                </p>
                <p className="font-serif text-base font-semibold leading-snug text-foreground">
                  Flip application status to <span className="text-brand-indigo-deep">Enrolled</span> — a class section
                  will be auto-assigned.
                </p>
              </div>
              <EditStageDialog
                ayCode={ayCode}
                enroleeNumber={enroleeNumber}
                stageKey="application"
                initialStatus={applicationStage.status}
                initialRemarks={applicationStage.remarks}
                initialExtras={applicationStage.extrasInitial}
                prereqStatuses={prereqStatusesForApplication}
              />
            </div>
          )}

          {/* Blocked — "next action" row on top, full blockers list below,
              override note at the bottom. */}
          {decisionState === "blocked" && (
            <>
              {nextActionKey && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-muted/20 p-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                    <ArrowRight className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Next action
                    </p>
                    <p className="font-serif text-sm font-semibold leading-tight text-foreground">
                      {STAGE_LABELS[nextActionKey]}
                      <span className="ml-2 font-sans text-[11px] font-normal text-muted-foreground">
                        → mark as{" "}
                        <span className="font-medium text-foreground">{STAGE_TERMINAL_STATUS[nextActionKey]}</span>
                      </span>
                    </p>
                  </div>
                </div>
              )}
              <div className="space-y-3 rounded-xl border border-hairline bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {blockers.length} step{blockers.length === 1 ? "" : "s"} remaining
                  </p>
                  <EditStageDialog
                    ayCode={ayCode}
                    enroleeNumber={enroleeNumber}
                    stageKey="application"
                    initialStatus={applicationStage.status}
                    initialRemarks={applicationStage.remarks}
                    initialExtras={applicationStage.extrasInitial}
                    prereqStatuses={prereqStatusesForApplication}
                  />
                </div>
                <ul className="space-y-1.5">
                  {blockers.map((b) => {
                    const isNext = b.key === nextActionKey;
                    return (
                      <li key={b.key} className="flex items-center gap-2.5 text-sm">
                        <Circle
                          className={cn("size-3.5 shrink-0", isNext ? "text-brand-indigo" : "text-muted-foreground")}
                        />
                        <span className="font-medium text-foreground">{STAGE_LABELS[b.key]}</span>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          → needs {STAGE_TERMINAL_STATUS[b.key]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Finish every prereq to unlock <strong className="text-foreground">Enrolled</strong>, or use{" "}
                  <strong className="text-foreground">Enrolled (Conditional)</strong> as the registrar override.
                </p>
              </div>
            </>
          )}

          {/* Cancelled / Withdrawn — terminal non-enrolled state. */}
          {(decisionState === "cancelled" || decisionState === "withdrawn") && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-muted/20 p-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <X className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Application {decisionState}
                </p>
                {applicationStage.updatedAt && (
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
                    {new Date(applicationStage.updatedAt).toLocaleDateString("en-SG", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                    {applicationStage.updatedBy && (
                      <span className="ml-1.5 normal-case text-muted-foreground/80">
                        by {applicationStage.updatedBy}
                      </span>
                    )}
                  </p>
                )}
              </div>
              <EditStageDialog
                ayCode={ayCode}
                enroleeNumber={enroleeNumber}
                stageKey="application"
                initialStatus={applicationStage.status}
                initialRemarks={applicationStage.remarks}
                initialExtras={applicationStage.extrasInitial}
                prereqStatuses={prereqStatusesForApplication}
              />
            </div>
          )}

          {applicationStage.extras && applicationStage.extras.some((e) => !isFieldEmpty(e)) && (
            <div className="rounded-lg border border-hairline bg-muted/20 px-3 py-2.5">
              <FieldGrid fields={applicationStage.extras} />
            </div>
          )}
          {applicationStage.remarks && (
            <p className="whitespace-pre-line rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">
              {applicationStage.remarks}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Phase 3 — Start */}
      <Card className={cn(!isEnrolled && "opacity-60")}>
        <CardHeader className="border-b border-border">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Phase 3 · Start
          </CardDescription>
          <CardTitle className="flex flex-wrap items-baseline gap-2 font-serif text-lg font-semibold tracking-tight text-foreground">
            Class, supplies &amp; orientation
            {isEnrolled ? (
              <Badge
                variant="outline"
                className="border-brand-mint bg-brand-mint/20 font-mono text-[10px] uppercase tracking-[0.14em] text-brand-indigo-deep">
                Active
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-border bg-muted/40 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Activates after Enrolled
              </Badge>
            )}
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <GraduationCap className="size-5" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="pt-0">
          <ol className="-mx-6 divide-y divide-border border-y border-border">
            {postList.map((stage) => {
              const isClassStage = stage.key === "class";
              return (
                <PostStepRow
                  key={stage.key}
                  stage={stage}
                  isClassStage={isClassStage}
                  isEnrolled={isEnrolled}
                  ayCode={ayCode}
                  enroleeNumber={enroleeNumber}
                />
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {/* Medical + Discounts */}
      <div className="grid gap-4 md:grid-cols-2">
        <MedicalCard app={app} />
        <BillingCard app={app} />
      </div>
    </div>
  );
}

// Stage status → semantic color tone for the vertical-timeline marker.
// Aligns with StageStatusBadge tones in components/sis/status-badge.tsx.
type StepStage = {
  key: StageKey;
  label: string;
  status: string | null;
  remarks: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  extras?: Field[];
  extrasInitial: Record<string, string | null>;
};

// 4px left accent stripe per-row, colored by state using Aurora Vault tokens.
function stripeForPrereqLock(lock: "done" | "cancelled" | "unlocked", isActive: boolean, hasStatus: boolean): string {
  if (lock === "done") return "bg-brand-mint";
  if (lock === "cancelled") return "bg-destructive/70";
  if (isActive) return "bg-brand-indigo";
  if (hasStatus) return "bg-brand-amber";
  return "bg-border";
}

function stripeForPostStage(stage: StepStage): string {
  if (stageCompleted(stage.status)) return "bg-brand-mint";
  if (stageRejected(stage.status) || stage.status === "Cancelled") return "bg-destructive/70";
  if (stagePending(stage.status)) return "bg-brand-amber";
  if (stage.status) return "bg-brand-indigo";
  return "bg-border";
}

// Phase card that renders a subset of prereq stages with the workflow's
// standard locking + next-action behavior. The overall aggregate progress
// (X of 5 prereqs) only appears on Phase 1 via the optional progress bar —
// Phase 2 inherits the locking context without a per-phase progress bar to
// keep the visual weight on "overall readiness", not "Commitments-only".
function PhaseStepCard({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  stages,
  stageIndices,
  prereqLocks,
  activeIndex,
  progressLabel,
  progressPct,
  allPrereqsDone,
  ayCode,
  enroleeNumber,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  stages: StepStage[];
  stageIndices: number[];
  prereqLocks: Array<"done" | "cancelled" | "unlocked">;
  activeIndex: number;
  progressLabel?: string;
  progressPct?: number;
  allPrereqsDone?: boolean;
  ayCode: string;
  enroleeNumber: string;
}) {
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">{title}</CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        {progressLabel !== undefined && progressPct !== undefined && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {progressLabel}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{progressPct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full transition-all", allPrereqsDone ? "bg-brand-mint" : "bg-brand-indigo/70")}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
        <ol className="-mx-6 divide-y divide-border border-y border-border">
          {stages.map((stage, localIdx) => {
            const globalIdx = stageIndices[localIdx];
            const lock = prereqLocks[globalIdx];
            const isActive = globalIdx === activeIndex;
            return (
              <StepRow
                key={stage.key}
                index={globalIdx + 1}
                lock={lock}
                isActive={isActive}
                stage={stage}
                ayCode={ayCode}
                enroleeNumber={enroleeNumber}
              />
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

// Renders a compact {key : value} chip strip for stage extras. Preserves
// the "at-a-glance" feel of the vertical timeline without the dense block.
function ExtrasChips({ fields }: { fields: Field[] }) {
  const nonEmpty = fields.filter((f) => !isFieldEmpty(f));
  if (nonEmpty.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {nonEmpty.map((f) => {
        const value =
          f.asDate && typeof f.value === "string"
            ? new Date(f.value).toLocaleDateString("en-SG", {
                day: "2-digit",
                month: "short",
              })
            : String(f.value ?? "—");
        return (
          <span
            key={f.label}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-muted/40 px-2 py-0.5 text-[11px] text-foreground">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{f.label}</span>
            <span className="font-medium tabular-nums">{value}</span>
          </span>
        );
      })}
    </div>
  );
}

// Dense prereq row with 4px accent stripe, marker, title + inline meta,
// and a hover-revealed Edit button (always visible on the active row).
function StepRow({
  index,
  lock,
  isActive,
  stage,
  ayCode,
  enroleeNumber,
}: {
  index: number;
  lock: "done" | "cancelled" | "unlocked";
  isActive: boolean;
  stage: StepStage;
  ayCode: string;
  enroleeNumber: string;
}) {
  const stripe = stripeForPrereqLock(lock, isActive, !!stage.status);
  return (
    <li
      className={cn(
        "group relative flex items-center gap-3 px-6 py-3 transition-colors",
        isActive && "bg-brand-indigo/5",
        !isActive && "hover:bg-muted/40",
      )}>
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", stripe)} />
      <PrereqMarker index={index} lock={lock} status={stage.status} isActive={isActive} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-serif text-sm font-semibold tracking-tight text-foreground">{stage.label}</h3>
          <StageStatusBadge status={stage.status} />
          {isActive && (
            <Badge variant="outline" className="gap-1 border-brand-indigo/40 bg-brand-indigo/5 text-brand-indigo-deep">
              <Sparkles className="size-3" />
              Next action
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {stage.updatedAt && (
            <span className="font-mono text-[10px] uppercase tracking-wider tabular-nums">
              {new Date(stage.updatedAt).toLocaleDateString("en-SG", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {stage.updatedBy && (
                <span className="ml-1.5 normal-case text-muted-foreground/80">by {stage.updatedBy}</span>
              )}
            </span>
          )}
          {stage.extras && <ExtrasChips fields={stage.extras} />}
          {stage.remarks && <span className="line-clamp-1 max-w-md italic">“{stage.remarks}”</span>}
        </div>
      </div>
      <div
        className={cn(
          "shrink-0 transition-opacity",
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}>
        <EditStageDialog
          ayCode={ayCode}
          enroleeNumber={enroleeNumber}
          stageKey={stage.key}
          initialStatus={stage.status}
          initialRemarks={stage.remarks}
          initialExtras={stage.extrasInitial}
        />
      </div>
    </li>
  );
}

// Post-enrollment row (class / supplies / orientation). Same density as
// StepRow but uses the simpler done/pending/cancelled tones — no lock
// sequence, since these are parallel and activate after Enrolled.
function PostStepRow({
  stage,
  isClassStage,
  isEnrolled,
  ayCode,
  enroleeNumber,
}: {
  stage: StepStage;
  isClassStage: boolean;
  isEnrolled: boolean;
  ayCode: string;
  enroleeNumber: string;
}) {
  const stripe = stripeForPostStage(stage);
  const tone = stageTone(stage.status);
  const marker = stageMarkerElement(stage.status, "size-4");
  return (
    <li className="group relative flex items-center gap-3 px-6 py-3 transition-colors hover:bg-muted/40">
      <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1", stripe)} />
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-background",
          tone.border,
          tone.bg,
          tone.text,
        )}>
        {marker ?? <Circle className="size-3" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-serif text-sm font-semibold tracking-tight text-foreground">{stage.label}</h3>
          <StageStatusBadge status={stage.status} />
          {isClassStage && !isEnrolled && (
            <Badge
              variant="outline"
              className="gap-1 border-brand-indigo/30 bg-brand-indigo/5 font-mono text-[10px] text-brand-indigo-deep">
              <Sparkles className="size-3" />
              Auto on Enrolled
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {stage.updatedAt && (
            <span className="font-mono text-[10px] uppercase tracking-wider tabular-nums">
              {new Date(stage.updatedAt).toLocaleDateString("en-SG", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {stage.updatedBy && (
                <span className="ml-1.5 normal-case text-muted-foreground/80">by {stage.updatedBy}</span>
              )}
            </span>
          )}
          {stage.extras && <ExtrasChips fields={stage.extras} />}
          {stage.remarks && <span className="line-clamp-1 max-w-md italic">“{stage.remarks}”</span>}
        </div>
      </div>
      <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <EditStageDialog
          ayCode={ayCode}
          enroleeNumber={enroleeNumber}
          stageKey={stage.key}
          initialStatus={stage.status}
          initialRemarks={stage.remarks}
          initialExtras={stage.extrasInitial}
        />
      </div>
    </li>
  );
}

// ---- Medical + Billing cards ----------------------------------------------

// Condition flags that render as amber "on file" pills at the top of the
// Medical card when the parent ticked them. The order here matches the
// visual priority — most safety-relevant first.
const MEDICAL_FLAGS: Array<{ key: keyof ApplicationRow; label: string }> = [
  { key: "allergies", label: "Allergies" },
  { key: "foodAllergies", label: "Food allergies" },
  { key: "asthma", label: "Asthma" },
  { key: "heartConditions", label: "Heart conditions" },
  { key: "epilepsy", label: "Epilepsy" },
  { key: "diabetes", label: "Diabetes" },
  { key: "eczema", label: "Eczema" },
];

const MEDICAL_DETAILS: Array<{ key: keyof ApplicationRow; label: string }> = [
  { key: "allergyDetails", label: "Allergy details" },
  { key: "foodAllergyDetails", label: "Food allergy details" },
  { key: "otherMedicalConditions", label: "Other conditions" },
  { key: "dietaryRestrictions", label: "Dietary restrictions" },
];

function MedicalCard({ app }: { app: ApplicationRow }) {
  const raisedFlags = MEDICAL_FLAGS.filter((f) => app[f.key] === true);
  const detailEntries = MEDICAL_DETAILS.filter((f) => {
    const v = app[f.key] as string | null | undefined;
    return v !== null && v !== undefined && String(v).trim() !== "";
  });
  const paracetamolConsent = app.paracetamolConsent; // boolean | null
  const hasAnyContent = raisedFlags.length > 0 || detailEntries.length > 0 || paracetamolConsent !== null;

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Health profile
        </CardDescription>
        <CardTitle className="flex flex-wrap items-baseline gap-2 font-serif text-lg font-semibold tracking-tight text-foreground">
          Medical
          {raisedFlags.length > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-brand-amber/40 bg-brand-amber-light/40 font-mono text-[10px] uppercase tracking-[0.14em] text-brand-amber">
              <AlertTriangle className="size-3" />
              {raisedFlags.length} flag{raisedFlags.length === 1 ? "" : "s"}
            </Badge>
          )}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Heart className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {!hasAnyContent && (
          <div className="flex items-center gap-2 rounded-lg border border-hairline bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5 shrink-0 text-brand-mint" />
            No medical conditions on file.
          </div>
        )}

        {raisedFlags.length > 0 && (
          <div className="space-y-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Conditions declared
            </p>
            <div className="flex flex-wrap gap-1.5">
              {raisedFlags.map((f) => (
                <span
                  key={String(f.key)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-brand-amber/40 bg-brand-amber-light/40 px-2.5 py-1 text-xs font-medium text-foreground">
                  <AlertTriangle className="size-3 text-brand-amber" />
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {detailEntries.length > 0 && (
          <div className="space-y-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Details
            </p>
            <dl className="space-y-3">
              {detailEntries.map((f) => (
                <div key={String(f.key)}>
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{f.label}</dt>
                  <dd className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {String(app[f.key] ?? "")}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {paracetamolConsent !== null && (
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs",
              paracetamolConsent ? "border-brand-mint/50 bg-brand-mint/10" : "border-hairline bg-muted/20",
            )}>
            {paracetamolConsent ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-brand-mint" />
            ) : (
              <X className="size-3.5 shrink-0 text-destructive" />
            )}
            <span className="text-foreground">
              Paracetamol consent: <span className="font-medium">{paracetamolConsent ? "Granted" : "Withheld"}</span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BillingCard({ app }: { app: ApplicationRow }) {
  const discountSlots = [
    { label: "Discount 1", value: app.discount1 },
    { label: "Discount 2", value: app.discount2 },
    { label: "Discount 3", value: app.discount3 },
  ];
  const consents: Array<{ label: string; value: boolean | null }> = [
    { label: "Social media consent", value: app.socialMediaConsent ?? null },
    { label: "Feedback consent", value: app.feedbackConsent ?? null },
  ];
  const activeDiscounts = discountSlots.filter((d) => d.value && String(d.value).trim() !== "");

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Billing &amp; consents
        </CardDescription>
        <CardTitle className="flex flex-wrap items-baseline gap-2 font-serif text-lg font-semibold tracking-tight text-foreground">
          Discounts &amp; consents
          {activeDiscounts.length > 0 && (
            <Badge
              variant="outline"
              className="border-brand-indigo/40 bg-brand-indigo/5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand-indigo-deep">
              {activeDiscounts.length} discount{activeDiscounts.length === 1 ? "" : "s"}
            </Badge>
          )}
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Tags className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Discount slots
          </p>
          <ul className="space-y-1.5">
            {discountSlots.map((d) => {
              const filled = !!d.value && String(d.value).trim() !== "";
              return (
                <li
                  key={d.label}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs",
                    filled ? "border-brand-indigo/30 bg-brand-indigo/5" : "border-hairline bg-muted/20",
                  )}>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {d.label}
                  </span>
                  {filled ? (
                    <span className="font-mono font-medium tabular-nums text-brand-indigo-deep">{String(d.value)}</span>
                  ) : (
                    <span className="text-muted-foreground">Empty</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Consents
          </p>
          <ul className="space-y-1.5">
            {consents.map((c) => {
              const Icon = c.value === true ? CheckCircle2 : c.value === false ? X : Circle;
              const iconClass =
                c.value === true ? "text-brand-mint" : c.value === false ? "text-destructive" : "text-muted-foreground";
              const bgClass =
                c.value === true
                  ? "border-brand-mint/40 bg-brand-mint/10"
                  : c.value === false
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-hairline bg-muted/20";
              const valueLabel = c.value === true ? "Granted" : c.value === false ? "Withheld" : "Not answered";
              return (
                <li
                  key={c.label}
                  className={cn("flex items-center gap-2.5 rounded-md border px-3 py-2 text-xs", bgClass)}>
                  <Icon className={cn("size-3.5 shrink-0", iconClass)} />
                  <span className="text-foreground">{c.label}</span>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {valueLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function PrereqMarker({
  index,
  lock,
  status,
  isActive,
}: {
  index: number;
  lock: "done" | "cancelled" | "unlocked";
  status: string | null;
  isActive: boolean;
}) {
  // Aurora Vault tokens. Done = mint + check. Cancelled = destructive + X.
  // Active = solid brand-indigo + step number with soft ring. In-progress
  // (unlocked, has a non-terminal status) → delegate to `stageTone` so
  // Invoiced / Sent / Unpaid keep their existing informational tints.
  const base = "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 bg-background";
  if (lock === "done") {
    return (
      <div className={cn(base, "border-brand-mint bg-brand-mint/20 text-brand-indigo-deep")}>
        <Check className="size-4" />
      </div>
    );
  }
  if (lock === "cancelled") {
    return (
      <div className={cn(base, "border-destructive/50 bg-destructive/10 text-destructive")}>
        <X className="size-4" />
      </div>
    );
  }
  if (isActive) {
    return (
      <div className={cn(base, "border-brand-indigo bg-brand-indigo text-white ring-4 ring-brand-indigo/20")}>
        <span className="font-mono text-[11px] font-semibold tabular-nums">{index}</span>
      </div>
    );
  }
  const tone = stageTone(status);
  const marker = stageMarkerElement(status, "size-4");
  return (
    <div className={cn(base, tone.border, tone.bg, tone.text)}>
      {marker ?? <span className="font-mono text-[11px] font-semibold tabular-nums">{index}</span>}
    </div>
  );
}

function stageTone(status: string | null): { border: string; bg: string; text: string } {
  const v = (status ?? "").trim();
  if (stageCompleted(v))
    return {
      border: "border-brand-mint",
      bg: "bg-brand-mint/20",
      text: "text-brand-indigo-deep",
    };
  if (stageRejected(v))
    return {
      border: "border-destructive/50",
      bg: "bg-destructive/10",
      text: "text-destructive",
    };
  if (stagePending(v))
    return {
      border: "border-brand-amber/60",
      bg: "bg-brand-amber-light/40",
      text: "text-brand-amber",
    };
  if (v && /invoic|upload/i.test(v))
    return {
      border: "border-brand-indigo/40",
      bg: "bg-accent",
      text: "text-brand-indigo-deep",
    };
  return { border: "border-border", bg: "bg-muted/40", text: "text-muted-foreground" };
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

function stageMarkerElement(status: string | null, className = "size-4"): React.ReactElement | null {
  const v = (status ?? "").trim();
  if (stageCompleted(v)) return <Check className={className} />;
  if (stageRejected(v)) return <X className={className} />;
  if (stagePending(v)) return <Clock className={className} />;
  if (v && /invoic|upload/i.test(v)) return <Circle className={className} />;
  return null;
}

function stageCompleted(status: string | null): boolean {
  return !!status && /^(finished|valid|signed)$/i.test(status.trim());
}

function stagePending(status: string | null): boolean {
  return !!status && /^(pending|incomplete)$/i.test(status.trim());
}

function stageRejected(status: string | null): boolean {
  return !!status && /^rejected$/i.test(status.trim());
}

function isFieldEmpty(f: Field): boolean {
  if (typeof f.value === "boolean") return false;
  return f.value === null || f.value === undefined || (typeof f.value === "string" && f.value.trim() === "");
}

// Document categorization. Keys come from DOCUMENT_SLOTS in lib/sis/queries.ts.
// - Non-expiring: permanent records (no expiryCol).
// - Expiring: student-scoped time-limited documents (passport, pass).
// - Parent/Guardian: mother/father/guardian-prefixed documents (all expiring).
const DOC_CATEGORY_KEYS = {
  nonExpiring: new Set(["idPicture", "birthCert", "educCert", "medical"]),
  expiring: new Set(["passport", "pass"]),
  parentGuardian: new Set([
    "motherPassport",
    "motherPass",
    "fatherPassport",
    "fatherPass",
    "guardianPassport",
    "guardianPass",
  ]),
} as const;

function DocumentsTab({
  application,
  documents,
  enroleeNumber,
  ayCode,
}: {
  application: ApplicationRow;
  documents: DocumentSlot[];
  enroleeNumber: string;
  ayCode: string;
}) {
  // Filter out the 3 STP-conditional slots when the parent didn't opt into the
  // STP sub-flow (`stpApplicationType IS NULL`). When stpApplicationType is
  // set, the 3 slots remain visible and the StpApplicationCard at the top of
  // the tab references them via the smooth-scroll `#slot-{key}` anchors.
  // See docs/context/21-stp-application.md.
  const stpKeys = new Set<string>(STP_CONDITIONAL_SLOT_KEYS);
  const visibleDocuments = application.stpApplicationType
    ? documents
    : documents.filter((d) => !stpKeys.has(d.key));

  const total = visibleDocuments.length;
  const onFile = visibleDocuments.filter((d) => !!d.url).length;
  const pct = total === 0 ? 0 : Math.round((onFile / total) * 100);
  const { expiringSoon: expiring, expired } = countExpiryBuckets(visibleDocuments);

  const nonExpiringDocs = visibleDocuments.filter((d) => DOC_CATEGORY_KEYS.nonExpiring.has(d.key));
  const expiringDocs = visibleDocuments.filter((d) => DOC_CATEGORY_KEYS.expiring.has(d.key));
  const parentGuardianDocs = visibleDocuments.filter((d) => DOC_CATEGORY_KEYS.parentGuardian.has(d.key));
  const stpDocs = visibleDocuments.filter((d) => stpKeys.has(d.key));

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Documents on file
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          {onFile} of {total} uploaded ({pct}%)
        </CardTitle>
        <CardAction>
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <FileCheck className="size-5" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full transition-all", pct === 100 ? "bg-brand-mint" : "bg-brand-indigo/70")}
            style={{ width: `${pct}%` }}
          />
        </div>
        {(expiring > 0 || expired > 0) && (
          <div className="flex items-start gap-2.5 rounded-xl border border-brand-amber/40 bg-brand-amber-light/40 p-3">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-brand-amber" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {expired > 0 && (
                <>
                  <span className="font-medium text-foreground">{expired} expired</span>
                  {" — replace via P-Files. "}
                </>
              )}
              {expiring > 0 && (
                <>
                  <span className="font-medium text-foreground">{expiring} expiring within 60 days</span>.
                </>
              )}
            </p>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Approve or reject each upload. Replacements and revision history live in P-Files.
        </p>
        <DocumentCategorySection
          title="Non-expiring documents"
          subtitle="Permanent records — upload once."
          icon={FileCheck}
          docs={nonExpiringDocs}
          enroleeNumber={enroleeNumber}
          ayCode={ayCode}
        />
        <DocumentCategorySection
          title="Expiring documents"
          subtitle="Student-scoped — track expiry, replace in P-Files before it lapses."
          icon={CalendarClock}
          docs={expiringDocs}
          enroleeNumber={enroleeNumber}
          ayCode={ayCode}
        />
        <DocumentCategorySection
          title="Parent / Guardian documents"
          subtitle="Mother, father and guardian identity documents — all have expiry dates."
          icon={Users}
          docs={parentGuardianDocs}
          enroleeNumber={enroleeNumber}
          ayCode={ayCode}
        />
        {stpDocs.length > 0 && (
          <DocumentCategorySection
            title="Singapore Student Pass (STP)"
            subtitle="ICA-required documents on top of the standard package — only shown when the parent opted into the STP sub-flow."
            icon={ShieldCheck}
            docs={stpDocs}
            enroleeNumber={enroleeNumber}
            ayCode={ayCode}
          />
        )}
      </CardContent>
    </Card>
  );
}

function DocumentCategorySection({
  title,
  subtitle,
  icon: Icon,
  docs,
  enroleeNumber,
  ayCode,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  docs: DocumentSlot[];
  enroleeNumber: string;
  ayCode: string;
}) {
  if (docs.length === 0) return null;
  const uploaded = docs.filter((d) => !!d.url).length;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-indigo-deep">
            {title}
          </h3>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-muted-foreground">
          {uploaded} / {docs.length} uploaded
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {docs.map((doc) => (
          <DocumentCard key={doc.key} doc={doc} enroleeNumber={enroleeNumber} ayCode={ayCode} />
        ))}
      </ul>
    </section>
  );
}

function DocumentCard({ doc, enroleeNumber, ayCode }: { doc: DocumentSlot; enroleeNumber: string; ayCode: string }) {
  const onFile = !!doc.url;
  return (
    <li
      id={`slot-${doc.key}`}
      className="scroll-mt-20 flex items-start gap-3 rounded-xl border border-hairline bg-card p-4"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FileText className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <span className="font-serif text-sm font-semibold text-foreground">{doc.label}</span>
          {doc.status ? (
            <StageStatusBadge status={doc.status} />
          ) : (
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Missing
            </Badge>
          )}
        </div>
        {doc.expiry && (
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Expires{" "}
            {new Date(doc.expiry).toLocaleDateString("en-SG", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {onFile && doc.url && (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand-indigo-deep underline transition-colors hover:text-brand-indigo">
              View file
              <ExternalLink className="size-3" />
            </a>
          )}
          <Link
            href={`/p-files/${enroleeNumber}#slot-${doc.key}`}
            className="inline-flex items-center gap-1 text-muted-foreground underline transition-colors hover:text-foreground">
            Open in P-Files
            <ExternalLink className="size-3" />
          </Link>
          <DocumentValidationActions
            ayCode={ayCode}
            enroleeNumber={enroleeNumber}
            slotKey={doc.key}
            label={doc.label}
            status={doc.status}
            url={doc.url}
          />
        </div>
      </div>
    </li>
  );
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
