import {
  SCOPE_CHOICE_LABELS,
  describeClassScope,
  describeLevelScope,
} from '@/lib/attendance/event-scope';
import type { LevelCode } from '@/lib/sis/levels';
import {
  EventFormSchema,
  pruneAnswers,
  type AnswerValue,
  type EventForm,
} from '@/lib/events/form';
import {
  eventIsFor,
  eventStatus,
  type EventStatus,
  type EventTiming,
} from '@/lib/events/event';
import { fetchAllPages } from '@/lib/supabase/paginate';
import type { createServiceClient } from '@/lib/supabase/service';

// Staff read model for parent events: the list with its counts, and one event's
// Registered / Not joining / Not registered yet tabs. Read-only; no auth here,
// the page that calls it gates the role.

type Service = ReturnType<typeof createServiceClient>;
type Answers = Record<string, AnswerValue>;

export type EventListRow = {
  id: string;
  slug: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  timeLabel: string;
  venue: string;
  scopeLabel: string;
  closesAt: string;
  status: EventStatus;
  registered: number;
  notJoining: number;
  eligible: number;
};

export type RegistrationRow = {
  studentNumber: string;
  studentName: string;
  className: string;
  registeredBy: { name: string; email: string };
  handphone: string;
  status: 'registered' | 'not_joining';
  reason: string | null;
  answers: Answers;
  familyAnswers: Answers;
  /** The parent's typed e-signature, from their submission; null when none. */
  signature: { name: string; signedAt: string | null } | null;
  updatedAt: string;
};

export type NotRegisteredRow = {
  studentNumber: string;
  studentName: string;
  className: string;
};

export type StaffEvent = EventTiming & {
  id: string;
  academicYearId: string;
  slug: string;
  title: string;
  description: string;
  timeLabel: string;
  venue: string;
  audience: 'all' | 'primary' | 'secondary';
  levels: LevelCode[];
  sectionIds: string[];
  answerMode: 'consent' | 'register';
};

export type EventRow = {
  id: string;
  academic_year_id: string;
  slug: string;
  title: string;
  description: string | null;
  starts_on: string;
  ends_on: string | null;
  time_label: string | null;
  venue: string | null;
  audience: 'all' | 'primary' | 'secondary';
  levels: LevelCode[] | null;
  section_ids: string[] | null;
  answer_mode: 'consent' | 'register';
  opens_at: string;
  closes_at: string;
  form: unknown;
  published_at: string | null;
  closed_early_at: string | null;
};

export const EVENT_COLUMNS =
  'id, academic_year_id, slug, title, description, starts_on, ends_on, time_label, venue, audience, levels, section_ids, answer_mode, opens_at, closes_at, form, published_at, closed_early_at';

export function mapEvent(r: EventRow): StaffEvent {
  return {
    id: r.id,
    academicYearId: r.academic_year_id,
    slug: r.slug,
    title: r.title,
    description: r.description ?? '',
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    timeLabel: r.time_label ?? '',
    venue: r.venue ?? '',
    audience: r.audience,
    levels: r.levels ?? [],
    sectionIds: r.section_ids ?? [],
    answerMode: r.answer_mode,
    opensAt: r.opens_at,
    closesAt: r.closes_at,
    publishedAt: r.published_at,
    closedEarlyAt: r.closed_early_at,
  };
}

export function parseForm(raw: unknown): EventForm {
  const parsed = EventFormSchema.safeParse(raw);
  return parsed.success ? parsed.data : { sections: [] };
}

export function scopeLabel(e: StaffEvent): string {
  if (e.sectionIds.length > 0) return describeClassScope(e.sectionIds.length);
  if (e.levels.length > 0) return describeLevelScope(e.levels);
  return SCOPE_CHOICE_LABELS[e.audience];
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

type StudentRef = {
  student_number: string;
  first_name: string;
  last_name: string;
};

type Child = {
  studentId: string;
  studentNumber: string;
  studentName: string;
  className: string;
  levelCode: string;
  sectionId: string;
};

type EnrolRow = {
  student_id: string;
  section_id: string;
  students: StudentRef | StudentRef[] | null;
  sections: {
    name: string;
    levels: { code: string } | { code: string }[] | null;
  } | null;
};

/** Every non-withdrawn child enrolled in the year, with the level and class they sit in. */
async function loadChildren(
  service: Service,
  academicYearId: string
): Promise<Child[]> {
  const data = await fetchAllPages<Record<string, unknown>>((from, to) =>
    service
      .from('section_students')
      .select(
        'student_id, section_id, students(student_number, first_name, last_name), sections!inner(id, name, academic_year_id, levels(code))'
      )
      .neq('enrollment_status', 'withdrawn')
      .eq('sections.academic_year_id', academicYearId)
      .range(from, to)
  );
  const out: Child[] = [];
  for (const r of data as unknown as EnrolRow[]) {
    const s = one(r.students);
    const sec = one(r.sections);
    if (!s || !sec) continue;
    out.push({
      studentId: r.student_id,
      studentNumber: s.student_number,
      studentName: `${s.first_name} ${s.last_name}`.trim(),
      className: sec.name,
      levelCode: one(sec.levels)?.code ?? '',
      sectionId: r.section_id,
    });
  }
  return out;
}

export async function loadEventList(
  service: Service,
  academicYearId: string,
  now: Date
): Promise<EventListRow[]> {
  const { data: events, error } = await service
    .from('parent_events')
    .select(EVENT_COLUMNS)
    .eq('academic_year_id', academicYearId)
    .order('starts_on', { ascending: false });
  if (error) throw error;
  const rows = (events ?? []) as unknown as EventRow[];
  if (rows.length === 0) return [];

  const regs = await fetchAllPages<{ event_id: string; status: string }>(
    (from, to) =>
      service
        .from('parent_event_registrations')
        .select('event_id, status')
        .in(
          'event_id',
          rows.map((r) => r.id)
        )
        .range(from, to)
  );
  const counts = new Map<string, { registered: number; notJoining: number }>();
  for (const r of regs) {
    const c = counts.get(r.event_id) ?? { registered: 0, notJoining: 0 };
    if (r.status === 'registered') c.registered += 1;
    else if (r.status === 'not_joining') c.notJoining += 1;
    counts.set(r.event_id, c);
  }

  const children = await loadChildren(service, academicYearId);
  return rows.map((raw) => {
    const e = mapEvent(raw);
    const c = counts.get(e.id) ?? { registered: 0, notJoining: 0 };
    return {
      id: e.id,
      slug: e.slug,
      title: e.title,
      startsOn: e.startsOn,
      endsOn: e.endsOn,
      timeLabel: e.timeLabel,
      venue: e.venue,
      scopeLabel: scopeLabel(e),
      closesAt: e.closesAt,
      status: eventStatus(e, now),
      registered: c.registered,
      notJoining: c.notJoining,
      eligible: children.filter((ch) => eventIsFor(e, ch)).length,
    };
  });
}

type RegRow = {
  submission_id: string;
  student_id: string;
  section_id: string;
  status: 'registered' | 'not_joining';
  not_joining_reason: string | null;
  answers: Answers | null;
  updated_at: string;
  students: StudentRef | StudentRef[] | null;
  sections: { name: string } | { name: string }[] | null;
};

type SubmissionRow = {
  id: string;
  parent_email: string;
  parent_name: string;
  parent_phone: string;
  family_answers: Answers | null;
  signature_name: string | null;
  signed_at: string | null;
};

export async function loadEventDetail(
  service: Service,
  eventId: string,
  now: Date
): Promise<{
  event: StaffEvent & { status: EventStatus };
  form: EventForm;
  registered: RegistrationRow[];
  notJoining: RegistrationRow[];
  notRegistered: NotRegisteredRow[];
  families: number;
  eligible: number;
} | null> {
  const { data, error } = await service
    .from('parent_events')
    .select(EVENT_COLUMNS)
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const raw = data as unknown as EventRow;
  const event = mapEvent(raw);
  const form = parseForm(raw.form);

  const [regData, subData, children] = await Promise.all([
    fetchAllPages<Record<string, unknown>>((from, to) =>
      service
        .from('parent_event_registrations')
        .select(
          'submission_id, student_id, section_id, status, not_joining_reason, answers, updated_at, students(student_number, first_name, last_name), sections(name)'
        )
        .eq('event_id', eventId)
        .order('updated_at', { ascending: false })
        .range(from, to)
    ),
    fetchAllPages<Record<string, unknown>>((from, to) =>
      service
        .from('parent_event_submissions')
        .select(
          'id, parent_email, parent_name, parent_phone, family_answers, signature_name, signed_at'
        )
        .eq('event_id', eventId)
        .range(from, to)
    ),
    loadChildren(service, event.academicYearId),
  ]);

  const subs = new Map<string, SubmissionRow>();
  for (const s of subData as unknown as SubmissionRow[]) {
    subs.set(s.id, s);
  }

  const registered: RegistrationRow[] = [];
  const notJoining: RegistrationRow[] = [];
  const answered = new Set<string>();
  for (const r of regData as unknown as RegRow[]) {
    answered.add(r.student_id);
    const stu = one(r.students);
    const sec = one(r.sections);
    const sub = subs.get(r.submission_id);
    const row: RegistrationRow = {
      studentNumber: stu?.student_number ?? '',
      studentName: stu ? `${stu.first_name} ${stu.last_name}`.trim() : '',
      className: sec?.name ?? '',
      registeredBy: {
        name: sub?.parent_name ?? '',
        email: sub?.parent_email ?? '',
      },
      handphone: sub?.parent_phone ?? '',
      status: r.status,
      reason: r.not_joining_reason,
      answers: pruneAnswers(form, r.answers ?? {}),
      familyAnswers: pruneAnswers(form, sub?.family_answers ?? {}),
      signature: sub?.signature_name
        ? { name: sub.signature_name, signedAt: sub.signed_at }
        : null,
      updatedAt: r.updated_at,
    };
    (r.status === 'registered' ? registered : notJoining).push(row);
  }

  const eligibleChildren = children.filter((c) => eventIsFor(event, c));
  const notRegistered = eligibleChildren
    .filter((c) => !answered.has(c.studentId))
    .map((c) => ({
      studentNumber: c.studentNumber,
      studentName: c.studentName,
      className: c.className,
    }))
    .sort(
      (a, b) =>
        a.className.localeCompare(b.className) ||
        a.studentName.localeCompare(b.studentName)
    );

  return {
    event: { ...event, status: eventStatus(event, now) },
    form,
    registered,
    notJoining,
    notRegistered,
    families: subs.size,
    eligible: eligibleChildren.length,
  };
}
