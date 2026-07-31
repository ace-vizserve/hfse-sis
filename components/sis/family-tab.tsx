import { Mail, Phone, Plus, Users } from 'lucide-react';

import { EditFamilySheet } from '@/components/sis/edit-family-sheet';
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
import type { ParentSlot } from '@/lib/schemas/sis';
import { isFieldEmpty } from '@/lib/sis/field-helpers';
import type { ApplicationRow } from '@/lib/sis/queries';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// FamilyTab — Father / Mother / Guardian contacts.
//
// Top: a "family contacts" strip that summarises completion + parent-portal
// linkage for all three slots in one row, with each row anchor-jumping to
// the matching detail card below.
//
// Below: three ParentCard sections (one per slot). Each card uses an
// initials-based gradient avatar tile, exposes WhatsApp / Teams consent
// + linkage as inline badges, and surfaces the primary contact (mobile
// + email) above the field grid for at-a-glance reading.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  app: ApplicationRow;
  ayCode: string;
  enroleeNumber: string;
  /** May this viewer edit parent/guardian details? Defaults to FALSE so a
   *  caller that forgets it renders read-only cards rather than an Edit sheet
   *  whose PATCH route would 403 (KD #173). Every call site passes it. */
  canEdit?: boolean;
};

type SlotConfig = {
  slot: ParentSlot;
  label: string;
  optional: boolean;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  mobile: string | number | null;
  email: string | null;
  whatsappConsent: boolean | null;
  fields: Field[];
  initial: Record<string, unknown>;
};

export function FamilyTab({
  app,
  ayCode,
  enroleeNumber,
  canEdit = false,
}: Props) {
  const slots: SlotConfig[] = [
    {
      slot: 'father',
      label: 'Father',
      optional: false,
      fullName: app.fatherFullName,
      firstName: app.fatherFirstName,
      lastName: app.fatherLastName,
      mobile: app.fatherMobile,
      email: app.fatherEmail,
      whatsappConsent: app.fatherWhatsappTeamsConsent,
      initial: {
        fatherFullName: app.fatherFullName,
        fatherFirstName: app.fatherFirstName,
        fatherMiddleName: app.fatherMiddleName,
        fatherLastName: app.fatherLastName,
        fatherPreferredName: app.fatherPreferredName,
        fatherNric: app.fatherNric,
        fatherBirthDay: app.fatherBirthDay,
        fatherMobile: app.fatherMobile,
        fatherEmail: app.fatherEmail,
        fatherNationality: app.fatherNationality,
        fatherReligion: app.fatherReligion,
        fatherReligionOther: app.fatherReligionOther,
        fatherMarital: app.fatherMarital,
        fatherCompanyName: app.fatherCompanyName,
        fatherPosition: app.fatherPosition,
        fatherPassport: app.fatherPassport,
        fatherPassportExpiry: app.fatherPassportExpiry,
        fatherPass: app.fatherPass,
        fatherPassExpiry: app.fatherPassExpiry,
        fatherWhatsappTeamsConsent: app.fatherWhatsappTeamsConsent,
      },
      fields: [
        { label: 'Full name', value: app.fatherFullName },
        { label: 'Middle name', value: app.fatherMiddleName },
        { label: 'Preferred name', value: app.fatherPreferredName },
        { label: 'NRIC / FIN', value: app.fatherNric },
        { label: 'Date of birth', value: app.fatherBirthDay, asDate: true },
        { label: 'Mobile', value: app.fatherMobile },
        { label: 'Email', value: app.fatherEmail, wide: true },
        { label: 'Nationality', value: app.fatherNationality },
        {
          label: 'Religion',
          value: app.fatherReligion ?? app.fatherReligionOther,
        },
        { label: 'Marital status', value: app.fatherMarital },
        { label: 'Company', value: app.fatherCompanyName },
        { label: 'Position', value: app.fatherPosition },
        { label: 'Passport', value: app.fatherPassport, sensitive: true },
        {
          label: 'Passport expiry',
          value: app.fatherPassportExpiry,
          asDate: true,
        },
        { label: 'Pass type', value: app.fatherPass },
        { label: 'Pass expiry', value: app.fatherPassExpiry, asDate: true },
        {
          label: 'WhatsApp / Teams consent',
          value: app.fatherWhatsappTeamsConsent,
        },
      ],
    },
    {
      slot: 'mother',
      label: 'Mother',
      optional: false,
      fullName: app.motherFullName,
      firstName: app.motherFirstName,
      lastName: app.motherLastName,
      mobile: app.motherMobile,
      email: app.motherEmail,
      whatsappConsent: app.motherWhatsappTeamsConsent,
      initial: {
        motherFullName: app.motherFullName,
        motherFirstName: app.motherFirstName,
        motherMiddleName: app.motherMiddleName,
        motherLastName: app.motherLastName,
        motherPreferredName: app.motherPreferredName,
        motherNric: app.motherNric,
        motherBirthDay: app.motherBirthDay,
        motherMobile: app.motherMobile,
        motherEmail: app.motherEmail,
        motherNationality: app.motherNationality,
        motherReligion: app.motherReligion,
        motherReligionOther: app.motherReligionOther,
        motherMarital: app.motherMarital,
        motherCompanyName: app.motherCompanyName,
        motherPosition: app.motherPosition,
        motherPassport: app.motherPassport,
        motherPassportExpiry: app.motherPassportExpiry,
        motherPass: app.motherPass,
        motherPassExpiry: app.motherPassExpiry,
        motherWhatsappTeamsConsent: app.motherWhatsappTeamsConsent,
      },
      fields: [
        { label: 'Full name', value: app.motherFullName },
        { label: 'Middle name', value: app.motherMiddleName },
        { label: 'Preferred name', value: app.motherPreferredName },
        { label: 'NRIC / FIN', value: app.motherNric },
        { label: 'Date of birth', value: app.motherBirthDay, asDate: true },
        { label: 'Mobile', value: app.motherMobile },
        { label: 'Email', value: app.motherEmail, wide: true },
        { label: 'Nationality', value: app.motherNationality },
        {
          label: 'Religion',
          value: app.motherReligion ?? app.motherReligionOther,
        },
        { label: 'Marital status', value: app.motherMarital },
        { label: 'Company', value: app.motherCompanyName },
        { label: 'Position', value: app.motherPosition },
        { label: 'Passport', value: app.motherPassport, sensitive: true },
        {
          label: 'Passport expiry',
          value: app.motherPassportExpiry,
          asDate: true,
        },
        { label: 'Pass type', value: app.motherPass },
        { label: 'Pass expiry', value: app.motherPassExpiry, asDate: true },
        {
          label: 'WhatsApp / Teams consent',
          value: app.motherWhatsappTeamsConsent,
        },
      ],
    },
    {
      slot: 'guardian',
      label: 'Guardian',
      optional: true,
      fullName: app.guardianFullName,
      firstName: app.guardianFirstName,
      lastName: app.guardianLastName,
      mobile: app.guardianMobile,
      email: app.guardianEmail,
      whatsappConsent: app.guardianWhatsappTeamsConsent,
      initial: {
        guardianFullName: app.guardianFullName,
        guardianFirstName: app.guardianFirstName,
        guardianMiddleName: app.guardianMiddleName,
        guardianLastName: app.guardianLastName,
        guardianPreferredName: app.guardianPreferredName,
        guardianNric: app.guardianNric,
        guardianBirthDay: app.guardianBirthDay,
        guardianMobile: app.guardianMobile,
        guardianEmail: app.guardianEmail,
        guardianNationality: app.guardianNationality,
        guardianReligion: app.guardianReligion,
        guardianReligionOther: app.guardianReligionOther,
        // No guardianMarital — guardian has no Marital column (see
        // edit-family-sheet.tsx).
        guardianCompanyName: app.guardianCompanyName,
        guardianPosition: app.guardianPosition,
        guardianPassport: app.guardianPassport,
        guardianPassportExpiry: app.guardianPassportExpiry,
        guardianPass: app.guardianPass,
        guardianPassExpiry: app.guardianPassExpiry,
        guardianWhatsappTeamsConsent: app.guardianWhatsappTeamsConsent,
      },
      fields: [
        { label: 'Full name', value: app.guardianFullName },
        { label: 'First name', value: app.guardianFirstName },
        { label: 'Middle name', value: app.guardianMiddleName },
        { label: 'Last name', value: app.guardianLastName },
        { label: 'Preferred name', value: app.guardianPreferredName },
        { label: 'NRIC / FIN', value: app.guardianNric },
        { label: 'Date of birth', value: app.guardianBirthDay, asDate: true },
        { label: 'Mobile', value: app.guardianMobile },
        { label: 'Email', value: app.guardianEmail, wide: true },
        { label: 'Nationality', value: app.guardianNationality },
        {
          label: 'Religion',
          value: app.guardianReligion ?? app.guardianReligionOther,
        },
        { label: 'Company', value: app.guardianCompanyName },
        { label: 'Position', value: app.guardianPosition },
        { label: 'Passport', value: app.guardianPassport, sensitive: true },
        {
          label: 'Passport expiry',
          value: app.guardianPassportExpiry,
          asDate: true,
        },
        { label: 'Pass type', value: app.guardianPass },
        { label: 'Pass expiry', value: app.guardianPassExpiry, asDate: true },
        {
          label: 'WhatsApp / Teams consent',
          value: app.guardianWhatsappTeamsConsent,
        },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      <FamilyContactsStrip slots={slots} />
      {slots.map((s) => (
        <ParentCard
          key={s.slot}
          slot={s}
          ayCode={ayCode}
          enroleeNumber={enroleeNumber}
          canEdit={canEdit}
        />
      ))}
      <SiblingsCard app={app} />
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function deriveInitials(slot: SlotConfig): string {
  const direct =
    [slot.firstName, slot.lastName]
      .filter((p): p is string => !!p && p.trim() !== '')
      .map((p) => p[0]!.toUpperCase())
      .join('') || '';
  if (direct.length >= 2) return direct.slice(0, 2);

  const fromFull = (slot.fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  if (fromFull.length >= 2) return fromFull.slice(0, 2);
  if (fromFull.length === 1) return fromFull;
  if (direct.length === 1) return direct;
  return slot.label[0]!.toUpperCase();
}

function isSlotEmpty(slot: SlotConfig): boolean {
  return slot.fields.every((f) => isFieldEmpty(f));
}

// ─── strip ──────────────────────────────────────────────────────────────────

function FamilyContactsStrip({ slots }: { slots: SlotConfig[] }) {
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Family contacts
        </CardDescription>
        <CardTitle className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
          Linked parents &amp; guardians
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Users className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <ul className="divide-y divide-border">
        {slots.map((slot) => (
          <FamilyContactsRow key={slot.slot} slot={slot} />
        ))}
      </ul>
    </Card>
  );
}

function FamilyContactsRow({ slot }: { slot: SlotConfig }) {
  const empty = isSlotEmpty(slot);
  const filled = slot.fields.filter((f) => !isFieldEmpty(f)).length;
  const total = slot.fields.length;
  const linked = !!slot.email && slot.email.trim() !== '';
  const initials = deriveInitials(slot);

  return (
    <li>
      <a
        href={`#family-${slot.slot}`}
        className={cn(
          'group flex items-center gap-3 px-5 py-3 transition-colors',
          'hover:bg-muted/40',
          'focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-indigo/40'
        )}
      >
        <AvatarTile
          slot={slot}
          initials={initials}
          size="strip"
          empty={empty}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-serif text-[14px] font-semibold tracking-tight text-foreground">
              {slot.label}
            </span>
            {slot.optional && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Optional
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {empty ? 'Not on file' : `${filled} of ${total} fields`}
          </div>
        </div>
        {!empty && linked && <Badge variant="success">Linked</Badge>}
        {!empty && !linked && <Badge variant="muted">No email</Badge>}
        {empty && <Badge variant="outline">Add</Badge>}
      </a>
    </li>
  );
}

function AvatarTile({
  slot,
  initials,
  size,
  empty,
}: {
  slot: SlotConfig;
  initials: string;
  size: 'strip' | 'card';
  empty: boolean;
}) {
  const sizeClass = size === 'strip' ? 'size-9' : 'size-12';
  const textSize = size === 'strip' ? 'text-[12px]' : 'text-[15px]';

  if (empty) {
    return (
      <div
        className={cn(
          sizeClass,
          'flex shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground'
        )}
      >
        <Plus className="size-4" />
      </div>
    );
  }

  // Father / Mother — full indigo gradient. Guardian — softer ink gradient
  // so the optional slot reads as secondary even when populated.
  const gradient = slot.optional
    ? 'from-ink-4 to-ink-3'
    : 'from-brand-indigo to-brand-navy';

  return (
    <div
      className={cn(
        sizeClass,
        'flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-brand-tile',
        gradient
      )}
    >
      <span className={cn('font-mono font-semibold tabular-nums', textSize)}>
        {initials}
      </span>
    </div>
  );
}

// ─── parent card ────────────────────────────────────────────────────────────

function ParentCard({
  slot,
  ayCode,
  enroleeNumber,
  canEdit,
}: {
  slot: SlotConfig;
  ayCode: string;
  enroleeNumber: string;
  canEdit: boolean;
}) {
  const empty = isSlotEmpty(slot);
  const filled = slot.fields.filter((f) => !isFieldEmpty(f)).length;
  const total = slot.fields.length;
  const initials = deriveInitials(slot);

  const displayName =
    slot.fullName?.trim() ||
    (empty
      ? `Add ${slot.label.toLowerCase()} details`
      : `(${slot.label} — name not set)`);
  const mobile =
    slot.mobile != null && String(slot.mobile).trim() !== ''
      ? String(slot.mobile)
      : null;
  const email = slot.email && slot.email.trim() !== '' ? slot.email : null;

  return (
    <Card
      id={`family-${slot.slot}`}
      className="scroll-mt-20 gap-0 overflow-hidden p-0"
    >
      <CardHeader className="border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <AvatarTile
            slot={slot}
            initials={initials}
            size="card"
            empty={empty}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              {slot.label}
              {slot.optional && ' · Optional'}
            </CardDescription>
            <CardTitle
              className={cn(
                'font-serif text-[18px] font-semibold leading-tight tracking-tight',
                empty ? 'text-muted-foreground' : 'text-foreground'
              )}
            >
              {displayName}
            </CardTitle>
            {!empty && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant={filled === total ? 'success' : 'muted'}>
                  {filled} / {total}
                </Badge>
                {slot.whatsappConsent === true && (
                  <Badge variant="success">WhatsApp ✓</Badge>
                )}
                {slot.whatsappConsent === false && (
                  <Badge variant="secondary">WhatsApp ✕</Badge>
                )}
                {email && <Badge variant="default">Linked</Badge>}
              </div>
            )}
          </div>
          {canEdit && (
            <CardAction>
              <EditFamilySheet
                ayCode={ayCode}
                enroleeNumber={enroleeNumber}
                parent={slot.slot}
                initial={slot.initial}
              />
            </CardAction>
          )}
        </div>
      </CardHeader>

      {empty ? (
        <CardContent className="px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {slot.optional
              ? 'Guardian is optional — add only if a non-parent adult is involved.'
              : `Add ${slot.label.toLowerCase()} contact + identity details to unlock parent-portal linkage.`}
          </p>
        </CardContent>
      ) : (
        <>
          {(mobile || email) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border bg-muted/25 px-5 py-3">
              {mobile && (
                <div className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 text-muted-foreground" />
                  <span className="font-mono text-[12px] tabular-nums text-foreground">
                    {mobile}
                  </span>
                </div>
              )}
              {email && (
                <div className="inline-flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    className="truncate text-[12px] text-foreground"
                    title={email}
                  >
                    {email}
                  </span>
                </div>
              )}
            </div>
          )}
          <CardContent className="px-5 py-4">
            <FieldGrid fields={slot.fields} dimEmpty />
          </CardContent>
        </>
      )}
    </Card>
  );
}

// ─── siblings ───────────────────────────────────────────────────────────────

type SiblingEntry = {
  index: number;
  fullName: string | null;
  fields: Field[];
};

// Parent-portal-collected, read-only here — siblings live on
// ProfileUpdateSchema (not the family schemas), so they're edited from the
// Profile tab's Edit profile sheet ("Sibling 1"–"Sibling 5" sections), not
// EditFamilySheet. Hidden entirely when no slot has data, matching the
// Medical card's precedent on the Profile tab (components/sis/profile-tab.tsx)
// — an applicant with no siblings on file doesn't get an empty card. Adding
// a first sibling still works: Edit Profile always shows all 5 slots
// (mirrors the discount-slot precedent), independent of this card.
function SiblingsCard({ app }: { app: ApplicationRow }) {
  const entries: SiblingEntry[] = ([1, 2, 3, 4, 5] as const).map((n) => {
    const fullName = app[`siblingFullName${n}`];
    const birthDay = app[`siblingBirthDay${n}`];
    const religion = app[`siblingReligion${n}`];
    const educationOccupation = app[`siblingEducationOccupation${n}`];
    const schoolCompany = app[`siblingSchoolCompany${n}`];
    return {
      index: n,
      fullName,
      fields: [
        { label: 'Date of birth', value: birthDay, asDate: true },
        { label: 'Religion', value: religion },
        { label: 'Education / occupation', value: educationOccupation },
        { label: 'School / company', value: schoolCompany },
      ],
    };
  });

  const populated = entries.filter(
    (e) => !!e.fullName || e.fields.some((f) => !isFieldEmpty(f))
  );

  if (populated.length === 0) return null;

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <CardHeader className="border-b border-border px-5 py-4">
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Siblings
        </CardDescription>
        <CardTitle className="font-serif text-[15px] font-semibold tracking-tight text-foreground">
          Siblings on file
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Edit from the Profile tab
        </p>
        <CardAction>
          <div className="flex items-center gap-2">
            <Badge variant="muted">
              {populated.length} / {entries.length}
            </Badge>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Users className="size-4" />
            </div>
          </div>
        </CardAction>
      </CardHeader>
      <ul className="divide-y divide-border">
        {populated.map((sibling) => (
          <li key={sibling.index} className="px-5 py-4">
            <p className="mb-3 font-serif text-[14px] font-semibold tracking-tight text-foreground">
              {sibling.fullName?.trim() || `Sibling ${sibling.index}`}
            </p>
            <FieldGrid fields={sibling.fields} dimEmpty />
          </li>
        ))}
      </ul>
    </Card>
  );
}
