// Phase "pfiles" (plan phase 7): document history (`p_file_revisions`) and
// the chase log (`p_file_outreach`).
//
// Production (prod-profile.md): 6,336 revisions over 750 enrolled enrolees
// (p50 9 per enrolee, p90 11, max 18), almost every one `parent-portal`, plus
// one `sis-direct` and one `pfile-upload`; the replaced version's status was
// Valid 45% / Uploaded 38% / Expired 16% (a handful Rejected / For submission
// / To follow); 65% carry an expiry. Outreach: one promise + one email
// reminder (both AY2026, fatherPassport). Locally: ~1,500 revisions over ~165
// enrolees in AY2025 + AY2026 (and one AY2027 child: idPicture + birthCert,
// as production), and 3 outreach rows: one family reminded about, then
// promising, an expired parent document (the father's passport when the
// seeded year has one expired, else the next parent document), plus a
// second family's reminder.
//
// Write paths — revisions are NEVER inserted by this phase:
//   * PARENT-PORTAL (all but two): the portal's re-upload, mirrored
//     (`studentReuploadDocuments` / `parentGuardianReuploadDocuments` in
//     ../app-online-admission/src/actions/private.ts). The parent's own login
//     (the admissions record's address, `ensureParent`) signs in; the
//     ownership check (`assertApplicationOwnership`: the address is the
//     child's mother / father / guardian email) runs through that session;
//     then the applications row (passport number / pass type + expiry, or
//     `enroleePhoto`) and the documents row (new link, `Valid` for an
//     expiring document, `Uploaded` otherwise, the new expiry) are updated
//     through the same session. The database's `capture_doc_revision`
//     trigger turns each replaced link into a revision — source
//     `parent-portal` because the write carries the parent's JWT, with the
//     replaced version's status and expiry. The new links point at the local
//     stack's bucket and, like the people phase's, at no file (the portal's
//     upload of the file itself is not reproduced — 1,500 placeholder files
//     would only slow the rebuild; nothing reads them).
//   * PFILE-UPLOAD (one): POST /api/p-files/[enroleeNumber]/upload, mirrored
//     (it gates on a cookie session) — the documents officer's capability,
//     the slot rules, the real Storage writes (a tiny placeholder PDF in the
//     `parent-portal` bucket), the archive MOVE of the file it replaces,
//     `createRevision`, the documents update and the route's `pfile.upload`
//     audit row. Two uploads into a slot that was empty: the first has
//     nothing to archive (and no revision), the second archives the first.
//   * SIS-DIRECT (one): what the trigger records for a write that carries no
//     JWT at all — a maintenance script repointing a file link over a direct
//     database connection (production's one row came from such a script; the
//     app's own service-role writes carry a JWT and record `parent-portal`).
//     Reproduced as a direct SQL UPDATE of one link.
//   * OUTREACH: PATCH /api/p-files/[enroleeNumber]/promise (the slot flips to
//     "To follow", a `promise` row, `pfile.mark.promised`) and POST
//     /api/p-files/[enroleeNumber]/notify (`runNotify`'s gates, the
//     `claim_pfile_reminder` RPC that inserts the `reminder` row, the route's
//     `pfile.reminder.sent`). ⚠ Mail is disabled (harness), and the real
//     `runNotify` RETRACTS its claim when no email went out — so the notify
//     path is mirrored step for step with the send treated as delivered
//     (`sent: 1`), which is what production's row records.
//
// ⚠ Deliberate differences, each for determinism (lib/constants.ts):
//   * `replaced_at` is the database's `now()` when the trigger / createRevision
//     inserts; the dashboards chart revisions over time, so once each version
//     lands its revision's `replaced_at` is set to the simulated moment of
//     that re-upload (May–September 2026, before TODAY), matched on the
//     revision's own unique key (ay, enrolee, slot, replaced link).
//   * the staff upload's archive path uses the simulated moment, not
//     `new Date()` (it lands in the audit row).
//   * the promise's `promisedUntil` must be within 90 days of the REAL date
//     (the route checks the clock), so it is the run date + 30 days — one of
//     the run-date values lib/constants.ts lists and the verify fingerprints
//     mask.
//
// Idempotent: each slot's history is planned from its ORIGINAL version — the
// documents row exactly as the people phase seeded it, re-derived from its
// plan (`seededDocumentRows`), never the live row, whose status the app's
// freshen jobs flip from Valid to Expired whenever a page reads it — so a
// re-run plans the same links, finds them already in place and writes
// nothing; the staff upload, the direct write and each outreach row are
// skipped when already on record.
//
// No re-upload predates its application: a family's re-uploads begin a few
// days after the application came in (`familyBaseMs`), a family whose
// application arrived at the very end of the window is not chosen, and the
// staff upload and the direct write only touch records older than them.

import { revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { getCapabilitiesForRole } from '@/lib/auth/permission-map';
import type { Role } from '@/lib/auth/roles';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { resolveRecipients } from '@/lib/notifications/email-pfile-reminder';
import { ENROLLED_STATUSES, prefixFor } from '@/lib/p-files/_shared';
import { loadApplicantIdentity } from '@/lib/p-files/audit';
import { DOCUMENT_SLOTS } from '@/lib/p-files/document-config';
import { createRevision } from '@/lib/p-files/mutations';
import { isStudentEnrolled } from '@/lib/p-files/queries';
import { NotifySchema, PromiseSchema } from '@/lib/schemas/p-files';

import { LOCAL_PASSWORD, runDateSg } from '../lib/constants';
import { anon, must, service, sql, sqlRows } from '../lib/local';
import { rng, type Rng } from '../lib/random';
import { ensureParent } from './declarations';
import { seededDocumentRows } from './people';
import { STAFF, emailOf, staffId } from './staff';

type Ay = 'AY2025' | 'AY2026' | 'AY2027';
const AYS: Ay[] = ['AY2025', 'AY2026', 'AY2027'];
const BUCKET = 'parent-portal';

/** How many enrolees' families re-upload, per year (production ~ every enrolee; scaled). */
const CHAIN_ENROLEES: Record<Ay, number> = {
  AY2025: 80,
  AY2026: 85,
  AY2027: 1,
};

/** The slots the portal's re-upload covers (plus form12, which the update-application page writes the same way). */
const PORTAL_SLOTS = [
  'idPicture',
  'birthCert',
  'educCert',
  'medical',
  'form12',
  'passport',
  'pass',
  'motherPassport',
  'motherPass',
  'fatherPassport',
  'fatherPass',
  'guardianPassport',
  'guardianPass',
] as const;
type PortalSlot = (typeof PORTAL_SLOTS)[number];

const SLOT_META = new Map(DOCUMENT_SLOTS.map((s) => [s.key, s]));
const expires = (slot: string) => SLOT_META.get(slot)?.expires === true;

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const DAY = 86_400_000;
/** Re-uploads fall between these (UTC), before TODAY. */
const WINDOW_START = Date.UTC(2026, 4, 19, 0, 0);
const WINDOW_DAYS = 104; // → 2026-08-31; a second version adds up to 30 days
const WINDOW_END = WINDOW_START + WINDOW_DAYS * DAY;
/**
 * The earliest a family re-uploads after submitting the application. A family
 * whose application came in later than this before WINDOW_END re-uploads
 * nothing (the AY2027 child excepted, see `runPfiles`).
 */
const SETTLE_DAYS = 5;

const docUrl = (ay: Ay, enrolee: string, slot: string, atMs: number) =>
  `http://127.0.0.1:54321/storage/v1/object/public/parent-portal/${ay.toLowerCase()}/documents/${atMs}_${enrolee}_${slot}.${slot === 'idPicture' ? 'jpg' : 'pdf'}`;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ── Reads ─────────────────────────────────────────────────────────────────

type Enrolee = {
  ay: Ay;
  enrolee: string;
  owner: string; // the parent login that re-uploads (mother, else father, else guardian)
  /** When the application was submitted (its seeded `created_at`). */
  createdMs: number;
  emails: {
    motherEmail: string | null;
    fatherEmail: string | null;
    guardianEmail: string | null;
  };
};

type DocRow = Record<string, string | null>;

async function loadEnrolled(ay: Ay): Promise<Enrolee[]> {
  const sb = service();
  const p = prefixFor(ay);
  const status = await must(
    `pfiles: ${ay} status`,
    sb
      .from(`${p}_enrolment_status`)
      .select('"enroleeNumber"')
      .in('applicationStatus', [...ENROLLED_STATUSES])
  );
  const enrolled = new Set(
    (status as { enroleeNumber: string | null }[])
      .map((r) => r.enroleeNumber)
      .filter((e): e is string => !!e)
  );
  const apps = await must(
    `pfiles: ${ay} applications`,
    sb
      .from(`${p}_enrolment_applications`)
      .select(
        '"enroleeNumber","motherEmail","fatherEmail","guardianEmail",created_at'
      )
  );
  const docs = new Set(
    (
      (await must(
        `pfiles: ${ay} documents`,
        sb.from(`${p}_enrolment_documents`).select('"enroleeNumber"')
      )) as { enroleeNumber: string | null }[]
    ).map((r) => r.enroleeNumber)
  );
  const out: Enrolee[] = [];
  for (const a of apps as Array<Record<string, string | null>>) {
    const enrolee = a.enroleeNumber;
    if (!enrolee || !enrolled.has(enrolee) || !docs.has(enrolee)) continue;
    const norm = (e: string | null) => {
      const t = e?.trim().toLowerCase() ?? '';
      return EMAIL.test(t) ? t : null;
    };
    const owner =
      norm(a.motherEmail) ?? norm(a.fatherEmail) ?? norm(a.guardianEmail);
    if (!owner) continue;
    out.push({
      ay,
      enrolee,
      owner,
      createdMs: Date.parse(a.created_at ?? '') || 0,
      emails: {
        motherEmail: a.motherEmail,
        fatherEmail: a.fatherEmail,
        guardianEmail: a.guardianEmail,
      },
    });
  }
  return out.sort((x, y) => x.enrolee.localeCompare(y.enrolee));
}

async function loadDocRows(ay: Ay): Promise<Map<string, DocRow>> {
  const rows = await must(
    `pfiles: ${ay} document rows`,
    service()
      .from(`${prefixFor(ay)}_enrolment_documents`)
      .select('*')
  );
  const map = new Map<string, DocRow>();
  for (const r of rows as DocRow[])
    if (r.enroleeNumber) map.set(r.enroleeNumber, r);
  return map;
}

/** A slot's ORIGINAL version: the link, status and expiry the people phase seeded. */
type FirstRevision = {
  url: string;
  status: string | null;
  expiry: string | null;
};

// ── Planning ──────────────────────────────────────────────────────────────

type Step = {
  url: string;
  status: 'Valid' | 'Uploaded';
  expiry: string | null; // expiring slots only
  renewNumber: string | null; // a renewed passport's new number
  atMs: number;
};

/** Chance the family replaced a slot, by the status the original version had. */
function replaceChance(status: string | null): number {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'expired') return 0.95;
  if (s === 'rejected') return 0.35;
  if (s === 'valid' || s === 'uploaded') return 0.9;
  return 0.15; // to follow / for submission with a link already on file
}

function newPassportNumber(r: Rng): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  return `P${String(r.int(0, 9_999_999)).padStart(7, '0')}${r.pick(letters.split(''))}`;
}

function planSlot(
  ay: Ay,
  enrolee: string,
  slot: PortalSlot,
  original: FirstRevision,
  baseMs: number,
  forced: boolean
): Step[] {
  const r = rng(`pfiles:slot:${ay}:${enrolee}:${slot}`);
  const chance = r.next();
  if (!forced && chance >= replaceChance(original.status)) return [];
  const steps: Step[] = [];
  const t1 = baseMs + r.int(0, 45) * 60_000;
  const isExpiring = expires(slot);
  let expiry: string | null = null;
  let renewNumber: string | null = null;
  if (isExpiring) {
    const lapsed =
      (original.status ?? '').toLowerCase() === 'expired' ||
      !original.expiry ||
      original.expiry <= isoDate(t1);
    if (lapsed) {
      const isPassport = SLOT_META.get(slot)?.meta?.kind === 'passport';
      const years = isPassport ? r.int(5, 10) : r.int(1, 2);
      const d = new Date(t1);
      d.setUTCFullYear(d.getUTCFullYear() + years);
      expiry = isoDate(d.getTime() + r.int(0, 200) * DAY);
      if (isPassport) renewNumber = newPassportNumber(r);
    } else {
      expiry = original.expiry; // a clearer scan of the same document
    }
  }
  const status = isExpiring ? 'Valid' : 'Uploaded';
  steps.push({
    url: docUrl(ay, enrolee, slot, t1),
    status,
    expiry,
    renewNumber,
    atMs: t1,
  });
  // A few slots get a second version (a re-scan) a week or few later — more
  // often after a rejection or a renewal, so those histories run several
  // versions deep.
  const lapsedOrRejected = ['expired', 'rejected'].includes(
    (original.status ?? '').toLowerCase()
  );
  if (!forced && r.chance(lapsedOrRejected ? 0.35 : 0.1)) {
    const t2 = t1 + r.int(5, 30) * DAY + r.int(0, 600) * 60_000;
    steps.push({
      url: docUrl(ay, enrolee, slot, t2),
      status,
      expiry,
      renewNumber: null,
      atMs: t2,
    });
  }
  return steps;
}

// ── The portal's re-upload, through the parent's session ─────────────────

const sessions = new Map<string, SupabaseClient>();

async function parentClient(email: string): Promise<SupabaseClient> {
  const cached = sessions.get(email);
  if (cached) return cached;
  try {
    await ensureParent(email);
  } catch (e) {
    // An account for this address already exists under another id (e.g.
    // created with different casing) — signing in still works.
    if (!/already|registered|exists/i.test(String(e))) throw e;
  }
  const client = anon();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: LOCAL_PASSWORD,
  });
  if (error || !data.session)
    throw new Error(`pfiles: sign-in as ${email}: ${error?.message}`);
  sessions.set(email, client);
  return client;
}

async function releaseSessions(): Promise<void> {
  for (const c of sessions.values()) await c.auth.signOut();
  sessions.clear();
}

/** One re-upload, as the portal's reupload action writes it. */
async function portalReupload(
  client: SupabaseClient,
  e: Enrolee,
  slot: PortalSlot,
  step: Step
): Promise<void> {
  const p = prefixFor(e.ay);
  const meta = SLOT_META.get(slot)?.meta ?? null;
  const appUpdates: Record<string, unknown> = {};
  if (meta && step.expiry) {
    appUpdates[meta.expiryCol] = step.expiry;
    if (meta.kind === 'passport' && step.renewNumber)
      appUpdates[meta.numberCol] = step.renewNumber;
  }
  if (slot === 'idPicture') appUpdates.enroleePhoto = step.url;
  const docUpdates: Record<string, unknown> = {
    [slot]: step.url,
    [`${slot}Status`]: step.status,
    ...(expires(slot) && step.expiry ? { [`${slot}Expiry`]: step.expiry } : {}),
  };
  if (Object.keys(appUpdates).length > 0) {
    const { error } = await client
      .from(`${p}_enrolment_applications`)
      .update(appUpdates)
      .eq('enroleeNumber', e.enrolee);
    if (error) throw new Error(`pfiles: ${e.enrolee} app: ${error.message}`);
  }
  const { error } = await client
    .from(`${p}_enrolment_documents`)
    .update(docUpdates)
    .eq('enroleeNumber', e.enrolee);
  if (error) throw new Error(`pfiles: ${e.enrolee} ${slot}: ${error.message}`);
}

async function assertOwnership(client: SupabaseClient, e: Enrolee) {
  const { data, error } = await client
    .from(`${prefixFor(e.ay)}_enrolment_applications`)
    .select('enroleeNumber')
    .eq('enroleeNumber', e.enrolee)
    .or(
      `fatherEmail.eq.${e.owner},motherEmail.eq.${e.owner},guardianEmail.eq.${e.owner}`
    )
    .maybeSingle();
  if (error || !data)
    throw new Error(
      `pfiles: ${e.owner} does not own ${e.enrolee} (the portal refuses)`
    );
}

type Backdate = {
  ay: Ay;
  enrolee: string;
  slot: string;
  prev: string;
  atMs: number;
};

async function pool<T>(items: T[], size: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

// ── Staff paths ───────────────────────────────────────────────────────────

const OFFICER = STAFF.find((s) => s.key === 'documents')!;
const officer = () => ({
  id: staffId(OFFICER),
  email: emailOf(OFFICER),
  role: OFFICER.roles[0] as Role,
});

async function requireCapability(cap: string): Promise<void> {
  const caps = (await getCapabilitiesForRole(officer().role)) as string[];
  if (!caps.includes(cap))
    throw new Error(`pfiles: ${officer().email} lacks ${cap} (the route 403s)`);
}

const PLACEHOLDER_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
);

/** POST /api/p-files/[enroleeNumber]/upload, mirrored for one non-expiring PDF slot. */
async function staffUpload(
  ayCode: Ay,
  enroleeNumber: string,
  slotKey: string,
  note: string | null,
  atMs: number
): Promise<void> {
  const sb = service();
  const slot = DOCUMENT_SLOTS.find((s) => s.key === slotKey);
  if (!slot || slot.expires || slot.meta || slotKey === 'idPicture')
    throw new Error(`pfiles: ${slotKey} is not a plain PDF slot`);
  const enrolled = await isStudentEnrolled(ayCode, enroleeNumber);
  await requireCapability(
    enrolled
      ? 'documents_post_enrolment.upload'
      : 'documents_pre_enrolment.upload'
  );
  const prefix = prefixFor(ayCode);
  const [current] = (await must(
    'pfiles: upload current',
    sb
      .from(`${prefix}_enrolment_documents`)
      .select(`"${slotKey}", "${slotKey}Status"`)
      .eq('enroleeNumber', enroleeNumber)
  )) as Array<Record<string, string | null>>;
  const currentUrl = current?.[slotKey] ?? null;
  const currentStatus = current?.[`${slotKey}Status`] ?? null;
  const canonicalPath = `${prefix}/${enroleeNumber}/${slotKey}.pdf`;
  const outcome = {
    replaced: currentUrl !== null,
    archived: false,
    archivedUrl: null as string | null,
    archiveError: null as string | null,
  };
  if (currentUrl) {
    const marker = `/${BUCKET}/`;
    const idx = currentUrl.indexOf(marker);
    const currentPath =
      idx < 0
        ? null
        : decodeURIComponent(
            currentUrl.slice(idx + marker.length).split('?')[0]
          );
    if (!currentPath) {
      outcome.archiveError =
        'The stored link does not point into the documents bucket, so the old file could not be archived.';
    } else {
      const iso = new Date(atMs).toISOString().replace(/[:.]/g, '-');
      const archivePath = `${prefix}/${enroleeNumber}/${slotKey}/revisions/${iso}.pdf`;
      const { error: moveError } = await sb.storage
        .from(BUCKET)
        .move(currentPath, archivePath);
      if (moveError) {
        outcome.archiveError = moveError.message;
      } else {
        const archivedUrl = sb.storage.from(BUCKET).getPublicUrl(archivePath)
          .data.publicUrl;
        const rev = await createRevision(sb, {
          ayCode,
          enroleeNumber,
          slotKey,
          archivedUrl,
          archivedPath: archivePath,
          previousUrl: currentUrl,
          statusSnapshot: currentStatus,
          expirySnapshot: null,
          passportNumberSnapshot: null,
          passTypeSnapshot: null,
          note,
          replacedByUserId: officer().id,
          replacedByEmail: officer().email,
        });
        if (!rev.ok) throw new Error(`pfiles: createRevision: ${rev.error}`);
        outcome.archived = true;
        outcome.archivedUrl = archivedUrl;
      }
    }
  }
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(canonicalPath, PLACEHOLDER_PDF, {
      upsert: true,
      contentType: 'application/pdf',
    });
  if (upErr) throw new Error(`pfiles: storage upload: ${upErr.message}`);
  const publicUrl = sb.storage.from(BUCKET).getPublicUrl(canonicalPath)
    .data.publicUrl;
  const updated = await must(
    'pfiles: upload document update',
    sb
      .from(`${prefix}_enrolment_documents`)
      .update({ [slotKey]: publicUrl, [`${slotKey}Status`]: 'Valid' })
      .eq('enroleeNumber', enroleeNumber)
      .select('"enroleeNumber"')
  );
  if ((updated as unknown[]).length === 0)
    throw new Error(`pfiles: ${enroleeNumber} has no documents row (409)`);
  const who = await loadApplicantIdentity(sb, ayCode, enroleeNumber);
  await logAction({
    service: sb,
    actor: officer(),
    action: 'pfile.upload',
    entityType: 'enrolment_document',
    entityId: enroleeNumber,
    context: {
      ay_code: ayCode,
      ...who,
      slotKey,
      label: slot.label,
      fileCount: 1,
      merged: false,
      replaced: outcome.replaced,
      archived: outcome.archived,
      ...(outcome.archiveError
        ? { archiveFailed: true, archiveError: outcome.archiveError }
        : {}),
      ...(outcome.archivedUrl ? { archivedUrl: outcome.archivedUrl } : {}),
      oldUrl: currentUrl,
      newUrl: publicUrl,
      priorStatus: currentStatus,
      newStatus: 'Valid',
      ...(note ? { note } : {}),
    },
  });
  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('p-files', ayCode);
}

/** PATCH /api/p-files/[enroleeNumber]/promise, mirrored (module 'p-files'). */
async function promiseRoute(
  ayCode: Ay,
  enroleeNumber: string,
  body: { slotKey: string; promisedUntil: string; note?: string }
): Promise<void> {
  const sb = service();
  const parsed = PromiseSchema.parse(body);
  const slot = DOCUMENT_SLOTS.find((s) => s.key === parsed.slotKey)!;
  const target = new Date(`${parsed.promisedUntil}T00:00:00Z`).getTime();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = (target - today.getTime()) / DAY;
  if (!(diff >= 0 && diff <= 90))
    throw new Error('pfiles: promisedUntil outside the 90-day horizon (400)');
  await requireCapability('documents_post_enrolment.chase');
  const prefix = prefixFor(ayCode);
  const [st] = (await must(
    'pfiles: promise status',
    sb
      .from(`${prefix}_enrolment_status`)
      .select('"applicationStatus"')
      .eq('enroleeNumber', enroleeNumber)
  )) as Array<{ applicationStatus: string | null }>;
  if (
    !st?.applicationStatus ||
    !(ENROLLED_STATUSES as readonly string[]).includes(st.applicationStatus)
  )
    throw new Error('pfiles: promise for a non-enrolled student (422)');
  const [doc] = (await must(
    'pfiles: promise doc',
    sb
      .from(`${prefix}_enrolment_documents`)
      .select(`"${parsed.slotKey}","${parsed.slotKey}Status"`)
      .eq('enroleeNumber', enroleeNumber)
  )) as Array<Record<string, string | null>>;
  const priorStatus = (doc?.[`${parsed.slotKey}Status`] ?? '').toLowerCase();
  const priorUrl = doc?.[parsed.slotKey] ?? null;
  if (
    !(
      priorStatus === 'expired' ||
      priorStatus === 'rejected' ||
      (!priorUrl && !priorStatus)
    )
  )
    throw new Error(`pfiles: promise on a ${priorStatus} slot (422)`);
  await must(
    'pfiles: promise flip',
    sb
      .from(`${prefix}_enrolment_documents`)
      .update({ [`${parsed.slotKey}Status`]: 'To follow' })
      .eq('enroleeNumber', enroleeNumber)
      .select('"enroleeNumber"')
  );
  const note = parsed.note?.trim() || null;
  const { error } = await sb.from('p_file_outreach').insert({
    ay_code: ayCode,
    enrolee_number: enroleeNumber,
    slot_key: parsed.slotKey,
    kind: 'promise',
    promised_until: parsed.promisedUntil,
    note,
    created_by_user_id: officer().id,
    created_by_email: officer().email,
  });
  if (error) throw new Error(`pfiles: promise insert: ${error.message}`);
  const who = await loadApplicantIdentity(sb, ayCode, enroleeNumber);
  await logAction({
    service: sb,
    actor: officer(),
    action: 'pfile.mark.promised',
    entityType: 'enrolment_document',
    entityId: `${enroleeNumber}:${parsed.slotKey}`,
    context: {
      ay_code: ayCode,
      ...who,
      slot_key: parsed.slotKey,
      label: slot.label,
      module: 'p-files',
      promised_until: parsed.promisedUntil,
      prior_status: priorStatus || null,
      new_status: 'To follow',
      ...(note ? { note } : {}),
    },
  });
  revalidateTag(`sis:${ayCode}`, 'max');
  invalidateDrillTags('p-files', ayCode);
}

/**
 * POST /api/p-files/[enroleeNumber]/notify, mirrored: `runNotify`'s gates
 * (enrolled, an actionable status, a recipient), the `claim_pfile_reminder`
 * RPC (which inserts the reminder row), the send — DISABLED locally, treated
 * as delivered — and the route's audit row.
 */
async function notifyRoute(
  ayCode: Ay,
  enroleeNumber: string,
  body: { slotKey: string }
): Promise<void> {
  const sb = service();
  const { slotKey } = NotifySchema.parse(body);
  await requireCapability('documents_post_enrolment.chase');
  const slot = DOCUMENT_SLOTS.find((s) => s.key === slotKey)!;
  const prefix = prefixFor(ayCode);
  const [app] = (await must(
    'pfiles: notify app',
    sb
      .from(`${prefix}_enrolment_applications`)
      .select(
        '"enroleeNumber","studentNumber","firstName","middleName","lastName","enroleeFullName","motherEmail","fatherEmail","guardianEmail"'
      )
      .eq('enroleeNumber', enroleeNumber)
  )) as Array<Record<string, string | null>>;
  const [st] = (await must(
    'pfiles: notify status',
    sb
      .from(`${prefix}_enrolment_status`)
      .select('"applicationStatus"')
      .eq('enroleeNumber', enroleeNumber)
  )) as Array<{ applicationStatus: string | null }>;
  if (
    !app ||
    !st?.applicationStatus ||
    !(ENROLLED_STATUSES as readonly string[]).includes(st.applicationStatus)
  )
    throw new Error('pfiles: notify for a non-enrolled student (422)');
  const [doc] = (await must(
    'pfiles: notify doc',
    sb
      .from(`${prefix}_enrolment_documents`)
      .select(`"${slotKey}","${slotKey}Status"`)
      .eq('enroleeNumber', enroleeNumber)
  )) as Array<Record<string, string | null>>;
  const s = (doc?.[`${slotKey}Status`] ?? '').trim().toLowerCase();
  if (!['rejected', 'expired', 'to follow'].includes(s))
    throw new Error(`pfiles: notify on a ${s} slot (422 no_actionable_status)`);
  const envelope = resolveRecipients(slotKey, {
    motherEmail: app.motherEmail,
    fatherEmail: app.fatherEmail,
    guardianEmail: app.guardianEmail,
  });
  if (envelope.kind === 'none')
    throw new Error('pfiles: notify with no recipient (422)');
  const { data: claim, error } = await sb.rpc('claim_pfile_reminder', {
    p_ay_code: ayCode,
    p_enrolee_number: enroleeNumber,
    p_slot_key: slotKey,
    p_recipient_email: envelope.to,
    p_created_by_user_id: officer().id,
    p_created_by_email: officer().email,
  });
  if (error) throw new Error(`pfiles: claim: ${error.message}`);
  if (!(claim as { claimed?: boolean })?.claimed)
    throw new Error('pfiles: reminder on cooldown (429)');
  const who = await loadApplicantIdentity(sb, ayCode, enroleeNumber);
  await logAction({
    service: sb,
    actor: officer(),
    action: 'pfile.reminder.sent',
    entityType: 'enrolment_document',
    entityId: `${enroleeNumber}:${slotKey}`,
    context: {
      ay_code: ayCode,
      ...who,
      slot_key: slotKey,
      label: slot.label,
      module: 'p-files',
      to: envelope.to,
      cc: envelope.cc,
      recipients: 1,
      sent: 1,
      failed: 0,
    },
  });
  invalidateDrillTags('p-files', ayCode);
}

// ── The phase ─────────────────────────────────────────────────────────────

/**
 * Which enrolees' families re-upload: immutable inputs only (enrolment,
 * address, when the application came in). A family can only replace a
 * document after submitting it, so an application that arrived too late in
 * the re-upload window is left out.
 */
export function chainEnrolees(ay: Ay, eligible: Enrolee[]): Enrolee[] {
  return rng(`pfiles:enrolees:${ay}`)
    .shuffle(
      eligible.filter((e) => e.createdMs + SETTLE_DAYS * DAY <= WINDOW_END)
    )
    .slice(0, CHAIN_ENROLEES[ay]);
}

/**
 * When a family's re-uploads begin: a seeded moment in the window, but never
 * within SETTLE_DAYS of the application itself (a re-upload replaces a
 * document the application carried, so it cannot come first).
 */
function familyBaseMs(ay: Ay, e: Enrolee): number {
  const base = rng(`pfiles:base:${ay}:${e.enrolee}`);
  const inWindow =
    WINDOW_START +
    base.int(0, WINDOW_DAYS) * DAY +
    base.int(0, 14 * 60) * 60_000;
  const settled =
    e.createdMs +
    (SETTLE_DAYS - base.int(0, 3)) * DAY +
    base.int(0, 600) * 60_000;
  return Math.max(inWindow, settled);
}

export async function runPfiles(): Promise<void> {
  const backdates: Backdate[] = [];
  let written = 0;
  let already = 0;
  let unexpected = 0;
  const nonChain: Record<Ay, Enrolee[]> = {
    AY2025: [],
    AY2026: [],
    AY2027: [],
  };

  for (const ay of AYS) {
    const eligible = await loadEnrolled(ay);
    // Each slot's ORIGINAL version, as the people phase inserted it.
    const seeded = seededDocumentRows(ay);
    const seededOf = (en: string) =>
      (seeded.get(en) ?? {}) as Record<string, string | null>;
    let chosen: Enrolee[];
    if (ay === 'AY2027') {
      // Production's one AY2027 history: an ID picture and a birth certificate.
      chosen = eligible
        .filter(
          (e) =>
            !!seededOf(e.enrolee).idPicture && !!seededOf(e.enrolee).birthCert
        )
        .slice(0, 1);
    } else {
      chosen = chainEnrolees(ay, eligible);
    }
    const chosenSet = new Set(chosen.map((e) => e.enrolee));
    nonChain[ay] = eligible.filter((e) => !chosenSet.has(e.enrolee));

    const docs = await loadDocRows(ay);
    type Job = { e: Enrolee; work: Array<{ slot: PortalSlot; steps: Step[] }> };
    const jobs: Job[] = [];
    for (const e of chosen) {
      const row = docs.get(e.enrolee)!;
      const first = seededOf(e.enrolee);
      const baseMs = familyBaseMs(ay, e);
      const slots: PortalSlot[] =
        ay === 'AY2027' ? ['idPicture', 'birthCert'] : [...PORTAL_SLOTS];
      const work: Job['work'] = [];
      for (const slot of slots) {
        // Planned from the seeded original, never the live row: a page that
        // read the slot may have flipped its status since (freshen jobs).
        const original: FirstRevision = {
          url: first[slot] ?? '',
          status: first[`${slot}Status`] ?? null,
          expiry: expires(slot) ? (first[`${slot}Expiry`] ?? null) : null,
        };
        if (!original.url) continue;
        const steps = planSlot(
          ay,
          e.enrolee,
          slot,
          original,
          baseMs,
          ay === 'AY2027'
        );
        if (steps.length === 0) continue;
        // Where the slot stands: still the original, part-way, or done.
        const cur = row[slot];
        const at =
          cur === original.url ? -1 : steps.findIndex((s) => s.url === cur);
        if (cur !== original.url && at < 0) {
          unexpected++;
          continue;
        }
        const chain = [original.url, ...steps.map((s) => s.url)];
        steps.forEach((s, i) =>
          backdates.push({
            ay,
            enrolee: e.enrolee,
            slot,
            prev: chain[i],
            atMs: s.atMs,
          })
        );
        already += at + 1;
        const todo = steps.slice(at + 1);
        if (todo.length) work.push({ slot, steps: todo });
      }
      if (work.length) jobs.push({ e, work });
    }

    // One family at a time per login; a few families in parallel.
    const byOwner = new Map<string, Job[]>();
    for (const j of jobs)
      byOwner.set(j.e.owner, [...(byOwner.get(j.e.owner) ?? []), j]);
    await pool([...byOwner.entries()], 6, async ([owner, list]) => {
      const client = await parentClient(owner);
      for (const { e, work } of list) {
        await assertOwnership(client, e);
        // In time order across the family's slots, as the parent did them.
        const ordered = work
          .flatMap(({ slot, steps }) => steps.map((step) => ({ slot, step })))
          .sort((a, b) => a.step.atMs - b.step.atMs);
        for (const { slot, step } of ordered) {
          await portalReupload(client, e, slot, step);
          written++;
        }
      }
    });
  }
  await releaseSessions();

  // ── The staff upload (pfile-upload) and the direct write (sis-direct) ──
  const ay: Ay = 'AY2026';
  const docs26 = await loadDocRows(ay);
  const pool26 = nonChain.AY2026;
  // A record whose application came in at least a day before `atMs`.
  const pick = (key: string, atMs: number, ok: (row: DocRow) => boolean) =>
    rng(`pfiles:${key}`)
      .shuffle(pool26)
      .find((e) => e.createdMs + DAY <= atMs && ok(docs26.get(e.enrolee)!));
  const out: string[] = [];

  const hasRevision = (source: string) =>
    Number(
      sql(
        `select count(*) from p_file_revisions where ay_code = '${ay}' and source = '${source}'`
      )
    ) > 0;

  if (!hasRevision('pfile-upload')) {
    // A slot the officer fills, then corrects a day later.
    const canonical = (en: string) => `${prefixFor(ay)}/${en}/medical.pdf`;
    const t1 = Date.UTC(2026, 8, 2, 2, 15);
    const t2 = Date.UTC(2026, 8, 3, 1, 40);
    const target =
      pool26.find((e) =>
        (docs26.get(e.enrolee)?.medical ?? '').includes(canonical(e.enrolee))
      ) ?? pick('upload', t1, (row) => !row.medical && !row.medicalStatus);
    if (!target)
      throw new Error('pfiles: no enrolee with an empty medical slot');
    const cur = docs26.get(target.enrolee)?.medical ?? '';
    if (!cur.includes(canonical(target.enrolee)))
      await staffUpload(
        ay,
        target.enrolee,
        'medical',
        'Medical form handed in at the office; scanned and filed.',
        t1
      );
    await staffUpload(
      ay,
      target.enrolee,
      'medical',
      'Re-scanned: the first scan cut off the doctor’s stamp.',
      t2
    );
    backdates.push({
      ay,
      enrolee: target.enrolee,
      slot: 'medical',
      prev: '',
      atMs: t2,
    });
    out.push(`staff upload ${target.enrolee}/medical x2`);
  } else out.push('staff upload: already');

  if (!hasRevision('sis-direct')) {
    const at = Date.UTC(2026, 7, 26, 3, 5);
    const target = pick('direct', at, (row) => !!row.educCert);
    if (!target)
      throw new Error('pfiles: no enrolee with an education certificate');
    const prev = docs26.get(target.enrolee)!.educCert!;
    const next = docUrl(ay, target.enrolee, 'educCert', at);
    // A maintenance script's direct write: no JWT, so the trigger records `sis-direct`.
    sql(
      `update public.ay2026_enrolment_documents set "educCert" = '${next.replace(/'/g, "''")}' where "enroleeNumber" = '${target.enrolee}'`
    );
    backdates.push({
      ay,
      enrolee: target.enrolee,
      slot: 'educCert',
      prev,
      atMs: at,
    });
    out.push(`direct write ${target.enrolee}/educCert`);
  } else out.push('direct write: already');

  // ── Backdate every revision to the moment its replacement happened ──
  if (backdates.length) {
    const values = backdates
      .map(
        (b) =>
          `('${b.ay}','${b.enrolee}','${b.slot}','${b.prev.replace(/'/g, "''")}','${new Date(b.atMs).toISOString()}'::timestamptz)`
      )
      .join(',\n');
    sql(`update public.p_file_revisions r set replaced_at = v.at
           from (values ${values}) v(ay, en, slot, prev, at)
          where r.ay_code = v.ay and r.enrolee_number = v.en and r.slot_key = v.slot
            and (r.previous_url = v.prev or (v.prev = '' and r.source = 'pfile-upload'))
            and r.replaced_at is distinct from v.at;`);
  }

  // ── Outreach: a promise and two reminders (AY2026) ──
  // Production's pair is one child's father passport: reminded, then a
  // promise to renew. The third row: another family's expired pass.
  // In the order they were written (the first family's reminder comes first).
  const existing = sqlRows(
    `select kind, enrolee_number, slot_key from p_file_outreach where ay_code = '${ay}' order by created_at, id`
  );
  const has = (kind: string, en: string, slot: string) =>
    existing.some((r) => r[0] === kind && r[1] === en && r[2] === slot);
  const fresh = await loadDocRows(ay);
  const firstFor = (key: string, slot: string, exclude: Set<string>) =>
    rng(`pfiles:outreach:${key}`)
      .shuffle(pool26)
      .find(
        (e) =>
          !exclude.has(e.enrolee) &&
          fresh.get(e.enrolee)?.[`${slot}Status`] === 'Expired' &&
          !!fresh.get(e.enrolee)?.[slot] &&
          resolveRecipients(slot, e.emails).kind !== 'none'
      );

  // A parent's expired document, the father's passport first as in
  // production; the seeded year may have none expired, so the next parent
  // document stands in.
  const PARENT_SLOTS = [
    'fatherPassport',
    'fatherPass',
    'motherPassport',
    'motherPass',
  ];
  // The first family, once chosen, is read back — the promise row, else (a
  // run that died between the reminder and the promise) the first reminder —
  // never searched for again: the search reads live statuses, which change.
  const knownFirst =
    existing.find((r) => r[0] === 'promise') ??
    existing.find((r) => r[0] === 'reminder');
  const first: { en: string; slot: string } | null = knownFirst
    ? { en: knownFirst[1], slot: knownFirst[2] }
    : (PARENT_SLOTS.map((slot) => ({
        slot,
        en: firstFor(`first:${slot}`, slot, new Set())?.enrolee ?? '',
      })).find((c) => c.en) ?? null);
  if (!first) throw new Error('pfiles: no parent document has expired');
  const fatherEn = first.en;
  const parentWord = first.slot.startsWith('father') ? 'Father' : 'Mother';
  const docWord = first.slot.endsWith('Passport') ? 'passport' : 'pass';
  if (!has('reminder', fatherEn, first.slot)) {
    await notifyRoute(ay, fatherEn, { slotKey: first.slot });
    out.push(`reminder ${fatherEn}/${first.slot}`);
  }
  if (!has('promise', fatherEn, first.slot)) {
    const until = isoDate(Date.parse(`${runDateSg()}T00:00:00Z`) + 30 * DAY);
    await promiseRoute(ay, fatherEn, {
      slotKey: first.slot,
      promisedUntil: until,
      note: `<p>${parentWord} is renewing the ${docWord}; will upload the new one once collected.</p>`,
    });
    out.push(`promise ${fatherEn}/${first.slot}`);
  }
  const second = existing.find((r) => r[0] === 'reminder' && r[1] !== fatherEn);
  if (!second) {
    const pick2 =
      ['motherPass', 'motherPassport', 'fatherPass', 'pass', 'passport']
        .map((slot) => ({
          slot,
          e: firstFor(`second:${slot}`, slot, new Set([fatherEn])),
        }))
        .find((c) => c.e) ?? null;
    if (!pick2?.e) throw new Error('pfiles: nobody for the second reminder');
    await notifyRoute(ay, pick2.e.enrolee, { slotKey: pick2.slot });
    out.push(`reminder ${pick2.e.enrolee}/${pick2.slot}`);
  }

  const total = Number(sql(`select count(*) from p_file_revisions`));
  console.log(
    `  portal re-uploads: ${written} written now, ${already} already in place${unexpected ? `, ${unexpected} slots skipped (link not in the plan)` : ''}; ${out.join('; ')}; p_file_revisions total ${total}`
  );
}
