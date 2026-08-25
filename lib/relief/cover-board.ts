import 'server-only';

import { getStaffDisplayNameById } from '@/lib/auth/staff-list';
import { reliefStatus, type ReliefStatus } from '@/lib/relief/display';
import { createServiceClient } from '@/lib/supabase/service';

// Every cover in the school, grouped the way it was actually arranged.
//
// ⚠ GROUPED BY THE ABSENT TEACHER, NOT BY CLASS, and that is the whole design.
// Every other staffing surface in this app is class-shaped, because staffing is.
// Cover is not: leave gets approved and the fact is "Marrie is out Mon–Fri",
// which is N classes, the same dates, one decision. Mr Ace, 2026-08-24 — "the
// relief teacher, this is what theyre for" — one stand-in takes all of them.
//
// READ ONLY, and not the gate. Uses the service client like every other loader
// here, so the CALLER must have proved `staff.manage_relief` first.
//
// ⚠ WHAT "RECENTLY ENDED" CAN AND CANNOT SHOW. A cover that ran out of road
// still has its row — the dates simply fell behind today — so it appears here.
// A cover somebody STOPPED EARLY does not: clearing the teacher wipes the row's
// window along with the name (see the PATCH route), leaving the audit log as the
// only record. That is the right trade — a stale name on a class nobody covers
// would be worse — but it means this group is "ran its course", not "all
// history". The page says so rather than implying a completeness it lacks.

export type CoverClass = {
  assignmentId: string;
  sectionId: string;
  label: string;
};

export type CoverGroup = {
  /** Stable key — the absence, not the row. */
  key: string;
  coveredTeacherId: string;
  coveredTeacherName: string;
  reliefTeacherId: string;
  reliefTeacherName: string;
  startedOn: string | null;
  endedOn: string | null;
  status: ReliefStatus;
  classes: CoverClass[];
  /**
   * Days until the last day, when there is one and it is close. Null otherwise.
   * This is the only thing on the page that a class-shaped screen could never
   * tell you, and the reason dates were worth adding.
   */
  endsInDays: number | null;
};

export type CoverBoard = {
  active: CoverGroup[];
  scheduled: CoverGroup[];
  recentlyEnded: CoverGroup[];
};

type Raw = {
  id: string;
  teacher_user_id: string;
  relief_teacher_user_id: string;
  role: 'form_adviser' | 'subject_teacher';
  relief_started_on: string | null;
  relief_ended_on: string | null;
  section: { id: string; name: string; level: { code: string | null } | null };
  subject: { name: string } | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * `yyyy-MM-dd` → UTC milliseconds.
 *
 * ⚠ `Date.UTC` TAKES A ZERO-INDEXED MONTH, and getting that wrong is not a
 * rounding error — it moves the date a whole month. This was shipped wrong on
 * 2026-08-24 and cost a real bug: the "recently ended" cutoff landed a month in
 * the FUTURE, so every finished cover tested as older than the cutoff and was
 * dropped. A one-day cover simply vanished from the page — not active, not
 * scheduled, not recently ended. Found in the browser by Mr Ace, 2026-08-25.
 *
 * Do the subtraction here, once, rather than at each call site.
 */
function utcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

/** `yyyy-MM-dd` N days before `iso`. */
function daysBefore(iso: string, days: number): string {
  return new Date(utcMs(iso) - days * 86_400_000).toISOString().slice(0, 10);
}

/** How far back "recently ended" reaches. */
export const RECENTLY_ENDED_DAYS = 30;

export async function getCoverBoard(
  academicYearId: string,
  today: string
): Promise<CoverBoard> {
  const service = createServiceClient();

  const [rowsRes, names] = await Promise.all([
    service
      .from('teacher_assignments')
      .select(
        `id, teacher_user_id, relief_teacher_user_id, role,
         relief_started_on, relief_ended_on,
         section:sections!inner(id, name, academic_year_id, level:levels(code)),
         subject:subjects(name)`
      )
      .not('relief_teacher_user_id', 'is', null)
      .eq('section.academic_year_id', academicYearId),
    getStaffDisplayNameById()
      .then((e) => new Map(e))
      .catch(() => new Map<string, string>()),
  ]);

  if (rowsRes.error) {
    console.error('[cover-board] read failed:', rowsRes.error.message);
    return { active: [], scheduled: [], recentlyEnded: [] };
  }

  const nameOf = (id: string) => names.get(id) ?? id;
  const cutoff = daysBefore(today, RECENTLY_ENDED_DAYS);

  // One group per (absent teacher, substitute, window). Two separate absences
  // by the same teacher with different dates are two rows on the page, which is
  // what they are in real life.
  const groups = new Map<string, CoverGroup>();

  for (const raw of (rowsRes.data ?? []) as unknown as Raw[]) {
    const section = one(raw.section);
    if (!section || !raw.relief_teacher_user_id) continue;

    const status = reliefStatus(
      raw.relief_started_on,
      raw.relief_ended_on,
      today
    );

    // An expired cover stays on its row forever — nothing clears it, and
    // nothing should. Drop the old ones here rather than letting last term's
    // cover crowd the page.
    if (
      status === 'ended' &&
      (!raw.relief_ended_on || raw.relief_ended_on < cutoff)
    ) {
      continue;
    }

    const key = [
      raw.teacher_user_id,
      raw.relief_teacher_user_id,
      raw.relief_started_on ?? '-',
      raw.relief_ended_on ?? '-',
    ].join('|');

    const level = one(section.level);
    const where = level?.code ? `${level.code} ${section.name}` : section.name;
    const label =
      raw.role === 'form_adviser'
        ? `${where} · Form class`
        : `${where} · ${one(raw.subject)?.name ?? 'Subject'}`;

    const existing = groups.get(key);
    if (existing) {
      existing.classes.push({
        assignmentId: raw.id,
        sectionId: section.id,
        label,
      });
      continue;
    }

    groups.set(key, {
      key,
      coveredTeacherId: raw.teacher_user_id,
      coveredTeacherName: nameOf(raw.teacher_user_id),
      reliefTeacherId: raw.relief_teacher_user_id,
      reliefTeacherName: nameOf(raw.relief_teacher_user_id),
      startedOn: raw.relief_started_on,
      endedOn: raw.relief_ended_on,
      status,
      classes: [{ assignmentId: raw.id, sectionId: section.id, label }],
      endsInDays:
        status === 'active' && raw.relief_ended_on
          ? daysBetween(today, raw.relief_ended_on)
          : null,
    });
  }

  const all = [...groups.values()];
  for (const g of all) g.classes.sort((a, b) => a.label.localeCompare(b.label));

  return {
    // Soonest to lapse first — the page exists to answer "what is about to run
    // out", so the answer should not need scrolling for.
    active: all
      .filter((g) => g.status === 'active')
      .sort((a, b) => (a.endsInDays ?? 9999) - (b.endsInDays ?? 9999)),
    scheduled: all
      .filter((g) => g.status === 'scheduled')
      .sort((a, b) => (a.startedOn ?? '').localeCompare(b.startedOn ?? '')),
    recentlyEnded: all
      .filter((g) => g.status === 'ended')
      .sort((a, b) => (b.endedOn ?? '').localeCompare(a.endedOn ?? '')),
  };
}
