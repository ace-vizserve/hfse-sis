/**
 * `RollupRow.daysPresent` is P+L+EX combined (see migration 068's
 * `recompute_attendance_rollup`: `count(*) filter (where status in
 * ('P','L','EX'))`). Present-ONLY count = daysPresent − daysLate −
 * daysExcused. Shared by the student-summary route and the attendance
 * lookup dialog's roster table so the derivation lives in exactly one
 * place.
 *
 * Lives in this dedicated, dependency-free module (not lib/attendance/queries.ts,
 * which transitively imports a server-only module) so client components can
 * import it without pulling a server-only module into the browser bundle.
 */
export function presentOnlyCount(r: {
  daysPresent: number;
  daysLate: number;
  daysExcused: number;
}): number {
  return Math.max(0, r.daysPresent - r.daysLate - r.daysExcused);
}
