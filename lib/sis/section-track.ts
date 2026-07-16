import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SectionClassType } from '@/lib/schemas/section';
import { subjectCodesForTrack } from '@/lib/sis/track-bundles';

export type ApplyTrackBundleResult = {
  /** How many NEW section_subjects rows this call actually inserted
   * (excludes anything already present — additive, never removes). */
  inserted: number;
  /** Bundle codes that resolved to a real subject_configs row for this
   * AY. Normally equals the full bundle; can be shorter if a bundle
   * subject somehow has no subject_configs row for this AY yet (e.g. a
   * brand-new AY that hasn't run apply_template_to_ay). */
  resolvedCodes: string[];
  /** Bundle codes that did NOT resolve — surfaced so the caller can warn
   * instead of silently under-attaching. */
  missingCodes: string[];
};

/**
 * Resolves a class_type's static subject-code bundle
 * (`lib/sis/track-bundles.ts`) to this section's AY's `subject_configs`
 * rows, then inserts the resulting `section_subjects` rows additively
 * (`on conflict do nothing` — never removes an existing per-section
 * customization, matching every other `section_subjects` write path in
 * this codebase: the single-attach route `POST /api/sections/[id]/subjects`
 * and the level-wide `load-defaults` route).
 *
 * Deliberately does NOT: set `sections.class_type`, call
 * `create_grading_sheets_for_section`, write an audit row, or invalidate
 * any cache — those differ slightly by caller (the dedicated
 * `POST /api/sections/[id]/track` route vs. mid-year section creation,
 * which already has its own single sheet-creation + audit + cache-bust
 * call after all section_subjects work for the new section is done) and
 * so are the caller's responsibility.
 */
export async function applyTrackBundle(
  service: SupabaseClient,
  {
    sectionId,
    academicYearId,
    classType,
  }: {
    sectionId: string;
    academicYearId: string;
    classType: SectionClassType;
  }
): Promise<ApplyTrackBundleResult> {
  const codes = subjectCodesForTrack(classType);

  const { data: subjectRows } = await service
    .from('subjects')
    .select('id, code')
    .in('code', codes);
  const subjectIdByCode = new Map(
    ((subjectRows ?? []) as Array<{ id: string; code: string }>).map((s) => [
      s.code,
      s.id,
    ])
  );
  const subjectIds = Array.from(subjectIdByCode.values());

  if (subjectIds.length === 0) {
    return { inserted: 0, resolvedCodes: [], missingCodes: [...codes] };
  }

  const { data: configRows } = await service
    .from('subject_configs')
    .select('id, subject_id')
    .eq('academic_year_id', academicYearId)
    .in('subject_id', subjectIds);
  const configs = (configRows ?? []) as Array<{
    id: string;
    subject_id: string;
  }>;

  const resolvedSubjectIds = new Set(configs.map((c) => c.subject_id));
  const resolvedCodes = codes.filter((code) => {
    const subjectId = subjectIdByCode.get(code);
    return !!subjectId && resolvedSubjectIds.has(subjectId);
  });
  const missingCodes = codes.filter((code) => !resolvedCodes.includes(code));

  if (configs.length === 0) {
    return { inserted: 0, resolvedCodes, missingCodes };
  }

  const { data: existingRows } = await service
    .from('section_subjects')
    .select('subject_config_id')
    .eq('section_id', sectionId);
  const existingIds = new Set(
    ((existingRows ?? []) as Array<{ subject_config_id: string }>).map(
      (r) => r.subject_config_id
    )
  );
  const missing = configs.filter((c) => !existingIds.has(c.id));

  if (missing.length === 0) {
    return { inserted: 0, resolvedCodes, missingCodes };
  }

  const { error: insertErr } = await service.from('section_subjects').insert(
    missing.map((c) => ({
      section_id: sectionId,
      subject_config_id: c.id,
    }))
  );
  if (insertErr) {
    // 23505 = unique_violation — a concurrent write beat us to one of
    // these rows; treat as a partial success rather than failing the
    // whole bundle-apply (matches the single-attach route's tolerance).
    if ((insertErr as { code?: string }).code !== '23505') {
      throw new Error(insertErr.message);
    }
  }

  return { inserted: missing.length, resolvedCodes, missingCodes };
}
