import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { DOCUMENT_SLOTS, resolveStatus, type DocumentStatus } from './document-config';

const CACHE_TTL_SECONDS = 600;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ['p-files-dashboard', `p-files-dashboard:${ayCode}`];
}

// Per-student completeness result
export type StudentCompleteness = {
  enroleeNumber: string;
  studentNumber: string | null;
  fullName: string;
  level: string | null;
  section: string | null;
  total: number;
  complete: number;
  expired: number;
  missing: number;
  uploaded: number;
  slots: { key: string; label: string; status: DocumentStatus; expiryDate: string | null }[];
};

export type DashboardSummary = {
  totalStudents: number;
  fullyComplete: number;
  hasExpired: number;
  hasMissing: number;
};

// ── Raw fetch ─────────────────────────────────────────────────────────────

type RawDocRow = Record<string, unknown>;
type RawAppRow = Record<string, unknown>;
type RawStatusRow = Record<string, unknown>;

async function loadRawDataUncached(ayCode: string) {
  const service = createServiceClient();
  const prefix = prefixFor(ayCode);

  // Fetch all three tables in parallel
  const [appsRes, statusRes, docsRes] = await Promise.all([
    service.from(`${prefix}_enrolment_applications`).select(
      '"enroleeNumber", "studentNumber", "firstName", "lastName", "fatherEmail", "guardianEmail"',
    ),
    service.from(`${prefix}_enrolment_status`).select(
      '"enroleeNumber", "applicationStatus", "classLevel", "classSection"',
    ),
    service.from(`${prefix}_enrolment_documents`).select(
      // Dashboard only needs status + expiry columns for completeness computation.
      // Full URLs are fetched separately on the detail page via getStudentDocumentDetail.
      DOCUMENT_SLOTS.flatMap((s) => {
        const cols = [`"enroleeNumber"`, `"${s.key}Status"`];
        if (s.expires) cols.push(`"${s.key}Expiry"`);
        // Include URL presence check (needed by resolveStatus)
        cols.push(`"${s.key}"`);
        return cols;
      })
        .filter((c, i, a) => a.indexOf(c) === i) // dedupe enroleeNumber
        .join(', '),
    ),
  ]);

  return {
    apps: (appsRes.data ?? []) as RawAppRow[],
    statuses: (statusRes.data ?? []) as RawStatusRow[],
    docs: (docsRes.data ?? []) as unknown as RawDocRow[],
  };
}

function loadRawData(ayCode: string) {
  return unstable_cache(
    () => loadRawDataUncached(ayCode),
    ['p-files-raw', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: tag(ayCode) },
  )();
}

// ── Completeness computation ─────────────────────────────────────────────

function str(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return v == null ? null : String(v);
}

function computeForStudent(
  app: RawAppRow,
  statusRow: RawStatusRow | undefined,
  docRow: RawDocRow | undefined,
): StudentCompleteness {
  const enroleeNumber = str(app, 'enroleeNumber') ?? '';
  const studentNumber = str(app, 'studentNumber');
  const firstName = str(app, 'firstName') ?? '';
  const lastName = str(app, 'lastName') ?? '';
  const fullName = `${lastName}, ${firstName}`.trim().replace(/^,\s*/, '');

  const level = str(statusRow ?? {}, 'classLevel');
  const section = str(statusRow ?? {}, 'classSection');

  const applicableSlots = DOCUMENT_SLOTS.filter((slot) => {
    if (!slot.conditional) return true;
    return !!str(app, slot.conditional);
  });

  const slots = applicableSlots.map((slot) => {
    const url = docRow ? str(docRow, slot.key) : null;
    const rawStatus = docRow ? str(docRow, `${slot.key}Status`) : null;
    const expiryDate = slot.expires && docRow ? str(docRow, `${slot.key}Expiry`) : null;
    const status = resolveStatus(url, rawStatus, expiryDate, slot.expires);
    return { key: slot.key, label: slot.label, status, expiryDate };
  });

  const total = slots.length;
  const complete = slots.filter((s) => s.status === 'valid').length;
  const expired = slots.filter((s) => s.status === 'expired').length;
  const uploaded = slots.filter((s) => s.status === 'uploaded').length;
  const missing = slots.filter((s) => s.status === 'missing').length;

  return {
    enroleeNumber,
    studentNumber,
    fullName,
    level,
    section,
    total,
    complete,
    expired,
    missing,
    uploaded,
    slots,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

export async function getDocumentDashboardData(ayCode: string): Promise<{
  students: StudentCompleteness[];
  summary: DashboardSummary;
}> {
  const { apps, statuses, docs } = await loadRawData(ayCode);

  const statusByEnrolee = new Map(
    statuses.map((s) => [str(s, 'enroleeNumber'), s]),
  );
  const docsByEnrolee = new Map(
    docs.map((d) => [str(d, 'enroleeNumber'), d]),
  );

  // Filter to enrolled students only (same logic as admissions dashboard)
  const enrolledApps = apps.filter((a) => {
    const s = statusByEnrolee.get(str(a, 'enroleeNumber'));
    if (!s) return false;
    const appStatus = str(s, 'applicationStatus') ?? '';
    const section = str(s, 'classSection');
    if (['Cancelled', 'Withdrawn'].includes(appStatus)) return false;
    return section != null && section.length > 0;
  });

  const students = enrolledApps.map((app) => {
    const statusRow = statusByEnrolee.get(str(app, 'enroleeNumber'));
    const docRow = docsByEnrolee.get(str(app, 'enroleeNumber'));
    return computeForStudent(app, statusRow, docRow);
  });

  // Sort by completeness ascending (least complete first)
  students.sort((a, b) => (a.complete / a.total) - (b.complete / b.total));

  const summary: DashboardSummary = {
    totalStudents: students.length,
    fullyComplete: students.filter((s) => s.complete === s.total).length,
    hasExpired: students.filter((s) => s.expired > 0).length,
    hasMissing: students.filter((s) => s.missing > 0).length,
  };

  return { students, summary };
}

export type StudentDocumentDetail = StudentCompleteness & {
  /** Raw document row — use to read file URLs for the detail page. */
  rawDocRow: Record<string, unknown>;
  /** Per-slot outreach summary keyed by slotKey. Drives "Reminded N days ago"
   *  + "Promised by [date]" badges on DocumentCards. */
  outreach: Record<
    string,
    { lastReminderAt: string | null; activePromise: { promisedUntil: string; note: string | null } | null }
  >;
  /** Recipient discovery for notify dialog preview — registrar sees who'll
   *  be emailed before clicking Send. */
  recipients: { motherEmail: string | null; fatherEmail: string | null; guardianEmail: string | null };
  /** Parent / guardian display names — surfaced on the family-contact panel. */
  family: {
    motherName: string | null;
    fatherName: string | null;
    guardianName: string | null;
  };
  /** STP application type (e.g. "New Student Pass Application"). Null when the
   *  student isn't on the STP track — UI hides the STP card in that case. */
  stpApplicationType: string | null;
  /** Chronological list of recent reminder + promise events, newest first.
   *  Used by the "Recent activity" strip on the detail page. Capped at 12. */
  recentEvents: Array<{
    kind: 'reminder' | 'promise';
    slotKey: string;
    createdAt: string;
    promisedUntil: string | null;
    recipientEmail: string | null;
    note: string | null;
  }>;
};

export type DocumentRevisionSource = 'pfile-upload' | 'parent-portal' | 'sis-direct';

export type DocumentRevision = {
  id: string;
  /** Public URL of the archived file. Set when the SIS officer flow
   *  moved the prior file to a `revisions/<iso>.<ext>` path. NULL when
   *  the revision came from the parent-portal direct-write trigger
   *  (no file move was performed there). */
  archivedUrl: string | null;
  /** The URL the slot held BEFORE the replacement. May or may not still
   *  resolve depending on whether the parent portal overwrites the
   *  canonical path or writes versioned paths. Always populated. */
  previousUrl: string | null;
  /** Discriminates the write path that produced this row. The history
   *  dialog renders different UI per source. */
  source: DocumentRevisionSource;
  statusSnapshot: string | null;
  expirySnapshot: string | null;
  passportNumberSnapshot: string | null;
  passTypeSnapshot: string | null;
  note: string | null;
  replacedByEmail: string | null;
  replacedAt: string;
};

/** Revision history for one document slot, newest first. */
export async function getDocumentRevisions(
  ayCode: string,
  enroleeNumber: string,
  slotKey: string,
): Promise<DocumentRevision[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('p_file_revisions')
    .select(
      'id, archived_url, previous_url, source, status_snapshot, expiry_snapshot, passport_number_snapshot, pass_type_snapshot, note, replaced_by_email, replaced_at',
    )
    .eq('ay_code', ayCode)
    .eq('enrolee_number', enroleeNumber)
    .eq('slot_key', slotKey)
    .order('replaced_at', { ascending: false });

  if (error || !data) return [];

  return data.map((r) => ({
    id: r.id as string,
    archivedUrl: (r.archived_url ?? null) as string | null,
    previousUrl: (r.previous_url ?? null) as string | null,
    source: ((r.source as DocumentRevisionSource | null) ?? 'pfile-upload'),
    statusSnapshot: (r.status_snapshot ?? null) as string | null,
    expirySnapshot: (r.expiry_snapshot ?? null) as string | null,
    passportNumberSnapshot: (r.passport_number_snapshot ?? null) as string | null,
    passTypeSnapshot: (r.pass_type_snapshot ?? null) as string | null,
    note: (r.note ?? null) as string | null,
    replacedByEmail: (r.replaced_by_email ?? null) as string | null,
    replacedAt: r.replaced_at as string,
  }));
}

export async function getStudentDocumentDetail(
  ayCode: string,
  enroleeNumber: string,
): Promise<StudentDocumentDetail | null> {
  const service = createServiceClient();
  const prefix = prefixFor(ayCode);

  const [appRes, statusRes, docRes, outreachRes] = await Promise.all([
    service
      .from(`${prefix}_enrolment_applications`)
      .select(
        '"enroleeNumber", "studentNumber", "firstName", "lastName", "motherEmail", "fatherEmail", "guardianEmail", "motherFirstName", "motherLastName", "fatherFirstName", "fatherLastName", "guardianFirstName", "guardianLastName", "stpApplicationType"',
      )
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    service
      .from(`${prefix}_enrolment_status`)
      .select('"enroleeNumber", "applicationStatus", "classLevel", "classSection"')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    service
      .from(`${prefix}_enrolment_documents`)
      .select('*')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    service
      .from('p_file_outreach')
      .select('slot_key, kind, promised_until, note, recipient_email, created_at')
      .eq('ay_code', ayCode)
      .eq('enrolee_number', enroleeNumber)
      .order('created_at', { ascending: false }),
  ]);

  if (!appRes.data) return null;

  const docRow = (docRes.data ?? {}) as RawDocRow;
  const completeness = computeForStudent(
    appRes.data as RawAppRow,
    (statusRes.data ?? undefined) as RawStatusRow | undefined,
    docRow.enroleeNumber ? docRow : undefined,
  );

  // Reduce outreach rows (newest-first) into a per-slot summary. Only
  // the latest reminder timestamp is retained; only the latest promise
  // whose `promised_until >= today` counts as 'active'.
  const todayIso = new Date().toISOString().slice(0, 10);
  const outreach: StudentDocumentDetail['outreach'] = {};
  for (const raw of (outreachRes.data ?? []) as Array<Record<string, unknown>>) {
    const slotKey = (raw.slot_key as string | null) ?? null;
    const kind = (raw.kind as string | null) ?? null;
    if (!slotKey || (kind !== 'reminder' && kind !== 'promise')) continue;
    const summary = (outreach[slotKey] ??= { lastReminderAt: null, activePromise: null });
    if (kind === 'reminder' && summary.lastReminderAt === null) {
      summary.lastReminderAt = (raw.created_at as string) ?? null;
    } else if (kind === 'promise' && summary.activePromise === null) {
      const promisedUntil = (raw.promised_until as string | null) ?? null;
      if (promisedUntil && promisedUntil >= todayIso) {
        summary.activePromise = {
          promisedUntil,
          note: (raw.note as string | null) ?? null,
        };
      }
    }
  }

  const appRow = appRes.data as Record<string, unknown>;
  const recipients = {
    motherEmail: (appRow.motherEmail as string | null) ?? null,
    fatherEmail: (appRow.fatherEmail as string | null) ?? null,
    guardianEmail: (appRow.guardianEmail as string | null) ?? null,
  };

  function composeName(first: unknown, last: unknown): string | null {
    const f = typeof first === 'string' ? first.trim() : '';
    const l = typeof last === 'string' ? last.trim() : '';
    const composed = `${f} ${l}`.trim();
    return composed.length > 0 ? composed : null;
  }

  const family = {
    motherName: composeName(appRow.motherFirstName, appRow.motherLastName),
    fatherName: composeName(appRow.fatherFirstName, appRow.fatherLastName),
    guardianName: composeName(appRow.guardianFirstName, appRow.guardianLastName),
  };

  const stpApplicationType = (appRow.stpApplicationType as string | null) ?? null;

  // Latest 12 outreach events for the activity strip. The earlier reduce
  // over `outreachRes.data` keeps just the per-slot summary; here we
  // surface the raw events too (capped) for the timeline view.
  const recentEvents = ((outreachRes.data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => {
      const k = r.kind;
      return k === 'reminder' || k === 'promise';
    })
    .slice(0, 12)
    .map((r) => ({
      kind: r.kind as 'reminder' | 'promise',
      slotKey: (r.slot_key as string | null) ?? '',
      createdAt: (r.created_at as string | null) ?? '',
      promisedUntil: (r.promised_until as string | null) ?? null,
      recipientEmail: (r.recipient_email as string | null) ?? null,
      note: (r.note as string | null) ?? null,
    }));

  return {
    ...completeness,
    rawDocRow: docRow,
    outreach,
    recipients,
    family,
    stpApplicationType,
    recentEvents,
  };
}
