import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { ayCodeToSlug } from './admissions-ddl';

// Read helpers for the AY Setup Wizard. All use the service-role client
// (the landing page is gated by route access + layout role check; the
// service client bypasses RLS for the academic_years / reference-data reads
// the page needs).

export type AcademicYearRow = {
  id: string;
  ay_code: string;
  label: string;
  is_current: boolean;
  /** KD #77: parent portal can submit applications for this AY when true. */
  accepting_applications: boolean;
  created_at: string;
};

export type TermRow = {
  id: string;
  academic_year_id: string;
  term_number: number;
  label: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  // Free-text virtue theme set in SIS Admin. Drives the Evaluation module
  // prompt and the T1–T3 report card parenthetical label (KD #49).
  virtue_theme: string | null;
  // Advisory grading cutoff. Informational only — the actual per-sheet
  // lock is `grading_sheets.is_locked`.
  grading_lock_date: string | null;
};

/**
 * Returns all terms grouped by academic_year_id. Used by the AY Setup page
 * to render the per-AY term-dates editor inline.
 */
export async function listTermsByAy(): Promise<Record<string, TermRow[]>> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('terms')
    .select('id, academic_year_id, term_number, label, start_date, end_date, is_current, virtue_theme, grading_lock_date')
    .order('term_number', { ascending: true });
  if (error) {
    console.error('[ay-setup queries] listTermsByAy failed:', error.message);
    return {};
  }
  const byAy: Record<string, TermRow[]> = {};
  for (const row of (data ?? []) as TermRow[]) {
    if (!byAy[row.academic_year_id]) byAy[row.academic_year_id] = [];
    byAy[row.academic_year_id].push(row);
  }
  return byAy;
}

export type AcademicYearListItem = AcademicYearRow & {
  counts: {
    terms: number;
    sections: number;
    subject_configs: number;
    section_students: number;
  };
  // Lightweight blocker summary for the Delete button. Full check happens
  // server-side in the DELETE API route via delete_academic_year().
  has_children: boolean;
};

/**
 * Returns every academic_years row with child-table row counts, newest first
 * by `ay_code`. Used by the AY Setup landing page.
 */
export async function listAcademicYears(): Promise<AcademicYearListItem[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('academic_years')
    .select('id, ay_code, label, is_current, accepting_applications, created_at')
    .order('ay_code', { ascending: false });

  if (error) {
    console.error('[ay-setup queries] listAcademicYears failed:', error.message);
    return [];
  }

  const rows = (data ?? []) as AcademicYearRow[];

  // Per-AY counts — kept cheap with count-only queries. For small row counts
  // (HFSE: <5 AYs ever, <100 sections/configs each) this is fine.
  const items: AcademicYearListItem[] = await Promise.all(
    rows.map(async (row) => {
      const [termsRes, sectionsRes, configsRes] = await Promise.all([
        service.from('terms').select('id', { count: 'exact', head: true }).eq('academic_year_id', row.id),
        service.from('sections').select('id', { count: 'exact', head: true }).eq('academic_year_id', row.id),
        service.from('subject_configs').select('id', { count: 'exact', head: true }).eq('academic_year_id', row.id),
      ]);

      // section_students is a count across all sections in this AY.
      const sectionIds = (
        await service.from('sections').select('id').eq('academic_year_id', row.id)
      ).data?.map((s) => (s as { id: string }).id) ?? [];

      let ssCount = 0;
      if (sectionIds.length > 0) {
        const { count } = await service
          .from('section_students')
          .select('id', { count: 'exact', head: true })
          .in('section_id', sectionIds);
        ssCount = count ?? 0;
      }

      const counts = {
        terms: termsRes.count ?? 0,
        sections: sectionsRes.count ?? 0,
        subject_configs: configsRes.count ?? 0,
        section_students: ssCount,
      };

      return {
        ...row,
        counts,
        has_children: ssCount > 0,
      };
    }),
  );

  return items;
}

import { TEMPLATE_SOURCE_SENTINEL } from './constants';

export { TEMPLATE_SOURCE_SENTINEL };

export type CopyForwardPreview = {
  /**
   * Where the new AY's sections + subject_configs will be sourced from:
   * - `TEMPLATE_SOURCE_SENTINEL` (`'__TEMPLATE__'`) when the master template
   *   has rows (migration 031).
   * - An AY code (`'AY2026'`) when falling back to copy-from-prior-AY.
   * - `null` when there's nothing to copy (target already has data, no
   *   template, no prior AY).
   */
  source_ay_code: string | null;
  sections_to_copy: number;
  subject_configs_to_copy: number;
  /** True when an `academic_years` row already exists for the new AY code. */
  ay_already_exists: boolean;
  /** Count of terms (T1–T4) that will actually be inserted by the RPC. */
  terms_to_insert: number;
};

/**
 * Returns the counts that the AY Setup wizard will copy from on creation.
 * Mirrors `create_academic_year` post migration 031:
 *
 *   - Template tables (`template_sections` / `template_subject_configs`)
 *     win when populated. The preview reports `source_ay_code =
 *     TEMPLATE_SOURCE_SENTINEL` and the count of template rows.
 *   - Otherwise falls back to the most-recent non-test prior AY (the
 *     migration-030 behaviour, kept for empty-template installs).
 *   - The RPC skips copying if the target AY already has sections (or
 *     subject_configs). The preview reports 0 in that case.
 */
export async function getCopyForwardPreview(newAyCode: string): Promise<CopyForwardPreview> {
  const service = createServiceClient();

  // Look up the target AY row first — drives idempotent-state fields.
  const { data: target } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', newAyCode)
    .maybeSingle();
  const targetId = (target as { id: string } | null)?.id ?? null;
  const targetExistingTermsCount = targetId
    ? (
        await service
          .from('terms')
          .select('id', { count: 'exact', head: true })
          .eq('academic_year_id', targetId)
      ).count ?? 0
    : 0;
  const termsToInsert = Math.max(0, 4 - targetExistingTermsCount);

  // Pre-compute target-side counts so we can skip-report for either source.
  const [targetSectionsRes, targetConfigsRes] = await Promise.all([
    targetId
      ? service.from('sections').select('id', { count: 'exact', head: true }).eq('academic_year_id', targetId)
      : Promise.resolve({ count: 0 }),
    targetId
      ? service.from('subject_configs').select('id', { count: 'exact', head: true }).eq('academic_year_id', targetId)
      : Promise.resolve({ count: 0 }),
  ]);
  const targetHasSections = (targetSectionsRes.count ?? 0) > 0;
  const targetHasConfigs = (targetConfigsRes.count ?? 0) > 0;

  // Template wins when populated. Count rows directly from the template
  // tables — same source the RPC actually copies from.
  const [templateSectionsRes, templateConfigsRes] = await Promise.all([
    service.from('template_sections').select('id', { count: 'exact', head: true }),
    service.from('template_subject_configs').select('id', { count: 'exact', head: true }),
  ]);
  const templateSectionsCount = templateSectionsRes.count ?? 0;
  const templateConfigsCount = templateConfigsRes.count ?? 0;
  if (templateSectionsCount > 0 || templateConfigsCount > 0) {
    return {
      source_ay_code: TEMPLATE_SOURCE_SENTINEL,
      sections_to_copy: targetHasSections ? 0 : templateSectionsCount,
      subject_configs_to_copy: targetHasConfigs ? 0 : templateConfigsCount,
      ay_already_exists: targetId !== null,
      terms_to_insert: termsToInsert,
    };
  }

  // Fallback: most recent non-test prior AY.
  const { data: prior } = await service
    .from('academic_years')
    .select('id, ay_code')
    .neq('ay_code', newAyCode)
    .not('ay_code', 'ilike', 'AY9%')
    .order('ay_code', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!prior) {
    return {
      source_ay_code: null,
      sections_to_copy: 0,
      subject_configs_to_copy: 0,
      ay_already_exists: targetId !== null,
      terms_to_insert: termsToInsert,
    };
  }

  const priorId = (prior as { id: string }).id;
  const [sectionsRes, configsRes] = await Promise.all([
    service.from('sections').select('id', { count: 'exact', head: true }).eq('academic_year_id', priorId),
    service.from('subject_configs').select('id', { count: 'exact', head: true }).eq('academic_year_id', priorId),
  ]);

  return {
    source_ay_code: (prior as { ay_code: string }).ay_code,
    sections_to_copy: targetHasSections ? 0 : (sectionsRes.count ?? 0),
    subject_configs_to_copy: targetHasConfigs ? 0 : (configsRes.count ?? 0),
    ay_already_exists: targetId !== null,
    terms_to_insert: termsToInsert,
  };
}

export type AyEmptinessCheck = {
  empty: boolean;
  blockers: string[];
  is_current: boolean;
};

/**
 * Client-side preview of what blocks a delete. The authoritative check runs
 * server-side in the `delete_academic_year` Postgres function; this is just
 * the UI disabled-state helper. Never trust client; always call the RPC and
 * let it reject.
 */
export async function checkAyEmpty(ayCode: string): Promise<AyEmptinessCheck> {
  const service = createServiceClient();
  const slug = ayCodeToSlug(ayCode);
  const blockers: string[] = [];

  const { data: ayRow } = await service
    .from('academic_years')
    .select('id, is_current')
    .eq('ay_code', ayCode)
    .maybeSingle();

  if (!ayRow) {
    return { empty: false, blockers: ['AY not found'], is_current: false };
  }

  const isCurrent = (ayRow as { is_current: boolean }).is_current;
  const ayId = (ayRow as { id: string }).id;

  if (isCurrent) {
    blockers.push('This is the current AY');
  }

  // section_students via sections
  const { data: sectionRows } = await service.from('sections').select('id').eq('academic_year_id', ayId);
  const sectionIds = (sectionRows ?? []).map((r) => (r as { id: string }).id);
  if (sectionIds.length > 0) {
    const { count } = await service
      .from('section_students')
      .select('id', { count: 'exact', head: true })
      .in('section_id', sectionIds);
    if ((count ?? 0) > 0) blockers.push(`${count} section_students rows`);
  }

  // grading_sheets via terms or sections
  const { data: termRows } = await service.from('terms').select('id').eq('academic_year_id', ayId);
  const termIds = (termRows ?? []).map((r) => (r as { id: string }).id);
  if (termIds.length > 0 || sectionIds.length > 0) {
    const sheetsQuery = service.from('grading_sheets').select('id', { count: 'exact', head: true });
    if (termIds.length > 0 && sectionIds.length > 0) {
      const { count } = await sheetsQuery.or(
        `term_id.in.(${termIds.join(',')}),section_id.in.(${sectionIds.join(',')})`,
      );
      if ((count ?? 0) > 0) blockers.push(`${count} grading_sheets rows`);
    }
  }

  // admissions tables — check if any of the 4 have rows
  for (const suffix of [
    'enrolment_applications',
    'enrolment_status',
    'enrolment_documents',
    'discount_codes',
  ]) {
    const table = `${slug}_${suffix}`;
    const { count, error } = await service.from(table).select('id', { count: 'exact', head: true });
    // Missing table → count errors; treat as zero (table doesn't exist yet).
    if (error) continue;
    if ((count ?? 0) > 0) blockers.push(`${count} rows in ${table}`);
  }

  return {
    empty: blockers.length === 0 && !isCurrent,
    blockers,
    is_current: isCurrent,
  };
}
