import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ClipboardList, ExternalLink, FileText } from 'lucide-react';

import { ApplicationStatusBadge, StageStatusBadge } from '@/components/sis/status-badge';
import { DocumentValidationActions } from '@/components/sis/document-validation-actions';
import { EditFamilySheet } from '@/components/sis/edit-family-sheet';
import { EditProfileSheet } from '@/components/sis/edit-profile-sheet';
import { EditStageDialog } from '@/components/sis/edit-stage-dialog';
import { EnrollmentHistoryChips } from '@/components/sis/enrollment-history-chips';
import { SisEmptyState } from '@/components/sis/empty-state';
import { FieldGrid, FieldSectionsCard, type Field } from '@/components/sis/field-grid';
import { StudentAttendanceTab } from '@/components/sis/student-attendance-tab';
import { CompassionateAllowanceInline } from '@/components/sis/compassionate-allowance-inline';
import type { ParentSlot, ProfileUpdateInput, StageKey } from '@/lib/schemas/sis';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCurrentAcademicYear, listAyCodes } from '@/lib/academic-year';
import { getEnrollmentHistory, getStudentDetail, type ApplicationRow, type DocumentSlot, type StatusRow } from '@/lib/sis/queries';
import { getSessionUser } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export default async function SisStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ enroleeNumber: string }>;
  searchParams: Promise<{ ay?: string; tab?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (
    sessionUser.role !== 'admissions' &&
    sessionUser.role !== 'registrar' &&
    sessionUser.role !== 'school_admin' &&
    sessionUser.role !== 'admin' &&
    sessionUser.role !== 'superadmin'
  ) {
    redirect('/');
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

  const detail = await getStudentDetail(selectedAy, enroleeNumber);
  if (!detail) notFound();

  const { application, status, documents } = detail;

  const history = application.studentNumber
    ? await getEnrollmentHistory(application.studentNumber)
    : [];

  // Look up the student's compassionate-leave allowance from the grading
  // schema (via studentNumber). Null when the student hasn't been synced yet
  // or has no studentNumber — disables the inline editor with a reason.
  let allowance: number | null = null;
  let allowanceDisabledReason: string | null = null;
  if (application.studentNumber) {
    const { data: stu } = await service
      .from('students')
      .select('urgent_compassionate_allowance')
      .eq('student_number', application.studentNumber)
      .maybeSingle();
    if (stu) {
      allowance = (stu as { urgent_compassionate_allowance: number | null })
        .urgent_compassionate_allowance ?? 5;
    } else {
      allowanceDisabledReason = 'Not yet synced to grading schema';
    }
  } else {
    allowanceDisabledReason = 'No studentNumber assigned yet';
  }

  const fullName =
    application.enroleeFullName ??
    [application.lastName, application.firstName, application.middleName].filter(Boolean).join(' ') ??
    '(no name on file)';

  const tab = ['profile', 'family', 'enrollment', 'documents', 'attendance'].includes(tabParam ?? '')
    ? (tabParam as 'profile' | 'family' | 'enrollment' | 'documents' | 'attendance')
    : 'profile';

  return (
    <PageShell>
      <Link
        href={{ pathname: '/admissions/applications', query: { ay: selectedAy } }}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Students · {selectedAy}
      </Link>

      <header className="space-y-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Admissions · Application
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <h1 className="font-serif text-[34px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[40px]">
              {fullName}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>Enrolee {application.enroleeNumber}</span>
              {application.studentNumber && <span>Student {application.studentNumber}</span>}
              {(status?.classLevel || status?.classSection) && (
                <span>{[status?.classLevel, status?.classSection].filter(Boolean).join(' · ')}</span>
              )}
            </div>
          </div>
          <ApplicationStatusBadge status={status?.applicationStatus ?? null} />
        </div>
      </header>

      {history.length > 1 && <EnrollmentHistoryChips history={history} currentAyCode={selectedAy} />}

      <Tabs defaultValue={tab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="family">Family</TabsTrigger>
          <TabsTrigger value="enrollment">Enrollment</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
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
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-6">
          <DocumentsTab documents={documents} enroleeNumber={application.enroleeNumber} ayCode={selectedAy} />
        </TabsContent>

        <TabsContent value="attendance" className="space-y-6">
          <StudentAttendanceTab studentNumber={application.studentNumber} fullName={fullName} />
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
    firstName: app.firstName, middleName: app.middleName, lastName: app.lastName,
    preferredName: app.preferredName, enroleeFullName: app.enroleeFullName,
    category: app.category, nric: app.nric, birthDay: app.birthDay,
    gender: app.gender, nationality: app.nationality, primaryLanguage: app.primaryLanguage,
    religion: app.religion, religionOther: app.religionOther,
    passportNumber: app.passportNumber, passportExpiry: app.passportExpiry,
    pass: app.pass, passExpiry: app.passExpiry,
    homePhone: app.homePhone, homeAddress: app.homeAddress, postalCode: app.postalCode,
    livingWithWhom: app.livingWithWhom, contactPerson: app.contactPerson,
    contactPersonNumber: app.contactPersonNumber, parentMaritalStatus: app.parentMaritalStatus,
    levelApplied: app.levelApplied, preferredSchedule: app.preferredSchedule,
    classType: app.classType, paymentOption: app.paymentOption,
    availSchoolBus: app.availSchoolBus, availStudentCare: app.availStudentCare,
    studentCareProgram: app.studentCareProgram, availUniform: app.availUniform,
    additionalLearningNeeds: app.additionalLearningNeeds,
    otherLearningNeeds: app.otherLearningNeeds, previousSchool: app.previousSchool,
    howDidYouKnowAboutHFSEIS: app.howDidYouKnowAboutHFSEIS, otherSource: app.otherSource,
    referrerName: app.referrerName, referrerMobile: app.referrerMobile,
    contractSignatory: app.contractSignatory,
    discount1: app.discount1, discount2: app.discount2, discount3: app.discount3,
  };

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="flex justify-end">
          <EditProfileSheet ayCode={ayCode} enroleeNumber={enroleeNumber} initial={initial} />
        </div>
        <CompassionateAllowanceInline
          enroleeNumber={enroleeNumber}
          initial={allowance}
          disabled={!!allowanceDisabledReason}
          disabledReason={allowanceDisabledReason ?? undefined}
        />
        <FieldSectionsCard
          sections={[
            {
              title: 'Identity',
              fields: [
                { label: 'Category', value: app.category },
                { label: 'Preferred name', value: app.preferredName },
                { label: 'NRIC / FIN', value: app.nric },
                { label: 'Date of birth', value: app.birthDay, asDate: true },
                { label: 'Gender', value: app.gender },
                { label: 'Nationality', value: app.nationality },
                { label: 'Religion', value: app.religion ?? app.religionOther },
                { label: 'Primary language', value: app.primaryLanguage },
              ],
            },
            {
              title: 'Travel documents',
              fields: [
                { label: 'Passport number', value: app.passportNumber },
                { label: 'Passport expiry', value: app.passportExpiry, asDate: true },
                { label: 'Pass type', value: app.pass },
                { label: 'Pass expiry', value: app.passExpiry, asDate: true },
              ],
            },
            {
              title: 'Contact',
              fields: [
                { label: 'Home phone', value: app.homePhone },
                { label: 'Home address', value: app.homeAddress, wide: true },
                { label: 'Postal code', value: app.postalCode },
                { label: 'Living with', value: app.livingWithWhom },
                { label: 'Contact person', value: app.contactPerson },
                { label: 'Contact number', value: app.contactPersonNumber },
                { label: 'Parent marital status', value: app.parentMaritalStatus },
              ],
            },
            {
              title: 'Application preferences',
              fields: [
                { label: 'Level applied', value: app.levelApplied },
                { label: 'Preferred schedule', value: app.preferredSchedule },
                { label: 'Class type', value: app.classType },
                { label: 'Payment option', value: app.paymentOption },
                { label: 'School bus', value: app.availSchoolBus },
                { label: 'Student care', value: app.availStudentCare },
                { label: 'Student care program', value: app.studentCareProgram },
                { label: 'Uniform', value: app.availUniform },
                { label: 'Additional learning needs', value: app.additionalLearningNeeds, wide: true, multiline: true },
                { label: 'Other learning needs', value: app.otherLearningNeeds, wide: true, multiline: true },
                { label: 'Previous school', value: app.previousSchool },
                { label: 'Referral source', value: app.howDidYouKnowAboutHFSEIS },
                { label: 'Other source', value: app.otherSource },
                { label: 'Referrer name', value: app.referrerName },
                { label: 'Referrer mobile', value: app.referrerMobile },
                { label: 'Contract signatory', value: app.contractSignatory },
              ],
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function FamilyTab({
  app,
  ayCode,
  enroleeNumber,
}: {
  app: ApplicationRow;
  ayCode: string;
  enroleeNumber: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <ParentCard
        title="Father"
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        parentSlot="father"
        initial={{
          fatherFullName: app.fatherFullName, fatherFirstName: app.fatherFirstName, fatherLastName: app.fatherLastName,
          fatherNric: app.fatherNric, fatherBirthDay: app.fatherBirthDay,
          fatherMobile: app.fatherMobile, fatherEmail: app.fatherEmail, fatherNationality: app.fatherNationality,
          fatherCompanyName: app.fatherCompanyName, fatherPosition: app.fatherPosition,
          fatherPassport: app.fatherPassport, fatherPassportExpiry: app.fatherPassportExpiry,
          fatherPass: app.fatherPass, fatherPassExpiry: app.fatherPassExpiry,
          fatherWhatsappTeamsConsent: app.fatherWhatsappTeamsConsent,
        }}
        fields={[
          { label: 'Full name', value: app.fatherFullName },
          { label: 'NRIC / FIN', value: app.fatherNric },
          { label: 'Date of birth', value: app.fatherBirthDay, asDate: true },
          { label: 'Mobile', value: app.fatherMobile },
          { label: 'Email', value: app.fatherEmail, wide: true },
          { label: 'Nationality', value: app.fatherNationality },
          { label: 'Company', value: app.fatherCompanyName },
          { label: 'Position', value: app.fatherPosition },
          { label: 'Passport', value: app.fatherPassport },
          { label: 'Passport expiry', value: app.fatherPassportExpiry, asDate: true },
          { label: 'Pass type', value: app.fatherPass },
          { label: 'Pass expiry', value: app.fatherPassExpiry, asDate: true },
          { label: 'WhatsApp / Teams consent', value: app.fatherWhatsappTeamsConsent },
        ]}
      />
      <ParentCard
        title="Mother"
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        parentSlot="mother"
        initial={{
          motherFullName: app.motherFullName, motherFirstName: app.motherFirstName, motherLastName: app.motherLastName,
          motherNric: app.motherNric, motherBirthDay: app.motherBirthDay,
          motherMobile: app.motherMobile, motherEmail: app.motherEmail, motherNationality: app.motherNationality,
          motherCompanyName: app.motherCompanyName, motherPosition: app.motherPosition,
          motherPassport: app.motherPassport, motherPassportExpiry: app.motherPassportExpiry,
          motherPass: app.motherPass, motherPassExpiry: app.motherPassExpiry,
          motherWhatsappTeamsConsent: app.motherWhatsappTeamsConsent,
        }}
        fields={[
          { label: 'Full name', value: app.motherFullName },
          { label: 'NRIC / FIN', value: app.motherNric },
          { label: 'Date of birth', value: app.motherBirthDay, asDate: true },
          { label: 'Mobile', value: app.motherMobile },
          { label: 'Email', value: app.motherEmail, wide: true },
          { label: 'Nationality', value: app.motherNationality },
          { label: 'Company', value: app.motherCompanyName },
          { label: 'Position', value: app.motherPosition },
          { label: 'Passport', value: app.motherPassport },
          { label: 'Passport expiry', value: app.motherPassportExpiry, asDate: true },
          { label: 'Pass type', value: app.motherPass },
          { label: 'Pass expiry', value: app.motherPassExpiry, asDate: true },
          { label: 'WhatsApp / Teams consent', value: app.motherWhatsappTeamsConsent },
        ]}
      />
      <ParentCard
        title="Guardian"
        ayCode={ayCode}
        enroleeNumber={enroleeNumber}
        parentSlot="guardian"
        initial={{
          guardianFullName: app.guardianFullName, guardianMobile: app.guardianMobile, guardianEmail: app.guardianEmail,
          guardianNationality: app.guardianNationality,
          guardianPassport: app.guardianPassport, guardianPassportExpiry: app.guardianPassportExpiry,
          guardianPass: app.guardianPass, guardianPassExpiry: app.guardianPassExpiry,
          guardianWhatsappTeamsConsent: app.guardianWhatsappTeamsConsent,
        }}
        fields={[
          { label: 'Full name', value: app.guardianFullName },
          { label: 'Mobile', value: app.guardianMobile },
          { label: 'Email', value: app.guardianEmail, wide: true },
          { label: 'Nationality', value: app.guardianNationality },
          { label: 'Passport', value: app.guardianPassport },
          { label: 'Passport expiry', value: app.guardianPassportExpiry, asDate: true },
          { label: 'Pass type', value: app.guardianPass },
          { label: 'Pass expiry', value: app.guardianPassExpiry, asDate: true },
          { label: 'WhatsApp / Teams consent', value: app.guardianWhatsappTeamsConsent },
        ]}
        muted
      />
    </div>
  );
}

function ParentCard({
  title,
  fields,
  muted,
  ayCode,
  enroleeNumber,
  parentSlot,
  initial,
}: {
  title: string;
  fields: Field[];
  muted?: boolean;
  ayCode: string;
  enroleeNumber: string;
  parentSlot: ParentSlot;
  initial: Record<string, unknown>;
}) {
  const allEmpty = fields.every((f) => {
    if (typeof f.value === 'boolean') return f.value === null;
    return f.value === null || f.value === undefined || (typeof f.value === 'string' && f.value.trim() === '');
  });
  return (
    <Card className={muted ? 'bg-muted/20' : undefined}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="font-serif text-base font-semibold">{title}</CardTitle>
        <EditFamilySheet
          ayCode={ayCode}
          enroleeNumber={enroleeNumber}
          parent={parentSlot}
          initial={initial}
        />
      </CardHeader>
      <CardContent>
        {allEmpty ? (
          <p className="text-sm text-muted-foreground">No {title.toLowerCase()} on file. Click Edit to add details.</p>
        ) : (
          <FieldGrid fields={fields} />
        )}
      </CardContent>
    </Card>
  );
}

function EnrollmentTab({
  status,
  app,
  ayCode,
  enroleeNumber,
}: {
  status: StatusRow | null;
  app: ApplicationRow;
  ayCode: string;
  enroleeNumber: string;
}) {
  if (!status) {
    return (
      <SisEmptyState
        icon={ClipboardList}
        title="No enrollment pipeline yet."
        body="The registrar hasn't opened any stages for this enrolee. Once they do, each stage's status, remarks, and history appear here."
      />
    );
  }

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
      key: 'application', label: 'Application',
      status: status.applicationStatus, remarks: status.applicationRemarks,
      updatedAt: status.applicationUpdatedDate, updatedBy: status.applicationUpdatedBy,
      extras: [
        { label: 'Enrolment date', value: status.enrolmentDate, asDate: true },
        { label: 'Enrolee type', value: status.enroleeType },
      ],
      extrasInitial: {},
    },
    {
      key: 'registration', label: 'Registration',
      status: status.registrationStatus, remarks: status.registrationRemarks,
      updatedAt: status.registrationUpdatedDate, updatedBy: status.registrationUpdatedBy,
      extras: [
        { label: 'Invoice', value: status.registrationInvoice },
        { label: 'Payment date', value: status.registrationPaymentDate, asDate: true },
      ],
      extrasInitial: {
        invoice: status.registrationInvoice,
        paymentDate: status.registrationPaymentDate,
      },
    },
    {
      key: 'documents', label: 'Documents',
      status: status.documentStatus, remarks: status.documentRemarks,
      updatedAt: status.documentUpdatedDate, updatedBy: status.documentUpdatedBy,
      extrasInitial: {},
    },
    {
      key: 'assessment', label: 'Assessment',
      status: status.assessmentStatus, remarks: status.assessmentRemarks,
      updatedAt: status.assessmentUpdatedDate, updatedBy: status.assessmentUpdatedBy,
      extras: [
        { label: 'Schedule', value: status.assessmentSchedule, asDate: true },
        { label: 'Math', value: status.assessmentGradeMath as string | number | null },
        { label: 'English', value: status.assessmentGradeEnglish as string | number | null },
        { label: 'Medical', value: status.assessmentMedical },
      ],
      extrasInitial: {
        schedule: status.assessmentSchedule,
        math: status.assessmentGradeMath != null ? String(status.assessmentGradeMath) : null,
        english: status.assessmentGradeEnglish != null ? String(status.assessmentGradeEnglish) : null,
        medical: status.assessmentMedical,
      },
    },
    {
      key: 'contract', label: 'Contract',
      status: status.contractStatus, remarks: status.contractRemarks,
      updatedAt: status.contractUpdatedDate, updatedBy: status.contractUpdatedBy,
      extrasInitial: {},
    },
    {
      key: 'fees', label: 'Fees',
      status: status.feeStatus, remarks: status.feeRemarks,
      updatedAt: status.feeUpdatedDate, updatedBy: status.feeUpdatedBy,
      extras: [
        { label: 'Invoice', value: status.feeInvoice },
        { label: 'Payment date', value: status.feePaymentDate, asDate: true },
        { label: 'Start date', value: status.feeStartDate, asDate: true },
      ],
      extrasInitial: {
        invoice: status.feeInvoice,
        paymentDate: status.feePaymentDate,
        startDate: status.feeStartDate,
      },
    },
    {
      key: 'class', label: 'Class assignment',
      status: status.classStatus, remarks: status.classRemarks,
      updatedAt: status.classUpdatedDate, updatedBy: status.classUpdatedBy,
      extras: [
        { label: 'Class AY', value: status.classAY },
        { label: 'Level', value: status.classLevel },
        { label: 'Section', value: status.classSection },
      ],
      extrasInitial: {
        classAY: status.classAY,
        classLevel: status.classLevel,
        classSection: status.classSection,
      },
    },
    {
      key: 'supplies', label: 'Supplies',
      status: status.suppliesStatus, remarks: status.suppliesRemarks,
      updatedAt: status.suppliesUpdatedDate, updatedBy: status.suppliesUpdatedBy,
      extras: [{ label: 'Claimed date', value: status.suppliesClaimedDate, asDate: true }],
      extrasInitial: { claimedDate: status.suppliesClaimedDate },
    },
    {
      key: 'orientation', label: 'Orientation',
      status: status.orientationStatus, remarks: status.orientationRemarks,
      updatedAt: status.orientationUpdatedDate, updatedBy: status.orientationUpdatedBy,
      extras: [{ label: 'Schedule', value: status.orientationScheduleDate, asDate: true }],
      extrasInitial: { scheduleDate: status.orientationScheduleDate },
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-serif text-lg font-semibold">Enrollment pipeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          <ol className="space-y-4">
            {stages.map((stage, i) => (
              <li
                key={stage.key}
                className="grid gap-4 border-b border-hairline pb-4 last:border-0 last:pb-0 sm:grid-cols-[120px_1fr]"
              >
                <div className="flex items-start gap-3 sm:flex-col sm:gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Step {i + 1}
                  </span>
                  <span className="font-serif text-sm font-semibold text-foreground">{stage.label}</span>
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StageStatusBadge status={stage.status} />
                    {stage.updatedAt && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {new Date(stage.updatedAt).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {stage.updatedBy && <span className="ml-2 normal-case text-muted-foreground/80">by {stage.updatedBy}</span>}
                      </span>
                    )}
                    <div className="ml-auto">
                      <EditStageDialog
                        ayCode={ayCode}
                        enroleeNumber={enroleeNumber}
                        stageKey={stage.key}
                        initialStatus={stage.status}
                        initialRemarks={stage.remarks}
                        initialExtras={stage.extrasInitial}
                      />
                    </div>
                  </div>
                  {stage.extras && stage.extras.some((e) => !isFieldEmpty(e)) && (
                    <FieldGrid fields={stage.extras} />
                  )}
                  {stage.remarks && (
                    <p className="whitespace-pre-line rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground">
                      {stage.remarks}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-base font-semibold">Medical</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid
              fields={[
                { label: 'Asthma', value: app.asthma },
                { label: 'Allergies', value: app.allergies },
                { label: 'Allergy details', value: app.allergyDetails, wide: true, multiline: true },
                { label: 'Food allergies', value: app.foodAllergies },
                { label: 'Food allergy details', value: app.foodAllergyDetails, wide: true, multiline: true },
                { label: 'Heart conditions', value: app.heartConditions },
                { label: 'Epilepsy', value: app.epilepsy },
                { label: 'Eczema', value: app.eczema },
                { label: 'Diabetes', value: app.diabetes },
                { label: 'Paracetamol consent', value: app.paracetamolConsent },
                { label: 'Other conditions', value: app.otherMedicalConditions, wide: true, multiline: true },
                { label: 'Dietary restrictions', value: app.dietaryRestrictions, wide: true },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="font-serif text-base font-semibold">Discounts &amp; consents</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid
              fields={[
                { label: 'Discount 1', value: app.discount1 },
                { label: 'Discount 2', value: app.discount2 },
                { label: 'Discount 3', value: app.discount3 },
                { label: 'Social media consent', value: app.socialMediaConsent },
                { label: 'Feedback consent', value: app.feedbackConsent },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function isFieldEmpty(f: Field): boolean {
  if (typeof f.value === 'boolean') return false;
  return f.value === null || f.value === undefined || (typeof f.value === 'string' && f.value.trim() === '');
}

function DocumentsTab({
  documents,
  enroleeNumber,
  ayCode,
}: {
  documents: DocumentSlot[];
  enroleeNumber: string;
  ayCode: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg font-semibold">Documents on file</CardTitle>
        <p className="text-sm text-muted-foreground">
          Approve or reject each upload. Replacements and revision history live in P-Files.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {documents.map((doc) => {
            const onFile = !!doc.url;
            return (
              <li
                key={doc.key}
                className="flex items-start gap-3 rounded-xl border border-hairline bg-card p-4"
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
                      Expires {new Date(doc.expiry).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {onFile && doc.url && (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-indigo-deep underline transition-colors hover:text-brand-indigo"
                      >
                        View file
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                    <Link
                      href={`/p-files/${enroleeNumber}#slot-${doc.key}`}
                      className="inline-flex items-center gap-1 text-muted-foreground underline transition-colors hover:text-foreground"
                    >
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
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
