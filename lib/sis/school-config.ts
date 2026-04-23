import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Singleton school-wide settings (principal, CEO, PEI reg no., default publish
// window). Row id=1 is seeded by migration 022 — query always resolves it.

export type SchoolConfig = {
  principalName: string;
  ceoName: string;
  peiRegistrationNumber: string;
  defaultPublishWindowDays: number;
};

export const DEFAULT_SCHOOL_CONFIG: SchoolConfig = {
  principalName: '',
  ceoName: '',
  peiRegistrationNumber: '',
  defaultPublishWindowDays: 30,
};

export async function getSchoolConfig(): Promise<SchoolConfig> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('school_config')
    .select('principal_name, ceo_name, pei_registration_number, default_publish_window_days')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) {
    // Defensive: migration seeds the row, but if something went wrong the
    // report-card render must still work.
    return DEFAULT_SCHOOL_CONFIG;
  }
  return {
    principalName: (data.principal_name as string | null) ?? '',
    ceoName: (data.ceo_name as string | null) ?? '',
    peiRegistrationNumber: (data.pei_registration_number as string | null) ?? '',
    defaultPublishWindowDays:
      (data.default_publish_window_days as number | null) ??
      DEFAULT_SCHOOL_CONFIG.defaultPublishWindowDays,
  };
}
