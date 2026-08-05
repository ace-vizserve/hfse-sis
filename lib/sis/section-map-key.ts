/**
 * Key for the pre-loaded assignable-sections map used by the
 * students-needing-setup queue.
 *
 * Must include the academic year: the same level has different sections in
 * different years, so keying on the level alone would offer a registrar next
 * year's classes for this year's student.
 *
 * Lives in its own module rather than beside the loader because BOTH a server
 * page and a client component need it, and the loader imports
 * `lib/academic-year` (which reaches for `next/headers`) — importing this from
 * a client component would otherwise pull a server-only module into the
 * browser bundle.
 */
export function sectionMapKey(ayCode: string, levelLabel: string): string {
  return `${ayCode}::${levelLabel}`;
}
