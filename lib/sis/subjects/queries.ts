import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Subject-config matrix queries for /sis/admin/subjects. Service-role reads;
// the page itself is gated to superadmin via ROUTE_ACCESS.

export type SubjectRow = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
};

export type LevelRow = {
  id: string;
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
};

export type SubjectConfigRow = {
  id: string;
  academic_year_id: string;
  subject_id: string;
  level_id: string;
  ww_weight: number;  // stored as 0.00–1.00 in DB; UI converts
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;  // max possible QA score, default 30 (Hard Rule #1 canonical)
};

export async function listSubjects(): Promise<SubjectRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subjects')
    .select('id, code, name, is_examinable')
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
  academicYearId: string,
): Promise<SubjectConfigRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('subject_configs')
    .select(
      'id, academic_year_id, subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max',
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
