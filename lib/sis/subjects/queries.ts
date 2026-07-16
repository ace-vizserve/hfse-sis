import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Subject-config queries for /sis/admin/subjects. Service-role reads; the
// page itself is gated to school_admin+superadmin via ROUTE_ACCESS.

export type SubjectRow = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
  // `grading_method` (migration 082) — 'standard_sheet' (has a WW/PT/QA
  // grading grid) vs 'no_sheet' (recorded some other way, no grid
  // generated). Every pre-082 subject defaults to 'standard_sheet'.
  grading_method: 'standard_sheet' | 'no_sheet';
};

export type LevelRow = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

// One row per (subject × AY) — migration 080 collapsed subject_configs off
// the level dimension (weight is a property of the subject, not any one
// level it's taught at). Which levels a subject is taught at now lives on
// `subject_level_offerings` (see `listSubjectLevelOfferings` below).
export type SubjectConfigRow = {
  id: string;
  academic_year_id: string;
  subject_id: string;
  ww_weight: number; // stored as 0.00–1.00 in DB; UI converts
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number; // max possible QA score, default 30 (Hard Rule #1 canonical)
};

// `subject_level_offerings(subject_id, level_id, academic_year_id)` — this
// AY's "which levels does this subject teach at" source of truth.
export type SubjectLevelOfferingRow = {
  subject_id: string;
  level_id: string;
};

// `subject_report_map(subject_id, report_subject_id)` — global (no AY
// column), which report-card column a subject's grades roll up into. Every
// subject is seeded self-mapped (migration 080).
export type SubjectReportMapRow = {
  subject_id: string;
  report_subject_id: string;
};

export async function listSubjects(): Promise<SubjectRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subjects')
    .select('id, code, name, is_examinable, grading_method')
    .order('name', { ascending: true });
  if (error) {
    console.error('[subjects] listSubjects failed:', error.message);
    return [];
  }
  return (data ?? []) as SubjectRow[];
}

export async function listLevels(): Promise<LevelRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('levels')
    .select('id, code, label, level_type')
    .order('code', { ascending: true });
  if (error) {
    console.error('[subjects] listLevels failed:', error.message);
    return [];
  }
  return (data ?? []) as LevelRow[];
}

export async function listSubjectConfigsForAy(
  academicYearId: string
): Promise<SubjectConfigRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subject_configs')
    .select(
      'id, academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
    )
    .eq('academic_year_id', academicYearId);
  if (error) {
    console.error('[subjects] listSubjectConfigsForAy failed:', error.message);
    return [];
  }
  return ((data ?? []) as SubjectConfigRow[]).map((r) => ({
    ...r,
    // `numeric(4,2)` comes back as a string from supabase-js; coerce to number.
    ww_weight: Number(r.ww_weight),
    pt_weight: Number(r.pt_weight),
    qa_weight: Number(r.qa_weight),
  }));
}

// Which levels each subject is attached to in a given AY — the level
// dimension migration 080 moved off `subject_configs`. AY-scoped sibling of
// `lib/sis/template/queries.ts::listTemplateSubjectLevelOfferings`.
export async function listSubjectLevelOfferings(
  academicYearId: string
): Promise<SubjectLevelOfferingRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subject_level_offerings')
    .select('subject_id, level_id')
    .eq('academic_year_id', academicYearId);
  if (error) {
    console.error(
      '[subjects] listSubjectLevelOfferings failed:',
      error.message
    );
    return [];
  }
  return (data ?? []) as SubjectLevelOfferingRow[];
}

// Report-card column mapping — global, no AY filter (migration 080's
// confirmed deviation: `subject_report_map` has no `academic_year_id`
// column).
export async function listSubjectReportMap(): Promise<SubjectReportMapRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subject_report_map')
    .select('subject_id, report_subject_id');
  if (error) {
    console.error('[subjects] listSubjectReportMap failed:', error.message);
    return [];
  }
  return (data ?? []) as SubjectReportMapRow[];
}
