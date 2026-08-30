import 'server-only';

// Server half of the form class adviser's attendance dashboard. The rules live
// in lib/attendance/adviser-dashboard.ts (pure, tested); this composes them
// from loaders that are ALREADY section-scoped.
//
// WHY COMPOSITION AND NOT THE REGISTRAR'S LOADERS. /attendance's six loaders
// (getAttendanceKpisRange, buildAllRowSets, …) are school-wide and cached per
// AY. Threading a `sectionIds` filter through them would change cache keys the
// registrar view depends on (KD #46) — a large regression surface for a new
// page. Every loader used here already takes a sectionId, and each is the same
// one the per-section summary and quota cards use.
//
// SCOPE. Sections come from `resolveClassroomScope` + `canReadAttendance`, the
// resolver KD #163 used to gate the register itself — ADVISED sections only,
// never every section the teacher is assigned to. A subject teacher has no
// attendance work and gets an empty list, which the page turns into a redirect.

import {
  canReadAttendance,
  resolveClassroomScope,
} from '@/lib/classroom/scope';
import { loadEffectiveAssignmentsForUser } from '@/lib/auth/teacher-assignments';
import type { Role } from '@/lib/auth/roles';
import { sgToday } from '@/lib/dates';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import { createServiceClient } from '@/lib/supabase/service';
import {
  getDailyForSection,
  getSectionAttendanceSummary,
  getCompassionateUsageForSection,
  getVacationLeaveUsageForSection,
  isMarked,
  type SectionAttendanceSummary,
} from '@/lib/attendance/queries';
import {
  getDedupedSchoolCalendarForTerm,
  getEncodableDatesForTerm,
} from '@/lib/attendance/calendar';
import { isEncodableDayType } from '@/lib/schemas/attendance';
import {
  headlineFor,
  subheadFor,
  tallyToday,
  unmarkedSchoolDays,
  type AdviserSection,
  type SectionTodayState,
} from '@/lib/attendance/adviser-dashboard';

export type QuotaRisk = {
  studentId: string;
  studentName: string;
  sectionName: string;
  kind: 'compassionate' | 'vacation';
  used: number;
  allowance: number;
};

export type AdviserDashboard = {
  today: string;
  isSchoolDay: boolean;
  holidayLabel: string | null;
  nextSchoolDay: string | null;
  headline: string;
  subhead: string;
  sections: AdviserSection[];
  summaries: Record<string, SectionAttendanceSummary>;
  quotaRisks: QuotaRisk[];
};

type SectionLite = {
  id: string;
  name: string;
  levelLabel: string | null;
  levelCode: string | null;
};

/** The viewer's ADVISED sections in this AY. Empty for anyone else. */
async function loadAdvisedSections(
  role: Role | null,
  userId: string,
  academicYearId: string
): Promise<SectionLite[]> {
  const service = createServiceClient();
  // Effective, not held: taking attendance is exactly the work a substitute is
  // there to do, so a class they are covering belongs on this dashboard.
  const assignments = await loadEffectiveAssignmentsForUser(service, userId);
  const scope = resolveClassroomScope(role, assignments);

  // Oversight never reaches this page (it has its own dashboard), and a
  // `sectionIds: null` scope means "every section" — passing that through here
  // would be exactly the school-wide read this surface must not do.
  if (scope.isOversight || !scope.sectionIds || scope.sectionIds.length === 0) {
    return [];
  }
  const advisedIds = scope.sectionIds.filter((id) =>
    canReadAttendance(scope.capabilityBySection[id] ?? null)
  );
  if (advisedIds.length === 0) return [];

  const { data } = await service
    .from('sections')
    .select('id, name, level:levels(code, label)')
    .eq('academic_year_id', academicYearId)
    .in('id', advisedIds);

  type LevelLite = { code: string | null; label: string | null };
  type Row = {
    id: string;
    name: string;
    level: LevelLite | LevelLite[] | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const level = Array.isArray(r.level) ? (r.level[0] ?? null) : r.level;
    return {
      id: r.id,
      name: r.name,
      levelLabel: level?.label ?? null,
      levelCode: level?.code ?? null,
    };
  });
}

async function activeRosterCounts(
  sectionIds: string[]
): Promise<Record<string, number>> {
  if (sectionIds.length === 0) return {};
  const service = createServiceClient();
  const { data } = await service
    .from('section_students')
    .select('section_id, enrollment_status')
    .in('section_id', sectionIds);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{
    section_id: string;
    enrollment_status: string | null;
  }>) {
    // Withdrawn students stay on the roster row (Hard Rule #6) but are not
    // marked, so counting them would make a fully-marked class read as partial.
    if (row.enrollment_status !== 'withdrawn') {
      counts[row.section_id] = (counts[row.section_id] ?? 0) + 1;
    }
  }
  return counts;
}

export async function loadAdviserAttendanceDashboard(opts: {
  role: Role | null;
  userId: string;
  academicYearId: string;
  termId: string;
}): Promise<AdviserDashboard | null> {
  const { role, userId, academicYearId, termId } = opts;
  const sections = await loadAdvisedSections(role, userId, academicYearId);
  if (sections.length === 0) return null;

  const today = sgToday();

  // ── THREE INDEPENDENT GROUPS, ONE WAVE ────────────────────────────────
  // The roster counts, the per-section day/summary fan-out and the quota scan
  // are all functions of `sections`, `academicYearId` and `termId` — nothing
  // in any of them consumes a result from either of the others. They ran one
  // after another anyway, and the last one ran LAST BY ACCIDENT: `quotaRisks`
  // was `await`ed inside the returned object literal, whose properties
  // evaluate in source order, so the deepest of the three was pinned behind
  // both of the others with nothing to show for it.
  //
  // The roster count is joined onto each section AFTER the group resolves
  // rather than read inside the per-section map, which is the only reason the
  // map could be lifted out from behind it.
  const [counts, perSection, quotaRisks] = await Promise.all([
    activeRosterCounts(sections.map((s) => s.id)),
    // The calendar is audience-resolved per level (KD #50), so a primary and a
    // secondary class can genuinely disagree about whether today is a school
    // day. Resolve per section rather than once for the whole page.
    Promise.all(
      sections.map(async (s) => {
        const levelType = levelTypeForAudienceLookup(s.levelCode);
        // ONE DAILY READ PER CLASS, NOT TWO. This asked `getDailyForSection`
        // for `{ fromDate: today, toDate: today }` AND `{ toDate: today }` — the
        // second window contains the first, so the narrow read re-fetched rows
        // the wide one already had, at a roster read plus a paginated daily read
        // per class, every load.
        //
        // The filter below is exact, not approximate: `getDailyForSection`
        // dedupes to the latest row per `student|date|period`, and because that
        // key CONTAINS the date, earlier days cannot displace a winner on today
        // — not even a backdated correction entered after today's marks. Order
        // survives too, since `recorded_at desc` is applied across the whole set
        // and filtering preserves relative order. Pinned by
        // __tests__/attendance/adviser-dashboard-today-subset.test.ts, which was
        // run green against the two-fetch version first and includes the case
        // where today's marks only appear on the wide read's SECOND page.
        const [allRows, encodable, summary] = await Promise.all([
          getDailyForSection(s.id, termId, { toDate: today }),
          getEncodableDatesForTerm(termId, levelType),
          getSectionAttendanceSummary(s.id, termId),
        ]);
        // FILTERED AT THE READ, which fixes BOTH consumers below at once and
        // is why it is done here rather than at either call site. A cleared
        // day (status null, migration 134) is NOT MARKED:
        //
        //   · `tallyToday` would otherwise count it in `marked` — the number
        //     driving "this class is done for today" — while it landed in none
        //     of present/late/absent/excused/noClass, so the tally would not
        //     even add up to itself;
        //   · `unmarkedSchoolDays` keys purely on the DATE being present, so a
        //     day whose only marks were all cleared would still read as done
        //     and quietly drop off the list of days that slipped. That list is
        //     the entire point of this dashboard.
        //
        // `MarkLite` deliberately stays narrow — it is the pure engine's row
        // type and has no business knowing a mark can be absent.
        const allMarks = allRows.filter(isMarked);
        const todayMarks = allMarks.filter((m) => m.date === today);

        const isSchoolDayHere = encodable.includes(today);
        const tally = tallyToday(todayMarks);
        const todayState: SectionTodayState = !isSchoolDayHere
          ? { kind: 'not-a-school-day' }
          : tally.marked > 0
            ? { kind: 'marked', tally }
            : { kind: 'unmarked' };

        return {
          sectionId: s.id,
          sectionName: s.name,
          levelLabel: s.levelLabel,
          today: todayState,
          unmarked: unmarkedSchoolDays(
            encodable,
            new Set(allMarks.map((m) => m.date)),
            today
          ),
          summary,
          isSchoolDayHere,
        };
      })
    ),
    loadQuotaRisks(sections, academicYearId, termId),
  ]);

  const adviserSections: AdviserSection[] = perSection.map((p) => ({
    sectionId: p.sectionId,
    sectionName: p.sectionName,
    levelLabel: p.levelLabel,
    rosterCount: counts[p.sectionId] ?? 0,
    today: p.today,
    unmarked: p.unmarked,
  }));

  // Page-level day state follows the sections: it is a school day if it is one
  // for any class the adviser holds. GENUINELY DEPENDENT and left serial —
  // `describeNonSchoolDay` is only asked when no class has a school day today,
  // which is a fact only the fan-out above can produce.
  const isSchoolDay = perSection.some((p) => p.isSchoolDayHere);
  const { holidayLabel, nextSchoolDay } = isSchoolDay
    ? { holidayLabel: null, nextSchoolDay: null }
    : await describeNonSchoolDay(termId, today, sections[0]?.levelCode ?? null);

  const summaries: Record<string, SectionAttendanceSummary> = {};
  for (const p of perSection) summaries[p.sectionId] = p.summary;

  return {
    today,
    isSchoolDay,
    holidayLabel,
    nextSchoolDay,
    headline: headlineFor(adviserSections, isSchoolDay, holidayLabel),
    subhead: subheadFor(adviserSections, isSchoolDay, nextSchoolDay),
    sections: adviserSections,
    summaries,
    quotaRisks,
  };
}

/** Why today takes no marks, and when the next one that does is. */
async function describeNonSchoolDay(
  termId: string,
  today: string,
  levelCode: string | null
): Promise<{ holidayLabel: string | null; nextSchoolDay: string | null }> {
  const rows = await getDedupedSchoolCalendarForTerm(
    termId,
    levelTypeForAudienceLookup(levelCode)
  );
  const todayRow = rows.find((r) => r.date === today);
  const next =
    rows
      .filter(
        (r) => r.date > today && isEncodableDayType(r.dayType, r.hblOverlay)
      )
      .map((r) => r.date)
      .sort()[0] ?? null;
  return { holidayLabel: todayRow?.label ?? null, nextSchoolDay: next };
}

/**
 * Students who have spent a leave allowance, across the adviser's classes.
 *
 * Both loaders are section-scoped, so this never touches another adviser's
 * class — deliberately NOT `getCompassionateOverQuota(ayCode)`, which scans the
 * whole year for every section.
 */
async function loadQuotaRisks(
  sections: SectionLite[],
  academicYearId: string,
  termId: string
): Promise<QuotaRisk[]> {
  const service = createServiceClient();
  const out: QuotaRisk[] = [];

  // ⚠ THE TWO QUOTAS ARE INDEPENDENT AND USED TO BE SERIAL BY OBJECT-LITERAL
  // ORDER. Written as `{ compassionate: await …, vacation: await … }`, the
  // properties evaluate top to bottom, so the vacation scan — the deeper of
  // the two by a wide margin — never started until the compassionate one had
  // finished. Neither reads anything the other produces.
  const perSection = await Promise.all(
    sections.map(async (s) => {
      const [compassionate, vacation] = await Promise.all([
        getCompassionateUsageForSection(s.id, academicYearId),
        getVacationLeaveUsageForSection(s.id, academicYearId, termId),
      ]);
      return { section: s, compassionate, vacation };
    })
  );

  const studentIds = new Set<string>();
  for (const p of perSection) {
    for (const id of p.compassionate.keys()) studentIds.add(id);
    for (const id of p.vacation.keys()) studentIds.add(id);
  }
  const names = await loadStudentNames(service, [...studentIds]);

  for (const p of perSection) {
    for (const [studentId, usage] of p.compassionate) {
      if (usage.used > usage.allowance) {
        out.push({
          studentId,
          studentName: names[studentId] ?? 'Unknown student',
          sectionName: p.section.name,
          kind: 'compassionate',
          used: usage.used,
          allowance: usage.allowance,
        });
      }
    }
    for (const [studentId, usage] of p.vacation) {
      if (usage.usedThisTerm > usage.allowance) {
        out.push({
          studentId,
          studentName: names[studentId] ?? 'Unknown student',
          sectionName: p.section.name,
          kind: 'vacation',
          used: usage.usedThisTerm,
          allowance: usage.allowance,
        });
      }
    }
  }

  return out.sort((a, b) => a.studentName.localeCompare(b.studentName));
}

async function loadStudentNames(
  service: ReturnType<typeof createServiceClient>,
  studentIds: string[]
): Promise<Record<string, string>> {
  if (studentIds.length === 0) return {};
  const { data } = await service
    .from('students')
    .select('id, first_name, last_name')
    .in('id', studentIds);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
  }>) {
    out[row.id] = `${row.last_name ?? ''}, ${row.first_name ?? ''}`
      .trim()
      .replace(/^,\s*/, '');
  }
  return out;
}
