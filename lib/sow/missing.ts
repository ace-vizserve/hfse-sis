import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchInChunks } from '@/lib/supabase/paginate';

export type ClassWithoutSow = {
  sectionId: string;
  subjectId: string;
  sectionName: string;
  subjectName: string;
};

/**
 * Of the given (section, subject) pairs, the ones with no approved scheme of
 * work this term. Used by grading-sheet creation to WARN, never to block.
 *
 * "Approved" means the scheme has an `approved_snapshot` and lists the section
 * as one of its classes. State is deliberately not read: a reopened scheme is
 * back in draft, but its approved plan is still the one in force.
 *
 * Batched: schemes, then their classes, then the names. A whole-year create
 * names hundreds of pairs, so nothing here runs once per pair.
 */
export async function listClassesWithoutApprovedSow(
  service: SupabaseClient,
  termId: string,
  pairs: { sectionId: string; subjectId: string }[]
): Promise<ClassWithoutSow[]> {
  const seen = new Set<string>();
  const unique = pairs.filter((p) => {
    const k = `${p.sectionId}|${p.subjectId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) return [];

  const subjectIds = [...new Set(unique.map((p) => p.subjectId))];
  const sectionIds = [...new Set(unique.map((p) => p.sectionId))];

  const schemes = await fetchInChunks(subjectIds, async (slice) => {
    const { data, error } = await service
      .from('schemes_of_work')
      .select('id, subject_id')
      .eq('term_id', termId)
      .in('subject_id', slice)
      .not('approved_snapshot', 'is', null);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; subject_id: string }[];
  });
  const subjectOfSow = new Map(schemes.map((s) => [s.id, s.subject_id]));

  const covered = new Set<string>();
  if (schemes.length > 0) {
    const sowIds = [...subjectOfSow.keys()];
    const classes = await fetchInChunks(sowIds, async (slice) => {
      const { data, error } = await service
        .from('scheme_of_work_classes')
        .select('sow_id, section_id')
        .in('sow_id', slice)
        .in('section_id', sectionIds);
      if (error) throw new Error(error.message);
      return (data ?? []) as { sow_id: string; section_id: string }[];
    });
    for (const c of classes) {
      covered.add(`${c.section_id}|${subjectOfSow.get(c.sow_id)}`);
    }
  }

  const missing = unique.filter(
    (p) => !covered.has(`${p.sectionId}|${p.subjectId}`)
  );
  if (missing.length === 0) return [];

  const [sections, subjects] = await Promise.all([
    fetchInChunks(
      [...new Set(missing.map((p) => p.sectionId))],
      async (slice) => {
        const { data, error } = await service
          .from('sections')
          .select('id, name')
          .in('id', slice);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; name: string }[];
      }
    ),
    fetchInChunks(
      [...new Set(missing.map((p) => p.subjectId))],
      async (slice) => {
        const { data, error } = await service
          .from('subjects')
          .select('id, name')
          .in('id', slice);
        if (error) throw new Error(error.message);
        return (data ?? []) as { id: string; name: string }[];
      }
    ),
  ]);
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  return missing
    .map((p) => ({
      sectionId: p.sectionId,
      subjectId: p.subjectId,
      sectionName: sectionName.get(p.sectionId) ?? '',
      subjectName: subjectName.get(p.subjectId) ?? '',
    }))
    .sort(
      (a, b) =>
        a.sectionName.localeCompare(b.sectionName) ||
        a.subjectName.localeCompare(b.subjectName)
    );
}
