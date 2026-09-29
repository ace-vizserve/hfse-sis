// The `sis.house.update` audit row's context — ONE builder, shared by the
// single-student route (PATCH /api/sis/students/[enroleeNumber]/house) and the
// house page's bulk route (/api/sis/houses/[code]/members), so a house change
// reads the same in the audit log whichever screen made it.
//
// Pure (no Supabase): tested in __tests__/house-points/member-moves.test.ts.

export type HouseAuditInput = {
  enroleeNumber: string | null;
  studentNumber: string;
  studentId: string;
  before: string | null;
  after: string | null;
  /** house id → name, from listHouses(). */
  nameById: ReadonlyMap<string, string>;
  /** Which screen made the change, when it is not the student's record. */
  source?: string;
};

export function houseAuditContext(
  input: HouseAuditInput
): Record<string, unknown> {
  const { before, after, nameById } = input;
  return {
    enroleeNumber: input.enroleeNumber,
    studentNumber: input.studentNumber,
    student_id: input.studentId,
    before,
    after,
    // Names, not just ids — the audit log is read by people.
    before_name: before == null ? null : (nameById.get(before) ?? null),
    after_name: after == null ? null : (nameById.get(after) ?? null),
    ...(input.source ? { source: input.source } : {}),
  };
}
