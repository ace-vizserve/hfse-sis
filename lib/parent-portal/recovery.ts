import type { SupabaseClient } from '@supabase/supabase-js';

import { listAyCodes } from '@/lib/academic-year';
import { prefixFor } from '@/lib/admissions/_shared';
import { sendRecoveryLinkEmail } from '@/lib/notifications/email-recovery-link';
import {
  listApplications,
  type TransferApplication,
} from '@/lib/parent-portal/transfer';
import {
  RECOVERY_SECTIONS,
  type RecoverySection,
} from '@/lib/schemas/parent-portal';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Recovery link: a family's enrolment record is partly missing, so a superadmin
// makes a one-time link to the portal's `/complete-enrolment/:token` form, which
// needs no login. This is a port of the portal's `recovery-link` edge function,
// which only accepts the shared portal admin login. The portal still consumes
// the token, so what is written here has to be what it expects.
//
// Server-only, through the email module. The screen takes the types and nothing
// else.

const TOKEN_TTL_DAYS = 7;
const VALID_CATEGORIES = [
  'New',
  'Current',
  'VizSchool New',
  'VizSchool Current',
];

export type RecoveryCheckResult =
  | { complete: true; academicYear: string; enroleeNumber: string }
  | {
      complete?: false;
      academicYear: string;
      enroleeNumber: string;
      studentNumber: string | null;
      category: string;
      studentName: string | null;
      present: { applications: boolean; documents: boolean; status: boolean };
      /** The application row exists but has required fields left empty. */
      applicationsIncomplete: boolean;
      missing: string[];
      suggestedSections: RecoverySection[];
      /** Prefill for the recipient box, comma-separated. Never sent unseen. */
      knownEmails: string | null;
    };

export type RecoveryLinkResult = {
  token: string;
  url: string;
  missing: string[];
  sections: RecoverySection[];
  studentName: string | null;
  category: string;
  emailSent: boolean;
  emailError?: string;
};

export type RecoveryLinkStatus = 'Pending' | 'Completed' | 'Expired';

export type LatestLink = {
  linkStatus: RecoveryLinkStatus;
  /** Superadmins only, on a Pending link. It opens a family's form with no login. */
  linkUrl?: string;
};

/** A row of the Applications table. `linkStatus` is null when no link was made. */
export type ApplicationRow = TransferApplication & {
  linkStatus: RecoveryLinkStatus | null;
  linkUrl?: string;
};

/** A refusal the route answers with this status and message. */
export class RecoveryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'RecoveryError';
    this.status = status;
  }
}

type Row = Record<string, unknown>;

// ⚠ A COPY. The portal holds this same list, plus the rule below, in
// `supabase/functions/_shared/enrolment-payload.ts`, and it is the portal that
// consumes the token, so the two must agree. Change both or neither;
// `__tests__/sis/parent-portal-recovery.test.ts` compares them when the portal
// repo is checked out beside this one.
//
// Father and guardian columns are left out on purpose: they are rightly empty
// for a single-parent family, and nothing tells that apart from a form left
// unfinished.
export const REQUIRED_APPLICATION_FIELDS_BY_SECTION: Record<string, string[]> =
  {
    studentInfo: [
      'firstName',
      'lastName',
      'preferredName',
      'birthDay',
      'gender',
      'primaryLanguage',
      'religion',
      'homeAddress',
      'postalCode',
      'homePhone',
      'contactPerson',
      'contactPersonNumber',
      'livingWithWhom',
      'parentMaritalStatus',
    ],
    familyInfo: [
      'motherFirstName',
      'motherLastName',
      'motherBirthDay',
      'motherNationality',
      'motherReligion',
      'motherNric',
      'motherMobile',
      'motherEmail',
      'motherCompanyName',
      'motherPosition',
    ],
    enrollmentInfo: [
      'levelApplied',
      'classType',
      'preferredSchedule',
      'availSchoolBus',
      'availStudentCare',
      'paymentOption',
      'contractSignatory',
      'preferredPaymentScheme',
      'preferredPaymentMethod',
    ],
  };

function isSectionIncomplete(application: Row, section: string): boolean {
  if (section === 'studentInfo' && application.paracetamolConsent == null) {
    return true;
  }
  return (REQUIRED_APPLICATION_FIELDS_BY_SECTION[section] ?? []).some(
    (field) => {
      const value = application[field];
      return value == null || value === '';
    }
  );
}

export function incompleteApplicationSections(
  application: Row
): RecoverySection[] {
  return Object.keys(REQUIRED_APPLICATION_FIELDS_BY_SECTION).filter((section) =>
    isSectionIncomplete(application, section)
  ) as RecoverySection[];
}

function isApplicationIncomplete(application: Row): boolean {
  return incompleteApplicationSections(application).length > 0;
}

type TableState = {
  applications: Row | null;
  documents: Row | null;
  status: Row | null;
};

type RecordYear = {
  /** `ay2027`: the form the portal builds table names from, and stores. */
  academicYear: string;
  otherYears: string[];
};

// The portal's `academicYearFromEnroleeNumber`, against the years on file here.
async function yearFromEnroleeNumber(
  service: SupabaseClient,
  enroleeNumber: string
): Promise<RecordYear> {
  const yy = enroleeNumber.match(/E(\d{2})/)?.[1];
  const codes = yy ? await listAyCodes(service) : [];
  const code = codes.find((ayCode) => ayCode.slice(-2) === yy);
  if (!code) {
    throw new RecoveryError(
      400,
      `Could not tell which academic year ${enroleeNumber} belongs to. Check the number.`
    );
  }
  return {
    academicYear: prefixFor(code),
    otherYears: codes.filter((ayCode) => ayCode !== code).map(prefixFor),
  };
}

async function detect(
  service: SupabaseClient,
  academicYear: string,
  enroleeNumber: string
): Promise<TableState> {
  const read = (table: string) =>
    service
      .from(`${academicYear}_enrolment_${table}`)
      .select('*')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
  const [applications, documents, status] = await Promise.all([
    read('applications'),
    read('documents'),
    read('status'),
  ]);

  const failed = applications.error ?? documents.error ?? status.error;
  if (failed) {
    throw new RecoveryError(
      500,
      `Could not read the record for ${enroleeNumber}: ${failed.message}`
    );
  }
  return {
    applications: applications.data as Row | null,
    documents: documents.data as Row | null,
    status: status.data as Row | null,
  };
}

function missingTables(state: TableState): string[] {
  const missing: string[] = [];
  if (!state.applications || isApplicationIncomplete(state.applications)) {
    missing.push('applications');
  }
  if (!state.documents) missing.push('documents');
  if (!state.status) missing.push('status');
  return missing;
}

function defaultSections(state: TableState): RecoverySection[] {
  if (!state.applications) return [...RECOVERY_SECTIONS];
  const sections = incompleteApplicationSections(state.applications);
  if (!state.documents) sections.push('uploads');
  return sections.length ? sections : [...RECOVERY_SECTIONS];
}

function deriveCategory(state: TableState, enroleeNumber: string): string {
  const value = state.applications?.category ?? state.status?.enroleeType;
  if (typeof value === 'string' && VALID_CATEGORIES.includes(value)) {
    return value;
  }
  throw new RecoveryError(
    422,
    `Could not tell from its records whether ${enroleeNumber} is a new or a current student. Check the number.`
  );
}

function deriveStudentName(state: TableState): string | null {
  return (state.applications?.enroleeFullName ??
    state.status?.enroleeName ??
    null) as string | null;
}

function deriveStudentNumber(state: TableState): string | null {
  return (state.applications?.studentNumber ??
    state.documents?.studentNumber ??
    null) as string | null;
}

function emailsFromRow(row: Row | null | undefined): string | null {
  if (!row) return null;
  const emails = [row.fatherEmail, row.motherEmail, row.guardianEmail].filter(
    (email): email is string =>
      typeof email === 'string' && email.trim().length > 0
  );
  return emails.length ? emails.join(', ') : null;
}

// This year's application first. Usually there is none, which is why the link is
// needed, so then other years by student number (stable across years).
async function findKnownEmails(
  service: SupabaseClient,
  state: TableState,
  otherYears: string[]
): Promise<string | null> {
  const current = emailsFromRow(state.applications);
  if (current) return current;

  const studentNumber = deriveStudentNumber(state);
  if (!studentNumber) return null;

  for (const year of otherYears) {
    const { data, error } = await service
      .from(`${year}_enrolment_applications`)
      .select('fatherEmail, motherEmail, guardianEmail')
      .eq('studentNumber', studentNumber)
      .maybeSingle();
    // Only a prefill: a year that cannot be read is no reason to stop.
    if (error) continue;
    const emails = emailsFromRow(data as Row | null);
    if (emails) return emails;
  }
  return null;
}

function linkFor(token: string): string {
  // Origin only: this setting can carry a path for other emails' links, and the
  // portal's form lives at the root.
  const { origin } = new URL(
    process.env.NEXT_PUBLIC_PARENT_PORTAL_URL ?? 'https://enrol.hfse.edu.sg'
  );
  return `${origin}/complete-enrolment/${token}`;
}

export async function checkRecovery(
  service: SupabaseClient,
  enroleeNumber: string
): Promise<RecoveryCheckResult> {
  const { academicYear, otherYears } = await yearFromEnroleeNumber(
    service,
    enroleeNumber
  );
  const state = await detect(service, academicYear, enroleeNumber);
  const missing = missingTables(state);
  if (missing.length === 0) {
    return { complete: true, academicYear, enroleeNumber };
  }

  return {
    academicYear,
    enroleeNumber,
    studentNumber: deriveStudentNumber(state),
    category: deriveCategory(state, enroleeNumber),
    studentName: deriveStudentName(state),
    present: {
      applications: !!state.applications,
      documents: !!state.documents,
      status: !!state.status,
    },
    applicationsIncomplete:
      !!state.applications && isApplicationIncomplete(state.applications),
    missing,
    suggestedSections: defaultSections(state),
    knownEmails: await findKnownEmails(service, state, otherYears),
  };
}

export async function generateRecoveryLink(
  service: SupabaseClient,
  input: {
    enroleeNumber: string;
    sections?: RecoverySection[];
    recipientEmails?: string[];
    createdBy: string;
  }
): Promise<RecoveryLinkResult> {
  const { enroleeNumber, createdBy } = input;
  const recipients = input.recipientEmails ?? [];

  const { academicYear } = await yearFromEnroleeNumber(service, enroleeNumber);
  const state = await detect(service, academicYear, enroleeNumber);
  const missing = missingTables(state);
  if (missing.length === 0) {
    throw new RecoveryError(
      409,
      'Nothing to recover: all three records are already complete.'
    );
  }

  // With no application row the link has to insert a whole one, so it cannot be
  // narrowed: that would save a row with entire sections blank.
  const sections: RecoverySection[] = !state.applications
    ? [...RECOVERY_SECTIONS]
    : (input.sections ?? defaultSections(state));

  const category = deriveCategory(state, enroleeNumber);
  const studentName = deriveStudentName(state);
  const expiresAt = new Date(
    Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: tokenRow, error: insertError } = await service
    .from('enrolment_recovery_tokens')
    .insert({
      academic_year: academicYear,
      enrolee_number: enroleeNumber,
      student_number: deriveStudentNumber(state),
      student_name: studentName,
      category,
      missing_tables: missing,
      sections,
      created_by: createdBy,
      expires_at: expiresAt,
    })
    .select('token')
    .single();
  if (insertError || !tokenRow) {
    throw new RecoveryError(
      500,
      `Could not create the link: ${insertError?.message ?? 'no link returned'}`
    );
  }

  const token = (tokenRow as { token: string }).token;
  const url = linkFor(token);

  let emailSent = false;
  let emailError: string | undefined;
  if (recipients.length > 0) {
    const sent = await sendRecoveryLinkEmail(recipients, url);
    if (sent.ok) {
      emailSent = true;
      // Display only: Recent links shows who it went to. The email has gone and
      // the link works, so a failure here is not worth failing the request.
      const { error } = await service
        .from('enrolment_recovery_tokens')
        .update({
          notified_email: recipients.join(', '),
          notified_at: new Date().toISOString(),
        })
        .eq('token', token);
      if (error) {
        console.error(
          '[parent-portal] could not record the recovery email:',
          error.message
        );
      }
    } else {
      emailError = sent.error;
    }
  }

  return {
    token,
    url,
    missing,
    sections,
    studentName,
    category,
    emailSent,
    ...(emailError ? { emailError } : {}),
  };
}

// ⚠ `token` is only selected for a superadmin. A viewer's page never fetches it,
// so there is nothing to forget to strip.
const LINK_COLUMNS = 'enrolee_number, created_at, expires_at, used_at';

type TokenRow = {
  token?: string;
  enrolee_number: string;
  expires_at: string;
  used_at: string | null;
};

function statusOf(row: TokenRow, now: number): RecoveryLinkStatus {
  if (row.used_at) return 'Completed';
  return new Date(row.expires_at).getTime() < now ? 'Expired' : 'Pending';
}

/** Each student's latest link in a year, by enrolee number. */
export async function listLatestLinks(
  service: SupabaseClient,
  ayCode: string,
  { includeLink }: { includeLink: boolean }
): Promise<Map<string, LatestLink>> {
  const columns: string = includeLink ? `token, ${LINK_COLUMNS}` : LINK_COLUMNS;
  const rows = await fetchAllPages<TokenRow>(
    (from, to) =>
      service
        .from('enrolment_recovery_tokens')
        .select(columns)
        .eq('academic_year', prefixFor(ayCode))
        .order('created_at', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{
        data: TokenRow[] | null;
        error: { message: string } | null;
      }>,
    undefined,
    // This table has no `id`.
    { tieBreak: 'token' }
  );

  const now = Date.now();
  const latest = new Map<string, LatestLink>();
  for (const row of rows) {
    // Newest first, so the first one seen is the one that counts.
    if (latest.has(row.enrolee_number)) continue;
    const linkStatus = statusOf(row, now);
    // Only a link that still works is worth copying.
    latest.set(
      row.enrolee_number,
      includeLink && linkStatus === 'Pending' && row.token
        ? { linkStatus, linkUrl: linkFor(row.token) }
        : { linkStatus }
    );
  }
  return latest;
}

/** The Applications table: every record in a year and its latest link. */
export async function listApplicationRows(
  service: SupabaseClient,
  ayCode: string,
  { includeLink }: { includeLink: boolean }
): Promise<ApplicationRow[]> {
  const [applications, links] = await Promise.all([
    listApplications(service, ayCode),
    listLatestLinks(service, ayCode, { includeLink }),
  ]);
  return applications.map((application) => ({
    ...application,
    linkStatus: null,
    ...links.get(application.enroleeNumber),
  }));
}
