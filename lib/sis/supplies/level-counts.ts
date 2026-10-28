// The Admissions Book list page (migration 199): one level's books and
// supplies for a year, and for each item how many of the level's students
// have been given it.
//
// For an item, M = the students currently in that year's classes of the level
// (not withdrawn) whose track the item fits, and N = those of them with a
// handover row for it. "Fits" is the checklist's own rule, `itemFitsClass`,
// on the checklist's own track, `trackOfStudent` (the application's track,
// else the class's, else Standard), so a count and a student's checklist can
// never disagree about who an item is for.
//
// `buildLevelSupplies` is the pure half (tested); `loadLevelSupplies` reads
// the rows and hands them to it. Nothing here is cached: a tick on a
// student's Supplies stage must show on the next open of this page. Every
// read pages (`fetchAllPages` orders each page by id itself): handovers grow
// with items × students and pass PostgREST's 1,000-row cap within one level.

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  groupSupplyItems,
  itemFitsClass,
  metaOf,
  trackOfStudent,
} from '@/lib/sis/supplies/student-list';
import { resolveStudentTracks } from '@/lib/sis/supplies/tracks';
import type {
  SupplyClassType,
  SupplyItemRow,
  SupplyKind,
} from '@/lib/sis/supplies/types';
import { fetchAllPages, fetchInChunks } from '@/lib/supabase/paginate';

const TRACK_ORDER: SupplyClassType[] = ['Global', 'Standard'];

/** A student in one of the level's classes. */
export type LevelStudent = {
  studentNumber: string;
  /** Their class's `class_type`. */
  classType: string | null;
  /** The track their application names; null/absent → the class's. */
  applicationTrack?: SupplyClassType | null;
};

export type LevelSupplyItem = {
  id: string;
  kind: SupplyKind;
  title: string;
  meta: string | null;
  /** N — students on `students` with a handover row for this item. */
  given: number;
  /** M — students in the level (and track) whose track this item fits. */
  students: number;
  /**
   * Every handover row for the item, whoever holds it (a withdrawn student
   * too). What the Remove action checks: an item anyone was given cannot be
   * removed.
   */
  handedOver: number;
  // The stored fields, so the page's Edit form opens prefilled.
  subject: string | null;
  publisher: string | null;
  isbn: string | null;
  /** Null = both tracks. */
  classType: SupplyClassType | null;
  /** Null = every level (a supply); otherwise the level it is for. */
  levelId: string | null;
};

export type LevelSupplyGroup = {
  name: string;
  kind: SupplyKind;
  items: LevelSupplyItem[];
};

export type LevelSupplies = {
  /** The tracks the level's books are split by — two means a track choice. */
  tracks: SupplyClassType[];
  /** The track shown; null = the level has no Global / Standard split. */
  track: SupplyClassType | null;
  /** Students in the level's classes (on the chosen track, if any). */
  students: number;
  groups: LevelSupplyGroup[];
  /** Every subject the level's books name, either track, in the list's order. */
  subjects: string[];
};

/** The tracks a level's books name, Global first. */
export function levelTracks(
  items: Pick<SupplyItemRow, 'kind' | 'level_id' | 'class_type'>[],
  levelId: string
): SupplyClassType[] {
  const named = new Set(
    items
      .filter((i) => i.kind === 'book' && i.level_id === levelId)
      .map((i) => i.class_type)
  );
  return TRACK_ORDER.filter((t) => named.has(t));
}

export function buildLevelSupplies(input: {
  levelId: string;
  /** The `?type=` asked for; honoured only when the level has both tracks. */
  track: string | null;
  items: SupplyItemRow[];
  students: LevelStudent[];
  handovers: { item_id: string; student_number: string }[];
}): LevelSupplies {
  const { levelId } = input;
  const tracks = levelTracks(input.items, levelId);
  const track =
    tracks.length > 1
      ? (tracks.find((t) => t === input.track) ?? tracks[0])
      : null;

  // One row per student, with the track their checklist uses — on the chosen
  // track when there is one.
  const byNumber = new Map<
    string,
    { studentNumber: string; track: SupplyClassType }
  >();
  for (const s of input.students)
    byNumber.set(s.studentNumber, {
      studentNumber: s.studentNumber,
      track: trackOfStudent(s.applicationTrack, s.classType),
    });
  const students = [...byNumber.values()].filter(
    (s) => !track || s.track === track
  );

  // With a track, the items a class on it gets; without one, anything a class
  // of the level gets on either track.
  const fits = input.items.filter((i) =>
    track
      ? itemFitsClass(i, levelId, track)
      : TRACK_ORDER.some((t) => itemFitsClass(i, levelId, t))
  );

  const given = new Map<string, Set<string>>();
  for (const h of input.handovers) {
    let set = given.get(h.item_id);
    if (!set) given.set(h.item_id, (set = new Set()));
    set.add(h.student_number);
  }

  const groups = groupSupplyItems(fits, (item) => {
    const eligible = students.filter((s) =>
      itemFitsClass(item, levelId, s.track)
    );
    const handed = given.get(item.id);
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      meta: metaOf(item),
      given: handed
        ? eligible.filter((s) => handed.has(s.studentNumber)).length
        : 0,
      students: eligible.length,
      handedOver: handed?.size ?? 0,
      subject: item.subject,
      publisher: item.publisher,
      isbn: item.isbn,
      classType: item.class_type,
      levelId: item.level_id,
    };
  });

  const subjects = groupSupplyItems(
    input.items.filter(
      (i) => i.kind === 'book' && i.level_id === levelId && !!i.subject?.trim()
    ),
    () => null
  ).map((g) => g.name);

  return { tracks, track, students: students.length, groups, subjects };
}

/**
 * Reads one level's list and counts for a year. `null` = the year has no book
 * list loaded at all. Throws on a failed read.
 */
export async function loadLevelSupplies(
  service: SupabaseClient,
  args: { ayCode: string; levelId: string; track: string | null }
): Promise<LevelSupplies | null> {
  const { data: ay, error: ayErr } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', args.ayCode)
    .maybeSingle();
  if (ayErr) throw new Error(`Academic year lookup failed: ${ayErr.message}`);
  const ayId = (ay as { id: string } | null)?.id;
  if (!ayId) return null;

  // The whole year's list (a few hundred rows) — it says whether the year has
  // a list at all, and which tracks the level's books are split by.
  const [items, sections] = await Promise.all([
    fetchAllPages<SupplyItemRow>((from, to) =>
      service
        .from('supply_items')
        .select(
          'id, kind, level_id, class_type, subject, title, publisher, isbn, sort_order'
        )
        .eq('academic_year_id', ayId)
        .eq('is_active', true)
        .range(from, to)
    ),
    fetchAllPages<{ id: string; class_type: string | null }>((from, to) =>
      service
        .from('sections')
        .select('id, class_type')
        .eq('academic_year_id', ayId)
        .eq('level_id', args.levelId)
        .range(from, to)
    ),
  ]);
  if (!items.length) return null;

  const levelItems = items.filter(
    (i) => i.level_id === args.levelId || i.level_id === null
  );
  const classTypeOf = new Map(sections.map((s) => [s.id, s.class_type]));
  const sectionIds = sections.map((s) => s.id);
  const itemIds = levelItems.map((i) => i.id);

  type EnrolmentRow = {
    section_id: string;
    // Many-to-one, so one object at runtime; typed loosely as PostgREST's
    // generated types describe an embed as a list.
    student: { student_number: string } | { student_number: string }[] | null;
  };
  const [enrolments, handovers] = await Promise.all([
    fetchInChunks(sectionIds, (slice) =>
      fetchAllPages<EnrolmentRow>(
        (from, to) =>
          service
            .from('section_students')
            .select('section_id, student:students(student_number)')
            .in('section_id', slice)
            .neq('enrollment_status', 'withdrawn')
            .range(from, to) as unknown as PromiseLike<{
            data: EnrolmentRow[] | null;
            error: { message: string } | null;
          }>
      )
    ),
    fetchInChunks(itemIds, (slice) =>
      fetchAllPages<{ item_id: string; student_number: string }>((from, to) =>
        service
          .from('supply_handovers')
          .select('item_id, student_number')
          .in('item_id', slice)
          .range(from, to)
      )
    ),
  ]);

  const students: LevelStudent[] = [];
  for (const e of enrolments) {
    const student = Array.isArray(e.student) ? e.student[0] : e.student;
    const number = student?.student_number;
    if (number)
      students.push({
        studentNumber: number,
        classType: classTypeOf.get(e.section_id) ?? null,
      });
  }

  // The tracks the students' applications name — one batched read for the
  // level, not one per student.
  const tracks = await resolveStudentTracks(
    service,
    args.ayCode,
    students.map((s) => s.studentNumber)
  );
  for (const s of students)
    s.applicationTrack = tracks.get(s.studentNumber) ?? null;

  return buildLevelSupplies({
    levelId: args.levelId,
    track: args.track,
    items: levelItems,
    students,
    handovers,
  });
}
