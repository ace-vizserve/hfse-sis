import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import type { LinkedStudent } from '@/lib/declarations/parent';
import { formatClosesAt } from '@/lib/events/display';
import { canRegister, eventIsFor, eventStatus } from '@/lib/events/event';
import {
  dropHiddenAnswers,
  pruneAnswers,
  validateChildAnswers,
  validateFamilyAnswers,
  type AnswerValue,
  type EventForm,
} from '@/lib/events/form';
import {
  EVENT_COLUMNS,
  mapEvent,
  parseForm,
  scopeLabel,
  type EventRow,
  type StaffEvent,
} from '@/lib/events/staff';
import {
  createAdmissionsClient,
  getAllStudentsByParentEmail,
} from '@/lib/supabase/admissions';
import type { createServiceClient } from '@/lib/supabase/service';

// Parent read model for events (KD #195: the parent's children come from
// `loadFilableStudents`, never from /students). Read-only; the routes do the
// Bearer check and hand in the verified, lowercased email and the children.
//
// v1 simplification: registrations are matched by student id across ALL the
// parent's children, current or past (resolved from the same email lookup the
// declarations code uses, then mapped to `students.id` by studentNumber). A
// child who is no longer enrolled can therefore still show on a past year's
// "mine" list, but is never offered for a new registration.

type Service = ReturnType<typeof createServiceClient>;
type Answers = Record<string, AnswerValue>;

export type ParentStatus = 'registered' | 'not_joining' | 'not_registered';

export type ParentChildStatus = {
  studentNumber: string;
  name: string;
  status: ParentStatus;
};

export type ParentEventRow = {
  slug: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  timeLabel: string;
  venue: string;
  scopeLabel: string;
  /** When registration opens; the portal says "opens on …" before then. */
  opensAt: string;
  closesAt: string;
  canRegister: boolean;
  children: ParentChildStatus[];
};

type Kid = {
  studentId: string;
  studentNumber: string;
  name: string;
  /** null for a child who is not in the current year's roster. */
  academicYearId: string | null;
  levelCode: string;
  sectionId: string;
  className: string;
};

type Reg = {
  event_id: string;
  student_id: string;
  section_id: string | null;
  status: 'registered' | 'not_joining';
  not_joining_reason: string | null;
  answers: Answers | null;
};

type AyRow = { id: string; ay_code: string; is_current: boolean };

const REG_COLUMNS =
  'event_id, student_id, section_id, status, not_joining_reason, answers';

async function loadAcademicYears(service: Service): Promise<AyRow[]> {
  const { data, error } = await service
    .from('academic_years')
    .select('id, ay_code, is_current');
  if (error) throw error;
  return (data ?? []) as unknown as AyRow[];
}

/** The parent's children: current-year enrolments plus any past-year child by studentNumber. */
async function loadKids(
  service: Service,
  email: string,
  filable: LinkedStudent[]
): Promise<Kid[]> {
  const kids = new Map<string, Kid>();
  for (const s of filable) {
    kids.set(s.studentNumber, {
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      name: s.displayName,
      academicYearId: s.academicYearId,
      levelCode: s.levelCode ?? '',
      sectionId: s.sectionId,
      className: s.sectionName ?? '',
    });
  }
  const linked = await getAllStudentsByParentEmail(email);
  const extra = linked
    .map((r) => r.student_number)
    .filter((n): n is string => !!n && !kids.has(n));
  if (extra.length > 0) {
    const { data, error } = await service
      .from('students')
      .select('id, student_number, first_name, last_name')
      .in('student_number', extra);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as Array<{
      id: string;
      student_number: string;
      first_name: string;
      last_name: string;
    }>) {
      kids.set(r.student_number, {
        studentId: r.id,
        studentNumber: r.student_number,
        name: `${r.first_name} ${r.last_name}`.trim(),
        academicYearId: null,
        levelCode: '',
        sectionId: '',
        className: '',
      });
    }
  }
  return [...kids.values()];
}

async function loadRegs(
  service: Service,
  kids: Kid[],
  eventId?: string
): Promise<Reg[]> {
  if (kids.length === 0) return [];
  let q = service
    .from('parent_event_registrations')
    .select(REG_COLUMNS)
    .in(
      'student_id',
      kids.map((k) => k.studentId)
    );
  if (eventId) q = q.eq('event_id', eventId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Reg[];
}

function eligibleKids(e: StaffEvent, kids: Kid[]): Kid[] {
  return kids.filter(
    (k) =>
      k.academicYearId === e.academicYearId &&
      k.sectionId !== '' &&
      eventIsFor(e, { levelCode: k.levelCode, sectionId: k.sectionId })
  );
}

/** Eligible children plus any child who already has an answer on this event. */
function shownKids(
  e: StaffEvent,
  kids: Kid[],
  regByStudent: Map<string, Reg>
): Kid[] {
  const eligible = eligibleKids(e, kids);
  const ids = new Set(eligible.map((k) => k.studentId));
  const answered = kids.filter(
    (k) => regByStudent.has(k.studentId) && !ids.has(k.studentId)
  );
  return [...eligible, ...answered];
}

function toRow(
  e: StaffEvent,
  shown: Kid[],
  regByStudent: Map<string, Reg>,
  now: Date
): ParentEventRow {
  return {
    slug: e.slug,
    title: e.title,
    startsOn: e.startsOn,
    endsOn: e.endsOn,
    timeLabel: e.timeLabel,
    venue: e.venue,
    scopeLabel: scopeLabel(e),
    opensAt: e.opensAt,
    closesAt: e.closesAt,
    canRegister: canRegister(e, now),
    children: shown.map((k) => ({
      studentNumber: k.studentNumber,
      name: k.name,
      status: regByStudent.get(k.studentId)?.status ?? 'not_registered',
    })),
  };
}

function byEvent(regs: Reg[]): Map<string, Map<string, Reg>> {
  const out = new Map<string, Map<string, Reg>>();
  for (const r of regs) {
    const m = out.get(r.event_id) ?? new Map<string, Reg>();
    m.set(r.student_id, r);
    out.set(r.event_id, m);
  }
  return out;
}

const EMPTY = new Map<string, Reg>();

export async function loadParentEventList(
  service: Service,
  input: {
    email: string;
    filable: LinkedStudent[];
    ayCode?: string | null;
    now: Date;
  }
): Promise<{
  open: ParentEventRow[];
  mine: ParentEventRow[];
  academicYears: string[];
  currentAy: string;
}> {
  const { now } = input;
  const ays = await loadAcademicYears(service);
  const current = ays.find((a) => a.is_current) ?? null;
  const target = input.ayCode
    ? (ays.find((a) => a.ay_code === input.ayCode) ?? null)
    : current;

  const kids = await loadKids(service, input.email, input.filable);
  const regs = await loadRegs(service, kids);
  const regsByEvent = byEvent(regs);

  // Events: this year's (for "open") plus every event the family has answered.
  const events = new Map<string, StaffEvent>();
  const take = (rows: unknown) => {
    for (const raw of (rows ?? []) as EventRow[]) {
      if (!raw.published_at) continue; // unpublished is never shown to parents
      events.set(raw.id, mapEvent(raw));
    }
  };
  if (current) {
    const { data, error } = await service
      .from('parent_events')
      .select(EVENT_COLUMNS)
      .eq('academic_year_id', current.id);
    if (error) throw error;
    take(data);
  }
  const answeredIds = [...regsByEvent.keys()].filter((id) => !events.has(id));
  if (answeredIds.length > 0) {
    const { data, error } = await service
      .from('parent_events')
      .select(EVENT_COLUMNS)
      .in('id', answeredIds);
    if (error) throw error;
    take(data);
  }

  const open: ParentEventRow[] = [];
  const mine: ParentEventRow[] = [];
  const yearsWithAnswers = new Set<string>();
  for (const e of events.values()) {
    const regByStudent = regsByEvent.get(e.id) ?? EMPTY;
    const answered = regByStudent.size > 0;
    if (answered) yearsWithAnswers.add(e.academicYearId);
    const shown = shownKids(e, kids, regByStudent);
    if (
      eventStatus(e, now) === 'open' &&
      current &&
      e.academicYearId === current.id &&
      eligibleKids(e, kids).length > 0
    ) {
      open.push(toRow(e, shown, regByStudent, now));
    }
    if (answered && target && e.academicYearId === target.id) {
      mine.push(toRow(e, shown, regByStudent, now));
    }
  }
  open.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  mine.sort((a, b) => b.startsOn.localeCompare(a.startsOn));

  const codes = new Set<string>();
  if (current) codes.add(current.ay_code);
  for (const a of ays) if (yearsWithAnswers.has(a.id)) codes.add(a.ay_code);
  const academicYears = [...codes].sort((a, b) => b.localeCompare(a));

  return { open, mine, academicYears, currentAy: current?.ay_code ?? '' };
}

export type ParentEventDetail = {
  event: ParentEventRow & {
    description: string;
    answerMode: 'consent' | 'register';
  };
  form: EventForm;
  children: {
    studentNumber: string;
    name: string;
    levelLabel: string;
    className: string;
    /**
     * True when the child is eligible now. False for a child shown only because they answered
     * earlier (withdrawn, or moved out of the event's levels/classes): the save refuses them.
     */
    canRegister: boolean;
  }[];
  submission: {
    parentName: string;
    parentPhone: string;
    familyAnswers: Answers;
    signatureName: string | null;
    signedAt: string | null;
  } | null;
  registrations: Record<
    string,
    {
      status: 'registered' | 'not_joining';
      reason: string | null;
      answers: Answers;
    }
  >;
  prefill: { parentName: string; parentPhone: string };
};

/** Name and phone from the child's application, for the parent whose email matches. */
async function loadPrefill(
  ayCode: string | null,
  studentNumbers: string[],
  email: string
): Promise<{ parentName: string; parentPhone: string }> {
  const blank = { parentName: '', parentPhone: '' };
  if (!ayCode || studentNumbers.length === 0) return blank;
  const table = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}_enrolment_applications`;
  try {
    const { data, error } = await createAdmissionsClient()
      .from(table)
      .select(
        'studentNumber, motherEmail, motherFullName, motherMobile, fatherEmail, fatherFullName, fatherMobile, guardianEmail, guardianFullName, guardianMobile'
      )
      .in('studentNumber', studentNumbers);
    if (error) return blank;
    // The mobile columns are bigint, so they arrive as numbers.
    type App = Record<string, string | number | null>;
    const text = (v: string | number | null | undefined) =>
      String(v ?? '').trim();
    for (const r of (data ?? []) as App[]) {
      for (const who of ['mother', 'father', 'guardian']) {
        if (text(r[`${who}Email`]).toLowerCase() !== email) continue;
        return {
          parentName: text(r[`${who}FullName`]),
          parentPhone: text(r[`${who}Mobile`]),
        };
      }
    }
  } catch {
    // Prefill is a convenience; the parent can type their own details.
  }
  return blank;
}

/** One event for this parent, or null (unpublished, unknown, or none of their children). */
export async function loadParentEventDetail(
  service: Service,
  input: {
    email: string;
    filable: LinkedStudent[];
    slug: string;
    now: Date;
  }
): Promise<ParentEventDetail | null> {
  const { data, error } = await service
    .from('parent_events')
    .select(EVENT_COLUMNS)
    .eq('slug', input.slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const raw = data as unknown as EventRow;
  if (!raw.published_at) return null;
  const e = mapEvent(raw);

  const kids = await loadKids(service, input.email, input.filable);
  const regs = await loadRegs(service, kids, e.id);
  const regByStudent = new Map(regs.map((r) => [r.student_id, r]));
  const shown = shownKids(e, kids, regByStudent);
  if (shown.length === 0) return null;
  const eligibleIds = new Set(eligibleKids(e, kids).map((k) => k.studentId));

  const form = parseForm(raw.form);

  // A child who is no longer on the roster has no class of their own; use the
  // class recorded on their answer.
  const sectionNames = new Map<string, string>();
  const needSections = shown
    .filter((k) => !k.className)
    .map((k) => regByStudent.get(k.studentId)?.section_id)
    .filter((id): id is string => !!id);
  if (needSections.length > 0) {
    const { data: secs } = await service
      .from('sections')
      .select('id, name')
      .in('id', needSections);
    for (const s of (secs ?? []) as unknown as Array<{
      id: string;
      name: string;
    }>) {
      sectionNames.set(s.id, s.name);
    }
  }

  const { data: subData, error: subErr } = await service
    .from('parent_event_submissions')
    .select(
      'parent_name, parent_phone, family_answers, signature_name, signed_at'
    )
    .eq('event_id', e.id)
    .eq('parent_email', input.email)
    .maybeSingle();
  if (subErr) throw subErr;
  const sub = subData as unknown as {
    parent_name: string;
    parent_phone: string;
    family_answers: Answers | null;
    signature_name: string | null;
    signed_at: string | null;
  } | null;

  const ayCode =
    (await loadAcademicYears(service)).find((a) => a.id === e.academicYearId)
      ?.ay_code ?? null;
  const prefill = await loadPrefill(
    ayCode,
    shown.map((k) => k.studentNumber),
    input.email
  );

  const registrations: ParentEventDetail['registrations'] = {};
  for (const k of shown) {
    const r = regByStudent.get(k.studentId);
    if (!r) continue;
    registrations[k.studentNumber] = {
      status: r.status,
      reason: r.not_joining_reason,
      answers: pruneAnswers(form, r.answers ?? {}),
    };
  }

  return {
    event: {
      ...toRow(e, shown, regByStudent, input.now),
      description: e.description,
      answerMode: e.answerMode,
    },
    form,
    children: shown.map((k) => ({
      studentNumber: k.studentNumber,
      name: k.name,
      levelLabel: k.levelCode,
      className:
        k.className ||
        sectionNames.get(regByStudent.get(k.studentId)?.section_id ?? '') ||
        '',
      canRegister: eligibleIds.has(k.studentId),
    })),
    submission: sub
      ? {
          parentName: sub.parent_name,
          parentPhone: sub.parent_phone,
          familyAnswers: pruneAnswers(form, sub.family_answers ?? {}),
          signatureName: sub.signature_name,
          signedAt: sub.signed_at,
        }
      : null,
    registrations,
    prefill,
  };
}

// ---------------------------------------------------------------------------
// Write: one family's answers for one event.
// ---------------------------------------------------------------------------

const AnswerValueSchema = z.union([
  z.string().max(5000),
  z.array(z.string().max(500)).max(100),
  z.number(),
  z.null(),
]);
const AnswersSchema = z.record(z.string(), AnswerValueSchema);

export const RegistrationBodySchema = z.object({
  parentName: z.string().trim().min(1).max(200),
  parentPhone: z.string().trim().min(1).max(50),
  children: z
    .array(
      z.object({
        studentNumber: z.string().trim().min(1).max(50),
        consent: z.enum(['allowing', 'not_allowing']),
        reason: z.string().max(2000).optional(),
        answers: AnswersSchema.default({}),
      })
    )
    .min(1)
    .max(30),
  familyAnswers: AnswersSchema.default({}),
  signatureName: z.string().max(200).optional(),
});

export type SaveRegistrationResult =
  | { status: 200; body: { savedAt: string } }
  | { status: 400; body: { error: string; errors?: Record<string, string> } }
  | { status: 403 | 404 | 409; body: { error: string } };

const fail = (
  status: 400 | 403 | 404 | 409,
  error: string,
  errors?: Record<string, string>
): SaveRegistrationResult =>
  ({
    status,
    body: errors ? { error, errors } : { error },
  }) as SaveRegistrationResult;

/**
 * Validates and stores a family's answers for one event.
 *
 * Not a transaction (no RPC): the family submission is upserted first, then the
 * child rows. If a child write fails, the submission row exists but some
 * children have no row yet, and the parent simply submits again. Every write
 * is an upsert on its natural key, so a retry converges with nothing to clean up.
 *
 * Validation error keys: a family question is keyed by its question id; a
 * child's question by `<studentNumber>.<questionId>`; a child's reason by
 * `<studentNumber>.reason`.
 */
export async function saveRegistration(
  service: Service,
  input: {
    email: string;
    userId: string;
    filable: LinkedStudent[];
    slug: string;
    now: Date;
    body: unknown;
  }
): Promise<SaveRegistrationResult> {
  const { data, error } = await service
    .from('parent_events')
    .select(EVENT_COLUMNS)
    .eq('slug', input.slug)
    .maybeSingle();
  if (error) throw error;
  if (!data || !(data as unknown as EventRow).published_at) {
    return fail(404, 'event not found');
  }
  const raw = data as unknown as EventRow;
  const e = mapEvent(raw);
  if (!canRegister(e, input.now)) {
    if (eventStatus(e, input.now) === 'upcoming') {
      return fail(
        409,
        `Registration for this event opens on ${formatClosesAt(e.opensAt)}.`
      );
    }
    return fail(409, 'Registration for this event has closed.');
  }

  const parsed = RegistrationBodySchema.safeParse(input.body);
  if (!parsed.success) {
    return fail(400, 'Please check your details and try again.');
  }
  const body = parsed.data;

  const kids = await loadKids(service, input.email, input.filable);
  const byNumber = new Map(kids.map((k) => [k.studentNumber, k]));
  const eligible = eligibleKids(e, kids);
  const eligibleNumbers = new Set(eligible.map((k) => k.studentNumber));

  const seen = new Set<string>();
  for (const c of body.children) {
    if (!byNumber.has(c.studentNumber)) {
      return fail(403, 'That child is not linked to your account.');
    }
    if (seen.has(c.studentNumber)) {
      return fail(400, 'A child appears more than once.');
    }
    seen.add(c.studentNumber);
    if (!eligibleNumbers.has(c.studentNumber)) {
      return fail(
        400,
        'One of the children can no longer be registered for this event.'
      );
    }
  }
  if (eligible.some((k) => !seen.has(k.studentNumber))) {
    return fail(400, 'Please answer for every child.');
  }

  const form = parseForm(raw.form);
  const errors: Record<string, string> = {};

  type Prepared = {
    kid: Kid;
    status: 'registered' | 'not_joining';
    reason: string | null;
    answers: Answers;
  };
  const prepared: Prepared[] = [];
  for (const c of body.children) {
    const kid = byNumber.get(c.studentNumber) as Kid;
    if (c.consent === 'not_allowing') {
      // In a consent event the parent must say why. In a register event
      // "not ticked" is simply not joining and needs no reason.
      const reason = (c.reason ?? '').trim();
      if (e.answerMode === 'consent') {
        if (reason === '') {
          errors[`${c.studentNumber}.reason`] = 'Tell us why.';
        } else if (reason.length > 500) {
          errors[`${c.studentNumber}.reason`] =
            'Keep this to 500 characters or fewer.';
        }
      }
      prepared.push({
        kid,
        status: 'not_joining',
        reason: e.answerMode === 'consent' ? reason : null,
        answers: {},
      });
      continue;
    }
    const result = validateChildAnswers(form, 'allowing', c.answers);
    if (!result.ok) {
      for (const [q, msg] of Object.entries(result.errors)) {
        errors[`${c.studentNumber}.${q}`] = msg;
      }
    }
    prepared.push({
      kid,
      status: 'registered',
      reason: null,
      answers: pruneAnswers(
        form,
        dropHiddenAnswers(form, { consent: 'allowing' }, c.answers)
      ),
    });
  }

  // Family questions and the signature only matter when someone is attending.
  // If every child is not joining, nothing is validated and nothing is stored.
  const anyRegistered = prepared.some((p) => p.status === 'registered');
  const signatureName = anyRegistered ? (body.signatureName ?? '').trim() : '';
  if (anyRegistered) {
    const family = validateFamilyAnswers(
      form,
      body.familyAnswers,
      signatureName
    );
    if (!family.ok) Object.assign(errors, family.errors);
  }

  if (Object.keys(errors).length > 0) {
    return fail(400, 'Please check the highlighted answers.', errors);
  }

  const familyAnswers: Answers = anyRegistered
    ? pruneAnswers(
        form,
        dropHiddenAnswers(form, { family: true }, body.familyAnswers)
      )
    : {};

  // signed_at moves only when the typed signature changes.
  const { data: existing, error: exErr } = await service
    .from('parent_event_submissions')
    .select('signature_name, signed_at')
    .eq('event_id', e.id)
    .eq('parent_email', input.email)
    .maybeSingle();
  if (exErr) throw exErr;
  const prev = existing as unknown as {
    signature_name: string | null;
    signed_at: string | null;
  } | null;
  const nowIso = input.now.toISOString();
  const signedAt =
    signatureName === ''
      ? null
      : prev?.signature_name === signatureName && prev.signed_at
        ? prev.signed_at
        : nowIso;

  const { data: sub, error: subErr } = await service
    .from('parent_event_submissions')
    .upsert(
      {
        event_id: e.id,
        parent_email: input.email,
        parent_name: body.parentName,
        parent_phone: body.parentPhone,
        family_answers: familyAnswers,
        signature_name: signatureName === '' ? null : signatureName,
        signed_at: signedAt,
        submitted_by: input.userId,
      },
      { onConflict: 'event_id,parent_email' }
    )
    .select('id')
    .single();
  if (subErr) throw subErr;
  const submissionId = (sub as unknown as { id: string }).id;

  // A child already answered by the other parent keeps its row; this submit
  // overwrites it and points it at this parent's submission.
  const { error: regErr } = await service
    .from('parent_event_registrations')
    .upsert(
      prepared.map((p) => ({
        event_id: e.id,
        submission_id: submissionId,
        student_id: p.kid.studentId,
        section_id: p.kid.sectionId || null,
        status: p.status,
        not_joining_reason: p.reason,
        answers: p.answers,
      })),
      { onConflict: 'event_id,student_id' }
    );
  if (regErr) throw regErr;

  // Counts only, never answers (a parent's reason can be personal).
  const registered = prepared.filter((p) => p.status === 'registered').length;
  await logAction({
    service,
    actor: { id: input.userId, email: input.email, role: null },
    action: 'parent_event.register',
    entityType: 'parent_event',
    entityId: e.id,
    context: {
      children: prepared.length,
      registered,
      notJoining: prepared.length - registered,
    },
  });

  return { status: 200, body: { savedAt: nowIso } };
}
