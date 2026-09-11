// No `import 'server-only'`: the pure rule below is safe anywhere, and the
// loaders take their client as an argument rather than creating one. Call the
// loaders with the SERVICE client only — they read audit_log.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  GRADE_CHANGE_AEB_APPROVAL_FLOW,
  GRADE_CHANGE_APPROVAL_FLOW,
  type GradeChangeApprovalFlow,
} from '@/lib/schemas/approval-flows';

/** `approval_requests.subject_type` for a grade change (migration 144). */
export const GRADE_CHANGE_SUBJECT_TYPE = 'grade_change_request';

/**
 * One `publication.create` or `publication.delete` audit row, reduced to what
 * the rule reads.
 */
export type PublicationLogEvent = {
  sectionId: string;
  termNumber: number;
  kind: 'create' | 'delete';
  /** The window's start as it stood when this row was written. */
  publishFrom: string | null;
  /** The audit row's own `created_at`. */
  at: string;
};

export type PickGradeChangeFlowInput = {
  /** The term of the locked sheet the grade sits on. */
  sheetTermNumber: number;
  /** Publication windows that still exist, for the child's sections this year. */
  publications: Array<{ termNumber: number; publishFrom: string }>;
  /** Windows that were deleted, with when (from `publication.delete` audit rows). */
  revokedPublications: Array<{
    termNumber: number;
    publishFrom: string;
    revokedAt: string;
  }>;
  /**
   * Every publish and unpublish logged for the child's sections this year, in
   * any order. What closes the republish gap — see below.
   */
  publicationLog: PublicationLogEvent[];
  now: Date;
};

/**
 * Which approval flow a grade change goes to.
 *
 * ⚠ A REPORT CARD COUNTS ONCE PARENTS COULD SEE IT — not only while they can.
 * A window that has since closed still counts, and so does one that was
 * revoked after it opened: the parent may have read or saved the card in that
 * time. A window scheduled for later does not count, and neither does one
 * revoked before it ever opened — nobody saw anything.
 *
 * ⚠ A LATER TERM'S CARD COVERS AN EARLIER TERM'S GRADE. Term 1 grades print on
 * the Term 1, 2, 3 and 4 cards alike, so a published Term 3 card means a Term 1
 * grade has been seen. The reverse is not true: a Term 1 card never shows a
 * Term 3 grade.
 *
 * ⚠ RE-PUBLISHING OVERWRITES THE EVIDENCE, SO THE LOG IS READ TOO. A section's
 * card for a term is ONE row, upserted on (section, term). A card that opened
 * to parents on 1 September and was then re-published to open on 1 October
 * leaves a live row saying "1 October" — and on 15 September the live row
 * alone would say nobody has seen it, when parents have been reading it for a
 * fortnight. Every publish writes a `publication.create` audit row carrying the
 * window it set, so each logged window is judged on its own: it was in force
 * from when it was logged until the NEXT publish or unpublish of the same card,
 * and it was seen if it opened before that next row was written (or opens by
 * now, if nothing has replaced it).
 */
export function pickGradeChangeFlow(
  input: PickGradeChangeFlowInput
): GradeChangeApprovalFlow {
  const now = input.now.getTime();
  const covers = (termNumber: number) => termNumber >= input.sheetTermNumber;

  const seenLive = input.publications.some(
    (p) => covers(p.termNumber) && Date.parse(p.publishFrom) <= now
  );
  if (seenLive) return GRADE_CHANGE_AEB_APPROVAL_FLOW;

  const seenBeforeRevoked = input.revokedPublications.some(
    (p) =>
      covers(p.termNumber) &&
      Date.parse(p.publishFrom) < Date.parse(p.revokedAt)
  );
  if (seenBeforeRevoked) return GRADE_CHANGE_AEB_APPROVAL_FLOW;

  if (seenInLog(input.publicationLog, covers, now)) {
    return GRADE_CHANGE_AEB_APPROVAL_FLOW;
  }

  return GRADE_CHANGE_APPROVAL_FLOW;
}

function seenInLog(
  log: PublicationLogEvent[],
  covers: (termNumber: number) => boolean,
  now: number
): boolean {
  const byCard = new Map<string, PublicationLogEvent[]>();
  for (const event of log) {
    if (!covers(event.termNumber)) continue;
    const key = `${event.sectionId}|${event.termNumber}`;
    const list = byCard.get(key) ?? [];
    list.push(event);
    byCard.set(key, list);
  }

  for (const events of byCard.values()) {
    const ordered = [...events].sort(
      (a, b) => Date.parse(a.at) - Date.parse(b.at)
    );
    for (let i = 0; i < ordered.length; i += 1) {
      const event = ordered[i];
      if (event.kind !== 'create' || !event.publishFrom) continue;
      const opens = Date.parse(event.publishFrom);
      if (Number.isNaN(opens)) continue;
      const next = ordered[i + 1];
      const seen = next ? opens < Date.parse(next.at) : opens <= now;
      if (seen) return true;
    }
  }
  return false;
}

/** One embedded row, whichever shape PostgREST chose to return it in. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type SheetTerm = {
  sectionId: string;
  academicYearId: string;
  termNumber: number;
};

async function loadSheetTerm(
  service: SupabaseClient,
  gradingSheetId: string
): Promise<SheetTerm> {
  const { data, error } = await service
    .from('grading_sheets')
    .select('section_id, terms(academic_year_id, term_number)')
    .eq('id', gradingSheetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const sheet = data as unknown as {
    section_id: string;
    terms:
      | { academic_year_id: string; term_number: number }
      | Array<{ academic_year_id: string; term_number: number }>
      | null;
  } | null;
  const term = one(sheet?.terms);
  if (!sheet || !term) throw new Error('grading sheet or its term not found');
  return {
    sectionId: sheet.section_id,
    academicYearId: term.academic_year_id,
    termNumber: term.term_number,
  };
}

type PublicationHistory = {
  publications: Array<{
    sectionId: string;
    termNumber: number;
    publishFrom: string;
  }>;
  revoked: Array<{
    sectionId: string;
    termNumber: number;
    publishFrom: string;
    revokedAt: string;
  }>;
  log: PublicationLogEvent[];
};

/** Three reads in one parallel round, each on a key or an indexed column. */
async function loadPublicationHistory(
  service: SupabaseClient,
  academicYearId: string,
  sectionIds: string[]
): Promise<PublicationHistory> {
  if (sectionIds.length === 0) {
    return { publications: [], revoked: [], log: [] };
  }

  const [termsRes, pubsRes, logRes] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number')
      .eq('academic_year_id', academicYearId),
    service
      .from('report_card_publications')
      .select('section_id, term_id, publish_from')
      .in('section_id', sectionIds),
    // Both actions carry section_id, term_id and publish_from in context
    // (app/api/report-card-publications/route.ts and [id]/route.ts). The row's
    // own created_at is when the window was set, or taken down.
    service
      .from('audit_log')
      .select('action, context, created_at')
      .in('action', ['publication.create', 'publication.delete'])
      .in('context->>section_id', sectionIds),
  ]);
  if (termsRes.error) throw new Error(termsRes.error.message);
  if (pubsRes.error) throw new Error(pubsRes.error.message);
  if (logRes.error) throw new Error(logRes.error.message);

  const termNumberById = new Map(
    (
      (termsRes.data ?? []) as unknown as Array<{
        id: string;
        term_number: number;
      }>
    ).map((t) => [t.id, t.term_number])
  );

  const publications = (
    (pubsRes.data ?? []) as unknown as Array<{
      section_id: string;
      term_id: string;
      publish_from: string;
    }>
  ).flatMap((p) => {
    const termNumber = termNumberById.get(p.term_id);
    return termNumber == null
      ? []
      : [{ sectionId: p.section_id, termNumber, publishFrom: p.publish_from }];
  });

  const revoked: PublicationHistory['revoked'] = [];
  const log: PublicationLogEvent[] = [];
  for (const row of (logRes.data ?? []) as unknown as Array<{
    action: string;
    context: {
      section_id?: unknown;
      term_id?: unknown;
      publish_from?: unknown;
    } | null;
    created_at: string;
  }>) {
    const sectionId = row.context?.section_id;
    const termId = row.context?.term_id;
    if (typeof sectionId !== 'string' || typeof termId !== 'string') continue;
    // A term from another year never matches — the map holds this year only.
    const termNumber = termNumberById.get(termId);
    if (termNumber == null) continue;
    const publishFrom =
      typeof row.context?.publish_from === 'string'
        ? row.context.publish_from
        : null;
    const kind = row.action === 'publication.delete' ? 'delete' : 'create';
    log.push({ sectionId, termNumber, kind, publishFrom, at: row.created_at });
    if (kind === 'delete' && publishFrom) {
      revoked.push({
        sectionId,
        termNumber,
        publishFrom,
        revokedAt: row.created_at,
      });
    }
  }

  return { publications, revoked, log };
}

function pickForSections(
  sections: ReadonlySet<string>,
  sheetTermNumber: number,
  history: PublicationHistory,
  now: Date
): GradeChangeApprovalFlow {
  return pickGradeChangeFlow({
    sheetTermNumber,
    publications: history.publications
      .filter((p) => sections.has(p.sectionId))
      .map((p) => ({ termNumber: p.termNumber, publishFrom: p.publishFrom })),
    revokedPublications: history.revoked
      .filter((p) => sections.has(p.sectionId))
      .map((p) => ({
        termNumber: p.termNumber,
        publishFrom: p.publishFrom,
        revokedAt: p.revokedAt,
      })),
    publicationLog: history.log.filter((e) => sections.has(e.sectionId)),
    now,
  });
}

/**
 * Every section each child was placed in during the year.
 *
 * The child's report card is per SECTION, and a child can have been in more
 * than one section this year (a move keeps the old row as withdrawn, Hard Rule
 * #6), so every one is checked — a card published in the class they left still
 * showed this grade.
 */
async function loadPlacements(
  service: SupabaseClient,
  academicYearId: string,
  studentIds: string[]
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (studentIds.length === 0) return out;
  const { data, error } = await service
    .from('section_students')
    .select('student_id, section_id, sections!inner(academic_year_id)')
    .in('student_id', studentIds)
    .eq('sections.academic_year_id', academicYearId);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as unknown as Array<{
    student_id: string;
    section_id: string;
  }>) {
    const set = out.get(row.student_id) ?? new Set<string>();
    set.add(row.section_id);
    out.set(row.student_id, set);
  }
  return out;
}

/**
 * Loads what `pickGradeChangeFlow` needs for one grade entry and answers it.
 * What filing a request calls.
 */
export async function resolveGradeChangeFlow(
  service: SupabaseClient,
  opts: { gradeEntryId: string; gradingSheetId: string; now?: Date }
): Promise<GradeChangeApprovalFlow> {
  const now = opts.now ?? new Date();

  const [entryRes, sheet] = await Promise.all([
    service
      .from('grade_entries')
      .select('section_student_id, section_students(student_id)')
      .eq('id', opts.gradeEntryId)
      .eq('grading_sheet_id', opts.gradingSheetId)
      .maybeSingle(),
    loadSheetTerm(service, opts.gradingSheetId),
  ]);
  if (entryRes.error) throw new Error(entryRes.error.message);

  const entry = entryRes.data as unknown as {
    section_students:
      | { student_id: string }
      | Array<{ student_id: string }>
      | null;
  } | null;
  const studentId = one(entry?.section_students)?.student_id;
  if (!studentId) {
    throw new Error('grade entry not found on that grading sheet');
  }

  const placements = await loadPlacements(service, sheet.academicYearId, [
    studentId,
  ]);
  // The sheet's own class always counts, placement read or not — the two
  // loaders must never disagree about the same child.
  const sections = new Set<string>([
    sheet.sectionId,
    ...(placements.get(studentId) ?? []),
  ]);
  const history = await loadPublicationHistory(service, sheet.academicYearId, [
    ...sections,
  ]);
  return pickForSections(sections, sheet.termNumber, history, now);
}

export type GradeChangeFlowsForSheet = {
  /**
   * The flow for a child who has only ever been in this sheet's class. What
   * the filing screen shows before a student is picked.
   */
  sectionFlow: GradeChangeApprovalFlow;
  /**
   * Per grade entry. Can only ever be the board where `sectionFlow` is not —
   * a child who moved in may have had a card published in the class they left.
   */
  flowByEntryId: Record<string, GradeChangeApprovalFlow>;
};

/**
 * The same answer for every child on one sheet, in five reads rather than five
 * per child. What the filing screen calls, so it can say where a request will
 * go before it is sent.
 */
export async function resolveGradeChangeFlowsForSheet(
  service: SupabaseClient,
  opts: { gradingSheetId: string; now?: Date }
): Promise<GradeChangeFlowsForSheet> {
  const now = opts.now ?? new Date();

  const [sheet, entriesRes] = await Promise.all([
    loadSheetTerm(service, opts.gradingSheetId),
    service
      .from('grade_entries')
      .select('id, section_students(student_id)')
      .eq('grading_sheet_id', opts.gradingSheetId),
  ]);
  if (entriesRes.error) throw new Error(entriesRes.error.message);

  const entries = (
    (entriesRes.data ?? []) as unknown as Array<{
      id: string;
      section_students:
        | { student_id: string }
        | Array<{ student_id: string }>
        | null;
    }>
  ).map((e) => ({
    id: e.id,
    studentId: one(e.section_students)?.student_id ?? null,
  }));

  const studentIds = [
    ...new Set(entries.flatMap((e) => (e.studentId ? [e.studentId] : []))),
  ];
  const placements = await loadPlacements(
    service,
    sheet.academicYearId,
    studentIds
  );

  const allSections = new Set<string>([sheet.sectionId]);
  for (const set of placements.values()) {
    for (const id of set) allSections.add(id);
  }
  const history = await loadPublicationHistory(service, sheet.academicYearId, [
    ...allSections,
  ]);

  const sectionFlow = pickForSections(
    new Set([sheet.sectionId]),
    sheet.termNumber,
    history,
    now
  );

  const flowByEntryId: Record<string, GradeChangeApprovalFlow> = {};
  for (const entry of entries) {
    const sections = new Set<string>([sheet.sectionId]);
    const placed = entry.studentId ? placements.get(entry.studentId) : null;
    for (const id of placed ?? []) sections.add(id);
    flowByEntryId[entry.id] = pickForSections(
      sections,
      sheet.termNumber,
      history,
      now
    );
  }

  return { sectionFlow, flowByEntryId };
}
