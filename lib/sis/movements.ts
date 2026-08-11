import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';
import { sgDate } from '@/lib/dates';
import { preloadTermsForAYs, termForDateInPreloaded } from '@/lib/sis/terms';
import {
  WITHDRAWAL_REASON_LABELS,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';

// /records/movements unified feed.
//
// Surfaces three enrolment-movement event kinds derived from `audit_log`:
//   - section-transfer  (action='student.section.transfer')
//   - withdrawn         (action='enrolment.metadata.update' where context.after.enrollment_status === 'withdrawn')
//   - late-enrolled     (action='enrolment.metadata.update' where context.lateEnrolleeTransition === true)
//
// Withdrawn + late-enrolled share the metadata.update action and are demuxed
// by inspecting the context blob; a single audit row only ever represents
// one boundary (each PATCH is one logical transition).
//
// No caching — registrars need a live view. Cross-AY mode pages past the
// PostgREST 1000-row cap via `fetchAllPages`.
//
// Scope-anchor note: the metadata.update audit row does NOT carry `ay_code`
// in context (the route resolves it only when needed for the late-enrollee
// term lookup, doesn't persist it — verified at
// `app/api/sections/[id]/students/[enrolmentId]/route.ts`). For current-AY
// mode we therefore fetch metadata rows unfiltered at the SQL layer and
// filter post-enrichment via the resolved section_students → sections AY.
// Transfer rows DO carry ay_code so they get filtered at the SQL layer.

export type MovementKind =
  | 'section-transfer'
  | 'withdrawn'
  | 'late-enrolled'
  | 're-enrolled';

export type MovementEvent =
  | {
      id: string;
      kind: 'section-transfer';
      studentNumber: string | null;
      studentName: string;
      enroleeNumber: string;
      level: string;
      ayCode: string;
      termNumber: number | null;
      termLabel: string | null;
      date: string; // ISO yyyy-mm-dd
      actorEmail: string | null;
      fromSection: string;
      toSection: string;
    }
  | {
      id: string;
      kind: 'withdrawn';
      studentNumber: string | null;
      studentName: string;
      enroleeNumber: string;
      level: string;
      ayCode: string;
      termNumber: number | null;
      termLabel: string | null;
      date: string;
      actorEmail: string | null;
      reason: string | null;
      reasonLabel: string | null;
    }
  | {
      id: string;
      kind: 'late-enrolled' | 're-enrolled';
      studentNumber: string | null;
      studentName: string;
      enroleeNumber: string;
      level: string;
      ayCode: string;
      termNumber: number | null;
      termLabel: string | null;
      date: string;
      actorEmail: string | null;
    };

export type GetMovementsOptions = { includeAllAYs?: boolean };

// ── Internal types ──────────────────────────────────────────────────────────

type AuditRow = {
  id: string;
  actor_email: string | null;
  entity_id: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
};

// Transfer-flavoured partial: most fields populated from the route's context
// blob; only `studentName` (and sometimes `studentNumber`) need an AY-apps
// lookup to fill in.
type TransferPartial = {
  id: string;
  kind: 'section-transfer';
  studentNumber: string | null;
  studentName: string | null;
  enroleeNumber: string;
  level: string;
  ayCode: string;
  date: string;
  actorEmail: string | null;
  fromSection: string;
  toSection: string;
  ctxTermNumber: number | null;
  ctxTermLabel: string | null;
};

// Metadata-flavoured partial: entity_id is section_students.id UUID;
// student/section/AY/level all resolved during enrichment.
type MetadataPartial = {
  id: string;
  kind: 'withdrawn' | 'late-enrolled' | 're-enrolled';
  sectionStudentId: string;
  date: string;
  actorEmail: string | null;
  ctxTermNumber: number | null;
  ctxTermLabel: string | null;
  reason?: string | null;
  reasonLabel?: string | null;
};

// Enriched intermediate — has everything except term enrichment.
type EnrichedPartial = {
  id: string;
  kind: MovementKind;
  studentNumber: string | null;
  studentName: string;
  enroleeNumber: string;
  level: string;
  ayCode: string;
  date: string;
  actorEmail: string | null;
  fromSection?: string;
  toSection?: string;
  ctxTermNumber: number | null;
  ctxTermLabel: string | null;
  reason?: string | null;
  reasonLabel?: string | null;
};

// ── Public API ──────────────────────────────────────────────────────────────

export async function getMovementEvents(
  currentAyCode: string,
  options: GetMovementsOptions = {}
): Promise<MovementEvent[]> {
  const service = createServiceClient();
  const includeAll = options.includeAllAYs === true;

  const [transferPartials, metadataPartials] = await Promise.all([
    fetchTransferEvents(service, includeAll, currentAyCode),
    fetchMetadataEvents(service, includeAll),
  ]);

  const enriched = await enrichWithStudents(
    service,
    transferPartials,
    metadataPartials,
    includeAll,
    currentAyCode
  );

  // Term enrichment — one preload covering every AY we saw.
  const distinctAyCodes = Array.from(
    new Set(enriched.map((e) => e.ayCode).filter((c) => !!c))
  );
  const preloaded =
    distinctAyCodes.length > 0
      ? await preloadTermsForAYs(distinctAyCodes, service)
      : new Map<
          string,
          Array<{ termNumber: number; startDate: string; endDate: string }>
        >();

  const events: MovementEvent[] = enriched.map((e) => {
    const term = e.ayCode
      ? termForDateInPreloaded(e.date, e.ayCode, preloaded)
      : null;
    // For late-enrolled events the registrar's explicit override
    // (lateEnrolleeTermNumber in the audit context, surfaced as ctxTermNumber)
    // is the authoritative joining term per KD #111/#117/#146 — it is set by
    // the registrar when tagging a student, while the date-derived term is only
    // a fallback. For all other event kinds, the date-derived term comes first
    // (it is strictly more accurate than any context value, which is recorded
    // at write-time and may lag the actual calendar).
    const termNumber =
      e.kind === 'late-enrolled'
        ? (e.ctxTermNumber ?? term?.termNumber ?? null)
        : (term?.termNumber ?? e.ctxTermNumber ?? null);
    const termLabel =
      e.kind === 'late-enrolled'
        ? (e.ctxTermLabel ?? term?.termLabel ?? null)
        : (term?.termLabel ?? e.ctxTermLabel ?? null);

    if (e.kind === 'section-transfer') {
      return {
        id: e.id,
        kind: 'section-transfer',
        studentNumber: e.studentNumber,
        studentName: e.studentName,
        enroleeNumber: e.enroleeNumber,
        level: e.level,
        ayCode: e.ayCode,
        termNumber,
        termLabel,
        date: e.date,
        actorEmail: e.actorEmail,
        fromSection: e.fromSection ?? '',
        toSection: e.toSection ?? '',
      };
    }
    if (e.kind === 'withdrawn') {
      return {
        id: e.id,
        kind: 'withdrawn',
        studentNumber: e.studentNumber,
        studentName: e.studentName,
        enroleeNumber: e.enroleeNumber,
        level: e.level,
        ayCode: e.ayCode,
        termNumber,
        termLabel,
        date: e.date,
        actorEmail: e.actorEmail,
        reason: e.reason ?? null,
        reasonLabel: e.reasonLabel ?? null,
      };
    }
    return {
      id: e.id,
      kind: e.kind,
      studentNumber: e.studentNumber,
      studentName: e.studentName,
      enroleeNumber: e.enroleeNumber,
      level: e.level,
      ayCode: e.ayCode,
      termNumber,
      termLabel,
      date: e.date,
      actorEmail: e.actorEmail,
    };
  });

  // Sort by date desc — string compare on ISO yyyy-mm-dd is correct.
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return events;
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function fetchTransferEvents(
  service: SupabaseClient,
  includeAll: boolean,
  currentAyCode: string
): Promise<TransferPartial[]> {
  let rows: AuditRow[] = [];
  if (includeAll) {
    try {
      rows = await fetchAllPages<AuditRow>((from, to) =>
        service
          .from('audit_log')
          .select('id, actor_email, entity_id, context, created_at')
          .eq('action', 'student.section.transfer')
          .order('created_at', { ascending: false })
          .range(from, to)
      );
    } catch (e) {
      console.warn(
        '[movements] transfer fetch (all AYs) failed:',
        e instanceof Error ? e.message : String(e)
      );
      return [];
    }
  } else {
    // Paged like its all-AYs sibling above. `audit_log` is the one table here
    // that grows with nothing but time — 1,390 rows on 2026-08-10 and only
    // ever upward — so a transfer history that silently stops at 1,000 is a
    // matter of when, not whether.
    try {
      rows = await fetchAllPages<AuditRow>((from, to) =>
        service
          .from('audit_log')
          .select('id, actor_email, entity_id, context, created_at')
          .eq('action', 'student.section.transfer')
          .eq('context->>ay_code', currentAyCode)
          .order('created_at', { ascending: false })
          .range(from, to)
      );
    } catch (e) {
      console.warn(
        '[movements] transfer fetch failed:',
        e instanceof Error ? e.message : e
      );
      return [];
    }
  }

  const out: TransferPartial[] = [];
  for (const row of rows) {
    const ctx = (row.context ?? {}) as Record<string, unknown>;
    const ayCode = (ctx.ay_code as string | undefined) ?? '';
    const enroleeNumber =
      (ctx.enroleeNumber as string | undefined) ?? row.entity_id ?? '';
    if (!enroleeNumber) continue;
    const date =
      (ctx.transferDate as string | undefined)?.trim() ||
      sgDate(row.created_at);
    out.push({
      id: row.id,
      kind: 'section-transfer',
      studentNumber: (ctx.studentNumber as string | null | undefined) ?? null,
      studentName: (ctx.studentName as string | null | undefined) ?? null,
      enroleeNumber,
      level: (ctx.toLevel as string | undefined) ?? '',
      ayCode,
      date,
      actorEmail: row.actor_email,
      fromSection: (ctx.fromSection as string | undefined) ?? '',
      toSection: (ctx.toSection as string | undefined) ?? '',
      ctxTermNumber: (ctx.termNumber as number | null | undefined) ?? null,
      ctxTermLabel: (ctx.termLabel as string | null | undefined) ?? null,
    });
  }
  return out;
}

async function fetchMetadataEvents(
  service: SupabaseClient,
  includeAll: boolean
): Promise<MetadataPartial[]> {
  // We can't filter by AY at the SQL layer for metadata.update rows — see
  // the file-level scope-anchor note. Cross-AY scoping happens in
  // `enrichWithStudents` after the section_students lookup resolves the AY.
  let withdrawnRows: AuditRow[] = [];
  let lateRows: AuditRow[] = [];
  let reEnrolledRows: AuditRow[] = [];

  if (includeAll) {
    try {
      [withdrawnRows, lateRows, reEnrolledRows] = await Promise.all([
        fetchAllPages<AuditRow>((from, to) =>
          service
            .from('audit_log')
            .select('id, actor_email, entity_id, context, created_at')
            .eq('action', 'enrolment.metadata.update')
            .eq('context->after->>enrollment_status', 'withdrawn')
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
        fetchAllPages<AuditRow>((from, to) =>
          service
            .from('audit_log')
            .select('id, actor_email, entity_id, context, created_at')
            .eq('action', 'enrolment.metadata.update')
            .eq('context->>lateEnrolleeTransition', 'true')
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
        fetchAllPages<AuditRow>((from, to) =>
          service
            .from('audit_log')
            .select('id, actor_email, entity_id, context, created_at')
            .eq('action', 'enrolment.metadata.update')
            .eq('context->>reEnrolment', 'true')
            .order('created_at', { ascending: false })
            .range(from, to)
        ),
      ]);
    } catch (e) {
      console.warn(
        '[movements] metadata fetch (all AYs) failed:',
        e instanceof Error ? e.message : String(e)
      );
      return [];
    }
  } else {
    // Ranged for the same reason as the transfer read above: `audit_log` grows
    // with time alone, and a movements page that silently loses the oldest
    // withdrawals is a history that quietly rewrites itself.
    const [wRes, lRes, rRes] = await Promise.all([
      service
        .from('audit_log')
        .select('id, actor_email, entity_id, context, created_at')
        .eq('action', 'enrolment.metadata.update')
        .eq('context->after->>enrollment_status', 'withdrawn')
        .order('created_at', { ascending: false })
        .range(0, 999),
      service
        .from('audit_log')
        .select('id, actor_email, entity_id, context, created_at')
        .eq('action', 'enrolment.metadata.update')
        .eq('context->>lateEnrolleeTransition', 'true')
        .order('created_at', { ascending: false })
        .range(0, 999),
      service
        .from('audit_log')
        .select('id, actor_email, entity_id, context, created_at')
        .eq('action', 'enrolment.metadata.update')
        .eq('context->>reEnrolment', 'true')
        .order('created_at', { ascending: false })
        .range(0, 999),
    ]);
    if (wRes.error) {
      console.warn('[movements] withdrawn fetch failed:', wRes.error.message);
    } else {
      withdrawnRows = (wRes.data ?? []) as AuditRow[];
    }
    if (lRes.error) {
      console.warn(
        '[movements] late-enrolled fetch failed:',
        lRes.error.message
      );
    } else {
      lateRows = (lRes.data ?? []) as AuditRow[];
    }
    if (rRes.error) {
      console.warn('[movements] re-enrolled fetch failed:', rRes.error.message);
    } else {
      reEnrolledRows = (rRes.data ?? []) as AuditRow[];
    }
  }

  const out: MetadataPartial[] = [];
  for (const row of withdrawnRows) {
    if (!row.entity_id) continue;
    const ctx = (row.context ?? {}) as Record<string, unknown>;
    // The audit context may have either the new structured key ('withdrawalReason')
    // or the old unstructured key ('reason') for backwards compat with old audit rows.
    const reasonRaw =
      (ctx.withdrawalReason as string | null | undefined) ?? null;
    const reasonFallback = (ctx.reason as string | null | undefined) ?? null;
    const resolvedReason = reasonRaw ?? reasonFallback ?? null;
    const reasonLabel: string | null =
      resolvedReason !== null && resolvedReason in WITHDRAWAL_REASON_LABELS
        ? WITHDRAWAL_REASON_LABELS[resolvedReason as WithdrawalReason]
        : null;
    out.push({
      id: row.id,
      kind: 'withdrawn',
      sectionStudentId: row.entity_id,
      date: sgDate(row.created_at),
      actorEmail: row.actor_email,
      ctxTermNumber: null,
      ctxTermLabel: null,
      reason: resolvedReason,
      reasonLabel,
    });
  }
  // Track late-row IDs so that re-enrolled rows that are ALSO late-enrolled
  // (the route sets both lateEnrolleeTransition=true AND reEnrolment=true in
  // the same audit context) are not double-counted. When both flags co-exist,
  // late-enrolled is dominant — it tells the story of *how* the student joined,
  // while re-enrolled tells *that* they had a prior enrolment. From the
  // population-movement perspective the event is a single late join.
  const lateRowIds = new Set<string>();
  for (const row of lateRows) {
    if (!row.entity_id) continue;
    lateRowIds.add(row.id);
    const ctx = (row.context ?? {}) as Record<string, unknown>;
    out.push({
      id: row.id,
      kind: 'late-enrolled',
      sectionStudentId: row.entity_id,
      date: sgDate(row.created_at),
      actorEmail: row.actor_email,
      ctxTermNumber:
        (ctx.lateEnrolleeTermNumber as number | null | undefined) ?? null,
      ctxTermLabel:
        (ctx.lateEnrolleeTermLabel as string | null | undefined) ?? null,
    });
  }
  for (const row of reEnrolledRows) {
    if (!row.entity_id) continue;
    // Skip rows already emitted as late-enrolled (de-dup, Bug 1 fix — see note
    // above). The row carries both flags; late-enrolled is the dominant kind.
    if (lateRowIds.has(row.id)) continue;
    out.push({
      id: row.id,
      kind: 're-enrolled',
      sectionStudentId: row.entity_id,
      date: sgDate(row.created_at),
      actorEmail: row.actor_email,
      ctxTermNumber: null,
      ctxTermLabel: null,
    });
  }
  return out;
}

// Resolves studentNumber / studentName / level / enroleeNumber / ayCode for
// partial events.
//
// Transfer rows: context already has level/ayCode/sections; only studentName
// (and sometimes studentNumber) need a lookup against the AY-prefixed apps
// table.
//
// Metadata rows: resolved via section_students.id → joined section + level
// + AY, then student_id → students table for student_number + name.
// enroleeNumber resolved via section_students.enrolee_number with the AY-
// apps fallback pattern from lib/sis/drill.ts (migration 041 didn't backfill).
async function enrichWithStudents(
  service: SupabaseClient,
  transferPartials: TransferPartial[],
  metadataPartials: MetadataPartial[],
  includeAll: boolean,
  currentAyCode: string
): Promise<EnrichedPartial[]> {
  // ── Pass 1: section_students enrichment for metadata rows ────────────────
  const metaIds = Array.from(
    new Set(metadataPartials.map((e) => e.sectionStudentId))
  );

  type SectionStudentRow = {
    id: string;
    student_id: string;
    enrolee_number: string | null;
    sections:
      | {
          name: string;
          levels:
            | { code: string; label: string }
            | { code: string; label: string }[];
          academic_year: { ay_code: string } | { ay_code: string }[];
        }
      | {
          name: string;
          levels:
            | { code: string; label: string }
            | { code: string; label: string }[];
          academic_year: { ay_code: string } | { ay_code: string }[];
        }[];
  };
  const ssById = new Map<
    string,
    {
      studentId: string;
      enroleeNumber: string | null;
      level: string;
      ayCode: string;
    }
  >();
  if (metaIds.length > 0) {
    // Chunked: `metaIds` is one uuid per movement event, and the page's
    // `?scope=all` toggle (KD #83) spans every AY ever created, so this grows
    // without bound as movement history accumulates. PostgREST puts `.in()` in
    // the URL and fails past ~14.3KB / 396 uuids (see lib/supabase/paginate.ts).
    // The existing `if (error)` below could never have caught that: a URL
    // overflow rejects the fetch outright rather than resolving to
    // `{ data, error }`, so it threw straight out of getMovementEvents and took
    // the whole page down instead of degrading to unenriched rows.
    const data = await fetchInChunks(metaIds, async (slice) => {
      const { data, error } = await service
        .from('section_students')
        .select(
          'id, student_id, enrolee_number, sections!inner(name, levels!inner(code, label), academic_year:academic_years!inner(ay_code))'
        )
        .in('id', slice);
      // Enrichment is cosmetic (names/levels on an audit-derived feed), so keep
      // the original non-fatal posture: warn and carry on with what resolved,
      // rather than failing the page.
      if (error) {
        console.warn(
          '[movements] section_students enrichment failed:',
          error.message
        );
        return [];
      }
      return data ?? [];
    });
    for (const row of data as SectionStudentRow[]) {
      const sec = Array.isArray(row.sections) ? row.sections[0] : row.sections;
      if (!sec) continue;
      const lvl = Array.isArray(sec.levels) ? sec.levels[0] : sec.levels;
      const ay = Array.isArray(sec.academic_year)
        ? sec.academic_year[0]
        : sec.academic_year;
      ssById.set(row.id, {
        studentId: row.student_id,
        enroleeNumber: row.enrolee_number,
        // Use the full label ("Primary 1", "Secondary 1") not the short
        // code ("P1", "S1") so the movements table reads naturally for
        // registrars. levels.label is the canonical word-form per
        // migration 029 + lib/sis/levels.ts. Fallback to code if label
        // is missing on a level row (shouldn't happen — both are NOT NULL).
        level: lvl?.label ?? lvl?.code ?? '',
        ayCode: ay?.ay_code ?? '',
      });
    }
  }

  // ── Pass 2: bulk students lookup for resolved student_ids ─────────────────
  const studentIds = Array.from(
    new Set(Array.from(ssById.values()).map((v) => v.studentId))
  );
  type StudentRow = {
    id: string;
    student_number: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  const studentById = new Map<string, StudentRow>();
  if (studentIds.length > 0) {
    // Chunk to keep .in() lists tractable (mirrors lib/sis/drill.ts:185).
    for (let i = 0; i < studentIds.length; i += 100) {
      const chunk = studentIds.slice(i, i + 100);
      const { data, error } = await service
        .from('students')
        .select('id, student_number, first_name, last_name')
        .in('id', chunk);
      if (error) {
        console.warn('[movements] students enrichment failed:', error.message);
        continue;
      }
      for (const s of (data ?? []) as StudentRow[]) studentById.set(s.id, s);
    }
  }

  // ── Pass 3: enroleeNumber fallback for null section_students.enrolee_number
  //   (migration 041 pattern from lib/sis/drill.ts:200–229).
  const needFallbackByAy = new Map<string, Set<string>>();
  for (const v of ssById.values()) {
    if (v.enroleeNumber) continue;
    const student = studentById.get(v.studentId);
    if (!student?.student_number || !v.ayCode) continue;
    if (!needFallbackByAy.has(v.ayCode)) {
      needFallbackByAy.set(v.ayCode, new Set());
    }
    needFallbackByAy.get(v.ayCode)!.add(student.student_number);
  }
  const enroleeByStudentNumberByAy = new Map<string, Map<string, string>>();
  for (const [ayCode, studentNumbers] of needFallbackByAy) {
    const year = ayCode.replace(/^AY/i, '').toLowerCase();
    const list = Array.from(studentNumbers);
    const { data, error } = await service
      .from(`ay${year}_enrolment_applications`)
      .select('studentNumber, enroleeNumber')
      .in('studentNumber', list);
    if (error) {
      console.warn(
        `[movements] enroleeNumber fallback (${ayCode}) failed:`,
        error.message
      );
      continue;
    }
    const map = new Map<string, string>();
    for (const r of (data ?? []) as Array<{
      studentNumber: string | null;
      enroleeNumber: string | null;
    }>) {
      if (r.studentNumber && r.enroleeNumber) {
        map.set(r.studentNumber, r.enroleeNumber);
      }
    }
    enroleeByStudentNumberByAy.set(ayCode, map);
  }

  // ── Pass 4: transfer-row student names via the AY-apps table ──────────────
  const transferByAy = new Map<string, Set<string>>();
  for (const t of transferPartials) {
    if (!t.ayCode || !t.enroleeNumber) continue;
    if (!transferByAy.has(t.ayCode)) transferByAy.set(t.ayCode, new Set());
    transferByAy.get(t.ayCode)!.add(t.enroleeNumber);
  }
  const appByEnroleeAy = new Map<
    string,
    Map<string, { studentNumber: string | null; fullName: string }>
  >();
  for (const [ayCode, enroleeNumbers] of transferByAy) {
    const year = ayCode.replace(/^AY/i, '').toLowerCase();
    const list = Array.from(enroleeNumbers);
    const { data, error } = await service
      .from(`ay${year}_enrolment_applications`)
      .select(
        'enroleeNumber, studentNumber, enroleeFullName, firstName, lastName'
      )
      .in('enroleeNumber', list);
    if (error) {
      console.warn(
        `[movements] transfer-name lookup (${ayCode}) failed:`,
        error.message
      );
      continue;
    }
    const map = new Map<
      string,
      { studentNumber: string | null; fullName: string }
    >();
    for (const r of (data ?? []) as Array<{
      enroleeNumber: string | null;
      studentNumber: string | null;
      enroleeFullName: string | null;
      firstName: string | null;
      lastName: string | null;
    }>) {
      if (!r.enroleeNumber) continue;
      const fullName =
        r.enroleeFullName?.trim() ||
        `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() ||
        '(unnamed)';
      map.set(r.enroleeNumber, {
        studentNumber: r.studentNumber,
        fullName,
      });
    }
    appByEnroleeAy.set(ayCode, map);
  }

  // ── Compose ───────────────────────────────────────────────────────────────
  const out: EnrichedPartial[] = [];

  for (const t of transferPartials) {
    const app = appByEnroleeAy.get(t.ayCode)?.get(t.enroleeNumber);
    const studentName = t.studentName?.trim() || app?.fullName || '(unnamed)';
    const studentNumber = t.studentNumber ?? app?.studentNumber ?? null;
    out.push({
      id: t.id,
      kind: 'section-transfer',
      studentNumber,
      studentName,
      enroleeNumber: t.enroleeNumber,
      level: t.level,
      ayCode: t.ayCode,
      date: t.date,
      actorEmail: t.actorEmail,
      fromSection: t.fromSection,
      toSection: t.toSection,
      ctxTermNumber: t.ctxTermNumber,
      ctxTermLabel: t.ctxTermLabel,
    });
  }

  for (const m of metadataPartials) {
    const ss = ssById.get(m.sectionStudentId);
    if (!ss) continue; // entity row missing — drop
    // Current-AY scope filter for metadata rows (transfer rows already
    // filtered at the SQL layer).
    if (!includeAll && ss.ayCode !== currentAyCode) continue;

    const student = studentById.get(ss.studentId);
    const studentName = student
      ? `${student.first_name ?? ''} ${student.last_name ?? ''}`.trim() ||
        '(unnamed)'
      : '(unnamed)';
    const studentNumber = student?.student_number ?? null;
    let enroleeNumber = ss.enroleeNumber ?? '';
    if (!enroleeNumber && studentNumber) {
      enroleeNumber =
        enroleeByStudentNumberByAy.get(ss.ayCode)?.get(studentNumber) ?? '';
    }
    out.push({
      id: m.id,
      kind: m.kind,
      studentNumber,
      studentName,
      enroleeNumber,
      level: ss.level,
      ayCode: ss.ayCode,
      date: m.date,
      actorEmail: m.actorEmail,
      ctxTermNumber: m.ctxTermNumber,
      ctxTermLabel: m.ctxTermLabel,
      reason: m.reason,
      reasonLabel: m.reasonLabel,
    });
  }

  return out;
}
