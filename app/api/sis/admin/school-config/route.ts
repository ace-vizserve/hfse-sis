import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { SchoolConfigUpdateSchema } from '@/lib/schemas/school-config';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { getCurrentAcademicYear } from '@/lib/academic-year';

// PATCH /api/sis/admin/school-config
//
// Partial update of the singleton school-wide settings row (id=1 — seeded
// by migration 022). Superadmin only. Each field is optional in the
// payload; only fields present in the body are touched. Audit action:
// `school_config.update`; fires once per request with the full diff.
export async function PATCH(request: NextRequest) {
  // School-wide settings sit under academic_year: the resource covers the year,
  // its terms, and school-wide configuration, and this route's role set matches.
  const auth = await requireCapability('academic_year.edit');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = SchoolConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('school_config')
    .select(
      'principal_name, ceo_name, pei_registration_number, default_publish_window_days, default_compassionate_allowance_per_year, default_vl_allowance_per_term, subject_award_bronze_min, subject_award_silver_min, subject_award_gold_min, subject_award_max, organization_name, address_line_1, address_line_2, phone_number, website_url, contact_email, pei_registration_start_date, pei_registration_end_date, logo_url'
    )
    .eq('id', 1)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before) {
    return NextResponse.json(
      { error: 'school_config singleton row missing — re-run migration 022' },
      { status: 500 }
    );
  }

  // Build a sparse update object that only touches provided fields.
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: auth.user.id,
  };
  const keys: Array<[keyof typeof parsed.data, string]> = [
    ['principalName', 'principal_name'],
    ['ceoName', 'ceo_name'],
    ['peiRegistrationNumber', 'pei_registration_number'],
    ['defaultPublishWindowDays', 'default_publish_window_days'],
    [
      'defaultCompassionateAllowancePerYear',
      'default_compassionate_allowance_per_year',
    ],
    ['defaultVlAllowancePerTerm', 'default_vl_allowance_per_term'],
    ['subjectAwardBronzeMin', 'subject_award_bronze_min'],
    ['subjectAwardSilverMin', 'subject_award_silver_min'],
    ['subjectAwardGoldMin', 'subject_award_gold_min'],
    ['subjectAwardMax', 'subject_award_max'],
    // Letterhead fields (migration 054)
    ['organizationName', 'organization_name'],
    ['addressLine1', 'address_line_1'],
    ['addressLine2', 'address_line_2'],
    ['phoneNumber', 'phone_number'],
    ['websiteUrl', 'website_url'],
    ['contactEmail', 'contact_email'],
    ['peiRegistrationStartDate', 'pei_registration_start_date'],
    ['peiRegistrationEndDate', 'pei_registration_end_date'],
    ['logoUrl', 'logo_url'],
  ];

  // Cross-field ordering check before write — mirrors the DB CHECK in
  // migration 049, but client-side validation gives a friendlier error.
  const merged = {
    bronze: (parsed.data.subjectAwardBronzeMin ??
      (before as { subject_award_bronze_min: number | null })
        .subject_award_bronze_min ??
      88.5) as number,
    silver: (parsed.data.subjectAwardSilverMin ??
      (before as { subject_award_silver_min: number | null })
        .subject_award_silver_min ??
      91.5) as number,
    gold: (parsed.data.subjectAwardGoldMin ??
      (before as { subject_award_gold_min: number | null })
        .subject_award_gold_min ??
      95.5) as number,
    max: (parsed.data.subjectAwardMax ??
      (before as { subject_award_max: number | null }).subject_award_max ??
      100) as number,
  };
  if (
    !(
      merged.bronze < merged.silver &&
      merged.silver < merged.gold &&
      merged.gold <= merged.max
    )
  ) {
    return NextResponse.json(
      {
        error:
          'Award thresholds must be strictly increasing — bronze < silver < gold ≤ max.',
      },
      { status: 400 }
    );
  }
  for (const [k, col] of keys) {
    if (k in parsed.data && parsed.data[k] !== undefined) {
      updates[col] = parsed.data[k];
    }
  }

  const { error: updateErr } = await service
    .from('school_config')
    .update(updates)
    .eq('id', 1);
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Audit: record only the fields that actually changed to keep context tight.
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const [k, col] of keys) {
    if (k in parsed.data && parsed.data[k] !== undefined) {
      const b = (before as Record<string, unknown>)[col];
      const a = parsed.data[k];
      if (b !== a) diff[col] = { before: b, after: a };
    }
  }
  if (Object.keys(diff).length > 0) {
    await logAction({
      service,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'school_config.update',
      entityType: 'school_config',
      entityId: '1',
      context: { diff },
    });
  }

  // school_config is a global singleton — bust the CURRENT AY's tags.
  // Award thresholds are baked into the cached masterfile (markbook-drill:${ay}
  // via getSchoolConfig() inside loadMasterfile) — bust on threshold changes.
  // The sis: readiness tag is busted on any config change (letterhead, allowances,
  // thresholds) since the AY readiness widget reads school_config. Best-effort.
  const awardCols = [
    'subject_award_bronze_min',
    'subject_award_silver_min',
    'subject_award_gold_min',
    'subject_award_max',
  ];
  if (Object.keys(diff).length > 0) {
    const current = await getCurrentAcademicYear(service);
    if (current) {
      if (awardCols.some((c) => c in diff)) {
        invalidateDrillTags('markbook', current.ay_code);
      }
      revalidateTag(`sis:${current.ay_code}`, 'max');
    }
  }

  return NextResponse.json({ ok: true });
}
