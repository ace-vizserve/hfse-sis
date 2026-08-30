import 'server-only';

import { cache } from 'react';

import { createServiceClient } from '@/lib/supabase/service';

// Singleton school-wide settings — principal / CEO / PEI reg / default publish
// window (migration 022) + attendance quota defaults (migration 048, KD #94)
// + letterhead fields (migration 054).
// Row id=1 is seeded by migration 022 — query always resolves it.

export type SchoolConfig = {
  principalName: string;
  ceoName: string;
  peiRegistrationNumber: string;
  defaultPublishWindowDays: number;
  defaultCompassionateAllowancePerYear: number;
  defaultVlAllowancePerTerm: number;
  subjectAwardBronzeMin: number;
  subjectAwardSilverMin: number;
  subjectAwardGoldMin: number;
  subjectAwardMax: number;
  // Letterhead block (migration 054) — drive <ReportCardLetterhead />
  organizationName: string;
  addressLine1: string;
  addressLine2: string;
  phoneNumber: string;
  websiteUrl: string;
  contactEmail: string;
  peiRegistrationStartDate: string | null; // ISO yyyy-mm-dd
  peiRegistrationEndDate: string | null; // ISO yyyy-mm-dd
  logoUrl: string; // empty = fall back to /hfse-logo.webp
};

export const DEFAULT_SCHOOL_CONFIG: SchoolConfig = {
  principalName: '',
  ceoName: '',
  peiRegistrationNumber: '',
  defaultPublishWindowDays: 30,
  defaultCompassionateAllowancePerYear: 5,
  defaultVlAllowancePerTerm: 1,
  subjectAwardBronzeMin: 88.5,
  subjectAwardSilverMin: 91.5,
  subjectAwardGoldMin: 95.5,
  subjectAwardMax: 100.0,
  organizationName: 'HFSE Global Education Group',
  addressLine1: '223 Mountbatten Road, #01-08, 223@Mountbatten',
  addressLine2: 'Singapore 398008',
  phoneNumber: '+65 6451 0080',
  websiteUrl: 'https://hfse.edu.sg',
  contactEmail: 'enquiry@hfse.edu.sg',
  peiRegistrationStartDate: '2025-03-26',
  peiRegistrationEndDate: '2029-03-25',
  logoUrl: '',
};

/**
 * Read the singleton config row. REQUEST-MEMOISED with React `cache()`.
 *
 * WHY. Seventeen call sites, several of them inside per-student helpers —
 * `buildReportCard` resolves this once per student, so a 50-student batch print
 * (`/markbook/report-cards/section/[id]/print`) issued fifty identical reads of
 * a one-row table in a single render. `cache()` is request-scoped, so those
 * collapse to one and nothing outlives the request.
 *
 * WHY THAT IS SAFE — the whole argument is "no write route reads through this".
 * Searched: every `getSchoolConfig` occurrence in the repo, then every caller of
 * each library function that reaches it (`getCompassionateUsage[ForSection]`,
 * `getVacationLeaveUsage[ForSection]`, `loadMasterfile`, `getOverviewData`,
 * `computePublishReadiness`, `buildReportCard`), then every write of the table
 * itself (`school_config` across `app/`, `lib/`, `scripts/`, `supabase/`).
 * Exactly one handler with a write method reaches this function —
 * `POST /api/report-card-publications` via `computePublishReadiness` — and it
 * writes `report_card_publications`, not this table. The only writer of
 * `school_config` is `PATCH /api/sis/admin/school-config`, which takes its
 * before/after snapshot with a direct `.from('school_config')` select and never
 * calls this function. (`lib/sis/user-deletion.ts` nulls
 * `school_config.updated_by` on account deletion — a column this select does
 * not read, on a route that reaches this function by no path.) So no request
 * can both write the row and read it back through here.
 *
 * ⚠ CALLED FROM INSIDE `unstable_cache` BODIES (`loadMasterfileUncached`,
 * `loadOverviewDataUncached`, `computePublishReadiness` under
 * `lib/classroom/health.ts`). React `cache()` degrades to a plain call when
 * there is no dispatcher rather than throwing — pinned by
 * `__tests__/perf/school-config-request-cache.test.ts`, which calls this from
 * inside a real `unstable_cache` callback.
 */
export const getSchoolConfig = cache(
  async function getSchoolConfig(): Promise<SchoolConfig> {
    const service = createServiceClient();
    const { data, error } = await service
      .from('school_config')
      .select(
        'principal_name, ceo_name, pei_registration_number, default_publish_window_days, default_compassionate_allowance_per_year, default_vl_allowance_per_term, subject_award_bronze_min, subject_award_silver_min, subject_award_gold_min, subject_award_max, organization_name, address_line_1, address_line_2, phone_number, website_url, contact_email, pei_registration_start_date, pei_registration_end_date, logo_url'
      )
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
      peiRegistrationNumber:
        (data.pei_registration_number as string | null) ?? '',
      defaultPublishWindowDays:
        (data.default_publish_window_days as number | null) ??
        DEFAULT_SCHOOL_CONFIG.defaultPublishWindowDays,
      defaultCompassionateAllowancePerYear:
        (data.default_compassionate_allowance_per_year as number | null) ??
        DEFAULT_SCHOOL_CONFIG.defaultCompassionateAllowancePerYear,
      defaultVlAllowancePerTerm:
        (data.default_vl_allowance_per_term as number | null) ??
        DEFAULT_SCHOOL_CONFIG.defaultVlAllowancePerTerm,
      subjectAwardBronzeMin: Number(
        data.subject_award_bronze_min ??
          DEFAULT_SCHOOL_CONFIG.subjectAwardBronzeMin
      ),
      subjectAwardSilverMin: Number(
        data.subject_award_silver_min ??
          DEFAULT_SCHOOL_CONFIG.subjectAwardSilverMin
      ),
      subjectAwardGoldMin: Number(
        data.subject_award_gold_min ?? DEFAULT_SCHOOL_CONFIG.subjectAwardGoldMin
      ),
      subjectAwardMax: Number(
        data.subject_award_max ?? DEFAULT_SCHOOL_CONFIG.subjectAwardMax
      ),
      organizationName:
        (data.organization_name as string | null) ??
        DEFAULT_SCHOOL_CONFIG.organizationName,
      addressLine1:
        (data.address_line_1 as string | null) ??
        DEFAULT_SCHOOL_CONFIG.addressLine1,
      addressLine2:
        (data.address_line_2 as string | null) ??
        DEFAULT_SCHOOL_CONFIG.addressLine2,
      phoneNumber:
        (data.phone_number as string | null) ??
        DEFAULT_SCHOOL_CONFIG.phoneNumber,
      websiteUrl:
        (data.website_url as string | null) ?? DEFAULT_SCHOOL_CONFIG.websiteUrl,
      contactEmail:
        (data.contact_email as string | null) ??
        DEFAULT_SCHOOL_CONFIG.contactEmail,
      peiRegistrationStartDate:
        (data.pei_registration_start_date as string | null) ?? null,
      peiRegistrationEndDate:
        (data.pei_registration_end_date as string | null) ?? null,
      logoUrl: (data.logo_url as string | null) ?? '',
    };
  }
);
