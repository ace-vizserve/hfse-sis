import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUpRight,
  BadgePercent,
  Bus,
  CalendarCheck,
  Check,
  ClipboardList,
  CreditCard,
  ExternalLink,
  FolderOpen,
  GraduationCap,
  Home,
  Layers,
  LogOut,
  Mail,
  Phone,
  Pill,
  ShieldCheck,
  Shirt,
  Sparkles,
  Stethoscope,
  User,
  UserCircle2,
  Users,
  Utensils,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import React from 'react';

import { CompassionateAllowanceInline } from '@/components/sis/compassionate-allowance-inline';
import { EditFamilySheet } from '@/components/sis/edit-family-sheet';
import { EditProfileSheet } from '@/components/sis/edit-profile-sheet';
import { PlacementEditButton } from '@/components/sis/placement-edit-button';
import { RecordsLitePage } from '@/components/sis/records-lite-page';
import { StudentStatusBadges } from '@/components/sis/student-status-badges';
import {
  SectionTransferDialog,
  type SiblingSection,
} from '@/components/sis/section-transfer-dialog';
import { StageStatusBadge } from '@/components/sis/status-badge';
import { StpApplicationCard } from '@/components/sis/stp-application-card';
import { StudentLifecycleTimeline } from '@/components/sis/student-lifecycle-timeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentAcademicYear } from '@/lib/academic-year';
import {
  computeAnnualGrade,
  computeGeneralAverage,
} from '@/lib/compute/annual';
import {
  DEFAULT_AWARD_THRESHOLDS,
  subjectAward,
  type AwardThresholds,
} from '@/lib/compute/awards';
import { freshenAyDocuments } from '@/lib/p-files/freshen-document-statuses';
import {
  ENROLLED_STATUSES,
  isEnrolledStatus,
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';
import type { ProfileUpdateInput } from '@/lib/schemas/sis';
import { getStudentLifecycle } from '@/lib/sis/process';
import {
  getEnrollmentHistory,
  getStudentDetail,
  type ApplicationRow,
  type DocumentSlot,
  type StatusRow,
} from '@/lib/sis/queries';
import {
  findStudentByNumber,
  getAcademicHistory,
  getAttendanceHistory,
  getEvaluationWriteupsForStudent,
  getPlacementHistory,
  type AcademicHistoryRow,
  type AttendanceHistoryRow,
  type EvaluationWriteupEntry,
  type PlacementRow,
} from '@/lib/sis/records-history';
import {
  getSectionTransfersForStudent,
  type SectionTransferEntry,
} from '@/lib/sis/section-history';
import { canWriteStudentRecord } from '@/lib/auth/student-record';
import { preloadTermsForAYs, termForDateInPreloaded } from '@/lib/sis/terms';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Canonical CardAction gradient tile — indigo→navy with brand-tile glow.
// Used as the top-right icon affordance on every Card across the page so the
// section reads as a destination, not a flat block of text.
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

// Resolve a historical AY code into a deep link to that AY's admissions
// detail page (with the enrollment tab pre-selected). Falls through to plain
// text when the student has no admissions row for that AY — e.g. pre-SIS
// legacy years that only exist in the grading schema.
function AyLink({
  ayCode,
  enroleeByAy,
  className,
  children,
}: {
  ayCode: string;
  enroleeByAy: Map<string, string>;
  className?: string;
  children?: React.ReactNode;
}) {
  const enroleeNumber = enroleeByAy.get(ayCode);
  const label = children ?? ayCode;
  if (!enroleeNumber) return <span className={className}>{label}</span>;
  return (
    <Link
      href={`/admissions/applications/${enroleeNumber}?ay=${ayCode}&tab=enrollment`}
      className={`underline-offset-2 transition-colors hover:text-brand-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40 ${className ?? ''}`}
    >
      {label}
    </Link>
  );
}

function displayName(s: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
}): string {
  const parts = [s.lastName, s.firstName, s.middleName].filter(Boolean);
  return parts.length ? parts.join(', ') : '(no name on file)';
}

function fmtPercentage(num: number | null, den: number | null): string {
  if (!num || !den || den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

// Build the shared-profile editor's `initial` from the current-AY application
// row. Mirrors components/sis/profile-tab.tsx — the same admissions editor
// (EditProfileSheet) is mounted on Records since the profile is one shared
// row, editable from both surfaces (KD #147). Always fully editable here.
function buildProfileInitial(app: ApplicationRow): Partial<ProfileUpdateInput> {
  return {
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
    availStudentCare:
      app.availStudentCare as ProfileUpdateInput['availStudentCare'],
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
}

// Per-parent `initial` for EditFamilySheet — mirrors components/sis/family-tab.tsx.
function buildFamilyInitial(
  app: ApplicationRow,
  parent: 'father' | 'mother' | 'guardian'
): Record<string, unknown> {
  if (parent === 'father') {
    return {
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
    };
  }
  if (parent === 'mother') {
    return {
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
    };
  }
  return {
    guardianFullName: app.guardianFullName,
    guardianMobile: app.guardianMobile,
    guardianEmail: app.guardianEmail,
    guardianNationality: app.guardianNationality,
    guardianPassport: app.guardianPassport,
    guardianPassportExpiry: app.guardianPassportExpiry,
    guardianPass: app.guardianPass,
    guardianPassExpiry: app.guardianPassExpiry,
    guardianWhatsappTeamsConsent: app.guardianWhatsappTeamsConsent,
  };
}

const TAB_KEYS = [
  'overview',
  'family',
  'placements',
  'academic',
  'lifecycle',
] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function RecordsStudentCrossYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentNumber: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'academic_coordinator' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
  }

  // `<StpApplicationCard>` gained an OPTIONAL `canEdit` defaulting to FALSE
  // (KD #173) so the P-Files officer gets a read-only applicant file. Passed
  // explicitly here so this page's behaviour is unchanged: all three roles
  // admitted above are STUDENT_RECORD_WRITERS, so it is always true — stated,
  // not assumed, so a future change to either list is visible at this line.
  const canEditRecord = canWriteStudentRecord(sessionUser.role);

  const { studentNumber } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: TabKey = TAB_KEYS.includes(tabParam as TabKey)
    ? (tabParam as TabKey)
    : 'overview';

  const student = await findStudentByNumber(studentNumber);
  if (!student) {
    // No grading-schema row for this studentNumber. If we have admissions
    // history we render the Records "lite" page — same URL, but a stripped
    // view scoped to the most-recent (or current-AY) admissions entry, with
    // an assign-section action card so the registrar can unblock the
    // missing-classSection case without bouncing to admissions first.
    const history = await getEnrollmentHistory(studentNumber);
    if (history.length === 0) notFound();
    const currentAy = await getCurrentAcademicYear();
    const currentEntry =
      history.find((h) => h.ayCode === currentAy?.ay_code) ??
      [...history].sort((a, b) => b.ayCode.localeCompare(a.ayCode))[0];
    return (
      <RecordsLitePage
        studentNumber={studentNumber}
        history={history}
        currentEntry={currentEntry}
      />
    );
  }

  const [placements, academics, attendance, history, currentAy] =
    await Promise.all([
      getPlacementHistory(student.studentId),
      getAcademicHistory(student.studentId),
      getAttendanceHistory(student.studentId),
      getEnrollmentHistory(studentNumber),
      getCurrentAcademicYear(),
    ]);

  // Synchronous derivations — no DB calls.
  const placementAyCodes = Array.from(new Set(placements.map((p) => p.ayCode)));
  const enroleeByAy = new Map<string, string>(
    history.map((h) => [h.ayCode, h.enroleeNumber] as const)
  );
  const ayCount = new Set(placements.map((p) => p.ayCode)).size;
  // "Where is this student now" — a late enrollee counts. This matched
  // `=== 'active'` exactly, so for a student whose only non-withdrawn placement
  // is `late_enrollee` it came back undefined, and three things degraded at
  // once: the hero's "Currently in P1 Respect" line vanished, the sibling-
  // section lookup that feeds the transfer dialog returned [] (no destinations
  // to move them to), and the status badge received null.
  //
  // Measured on AY2026 when found: 20 students were in exactly that state.
  //
  // Nothing becomes less precise by including them — the badge below renders
  // `activePlacement.enrollmentStatus`, so a late enrollee still reads "Late".
  // This only stops the page pretending they have no current class.
  const activePlacement = placements.find((p) =>
    isEnrolledStatus(p.enrollmentStatus)
  );
  const lifecycleEntry = (() => {
    if (history.length === 0) return null;
    if (currentAy) {
      const match = history.find((h) => h.ayCode === currentAy.ay_code);
      if (match) return match;
    }
    return [...history].sort((a, b) => b.ayCode.localeCompare(a.ayCode))[0];
  })();
  const currentEnroleeNumber = currentAy
    ? (history.find((h) => h.ayCode === currentAy.ay_code)?.enroleeNumber ??
      null)
    : null;

  // Parallel batch A — all independent of each other and of document freshness.
  // freshenAyDocuments runs here too so it completes before batch B reads docs.
  const [
    sectionTransfers,
    termsByAy,
    allowanceResult,
    siblings,
    ,
    awardThresholdsResult,
  ] = await Promise.all([
    getSectionTransfersForStudent(
      studentNumber,
      history.map((h) => h.enroleeNumber)
    ),
    preloadTermsForAYs(placementAyCodes),
    createServiceClient()
      .from('students')
      .select('urgent_compassionate_allowance')
      .eq('id', student.studentId)
      .maybeSingle(),
    // Sibling sections: 3-query internal chain, returns SiblingSection[].
    (async (): Promise<SiblingSection[]> => {
      if (
        !activePlacement ||
        !currentAy ||
        activePlacement.ayCode !== currentAy.ay_code
      )
        return [];
      const sibService = createServiceClient();
      const { data: secRow } = await sibService
        .from('sections')
        .select('level_id, academic_year_id')
        .eq('id', activePlacement.sectionId)
        .maybeSingle();
      if (!secRow) return [];
      const { data: sibRows } = await sibService
        .from('sections')
        .select('id, name')
        .eq(
          'academic_year_id',
          (secRow as { level_id: string; academic_year_id: string })
            .academic_year_id
        )
        .eq(
          'level_id',
          (secRow as { level_id: string; academic_year_id: string }).level_id
        )
        .neq('id', activePlacement.sectionId);
      const sibList = (sibRows ?? []) as Array<{ id: string; name: string }>;
      if (sibList.length === 0) return [];
      const sibIds = sibList.map((s) => s.id);
      // Includes late enrollees — same reasoning as the SIS section page and
      // the capacity check in lib/sis/class-assignment.ts: a late enrollee
      // occupies a seat, so a roster headcount must count them.
      const { data: countRows } = await sibService
        .from('section_students')
        .select('section_id')
        .in('enrollment_status', ENROLLED_STATUSES)
        .in('section_id', sibIds);
      const sibCounts = new Map<string, number>();
      for (const cr of (countRows ?? []) as Array<{ section_id: string }>) {
        sibCounts.set(cr.section_id, (sibCounts.get(cr.section_id) ?? 0) + 1);
      }
      return sibList
        .map((s) => {
          const c = sibCounts.get(s.id) ?? 0;
          return {
            id: s.id,
            name: s.name,
            activeCount: c,
            isAtCapacity: c >= 50,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    })(),
    // freshenAyDocuments must complete before batch B reads doc statuses.
    lifecycleEntry
      ? freshenAyDocuments(lifecycleEntry.ayCode)
      : Promise.resolve(undefined),
    // Award thresholds from school_config.
    createServiceClient()
      .from('school_config')
      .select(
        'subject_award_bronze_min, subject_award_silver_min, subject_award_gold_min, subject_award_max'
      )
      .eq('id', 1)
      .maybeSingle(),
  ]);

  const allowance =
    (
      allowanceResult.data as {
        urgent_compassionate_allowance: number | null;
      } | null
    )?.urgent_compassionate_allowance ?? 5;

  const awardThresholds: AwardThresholds = (() => {
    const cfg = awardThresholdsResult?.data as {
      subject_award_bronze_min: number | null;
      subject_award_silver_min: number | null;
      subject_award_gold_min: number | null;
      subject_award_max: number | null;
    } | null;
    return {
      bronzeMin:
        cfg?.subject_award_bronze_min ?? DEFAULT_AWARD_THRESHOLDS.bronzeMin,
      silverMin:
        cfg?.subject_award_silver_min ?? DEFAULT_AWARD_THRESHOLDS.silverMin,
      goldMin: cfg?.subject_award_gold_min ?? DEFAULT_AWARD_THRESHOLDS.goldMin,
      max: cfg?.subject_award_max ?? DEFAULT_AWARD_THRESHOLDS.max,
    };
  })();

  // Parallel batch B — lifecycle + detail depend on freshened doc state from batch A.
  const [lifecycleSnapshot, currentAyDetail] = await Promise.all([
    lifecycleEntry
      ? getStudentLifecycle(lifecycleEntry.ayCode, lifecycleEntry.enroleeNumber)
      : Promise.resolve(null),
    lifecycleEntry
      ? getStudentDetail(lifecycleEntry.ayCode, lifecycleEntry.enroleeNumber)
      : Promise.resolve(null),
  ]);

  // Parallel batch C — evaluation writeups per AY (T1-T3 FCA comments).
  const writeupsResults = await Promise.all(
    academics.map((ay) =>
      getEvaluationWriteupsForStudent(student.studentId, ay.ayCode)
    )
  );
  const writeupsByAy = new Map<string, EvaluationWriteupEntry[]>(
    academics.map((ay, i) => [ay.ayCode, writeupsResults[i]])
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
          Records · Permanent record
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
            {displayName(student)}
          </h1>
          <Badge
            variant="outline"
            className="h-7 border-border bg-white px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
          >
            #{student.studentNumber}
          </Badge>
        </div>
        <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          Cross-year view, linked by the student&rsquo;s permanent student ID.{' '}
          {ayCount > 0 ? (
            <>
              Enrolled across <strong>{ayCount}</strong> academic year
              {ayCount === 1 ? '' : 's'}.
              {activePlacement && (
                <>
                  {' '}
                  Currently in{' '}
                  <strong>
                    {activePlacement.levelCode} {activePlacement.sectionName}
                  </strong>
                  .
                </>
              )}
            </>
          ) : (
            <>No enrolment history yet.</>
          )}
        </p>
      </header>

      <section className="@container/main">
        <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-3">
          <Stat
            label="Academic years"
            value={ayCount}
            icon={Layers}
            footnote="Years on roster"
          />
          <Stat
            label="Total placements"
            value={placements.length}
            icon={Users}
            footnote="Section enrolments"
          />
          <Stat
            label="Terms graded"
            value={academics.reduce((n, ay) => n + ay.terms.length, 0)}
            icon={GraduationCap}
            footnote="Cumulative across years"
          />
        </div>
      </section>

      {currentAyDetail && (
        <div className="space-y-3">
          <DocumentStatusStrip
            documents={currentAyDetail.documents}
            enroleeNumber={currentAyDetail.application.enroleeNumber}
            ayCode={currentAyDetail.ayCode}
          />
          <QuickActionsStrip
            enroleeNumber={currentAyDetail.application.enroleeNumber}
            ayCode={currentAyDetail.ayCode}
            studentId={student.studentId}
            studentNumber={studentNumber}
          />
        </div>
      )}

      <Tabs defaultValue={tab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="family">Family &amp; care</TabsTrigger>
          <TabsTrigger value="placements">Placements</TabsTrigger>
          <TabsTrigger value="academic">Academic</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {currentAyDetail ? (
            <>
              <StudentProfileCard
                app={currentAyDetail.application}
                status={currentAyDetail.status}
                ayCode={currentAyDetail.ayCode}
                enrollmentStatus={activePlacement?.enrollmentStatus ?? null}
              />
              <PostEnrolmentChecklist
                status={currentAyDetail.status}
                ayCode={currentAyDetail.ayCode}
                enroleeNumber={currentAyDetail.application.enroleeNumber}
              />
            </>
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  No current-AY admissions row for this student.
                </p>
              </CardContent>
            </Card>
          )}
          {currentAyDetail?.application.stpApplicationType && (
            <StpApplicationCard
              application={currentAyDetail.application}
              stpApplicationStatus={
                currentAyDetail.application.stpApplicationStatus ?? null
              }
              ayCode={currentAyDetail.ayCode}
              canEdit={canEditRecord}
            />
          )}
        </TabsContent>

        <TabsContent value="family" className="space-y-6">
          {currentAyDetail ? (
            <>
              <FamilyContactCard
                app={currentAyDetail.application}
                ayCode={currentAyDetail.ayCode}
                enroleeNumber={currentAyDetail.application.enroleeNumber}
              />
              <ServicePreferencesCard
                app={currentAyDetail.application}
                status={currentAyDetail.status}
              />
              <MedicalCard app={currentAyDetail.application} />
            </>
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  Family, services, and medical info live on the current-AY
                  admissions row.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="placements" className="space-y-6">
          <PlacementSection
            rows={placements}
            termsByAy={termsByAy}
            enroleeByAy={enroleeByAy}
            currentAyCode={currentAy?.ay_code ?? null}
            currentEnroleeNumber={currentEnroleeNumber}
            siblings={siblings}
          />
          <SectionTransferSection
            rows={sectionTransfers}
            enroleeByAy={enroleeByAy}
          />
        </TabsContent>

        <TabsContent value="academic" className="space-y-6">
          <AcademicSection
            rows={academics}
            enroleeByAy={enroleeByAy}
            awardThresholds={awardThresholds}
            writeupsByAy={writeupsByAy}
          />
          <AttendanceSection
            rows={attendance}
            enroleeByAy={enroleeByAy}
            studentNumber={studentNumber}
            allowance={allowance}
            currentEnroleeNumber={currentEnroleeNumber}
          />
        </TabsContent>

        <TabsContent value="lifecycle" className="space-y-6">
          {lifecycleSnapshot ? (
            <StudentLifecycleTimeline
              snapshot={lifecycleSnapshot}
              history={history}
            />
          ) : (
            <Card>
              <CardContent className="py-6">
                <p className="text-sm text-muted-foreground">
                  No lifecycle snapshot available — this student has no
                  admissions row in the current AY.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-2 flex items-center gap-2 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <GraduationCap className="size-3" strokeWidth={2.25} />
        <span>Permanent record</span>
        <span className="text-border">·</span>
        <span>Student ID {student.studentNumber}</span>
      </div>
    </PageShell>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  footnote,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  footnote: string;
}) {
  return (
    <div
      data-slot="card"
      className="@container/card flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm"
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-2 px-6">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            {label}
          </p>
          <p className="font-serif text-[32px] font-semibold leading-none tabular-nums text-foreground @[240px]/card:text-[38px]">
            {value.toLocaleString('en-SG')}
          </p>
        </div>
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
          <Icon className="size-4" />
        </div>
      </div>
      <p className="px-6 text-xs text-muted-foreground">{footnote}</p>
    </div>
  );
}

function PlacementSection({
  rows,
  termsByAy,
  enroleeByAy,
  currentAyCode,
  currentEnroleeNumber,
  siblings,
}: {
  rows: PlacementRow[];
  termsByAy: Map<
    string,
    Array<{ termNumber: number; startDate: string; endDate: string }>
  >;
  enroleeByAy: Map<string, string>;
  currentAyCode: string | null;
  currentEnroleeNumber: string | null;
  siblings: SiblingSection[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Class placement history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Placements across every AY
        </CardTitle>
        <CardAction>
          <ActionTile icon={Layers} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No placements on record.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3">AY</th>
                  <th className="py-2 pr-3">Level</th>
                  <th className="py-2 pr-3">Section</th>
                  <th className="py-2 pr-3 text-right">Index</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Enrolled</th>
                  <th className="py-2 pr-3">Withdrawn</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // Late enrollees: prefer the stored lateEnrolleTermNumber
                  // override (set by the registrar in EnrolmentEditSheet);
                  // fall back to date-derived term from enrollment_date
                  // (which the PATCH route refreshes on the active →
                  // late_enrollee transition). Non-late rows skip the lookup.

                  const lateTermResult: {
                    termNumber: number;
                    termLabel: string;
                    isOverride: boolean;
                  } | null =
                    r.enrollmentStatus === 'late_enrollee'
                      ? r.lateEnrolleTermNumber !== null
                        ? {
                            termNumber: r.lateEnrolleTermNumber,
                            termLabel: `T${r.lateEnrolleTermNumber}`,
                            isOverride: true,
                          }
                        : (() => {
                            const derived = r.enrollmentDate
                              ? termForDateInPreloaded(
                                  r.enrollmentDate,
                                  r.ayCode,
                                  termsByAy
                                )
                              : null;
                            return derived
                              ? { ...derived, isOverride: false }
                              : null;
                          })()
                      : null;
                  const isCurrentAy = r.ayCode === currentAyCode;
                  const isEditable =
                    isCurrentAy &&
                    (r.enrollmentStatus === 'active' ||
                      r.enrollmentStatus === 'late_enrollee' ||
                      r.enrollmentStatus === 'withdrawn');
                  // Late enrollees are transferable. This required exactly
                  // 'active', which contradicted the server:
                  // lib/sis/section-transfer.ts states outright that "a
                  // `late_enrollee` … is a legitimate transfer source — the
                  // registrar can move them to the section they'll start in",
                  // and its own source lookup matches both statuses. So the
                  // route accepted the operation while the UI hid the button
                  // for it.
                  const isTransferable =
                    isCurrentAy &&
                    isEnrolledStatus(r.enrollmentStatus) &&
                    currentEnroleeNumber !== null;

                  return (
                    <React.Fragment
                      key={`${r.ayCode}-${r.sectionName}-${r.indexNumber}`}
                    >
                      <tr className="border-b border-hairline last:border-0">
                        <td className="py-2 pr-3 font-mono tabular-nums">
                          <AyLink ayCode={r.ayCode} enroleeByAy={enroleeByAy} />
                        </td>
                        <td className="py-2 pr-3">{r.levelCode}</td>
                        <td className="py-2 pr-3 text-foreground">
                          {r.sectionName}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          #{r.indexNumber}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-1.5">
                            <StatusBadge status={r.enrollmentStatus} />
                            {lateTermResult && (
                              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-brand-amber">
                                · {lateTermResult.termLabel}
                                {lateTermResult.isOverride && (
                                  <span className="ml-1 text-muted-foreground">
                                    (corrected)
                                  </span>
                                )}
                              </span>
                            )}
                            {r.enrollmentStatus === 'late_enrollee' &&
                              !lateTermResult &&
                              r.enrollmentDate && (
                                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                  · between terms
                                </span>
                              )}
                          </span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted-foreground">
                          {r.enrollmentDate ?? '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted-foreground">
                          {r.withdrawalDate ?? '—'}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-1">
                            {isEditable && (
                              <PlacementEditButton
                                sectionId={r.sectionId}
                                enrolmentId={r.enrolmentId}
                                ayCode={r.ayCode}
                                studentName={r.sectionName}
                                indexNumber={r.indexNumber}
                                initial={{
                                  bus_no: r.busNo,
                                  classroom_officer_role:
                                    r.classroomOfficerRole,
                                  enrollment_status: r.enrollmentStatus,
                                  withdrawal_reason: r.withdrawalReason ?? null,
                                  withdrawal_notes: r.withdrawalNotes ?? null,
                                  late_enrollee_term_number:
                                    r.lateEnrolleTermNumber ?? null,
                                  academics_notes: r.academicsNotes ?? null,
                                  admin_notes: r.adminNotes ?? null,
                                }}
                              />
                            )}
                            {isTransferable && (
                              <SectionTransferDialog
                                enroleeNumber={currentEnroleeNumber!}
                                studentName={r.sectionName}
                                fromSectionName={r.sectionName}
                                ayCode={r.ayCode}
                                siblings={siblings}
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 gap-1 px-2 text-xs"
                                  >
                                    <ArrowRightLeft className="size-3" />
                                    Move
                                  </Button>
                                }
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Withdrawal reason sub-row */}
                      {r.enrollmentStatus === 'withdrawn' &&
                        r.withdrawalReason && (
                          <tr className="border-b border-hairline last:border-0">
                            <td colSpan={8} className="py-1.5 pl-8 pr-3">
                              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <LogOut className="size-3 shrink-0" />
                                <span className="font-medium text-foreground">
                                  {r.withdrawalReason !== null &&
                                  r.withdrawalReason in WITHDRAWAL_REASON_LABELS
                                    ? WITHDRAWAL_REASON_LABELS[
                                        r.withdrawalReason as WithdrawalReason
                                      ]
                                    : r.withdrawalReason}
                                </span>
                                {r.withdrawalNotes && (
                                  <>
                                    <span className="text-border">·</span>
                                    <span className="line-clamp-1">
                                      {r.withdrawalNotes}
                                    </span>
                                  </>
                                )}
                              </span>
                            </td>
                          </tr>
                        )}
                      {/* Operational details sub-row */}
                      {r.enrollmentStatus !== 'withdrawn' &&
                        (r.busNo || r.classroomOfficerRole) && (
                          <tr className="border-b border-hairline last:border-0">
                            <td colSpan={8} className="py-1.5 pl-8 pr-3">
                              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                {[
                                  r.busNo ? `Bus ${r.busNo}` : null,
                                  r.classroomOfficerRole ?? null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </td>
                          </tr>
                        )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: PlacementRow['enrollmentStatus'] }) {
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'late_enrollee') return <Badge variant="warning">Late</Badge>;
  return <Badge variant="muted">Withdrawn</Badge>;
}

function SectionTransferSection({
  rows,
  enroleeByAy,
}: {
  rows: SectionTransferEntry[];
  enroleeByAy: Map<string, string>;
}) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Section transfers
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Mid-year section moves
        </CardTitle>
        <CardAction>
          <ActionTile icon={ArrowRightLeft} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-1.5 rounded-xl bg-muted/25 px-4 py-3 ring-1 ring-inset ring-border sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-serif text-[15px] text-foreground">
                  <span>{r.fromSection || '—'}</span>
                  <ArrowRightLeft className="size-3.5 text-brand-indigo" />
                  <span>{r.toSection || '—'}</span>
                  {r.ayCode ? (
                    <AyLink
                      ayCode={r.ayCode}
                      enroleeByAy={enroleeByAy}
                      className="ml-1 inline-flex h-5 items-center rounded-md border border-border bg-muted/40 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {r.ayCode}
                    </AyLink>
                  ) : (
                    <Badge
                      variant="outline"
                      className="ml-1 h-5 border-border bg-muted/40 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      —
                    </Badge>
                  )}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {r.transferDate || '—'}
                  <span className="mx-1.5 text-border">·</span>
                  {r.termLabel ?? 'Between terms'}
                  {r.actorEmail && (
                    <>
                      <span className="mx-1.5 text-border">·</span>
                      <span>
                        by{' '}
                        <a
                          href={`mailto:${r.actorEmail}`}
                          className="lowercase underline-offset-2 transition-colors hover:text-brand-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
                        >
                          {r.actorEmail}
                        </a>
                      </span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AcademicSection({
  rows,
  enroleeByAy,
  awardThresholds,
  writeupsByAy,
}: {
  rows: AcademicHistoryRow[];
  enroleeByAy: Map<string, string>;
  awardThresholds: AwardThresholds;
  writeupsByAy: Map<string, EvaluationWriteupEntry[]>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Academic history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Grades per term × subject
        </CardTitle>
        <CardAction>
          <ActionTile icon={GraduationCap} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No graded terms yet.</p>
        ) : (
          rows.map((ay) => {
            // Build a map of subjectCode → quarterly grades across all terms in this AY.
            const subjectQuarterlies = new Map<string, (number | null)[]>();
            const subjectMeta = new Map<
              string,
              { isExaminable: boolean; annualLetterGrade: string | null }
            >();
            for (const term of ay.terms) {
              for (const s of term.subjects) {
                if (!subjectQuarterlies.has(s.subjectCode)) {
                  subjectQuarterlies.set(s.subjectCode, [
                    null,
                    null,
                    null,
                    null,
                  ]);
                  subjectMeta.set(s.subjectCode, {
                    isExaminable: s.isExaminable,
                    annualLetterGrade: null,
                  });
                }
                const arr = subjectQuarterlies.get(s.subjectCode)!;
                arr[term.termNumber - 1] = s.quarterlyGrade;
                // Always take the non-null annualLetterGrade — T4 row carries the real value
                if (s.annualLetterGrade !== null) {
                  subjectMeta.get(s.subjectCode)!.annualLetterGrade =
                    s.annualLetterGrade;
                }
              }
            }

            // Compute annual grade per examinable subject.
            const subjectAnnuals = new Map<string, number | null>();
            for (const [code, [t1, t2, t3, t4]] of subjectQuarterlies) {
              const meta = subjectMeta.get(code)!;
              if (meta.isExaminable) {
                subjectAnnuals.set(code, computeAnnualGrade(t1, t2, t3, t4));
              }
            }

            // Pass all examinable annuals including nulls — computeGeneralAverage
            // returns null when any grade is null (incomplete year), which is the
            // correct behaviour. Filtering nulls first would produce a misleading
            // GA from only the subjects whose T4 grades have been entered.
            const examinableAnnuals = [...subjectAnnuals.values()];
            const ga = computeGeneralAverage(examinableAnnuals);

            const effectiveThresholds = awardThresholds;

            return (
              <React.Fragment key={ay.ayCode}>
                <div className="space-y-3">
                  <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <AyLink ayCode={ay.ayCode} enroleeByAy={enroleeByAy}>
                      {ay.ayCode} · {ay.ayLabel}
                    </AyLink>
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          <th className="py-2 pr-3">Subject</th>
                          {ay.terms.map((t) => (
                            <th
                              key={t.termNumber}
                              className="py-2 pr-3 text-right"
                            >
                              T{t.termNumber}
                            </th>
                          ))}
                          <th className="py-2 text-right">Annual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Collect the union of subjects across all terms in this AY.
                          const subjMap = new Map<string, string>();
                          for (const t of ay.terms) {
                            for (const s of t.subjects) {
                              if (!subjMap.has(s.subjectCode)) {
                                subjMap.set(s.subjectCode, s.subjectName);
                              }
                            }
                          }
                          const subjects = [...subjMap.entries()].sort((a, b) =>
                            a[1].localeCompare(b[1])
                          );
                          return subjects.map(([code, name]) => (
                            <tr
                              key={code}
                              className="border-b border-hairline last:border-0"
                            >
                              <td className="py-2 pr-3 font-medium text-foreground">
                                {name}
                              </td>
                              {ay.terms.map((t) => {
                                const cell = t.subjects.find(
                                  (s) => s.subjectCode === code
                                );
                                return (
                                  <td
                                    key={t.termNumber}
                                    className="py-2 pr-3 text-right font-mono tabular-nums"
                                  >
                                    {cell?.quarterlyGrade != null
                                      ? cell.quarterlyGrade.toFixed(0)
                                      : '—'}
                                  </td>
                                );
                              })}
                              <td className="py-2 text-right">
                                {(() => {
                                  const meta = subjectMeta.get(code);
                                  if (!meta)
                                    return (
                                      <span className="font-mono tabular-nums text-muted-foreground">
                                        —
                                      </span>
                                    );
                                  if (meta.isExaminable) {
                                    const annual =
                                      subjectAnnuals.get(code) ?? null;
                                    if (annual === null)
                                      return (
                                        <span className="font-mono tabular-nums text-muted-foreground">
                                          —
                                        </span>
                                      );
                                    const award = subjectAward(
                                      annual,
                                      effectiveThresholds,
                                      {
                                        enrolled: true,
                                        hasCompleteData: true,
                                      }
                                    );
                                    const awardBadgeClass: Record<
                                      string,
                                      string
                                    > = {
                                      Gold: 'bg-gradient-to-b from-brand-amber to-brand-amber/80 text-white',
                                      Silver:
                                        'bg-gradient-to-b from-ink-4 to-ink-3 text-white',
                                      Bronze:
                                        'bg-gradient-to-b from-brand-bronze to-brand-bronze/80 text-white',
                                    };
                                    return (
                                      <span className="inline-flex items-center gap-1.5">
                                        <span className="font-mono tabular-nums">
                                          {annual.toFixed(2)}
                                        </span>
                                        {award &&
                                          award !==
                                            'Not eligible for Subject Award' && (
                                            <Badge
                                              variant="default"
                                              className={
                                                awardBadgeClass[award] ??
                                                'bg-muted text-muted-foreground'
                                              }
                                            >
                                              {award}
                                            </Badge>
                                          )}
                                      </span>
                                    );
                                  } else {
                                    // Non-examinable: show annual_letter_grade from the T4 row.
                                    const letter = meta.annualLetterGrade;
                                    if (!letter)
                                      return (
                                        <span className="font-mono tabular-nums text-muted-foreground">
                                          —
                                        </span>
                                      );
                                    return (
                                      <span className="inline-flex">
                                        <Badge
                                          variant="secondary"
                                          className="font-mono text-[10px]"
                                        >
                                          {letter}
                                        </Badge>
                                      </span>
                                    );
                                  }
                                })()}
                              </td>
                            </tr>
                          ));
                        })()}
                      </tbody>
                      {ga !== null && (
                        <tfoot>
                          <tr className="border-t border-hairline">
                            <td className="py-2 pr-3 font-semibold text-foreground">
                              General Average
                            </td>
                            {ay.terms.map((t) => (
                              <td key={t.termNumber} className="py-2 pr-3" />
                            ))}
                            <td className="py-2 text-right font-semibold tabular-nums text-foreground">
                              {ga.toFixed(1)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>
                <FcaCommentsCard
                  ayCode={ay.ayCode}
                  writeups={writeupsByAy.get(ay.ayCode) ?? []}
                />
              </React.Fragment>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function AttendanceSection({
  rows,
  enroleeByAy,
  studentNumber,
  allowance,
  currentEnroleeNumber,
}: {
  rows: AttendanceHistoryRow[];
  enroleeByAy: Map<string, string>;
  studentNumber: string;
  allowance: number;
  currentEnroleeNumber: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Attendance history
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Per-term summary
        </CardTitle>
        <CardAction className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/attendance/students/${encodeURIComponent(studentNumber)}`}
            >
              Open daily detail
              <ArrowUpRight className="size-3" />
            </Link>
          </Button>
          <ActionTile icon={CalendarCheck} />
        </CardAction>
      </CardHeader>
      <div className="border-b border-hairline px-6 pb-4">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Compassionate-leave quota
        </p>
        <CompassionateAllowanceInline
          enroleeNumber={currentEnroleeNumber ?? ''}
          initial={allowance}
          disabled={!currentEnroleeNumber}
          disabledReason={
            !currentEnroleeNumber
              ? 'No current-AY admissions record for this student.'
              : undefined
          }
        />
      </div>
      <CardContent className="space-y-6">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No attendance records yet.
          </p>
        ) : (
          rows.map((ay) => (
            <div key={ay.ayCode} className="space-y-3">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <AyLink ayCode={ay.ayCode} enroleeByAy={enroleeByAy}>
                  {ay.ayCode} · {ay.ayLabel}
                </AyLink>
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="py-2 pr-3">Term</th>
                      <th className="py-2 pr-3 text-right">School days</th>
                      <th className="py-2 pr-3 text-right">Present</th>
                      <th className="py-2 pr-3 text-right">Late</th>
                      <th className="py-2 text-right">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ay.terms.map((t) => (
                      <tr
                        key={t.termNumber}
                        className="border-b border-hairline last:border-0"
                      >
                        <td className="py-2 pr-3 font-medium text-foreground">
                          T{t.termNumber}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.schoolDays ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.daysPresent ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums">
                          {t.daysLate ?? '—'}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {fmtPercentage(t.daysPresent, t.schoolDays)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Quick actions — three cross-module deep links so the admin can jump from
// "I'm looking at this record" to "I'm editing the enrolment record / chasing
// docs / browsing the student's audit trail" without navigating manually.
// The admissions link is the canonical edit surface for post-enrolment
// stages (KD #51 — Records is read-only, edits live on /admissions/*).
// ──────────────────────────────────────────────────────────────────────────

function QuickActionsStrip({
  enroleeNumber,
  ayCode,
  studentId,
  studentNumber,
}: {
  enroleeNumber: string;
  ayCode: string;
  /** UUID from `public.students.id` — drives the Markbook report-card link. */
  studentId: string;
  /** Stable cross-AY ID per Hard Rule #4 — drives the Attendance per-student link. */
  studentNumber: string;
}) {
  const actions: Array<{
    href: string;
    label: string;
    sublabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      href: `/admissions/applications/${enroleeNumber}?ay=${ayCode}&tab=enrollment`,
      label: 'Open enrolment record',
      sublabel: `Edit post-enrolment stages · ${ayCode}`,
      icon: ExternalLink,
    },
    {
      // Records is cross-year (KD #4) but P-Files is AY-scoped — pass
      // ayCode explicitly so the page looks up the matching AY's
      // _enrolment_status row instead of falling back to currentAy.
      // Without this, a student whose enrolment is in a non-current AY
      // would 404 on P-Files even though their records page renders.
      href: `/p-files/${enroleeNumber}?ay=${ayCode}`,
      label: 'P-Files',
      sublabel: `Documents · renewals · ${ayCode}`,
      icon: FolderOpen,
    },
    {
      href: `/admissions/applications/${enroleeNumber}?ay=${ayCode}&tab=family`,
      label: 'Family details',
      sublabel: 'Edit parents + guardian',
      icon: Users,
    },
    {
      href: `/markbook/report-cards/${studentId}`,
      label: 'Markbook',
      sublabel: 'Report card · per term',
      icon: GraduationCap,
    },
    {
      href: `/attendance/students/${encodeURIComponent(studentNumber)}`,
      label: 'Attendance',
      sublabel: 'Daily ledger · quota',
      icon: CalendarCheck,
    },
  ];
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 rounded-xl border border-border bg-gradient-to-t from-primary/5 to-card px-4 py-3 shadow-xs transition-all hover:border-brand-indigo/40 hover:shadow-brand-tile/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-serif text-[14px] font-semibold leading-tight tracking-tight text-foreground">
                {a.label}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {a.sublabel}
              </p>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Student profile card — personal, ID/travel, application, and learning-needs
// details drawn from the current-AY ApplicationRow. Read-only on Records
// (KD #51); the CardFooter deep-links to the admissions profile tab to edit.
// ──────────────────────────────────────────────────────────────────────────

function FieldItem({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

function StudentProfileCard({
  app,
  status,
  ayCode,
  enrollmentStatus,
}: {
  app: ApplicationRow;
  status: StatusRow | null;
  ayCode: string;
  /** Current `enrollment_status` from the active `section_students` row. */
  enrollmentStatus: PlacementRow['enrollmentStatus'] | null;
}) {
  const hasIdDocs = app.nric || app.passportNumber || app.pass;
  const hasLearningNeeds =
    app.additionalLearningNeeds || app.otherLearningNeeds;
  const religion =
    app.religion === 'Others' && app.religionOther
      ? `Other: ${app.religionOther}`
      : app.religion;
  const howFound =
    app.howDidYouKnowAboutHFSEIS === 'Others' && app.otherSource
      ? `Other: ${app.otherSource}`
      : app.howDidYouKnowAboutHFSEIS;
  const enroleeType = status?.enroleeType ?? app.category;
  const assignedClass =
    [status?.classLevel, status?.classSection].filter(Boolean).join(' ') ||
    null;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Student profile · {ayCode}
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Personal & enrolment details
        </CardTitle>
        <CardAction>
          <ActionTile icon={UserCircle2} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status badges — application outcome vs current operational state */}
        <StudentStatusBadges
          outcome={status?.applicationStatus ?? null}
          state={enrollmentStatus}
        />
        {/* Personal */}
        <div>
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Personal
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {app.preferredName && app.preferredName !== app.firstName && (
              <FieldItem label="Preferred name" value={app.preferredName} />
            )}
            <FieldItem
              label="Date of birth"
              value={formatShort(app.birthDay)}
            />
            <FieldItem label="Gender" value={app.gender} />
            <FieldItem label="Nationality" value={app.nationality} />
            <FieldItem label="Primary language" value={app.primaryLanguage} />
            <FieldItem label="Religion" value={religion} />
          </div>
        </div>

        {/* ID & travel documents */}
        {hasIdDocs && (
          <div className="border-t border-hairline pt-5">
            <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              ID &amp; travel documents
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <FieldItem label="NRIC" value={app.nric} />
              <FieldItem label="Passport no." value={app.passportNumber} />
              {app.passportExpiry && (
                <FieldItem
                  label="Passport expiry"
                  value={formatShort(app.passportExpiry)}
                />
              )}
              <FieldItem label="Pass type" value={app.pass} />
              {app.passExpiry && (
                <FieldItem
                  label="Pass expiry"
                  value={formatShort(app.passExpiry)}
                />
              )}
            </div>
          </div>
        )}

        {/* Application */}
        <div className="border-t border-hairline pt-5">
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Application
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <FieldItem label="Level applied" value={app.levelApplied} />
            {assignedClass && (
              <FieldItem label="Assigned class" value={assignedClass} />
            )}
            <FieldItem label="Category" value={enroleeType} />
            <FieldItem label="Class type" value={app.classType} />
            <FieldItem
              label="Preferred schedule"
              value={app.preferredSchedule}
            />
            <FieldItem label="Previous school" value={app.previousSchool} />
            <FieldItem label="How they found us" value={howFound} />
          </div>
        </div>

        {/* Learning needs */}
        {hasLearningNeeds && (
          <div className="border-t border-hairline pt-5">
            <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Learning needs
            </p>
            <div className="space-y-3">
              {app.additionalLearningNeeds && (
                <DetailRow
                  label="Additional learning needs"
                  value={app.additionalLearningNeeds}
                  icon={Sparkles}
                  tone="warning"
                />
              )}
              {app.otherLearningNeeds && (
                <DetailRow
                  label="Other learning needs"
                  value={app.otherLearningNeeds}
                  icon={Sparkles}
                  tone="warning"
                />
              )}
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2 border-t border-hairline bg-muted/20">
        <EditProfileSheet
          ayCode={ayCode}
          enroleeNumber={app.enroleeNumber}
          initial={buildProfileInitial(app)}
        />
        <Button asChild variant="ghost" size="sm">
          <Link
            href={`/admissions/applications/${app.enroleeNumber}?ay=${ayCode}&tab=profile`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open in admissions
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Post-enrolment checklist — operational stages from `ay{YY}_enrolment_status`
// in pipeline order. Read-only on Records (KD #51); CardFooter links to the
// admissions detail page where the registrar actually flips statuses.
// Each row formats one of the eight stages; missing dates render as "—".
// ──────────────────────────────────────────────────────────────────────────

function PostEnrolmentChecklist({
  status,
  ayCode,
  enroleeNumber,
}: {
  status: StatusRow | null;
  ayCode: string;
  enroleeNumber: string;
}) {
  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Post-enrolment checklist · {ayCode}
          </CardDescription>
          <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
            What still needs to be done
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No status row on file for this AY.
          </p>
        </CardContent>
      </Card>
    );
  }

  const stages: Array<{
    label: string;
    status: string | null;
    sublabel?: string | null;
    updated: string | null;
    updatedBy: string | null;
  }> = [
    {
      label: 'Registration',
      status: status.registrationStatus,
      sublabel: status.registrationPaymentDate
        ? `Paid ${formatShort(status.registrationPaymentDate)}`
        : status.registrationInvoice
          ? `Invoice ${status.registrationInvoice}`
          : null,
      updated: status.registrationUpdatedDate,
      updatedBy: status.registrationUpdatedBy,
    },
    {
      label: 'Documents',
      status: status.documentStatus,
      sublabel: null,
      updated: status.documentUpdatedDate,
      updatedBy: status.documentUpdatedBy,
    },
    {
      label: 'Assessment',
      status: status.assessmentStatus,
      sublabel: status.assessmentSchedule
        ? `Scheduled ${formatShort(status.assessmentSchedule)}`
        : null,
      updated: status.assessmentUpdatedDate,
      updatedBy: status.assessmentUpdatedBy,
    },
    {
      label: 'Contract',
      status: status.contractStatus,
      sublabel: null,
      updated: status.contractUpdatedDate,
      updatedBy: status.contractUpdatedBy,
    },
    {
      label: 'Fees',
      status: status.feeStatus,
      sublabel: status.feePaymentDate
        ? `Paid ${formatShort(status.feePaymentDate)}`
        : status.feeStartDate
          ? `Starts ${formatShort(status.feeStartDate)}`
          : status.feeInvoice
            ? `Invoice ${status.feeInvoice}`
            : null,
      updated: status.feeUpdatedDate,
      updatedBy: status.feeUpdatedBy,
    },
    {
      label: 'Class assignment',
      status: status.classStatus,
      sublabel:
        [status.classLevel, status.classSection].filter(Boolean).join(' · ') ||
        null,
      updated: status.classUpdatedDate,
      updatedBy: status.classUpdatedBy,
    },
    {
      label: 'Supplies',
      status: status.suppliesStatus,
      sublabel: status.suppliesClaimedDate
        ? `Claimed ${formatShort(status.suppliesClaimedDate)}`
        : null,
      updated: status.suppliesUpdatedDate,
      updatedBy: status.suppliesUpdatedBy,
    },
    {
      label: 'Orientation',
      status: status.orientationStatus,
      sublabel: status.orientationScheduleDate
        ? `Scheduled ${formatShort(status.orientationScheduleDate)}`
        : null,
      updated: status.orientationUpdatedDate,
      updatedBy: status.orientationUpdatedBy,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Post-enrolment checklist · {ayCode}
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          What still needs to be done
        </CardTitle>
        <CardAction>
          <ActionTile icon={ClipboardList} />
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-hairline">
          {stages.map((s) => (
            <li
              key={s.label}
              className="relative flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/30"
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 w-1 ${stageStripeClass(s.status)}`}
              />
              <div className="min-w-0 flex-1 pl-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-serif text-sm font-semibold tracking-tight text-foreground">
                    {s.label}
                  </h3>
                  <StageStatusBadge status={s.status} />
                </div>
                {(s.sublabel || s.updated || s.updatedBy) && (
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider tabular-nums text-muted-foreground">
                    {[s.sublabel, s.updated ? formatShort(s.updated) : null]
                      .filter(Boolean)
                      .join(' · ')}
                    {s.updatedBy && (
                      <>
                        {(s.sublabel || s.updated) && (
                          <span className="mx-1">·</span>
                        )}
                        by{' '}
                        <a
                          href={`mailto:${s.updatedBy}`}
                          className="lowercase underline-offset-2 transition-colors hover:text-brand-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/40"
                        >
                          {s.updatedBy}
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="border-t border-hairline bg-muted/20">
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/admissions/applications/${enroleeNumber}?ay=${ayCode}&tab=enrollment`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Edit in admissions
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// Stripe color keyed off the same semantic mapping as <StageStatusBadge> — see
// `components/sis/status-badge.tsx::STAGE_VARIANT`. Keeps the visual language
// consistent across this checklist and the admissions EnrollmentTab.
function stageStripeClass(status: string | null): string {
  const t = (status ?? '').trim();
  if (!t) return 'bg-muted-foreground/30';
  if (
    t === 'Finished' ||
    t === 'Signed' ||
    t === 'Valid' ||
    t === 'Verified' ||
    t === 'Paid' ||
    t === 'Claimed'
  ) {
    return 'bg-brand-mint';
  }
  if (
    t === 'Pending' ||
    t === 'Incomplete' ||
    t === 'Uploaded' ||
    t === 'To follow' ||
    t === 'Unpaid'
  ) {
    return 'bg-brand-amber';
  }
  if (t === 'Rejected' || t === 'Expired') return 'bg-destructive';
  if (t === 'Cancelled' || t === 'Withdrawn') return 'bg-muted-foreground/30';
  return 'bg-brand-indigo';
}

function formatShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Family contact — mother / father / guardian columns. Each parent block is
// rendered only when at least one field is populated; mailto: + tel: links so
// the registrar can reach out without leaving the page. Home address /
// postal / home phone trail underneath.
// ──────────────────────────────────────────────────────────────────────────

function FamilyContactCard({
  app,
  ayCode,
  enroleeNumber,
}: {
  app: ApplicationRow;
  ayCode: string;
  enroleeNumber: string;
}) {
  const blocks: Array<{
    role: string;
    slot: 'father' | 'mother' | 'guardian';
    name: string | null;
    email: string | null;
    mobile: string | null;
    nationality: string | null;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      role: 'Mother',
      slot: 'mother',
      name: app.motherFullName,
      email: app.motherEmail,
      mobile: app.motherMobile,
      nationality: app.motherNationality,
      icon: User,
    },
    {
      role: 'Father',
      slot: 'father',
      name: app.fatherFullName,
      email: app.fatherEmail,
      mobile: app.fatherMobile,
      nationality: app.fatherNationality,
      icon: User,
    },
    {
      role: 'Guardian',
      slot: 'guardian',
      name: app.guardianFullName,
      email: app.guardianEmail,
      mobile: app.guardianMobile,
      nationality: app.guardianNationality,
      icon: ShieldCheck,
    },
  ];
  // Show every parent slot so the registrar can edit (and fill in) any of
  // them — the profile + family are one shared row, editable from Records
  // and Admissions alike (KD #147).
  const hasHome = app.homePhone || app.homeAddress || app.postalCode;

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {blocks.map((b) => {
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
                    {b.name ? (
                      <p className="font-serif text-[14px] font-semibold leading-tight text-foreground">
                        {b.name}
                      </p>
                    ) : (
                      <p className="text-[13px] leading-tight text-muted-foreground">
                        Not on file
                      </p>
                    )}
                  </div>
                  <EditFamilySheet
                    ayCode={ayCode}
                    enroleeNumber={enroleeNumber}
                    parent={b.slot}
                    initial={buildFamilyInitial(app, b.slot)}
                  />
                </div>
                {b.nationality && (
                  <div className="mt-3">
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] uppercase tracking-[0.12em]"
                    >
                      {b.nationality}
                    </Badge>
                  </div>
                )}
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
            {(app.homePhone || app.livingWithWhom) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                {app.homePhone && (
                  <ContactPill
                    href={`tel:${app.homePhone}`}
                    icon={Phone}
                    value={app.homePhone}
                    mono
                  />
                )}
                {app.livingWithWhom && (
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] uppercase tracking-[0.12em]"
                  >
                    Living with · {app.livingWithWhom}
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Pill-style mailto:/tel: link — gradient-tinted leading icon + value.
// Visually weighted enough to read as an action without competing with
// Badge primitives. Reuses brand-indigo tones to stay in the indigo band.
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

// ──────────────────────────────────────────────────────────────────────────
// Service preferences — bus / student care / uniform are stored as 'Yes'/
// 'No' strings on the apps row (per the existing comment in lib/sis/queries.ts).
// Discounts are open-text codes the registrar applied at admissions time.
// ──────────────────────────────────────────────────────────────────────────

function ServicePreferencesCard({
  app,
  status,
}: {
  app: ApplicationRow;
  status: StatusRow | null;
}) {
  const services: Array<{
    label: string;
    value: string | null;
    detail: string | null;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { label: 'School bus', value: app.availSchoolBus, detail: null, icon: Bus },
    {
      label: 'Student care',
      value: app.availStudentCare,
      detail: app.studentCareProgram,
      icon: Sparkles,
    },
    { label: 'Uniform', value: app.availUniform, detail: null, icon: Shirt },
  ];
  const discounts = [app.discount1, app.discount2, app.discount3].filter(
    (d): d is string => !!d && d.trim().length > 0
  );
  const hasAnything =
    services.some((s) => !!s.value) ||
    discounts.length > 0 ||
    !!app.paymentOption ||
    !!status?.enroleeType;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Service preferences
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Services · discounts · billing
        </CardTitle>
        <CardAction>
          <ActionTile icon={Sparkles} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasAnything ? (
          <p className="text-sm text-muted-foreground">
            No service preferences on file.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {services.map((s) => {
                const Icon = s.icon;
                const v = (s.value ?? '').toLowerCase();
                return (
                  <div
                    key={s.label}
                    className="flex items-center gap-3 rounded-xl bg-muted/25 p-3 ring-1 ring-inset ring-border"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        {s.label}
                      </p>
                      {v === 'yes' ? (
                        <Badge variant="success" className="gap-1">
                          <Check className="size-3" />
                          Yes
                        </Badge>
                      ) : v === 'no' ? (
                        <Badge variant="muted" className="gap-1">
                          <X className="size-3" />
                          No
                        </Badge>
                      ) : (
                        <p className="font-mono text-[13px] text-muted-foreground">
                          —
                        </p>
                      )}
                      {v === 'yes' && s.detail && (
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {s.detail}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {(discounts.length > 0 ||
              app.paymentOption ||
              status?.enroleeType) && (
              <div className="grid grid-cols-1 gap-3 border-t border-hairline pt-4 sm:grid-cols-3">
                {status?.enroleeType && (
                  <BillingTile label="Enrolee type" icon={UserCircle2}>
                    <Badge variant="default">{status.enroleeType}</Badge>
                  </BillingTile>
                )}
                {app.paymentOption && (
                  <BillingTile label="Payment option" icon={CreditCard}>
                    <p className="font-serif text-[14px] font-semibold leading-tight text-foreground">
                      {app.paymentOption}
                    </p>
                  </BillingTile>
                )}
                {discounts.length > 0 && (
                  <BillingTile label="Discounts applied" icon={BadgePercent}>
                    <div className="flex flex-wrap gap-1.5">
                      {discounts.map((d, i) => (
                        <Badge key={`${d}-${i}`} variant="default">
                          {d}
                        </Badge>
                      ))}
                    </div>
                  </BillingTile>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Medical & dietary — flag chips for known conditions, free-text details
// underneath. Surfaced on Records so an admin/registrar with the page open
// has the at-a-glance picture without bouncing to admissions for it.
// ──────────────────────────────────────────────────────────────────────────

function MedicalCard({ app }: { app: ApplicationRow }) {
  const flags: Array<{ label: string; on: boolean }> = [
    { label: 'Asthma', on: !!app.asthma },
    { label: 'Allergies', on: !!app.allergies },
    { label: 'Food allergies', on: !!app.foodAllergies },
    { label: 'Heart condition', on: !!app.heartConditions },
    { label: 'Epilepsy', on: !!app.epilepsy },
    { label: 'Eczema', on: !!app.eczema },
    { label: 'Diabetes', on: !!app.diabetes },
  ];
  const positiveFlags = flags.filter((f) => f.on);
  const hasDetails =
    !!app.allergyDetails ||
    !!app.foodAllergyDetails ||
    !!app.dietaryRestrictions ||
    !!app.otherMedicalConditions;
  const hasAnything =
    positiveFlags.length > 0 || hasDetails || app.paracetamolConsent !== null;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Medical · dietary
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Health profile
        </CardTitle>
        <CardAction>
          <ActionTile icon={Stethoscope} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasAnything ? (
          <p className="text-sm text-muted-foreground">
            No medical or dietary notes on file.
          </p>
        ) : (
          <>
            {positiveFlags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {positiveFlags.map((f) => (
                  <Badge key={f.label} variant="blocked" className="gap-1">
                    <AlertTriangle className="size-3" />
                    {f.label}
                  </Badge>
                ))}
              </div>
            )}
            {hasDetails && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {app.allergyDetails && (
                  <DetailRow
                    label="Allergy details"
                    value={app.allergyDetails}
                    icon={AlertTriangle}
                    tone="destructive"
                  />
                )}
                {app.foodAllergyDetails && (
                  <DetailRow
                    label="Food allergy details"
                    value={app.foodAllergyDetails}
                    icon={Utensils}
                    tone="destructive"
                  />
                )}
                {app.dietaryRestrictions && (
                  <DetailRow
                    label="Dietary restrictions"
                    value={app.dietaryRestrictions}
                    icon={Utensils}
                    tone="warning"
                  />
                )}
                {app.otherMedicalConditions && (
                  <DetailRow
                    label="Other conditions"
                    value={app.otherMedicalConditions}
                    icon={Stethoscope}
                    tone="destructive"
                  />
                )}
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-hairline pt-3 text-[13px]">
              <Pill className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Paracetamol consent
              </span>
              {app.paracetamolConsent === true ? (
                <Badge variant="success" className="gap-1">
                  <Check className="size-3" />
                  Granted
                </Badge>
              ) : app.paracetamolConsent === false ? (
                <Badge variant="blocked" className="gap-1">
                  <X className="size-3" />
                  Withheld
                </Badge>
              ) : (
                <Badge variant="muted">Not specified</Badge>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Tinted detail block — small leading icon tile + mono uppercase label +
// long-form value. The tile color shifts by `tone` so dietary notes (amber)
// read distinctly from medical conditions (destructive).
function DetailRow({
  label,
  value,
  icon: Icon,
  tone = 'destructive',
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'destructive' | 'warning';
}) {
  const tileClass =
    tone === 'warning'
      ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber'
      : 'bg-gradient-to-br from-destructive to-destructive/80 text-white shadow-brand-tile-destructive';
  return (
    <div className="rounded-xl bg-muted/25 p-3 ring-1 ring-inset ring-border">
      <div className="flex items-start gap-3">
        {Icon && (
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tileClass}`}
          >
            <Icon className="size-3.5" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <p className="text-[13px] leading-relaxed text-foreground">{value}</p>
        </div>
      </div>
    </div>
  );
}

// Form Class Adviser term comments per AY — rendered inside the Academic tab
// after each AY's grade table. Returns null when no writeups have content so
// AYs with no FCA data don't render an empty card.
function FcaCommentsCard({
  ayCode,
  writeups,
}: {
  ayCode: string;
  writeups: EvaluationWriteupEntry[];
}) {
  const hasAny = writeups.some((w) => w.writeup);
  if (!hasAny) return null;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Form Class Adviser · {ayCode}
        </CardDescription>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Term comments
        </CardTitle>
        <CardAction>
          <ActionTile icon={ClipboardList} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {writeups.map((w) => (
          <div key={w.termNumber} className="space-y-1.5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {w.termLabel}
              {w.virtueTheme && (
                <span className="font-normal">
                  {' '}
                  · HFSE Virtues: {w.virtueTheme}
                </span>
              )}
            </p>
            {w.writeup ? (
              <p className="text-sm leading-relaxed text-foreground">
                {w.writeup}
              </p>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                No comments recorded
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Document status strip — compact at-a-glance tally of P-Files document
// completeness. Counts Valid / needs-renewal (Expired|Rejected) / missing
// slots across the 13 DOCUMENT_SLOTS and links through to /p-files.
// Rendered above QuickActionsStrip so the registrar sees the document health
// without opening a separate module.
// ──────────────────────────────────────────────────────────────────────────

function DocumentStatusStrip({
  documents,
  enroleeNumber,
  ayCode,
}: {
  documents: DocumentSlot[];
  enroleeNumber: string;
  ayCode: string;
}) {
  let valid = 0;
  let needsRenewal = 0;
  let pending = 0;
  let missing = 0;

  for (const slot of documents) {
    if (slot.status === 'Valid') valid++;
    else if (slot.status === 'Expired' || slot.status === 'Rejected')
      needsRenewal++;
    else if (slot.status === 'Uploaded' || slot.status === 'To follow')
      pending++;
    else missing++;
  }

  const total = documents.length;
  const allValid = valid === total;

  const state = needsRenewal > 0 ? 'warn' : allValid ? 'ok' : 'info';

  const cardBg = {
    ok: 'border-brand-mint/30 bg-gradient-to-r from-brand-mint/10 to-card',
    warn: 'border-brand-amber/30 bg-gradient-to-r from-brand-amber/10 to-card',
    info: 'border-hairline bg-gradient-to-t from-primary/5 to-card',
  }[state];

  const iconCraft = {
    ok: 'bg-gradient-to-br from-brand-mint to-brand-mint/60 text-ink shadow-brand-tile-mint',
    warn: 'bg-gradient-to-br from-brand-amber to-brand-amber/70 text-ink shadow-brand-tile-amber',
    info: 'bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile',
  }[state];

  const StateIcon = { ok: ShieldCheck, warn: AlertTriangle, info: FolderOpen }[
    state
  ];

  return (
    <Link
      href={`/p-files/${enroleeNumber}?ay=${ayCode}`}
      className={`group flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-all hover:-translate-y-px hover:shadow-md ${cardBg}`}
    >
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${iconCraft}`}
      >
        <StateIcon className="size-4" aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Documents · {total} slots
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
          {allValid ? (
            <span className="font-semibold text-foreground">
              All documents on file
            </span>
          ) : (
            <>
              <span className="tabular-nums">
                <span className="font-semibold text-foreground">{valid}</span>{' '}
                <span className="text-muted-foreground">valid</span>
              </span>
              {needsRenewal > 0 && (
                <span className="font-semibold tabular-nums text-brand-amber">
                  {needsRenewal} need renewal
                </span>
              )}
              {pending > 0 && (
                <span className="tabular-nums text-muted-foreground">
                  {pending} pending
                </span>
              )}
              {missing > 0 && (
                <span className="tabular-nums text-muted-foreground">
                  {missing} missing
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-50 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
    </Link>
  );
}

// Billing tile — mirrors the ServicePreferencesCard service tile layout
// (gradient icon + label + value). One tile per Enrolee type / Payment /
// Discounts so the bottom strip reads as a row of peers, not a text list.
function BillingTile({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-muted/25 p-3 ring-1 ring-inset ring-border">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}
