import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import {
  buildLinkIndex,
  proposeLink,
  type LinkStudent,
} from '@/lib/billing/link-rules';
import {
  connectedRealmId,
  qboQueryAll,
  QboNotConnectedError,
} from '@/lib/qbo/client';

export type LinkRunResult = {
  students: number;
  alreadyLinked: number;
  linked: { invoice: number; sibling: number; name: number };
  review: number;
  newlyLinked: string[];
};

/** Every student with a student number, across every AY that has tables. */
export async function loadLinkStudents(
  service: SupabaseClient
): Promise<LinkStudent[]> {
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code');
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  const byNumber = new Map<string, LinkStudent>();
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const prefix = `ay${ay_code.slice(2)}`;
    const apps = await service
      .from(`${prefix}_enrolment_applications`)
      .select('"enroleeNumber","studentNumber","lastName","firstName"')
      .not('studentNumber', 'is', null);
    if (apps.error) continue; // a year without admissions tables (e.g. a future AY)
    const status = await service
      .from(`${prefix}_enrolment_status`)
      .select('"enroleeNumber","registrationInvoice","feeInvoice"');
    const typed = new Map<string, string[]>();
    for (const s of (status.data ?? []) as Array<
      Record<string, string | null>
    >) {
      typed.set(
        s.enroleeNumber!,
        [s.registrationInvoice, s.feeInvoice].filter((v): v is string => !!v)
      );
    }
    for (const a of (apps.data ?? []) as Array<Record<string, string | null>>) {
      const sn = a.studentNumber!;
      const prev = byNumber.get(sn);
      byNumber.set(sn, {
        studentNumber: sn,
        // The newest year's name wins (years are read oldest → newest is not
        // guaranteed, so keep a non-empty one).
        lastName: a.lastName ?? prev?.lastName ?? null,
        firstName: a.firstName ?? prev?.firstName ?? null,
        typedNumbers: [
          ...(prev?.typedNumbers ?? []),
          ...(typed.get(a.enroleeNumber!) ?? []),
        ],
      });
    }
  }
  return [...byNumber.values()];
}

export async function runLink(
  service: SupabaseClient,
  opts: {
    dryRun: boolean;
    actor: { id: string; email: string | null; role: string };
  }
): Promise<LinkRunResult> {
  const realmId = await connectedRealmId(service);
  if (!realmId) throw new QboNotConnectedError();

  const [customers, invoices, students, stored] = await Promise.all([
    qboQueryAll<{ Id: string; DisplayName: string }>(
      service,
      'Customer',
      'Active IN (true, false)'
    ),
    qboQueryAll<{ DocNumber?: string; CustomerRef: { value: string } }>(
      service,
      'Invoice'
    ),
    loadLinkStudents(service),
    service
      .from('qbo_customers')
      .select('student_number')
      .eq('realm_id', realmId),
  ]);
  if (stored.error)
    throw new Error(`Linked customers lookup failed: ${stored.error.message}`);
  const already = new Set(
    (stored.data ?? []).map((r) => r.student_number as string)
  );
  const index = buildLinkIndex(
    customers.map((c) => ({ id: c.Id, displayName: c.DisplayName })),
    invoices.map((i) => ({
      docNumber: i.DocNumber ?? null,
      customerId: i.CustomerRef.value,
    }))
  );

  const result: LinkRunResult = {
    students: students.length,
    alreadyLinked: 0,
    linked: { invoice: 0, sibling: 0, name: 0 },
    review: 0,
    newlyLinked: [],
  };
  const links: Array<Record<string, unknown>> = [];
  const reviews: Array<Record<string, unknown>> = [];
  for (const s of students) {
    if (already.has(s.studentNumber)) {
      result.alreadyLinked++;
      continue;
    }
    const p = proposeLink(s, index);
    if (p.kind === 'link') {
      result.linked[p.reason]++;
      result.newlyLinked.push(s.studentNumber);
      links.push({
        student_number: s.studentNumber,
        qbo_customer_id: p.customerId,
        display_name: index.customers.get(p.customerId)!.displayName,
        matched_by: 'auto',
        matched_at: new Date().toISOString(),
        realm_id: realmId,
      });
    } else {
      result.review++;
      reviews.push({
        student_number: s.studentNumber,
        student_name: [s.lastName, s.firstName].filter(Boolean).join(', '),
        candidates: p.candidates,
        computed_at: new Date().toISOString(),
      });
    }
  }
  if (opts.dryRun) return result;

  for (let i = 0; i < links.length; i += 500) {
    const { error } = await service
      .from('qbo_customers')
      .upsert(links.slice(i, i + 500));
    if (error) throw new Error(`Saving links failed: ${error.message}`);
  }
  // The review list is rebuilt from scratch: whoever was linked since drops off.
  const del = await service
    .from('billing_link_review')
    .delete()
    .neq('student_number', '');
  if (del.error)
    throw new Error(`Clearing the review list failed: ${del.error.message}`);
  for (let i = 0; i < reviews.length; i += 500) {
    const { error } = await service
      .from('billing_link_review')
      .insert(reviews.slice(i, i + 500));
    if (error)
      throw new Error(`Saving the review list failed: ${error.message}`);
  }
  await logAction({
    service,
    actor: opts.actor,
    action: 'billing.link.run',
    entityType: 'qbo_customer',
    entityId: 'bulk',
    context: {
      ...result.linked,
      review: result.review,
      already_linked: result.alreadyLinked,
    },
  });
  return result;
}
