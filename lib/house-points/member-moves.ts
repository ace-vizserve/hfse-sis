// Pure planning for the house page's "Add students to {house}" (POST
// /api/sis/houses/[code]/members). No Supabase, so it is unit-tested directly
// (__tests__/house-points/member-moves.test.ts).
//
// The request names SECTION_STUDENT ids — what the picker lists — but the
// house lives on the cross-AY `students` row (migration 110). A student who
// moved class has two roster rows, so two ids can name one student; they are
// changed once.

/** The roster fields planning needs — a subset of `RosterStudent`. */
export type MemberMoveStudent = {
  sectionStudentId: string;
  studentId: string;
  studentNumber: string;
  name: string;
  houseId: string | null;
};

export type HouseAddPlan<T extends MemberMoveStudent> = {
  /** Requested ids that are not on the year's ENROLLED roster. */
  unknownIds: string[];
  /** One row per student whose house changes, in request order. */
  change: T[];
  /** Students already in this house — left alone. */
  skipped: number;
};

export function planHouseAdds<T extends MemberMoveStudent>(
  roster: readonly T[],
  requestedIds: readonly string[],
  houseId: string
): HouseAddPlan<T> {
  const bySectionStudent = new Map(roster.map((s) => [s.sectionStudentId, s]));
  const unknownIds: string[] = [];
  const change: T[] = [];
  const seenStudents = new Set<string>();
  let skipped = 0;

  for (const id of new Set(requestedIds)) {
    const student = bySectionStudent.get(id);
    if (!student) {
      unknownIds.push(id);
      continue;
    }
    if (seenStudents.has(student.studentId)) continue;
    seenStudents.add(student.studentId);
    if (student.houseId === houseId) skipped += 1;
    else change.push(student);
  }

  return { unknownIds, change, skipped };
}
