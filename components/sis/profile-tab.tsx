import { Globe, Heart, Phone, Tags, User, type LucideIcon } from 'lucide-react';

import { EditProfileSheet } from '@/components/sis/edit-profile-sheet';
import { FieldGrid, type Field } from '@/components/sis/field-grid';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  paymentMethodLabel,
  paymentSchemeLabel,
  type ProfileUpdateInput,
} from '@/lib/schemas/sis';
import { isFieldEmpty } from '@/lib/sis/field-helpers';
import type { ApplicationRow } from '@/lib/sis/queries';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// ProfileTab — applicant identity, contact, and preferences.
//
// Hero strip surfaces the at-a-glance facts (name, category, level, pass)
// plus a total fields-filled progress bar. Below that, four section cards
// (Identity / Travel / Contact / Preferences) sit in a 2×2 grid (lg+) with
// gradient icon tiles and per-section completion badges. Empty fields are
// dimmed via `<FieldGrid dimEmpty />` so eyes skip past missing data.
//
// Compassionate-leave quota editor was moved off this tab — quota is
// enrolled-student metadata (lives on `public.students`) and now belongs
// on Records / Attendance per the practical rule + KD #51.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  app: ApplicationRow;
  ayCode: string;
  enroleeNumber: string;
};

export function ProfileTab({ app, ayCode, enroleeNumber }: Props) {
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
    availStudentCare:
      app.availStudentCare as ProfileUpdateInput['availStudentCare'],
    studentCareProgram: app.studentCareProgram,
    availUniform: app.availUniform as ProfileUpdateInput['availUniform'],
    additionalLearningNeeds: app.additionalLearningNeeds,
    otherLearningNeeds: app.otherLearningNeeds,
    previousSchool: app.previousSchool,
    howDidYouKnowAboutHFSEIS: app.howDidYouKnowAboutHFSEIS,
    otherSource: app.otherSource,
    marketingReferrerName: app.marketingReferrerName,
    referrerName: app.referrerName,
    referrerMobile: app.referrerMobile,
    contractSignatory: app.contractSignatory,
    preferredPaymentScheme: app.preferredPaymentScheme,
    preferredPaymentMethod: app.preferredPaymentMethod,
    discount1: app.discount1,
    discount2: app.discount2,
    discount3: app.discount3,
    siblingFullName1: app.siblingFullName1,
    siblingBirthDay1: app.siblingBirthDay1,
    siblingReligion1: app.siblingReligion1,
    siblingEducationOccupation1: app.siblingEducationOccupation1,
    siblingSchoolCompany1: app.siblingSchoolCompany1,
    siblingFullName2: app.siblingFullName2,
    siblingBirthDay2: app.siblingBirthDay2,
    siblingReligion2: app.siblingReligion2,
    siblingEducationOccupation2: app.siblingEducationOccupation2,
    siblingSchoolCompany2: app.siblingSchoolCompany2,
    siblingFullName3: app.siblingFullName3,
    siblingBirthDay3: app.siblingBirthDay3,
    siblingReligion3: app.siblingReligion3,
    siblingEducationOccupation3: app.siblingEducationOccupation3,
    siblingSchoolCompany3: app.siblingSchoolCompany3,
    siblingFullName4: app.siblingFullName4,
    siblingBirthDay4: app.siblingBirthDay4,
    siblingReligion4: app.siblingReligion4,
    siblingEducationOccupation4: app.siblingEducationOccupation4,
    siblingSchoolCompany4: app.siblingSchoolCompany4,
    siblingFullName5: app.siblingFullName5,
    siblingBirthDay5: app.siblingBirthDay5,
    siblingReligion5: app.siblingReligion5,
    siblingEducationOccupation5: app.siblingEducationOccupation5,
    siblingSchoolCompany5: app.siblingSchoolCompany5,
  };

  const identityFields: Field[] = [
    { label: 'Category', value: app.category },
    { label: 'Preferred name', value: app.preferredName },
    { label: 'NRIC / FIN', value: app.nric },
    { label: 'Date of birth', value: app.birthDay, asDate: true },
    { label: 'Gender', value: app.gender },
    { label: 'Nationality', value: app.nationality },
    { label: 'Religion', value: app.religion ?? app.religionOther },
    { label: 'Primary language', value: app.primaryLanguage },
  ];
  const travelFields: Field[] = [
    { label: 'Passport number', value: app.passportNumber, sensitive: true },
    { label: 'Passport expiry', value: app.passportExpiry, asDate: true },
    { label: 'Pass type', value: app.pass, sensitive: true },
    { label: 'Pass expiry', value: app.passExpiry, asDate: true },
  ];
  const contactFields: Field[] = [
    { label: 'Home phone', value: app.homePhone },
    { label: 'Home address', value: app.homeAddress, wide: true },
    { label: 'Postal code', value: app.postalCode },
    { label: 'Living with', value: app.livingWithWhom },
    { label: 'Contact person', value: app.contactPerson },
    { label: 'Contact number', value: app.contactPersonNumber },
    { label: 'Parent marital status', value: app.parentMaritalStatus },
  ];
  const preferencesFields: Field[] = [
    { label: 'Level applied', value: app.levelApplied },
    { label: 'Preferred schedule', value: app.preferredSchedule },
    { label: 'Class type', value: app.classType },
    { label: 'Payment option', value: app.paymentOption },
    {
      label: 'Payment scheme',
      value: paymentSchemeLabel(app.preferredPaymentScheme),
    },
    {
      label: 'Payment method',
      value: paymentMethodLabel(app.preferredPaymentMethod),
    },
    { label: 'School bus', value: app.availSchoolBus },
    { label: 'Student care', value: app.availStudentCare },
    { label: 'Student care program', value: app.studentCareProgram },
    { label: 'Uniform', value: app.availUniform },
    {
      label: 'Additional learning needs',
      value: app.additionalLearningNeeds,
      wide: true,
      multiline: true,
    },
    {
      label: 'Other learning needs',
      value: app.otherLearningNeeds,
      wide: true,
      multiline: true,
    },
    { label: 'Previous school', value: app.previousSchool },
    { label: 'Referral source', value: app.howDidYouKnowAboutHFSEIS },
    { label: 'Other source', value: app.otherSource },
    // "How did you know about HFSE" attribution — distinct from the
    // referrerName/referrerMobile pair below, which is a discount-code
    // referral (unrelated concept).
    { label: 'Referral name', value: app.marketingReferrerName },
    { label: 'Referrer name (discount code)', value: app.referrerName },
    { label: 'Referrer mobile (discount code)', value: app.referrerMobile },
    { label: 'Contract signatory', value: app.contractSignatory },
  ];

  // Medical flags — boolean conditions reported on the application.
  const medicalFlags: Array<{
    label: string;
    value: boolean | null | undefined;
  }> = [
    { label: 'Allergies', value: app.allergies },
    { label: 'Food allergies', value: app.foodAllergies },
    { label: 'Asthma', value: app.asthma },
    { label: 'Heart conditions', value: app.heartConditions },
    { label: 'Epilepsy', value: app.epilepsy },
    { label: 'Diabetes', value: app.diabetes },
    { label: 'Eczema', value: app.eczema },
  ];
  const medicalDetails: Field[] = [
    {
      label: 'Allergy details',
      value: app.allergyDetails,
      wide: true,
      multiline: true,
    },
    {
      label: 'Food allergy details',
      value: app.foodAllergyDetails,
      wide: true,
      multiline: true,
    },
    {
      label: 'Other conditions',
      value: app.otherMedicalConditions,
      wide: true,
      multiline: true,
    },
    {
      label: 'Dietary restrictions',
      value: app.dietaryRestrictions,
      wide: true,
      multiline: true,
    },
  ];

  // Show the medical card only when at least one flag is true or a detail field has a value.
  const hasMedical =
    medicalFlags.some((f) => f.value === true) ||
    medicalDetails.some((f) => !isFieldEmpty(f));

  const paracetamolLabel =
    app.paracetamolConsent === true
      ? 'Yes'
      : app.paracetamolConsent === false
        ? 'No'
        : null;

  // Total fields filled across all 4 sections — drives the hero progress
  // bar. Medical fields are optional health info and excluded intentionally.
  const allFields = [
    ...identityFields,
    ...travelFields,
    ...contactFields,
    ...preferencesFields,
  ];
  const totalFilled = allFields.filter((f) => !isFieldEmpty(f)).length;
  const total = allFields.length;
  const progressPct = total === 0 ? 0 : Math.round((totalFilled / total) * 100);

  // Hero "key facts" chip strip — only shows the chips that have values so
  // empty states don't clutter the strip.
  const heroChips: Array<{ label: string }> = [];
  if (app.category) heroChips.push({ label: app.category });
  if (app.levelApplied) heroChips.push({ label: app.levelApplied });
  if (app.nationality) heroChips.push({ label: app.nationality });
  if (app.pass) heroChips.push({ label: app.pass });

  const heroName =
    app.enroleeFullName ||
    [app.firstName, app.middleName, app.lastName].filter(Boolean).join(' ') ||
    '(name not set)';

  return (
    <div className="space-y-5">
      {/* Hero — applicant snapshot */}
      <Card className="gap-0 overflow-hidden p-0">
        <CardHeader className="border-b border-border px-5 py-5">
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Applicant profile · {ayCode}
          </CardDescription>
          <CardTitle className="font-serif text-[24px] font-semibold leading-tight tracking-tight text-foreground">
            {heroName}
          </CardTitle>
          {heroChips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {heroChips.map((c) => (
                <Badge key={c.label} variant="secondary">
                  {c.label}
                </Badge>
              ))}
            </div>
          )}
          <CardAction>
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
                <User className="size-5" />
              </div>
              <EditProfileSheet
                ayCode={ayCode}
                enroleeNumber={enroleeNumber}
                initial={initial}
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Profile completion
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {totalFilled} of {total} fields ·{' '}
              <span
                className={cn(
                  'font-semibold',
                  progressPct === 100 ? 'text-brand-mint' : 'text-foreground'
                )}
              >
                {progressPct}%
              </span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full transition-all',
                progressPct === 100
                  ? 'bg-gradient-to-r from-brand-mint to-brand-mint/70'
                  : 'bg-gradient-to-r from-brand-indigo to-brand-indigo/70'
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* 2×2 section grid — collapses to 1 column on smaller viewports */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileSectionCard
          eyebrow="Identity"
          title="Personal & demographic"
          icon={User}
          fields={identityFields}
        />
        <ProfileSectionCard
          eyebrow="Travel documents"
          title="Student passport & pass"
          icon={Globe}
          fields={travelFields}
        />
        <ProfileSectionCard
          eyebrow="Contact"
          title="Household & emergency"
          icon={Phone}
          fields={contactFields}
        />
        <ProfileSectionCard
          eyebrow="Application preferences"
          title="Level, schedule & services"
          icon={Tags}
          fields={preferencesFields}
        />
      </div>

      {/* Medical / health — full-width, shown only when at least one field has data */}
      {hasMedical && (
        <Card className="gap-0 overflow-hidden p-0">
          <CardHeader className="border-b border-border px-5 py-4">
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Medical &amp; health
            </CardDescription>
            <CardTitle className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
              Conditions &amp; dietary needs
            </CardTitle>
            <CardAction>
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-navy text-white shadow-brand-tile">
                <Heart className="size-4" />
              </div>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4 px-5 py-4">
            {/* Boolean condition flags */}
            <div>
              <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Reported conditions
              </p>
              <div className="flex flex-wrap gap-2">
                {medicalFlags.map((f) =>
                  f.value === true ? (
                    <Badge key={f.label} variant="warning">
                      {f.label}
                    </Badge>
                  ) : null
                )}
                {medicalFlags.every((f) => !f.value) && (
                  <span className="text-sm text-muted-foreground">
                    None reported
                  </span>
                )}
              </div>
            </div>
            {/* Detail text fields */}
            <FieldGrid fields={medicalDetails} dimEmpty />
            {/* Paracetamol consent */}
            {app.paracetamolConsent !== null &&
              app.paracetamolConsent !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Paracetamol consent:
                  </span>
                  <Badge
                    variant={app.paracetamolConsent ? 'success' : 'blocked'}
                  >
                    {paracetamolLabel}
                  </Badge>
                </div>
              )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ProfileSectionCard({
  eyebrow,
  title,
  icon: Icon,
  fields,
}: {
  eyebrow: string;
  title: string;
  icon: LucideIcon;
  fields: Field[];
}) {
  const total = fields.length;
  const filled = fields.filter((f) => !isFieldEmpty(f)).length;
  const isComplete = filled === total;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {eyebrow}
        </CardDescription>
        <CardTitle className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">
            <Badge variant={isComplete ? 'success' : 'muted'}>
              {filled} / {total}
            </Badge>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Icon className="size-4" />
            </div>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="px-5 py-4">
        <FieldGrid fields={fields} dimEmpty />
      </CardContent>
    </Card>
  );
}
