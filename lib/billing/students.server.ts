import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { studentDisplayName } from '@/lib/billing/view';

export type StudentInfo = {
  studentNumber: string;
  name: string;
  level: string | null;
  ayCode: string;
  enroleeNumber: string;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  fatherFullName: string | null;
  motherFullName: string | null;
};

const COLS =
  '"studentNumber","enroleeNumber","lastName","firstName","middleName","enroleeFullName","levelApplied","fatherFullName","motherFullName"';

/**
 * Name, level and newest application of each student number, from the newest
 * academic year that has them. A year with no admissions tables is skipped.
 */
export async function loadStudentInfo(
  service: SupabaseClient,
  studentNumbers: string[]
): Promise<Map<string, StudentInfo>> {
  const out = new Map<string, StudentInfo>();
  const wanted = new Set(studentNumbers.filter(Boolean));
  if (wanted.size === 0) return out;
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const left = [...wanted].filter((sn) => !out.has(sn));
    if (left.length === 0) break;
    for (let i = 0; i < left.length; i += 300) {
      const { data, error: appErr } = await service
        .from(`ay${ay_code.slice(2)}_enrolment_applications`)
        .select(COLS)
        .in('studentNumber', left.slice(i, i + 300))
        .order('enroleeNumber', { ascending: false });
      if (appErr) {
        if (
          /PGRST205|42P01|Could not find the table/i.test(
            `${appErr.code ?? ''} ${appErr.message}`
          )
        )
          break;
        throw new Error(
          `${ay_code} applications lookup failed: ${appErr.message}`
        );
      }
      for (const r of (data ?? []) as Array<Record<string, string | null>>) {
        const sn = r.studentNumber;
        if (!sn || out.has(sn)) continue;
        out.set(sn, {
          studentNumber: sn,
          name: studentDisplayName({
            lastName: r.lastName,
            firstName: r.firstName,
            middleName: r.middleName,
            enroleeFullName: r.enroleeFullName,
          }),
          level: r.levelApplied ?? null,
          ayCode: ay_code,
          enroleeNumber: r.enroleeNumber ?? '',
          firstName: r.firstName ?? null,
          middleName: r.middleName ?? null,
          lastName: r.lastName ?? null,
          fatherFullName: r.fatherFullName ?? null,
          motherFullName: r.motherFullName ?? null,
        });
      }
    }
  }
  return out;
}
