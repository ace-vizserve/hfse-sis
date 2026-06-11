import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Template table queries for /sis/admin/template. Service-role reads;
// the page itself is gated to superadmin via ROUTE_ACCESS.

export type TemplateSectionRow = {
  id: string;
  level_id: string;
  name: string;
  class_type: string | null;
  schedule: string | null;
  level_label: string;
  level_code: string;
  level_type: 'primary' | 'secondary';
};

export type TemplateSubjectConfigRow = {
  id: string;
  subject_id: string;
  level_id: string;
  ww_weight: number;
  pt_weight: number;
  qa_weight: number;
  ww_max_slots: number;
  pt_max_slots: number;
  qa_max: number;
};

export type EligibleAyRow = {
  ay_code: string;
  label: string;
  is_current: boolean;
};

export async function listTemplateSections(): Promise<TemplateSectionRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('template_sections')
    .select(
      'id, level_id, name, class_type, schedule, level:levels(code, label, level_type)'
    )
    .order('name');
  if (error) {
    console.error('[template] listTemplateSections failed:', error.message);
    return [];
  }
  type Row = {
    id: string;
    level_id: string;
    name: string;
    class_type: string | null;
    schedule: string | null;
    level:
      | { code: string; label: string; level_type: 'primary' | 'secondary' }
      | { code: string; label: string; level_type: 'primary' | 'secondary' }[]
      | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const lvl = Array.isArray(r.level) ? r.level[0] : r.level;
    return {
      id: r.id,
      level_id: r.level_id,
      name: r.name,
      class_type: r.class_type,
      schedule: r.schedule,
      level_label: lvl?.label ?? '—',
      level_code: lvl?.code ?? '',
      level_type: (lvl?.level_type ?? 'primary') as 'primary' | 'secondary',
    };
  });
}

export async function listTemplateSubjectConfigs(): Promise<
  TemplateSubjectConfigRow[]
> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('template_subject_configs')
    .select(
      'id, subject_id, level_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max'
    );
  if (error) {
    console.error(
      '[template] listTemplateSubjectConfigs failed:',
      error.message
    );
    return [];
  }
  return ((data ?? []) as TemplateSubjectConfigRow[]).map((r) => ({
    ...r,
    ww_weight: Number(r.ww_weight),
    pt_weight: Number(r.pt_weight),
    qa_weight: Number(r.qa_weight),
  }));
}

// Non-test AYs the admin can propagate the template into. Excludes test
// AYs (`^AY9`) to prevent accidentally seeding the test environment with
// template data — the test seeder owns that path.
export async function listEligibleAysForApply(): Promise<EligibleAyRow[]> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('academic_years')
    .select('ay_code, label, is_current')
    .not('ay_code', 'ilike', 'AY9%')
    .order('ay_code', { ascending: false });
  if (error) {
    console.error('[template] listEligibleAysForApply failed:', error.message);
    return [];
  }
  return (data ?? []) as EligibleAyRow[];
}
