import type { SupabaseClient } from '@supabase/supabase-js';

// A parent with a login and TWO children enrolled this year, for the parent
// event specs (LOCAL stack only — callers get the client from localDb()).

export type Child = {
  studentNumber: string;
  firstName: string;
  lastName: string;
};

export type Family = {
  parentEmail: string;
  children: [Child, Child];
  /** Puts back anything borrowed to make the family; call in afterAll. */
  restore: () => Promise<void>;
};

/** A parent with a login, who has two or more children on this year's applications, and an enrolled child. */
async function findTwoChildParent(
  client: SupabaseClient
): Promise<{ email: string; kids: Child[]; table: string }> {
  const { data: ay } = await client
    .from('academic_years')
    .select('ay_code')
    .eq('is_current', true)
    .single();
  const table = `${ay!.ay_code.toLowerCase()}_enrolment_applications`;
  const { data: apps } = await client
    .from(table)
    .select('studentNumber, motherEmail, fatherEmail, guardianEmail');
  const byEmail = new Map<string, Set<string>>();
  for (const a of apps ?? []) {
    for (const e of [a.motherEmail, a.fatherEmail, a.guardianEmail]) {
      if (!e) continue;
      const key = e.toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, new Set());
      byEmail.get(key)!.add(a.studentNumber);
    }
  }
  const multi = [...byEmail].filter(([, s]) => s.size >= 2);
  const logins = new Set<string>();
  for (let p = 1; p < 50; p++) {
    const { data } = await client.auth.admin.listUsers({
      page: p,
      perPage: 1000,
    });
    for (const u of data.users) if (u.email) logins.add(u.email.toLowerCase());
    if (data.users.length < 1000) break;
  }
  for (const [email, numbers] of multi) {
    if (!logins.has(email)) continue;
    const { data: students } = await client
      .from('students')
      .select('id, student_number, first_name, last_name')
      .in('student_number', [...numbers])
      .order('student_number');
    const ids = (students ?? []).map((s) => s.id as string);
    const enrolled = await enrolledThisYear(client, ids);
    const kids = (students ?? [])
      .filter((s) => enrolled.has(s.id as string))
      .map((s) => ({
        studentNumber: s.student_number as string,
        firstName: s.first_name as string,
        lastName: s.last_name as string,
      }));
    if (kids.length >= 1) return { email, kids, table };
  }
  throw new Error(
    'No parent with a login and an enrolled child on the local stack.'
  );
}

/** Student ids (of those given) in a class of the current academic year, not withdrawn. */
async function enrolledThisYear(client: SupabaseClient, ids: string[]) {
  const { data } = await client
    .from('section_students')
    .select('student_id, sections!inner(academic_years!inner(is_current))')
    .in('student_id', ids)
    .neq('enrollment_status', 'withdrawn')
    .eq('sections.academic_years.is_current', true);
  return new Set((data ?? []).map((r) => r.student_id as string));
}

/**
 * The local data has no parent with two children enrolled this year, so a
 * second child is borrowed: another enrolled child's application lists this
 * parent as father until restore() puts the original value back.
 */
async function borrowSecondChild(
  client: SupabaseClient,
  table: string,
  email: string,
  taken: string[]
): Promise<{ child: Child; restore: () => Promise<void> }> {
  const { data: rows } = await client
    .from('section_students')
    .select(
      'students!inner(id, student_number, first_name, last_name), sections!inner(academic_years!inner(is_current))'
    )
    .neq('enrollment_status', 'withdrawn')
    .eq('sections.academic_years.is_current', true)
    .limit(60);
  for (const r of rows ?? []) {
    const st = r.students as unknown as {
      student_number: string;
      first_name: string;
      last_name: string;
    };
    if (taken.includes(st.student_number)) continue;
    const { data: app } = await client
      .from(table)
      .select('enroleeNumber, fatherEmail')
      .eq('studentNumber', st.student_number)
      .limit(1)
      .maybeSingle();
    if (!app) continue;
    // The portal's lookup also wants a class on the application's status row.
    const { data: status } = await client
      .from(table.replace('_applications', '_status'))
      .select('enroleeNumber')
      .eq('enroleeNumber', app.enroleeNumber)
      .not('classSection', 'is', null)
      .not('applicationStatus', 'in', '("Cancelled","Withdrawn")')
      .maybeSingle();
    if (!status) continue;
    const original = (app.fatherEmail as string | null) ?? null;
    const { error } = await client
      .from(table)
      .update({ fatherEmail: email })
      .eq('studentNumber', st.student_number);
    if (error) throw error;
    return {
      child: {
        studentNumber: st.student_number,
        firstName: st.first_name,
        lastName: st.last_name,
      },
      restore: async () => {
        await client
          .from(table)
          .update({ fatherEmail: original })
          .eq('studentNumber', st.student_number);
      },
    };
  }
  throw new Error('No second enrolled child to borrow.');
}

export async function arrangeTwoChildFamily(
  client: SupabaseClient
): Promise<Family> {
  const family = await findTwoChildParent(client);
  const kids = family.kids.slice(0, 2);
  let restore = async () => {};
  if (kids.length < 2) {
    const borrowed = await borrowSecondChild(
      client,
      family.table,
      family.email,
      kids.map((c) => c.studentNumber)
    );
    kids.push(borrowed.child);
    restore = borrowed.restore;
  }
  return {
    parentEmail: family.email,
    children: [kids[0], kids[1]],
    restore,
  };
}
