import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CustomerForm } from '@/lib/billing/customer-form';
import {
  draftFromApplication,
  type ApplicationContact,
  type NewCustomerStudent,
} from '@/lib/billing/new-customer';
import { loadStudentInfo } from '@/lib/billing/students.server';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Billing → New customer: who can be added (every student the SIS holds no
// QuickBooks customer for — the To review list), and the form for one of
// them, filled from their newest application.

export async function listStudentsWithoutCustomer(
  service: SupabaseClient
): Promise<NewCustomerStudent[]> {
  type Row = { student_number: string; student_name: string };
  const rows = await fetchAllPages<Row>(
    (from, to) =>
      service
        .from('billing_link_review')
        .select('student_number, student_name')
        .order('student_name')
        .range(from, to) as unknown as PromiseLike<{
        data: Row[] | null;
        error: { message: string } | null;
      }>,
    1000,
    { tieBreak: 'student_number' }
  );
  const info = await loadStudentInfo(
    service,
    rows.map((r) => r.student_number)
  );
  return rows
    .map((r) => {
      const s = info.get(r.student_number);
      return {
        studentNumber: r.student_number,
        name: s?.name ?? r.student_name,
        level: s?.level ?? null,
        ayCode: s?.ayCode ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const CONTACT_COLS =
  '"firstName","middleName","lastName","fatherFullName","motherFullName","guardianFullName","fatherEmail","motherEmail","guardianEmail","fatherMobile","motherMobile","guardianMobile","homePhone","homeAddress","postalCode"';

/** The form for one student, or null when the SIS has no application. */
export async function newCustomerDraft(
  service: SupabaseClient,
  studentNumber: string
): Promise<CustomerForm | null> {
  const s = (await loadStudentInfo(service, [studentNumber])).get(
    studentNumber
  );
  if (!s) return null;
  const { data, error } = await service
    .from(`ay${s.ayCode.slice(2)}_enrolment_applications`)
    .select(CONTACT_COLS)
    .eq('enroleeNumber', s.enroleeNumber)
    .maybeSingle();
  if (error) throw new Error(`Application lookup failed: ${error.message}`);
  return draftFromApplication(
    (data as ApplicationContact | null) ?? {
      firstName: s.firstName,
      middleName: s.middleName,
      lastName: s.lastName,
      fatherFullName: s.fatherFullName,
      motherFullName: s.motherFullName,
      fatherEmail: null,
      motherEmail: null,
      guardianEmail: null,
      fatherMobile: null,
      motherMobile: null,
      guardianMobile: null,
      homePhone: null,
      homeAddress: null,
      postalCode: null,
    }
  );
}
