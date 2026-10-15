import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import { fetchAllPages } from '@/lib/supabase/paginate';
import {
  ALREADY_LINKED_REASON,
  claimCustomer,
  studentsNeedingHistory,
} from '@/lib/billing/link-claims';
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
  /** Problems loading a newly linked student's history; empty on a dry run. */
  historyErrors: string[];
  /** Students whose history was loaded in this run. */
  historyLoaded: number;
};

/** Every student with a student number, across every AY that has tables. */
export async function loadLinkStudents(
  service: SupabaseClient
): Promise<LinkStudent[]> {
  const { data: years, error } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: true });
  if (error) throw new Error(`Academic years lookup failed: ${error.message}`);
  const byNumber = new Map<string, LinkStudent>();
  // Oldest year first, so the newest year is processed last and its non-null
  // name wins.
  for (const { ay_code } of (years ?? []) as Array<{ ay_code: string }>) {
    const prefix = `ay${ay_code.slice(2)}`;
    type PageErr = { message: string; code?: string };
    let appRows: Array<Record<string, string | null>>;
    try {
      appRows = await fetchAllPages<Record<string, string | null>>(
        (from, to) =>
          service
            .from(`${prefix}_enrolment_applications`)
            .select('"enroleeNumber","studentNumber","lastName","firstName"')
            .not('studentNumber', 'is', null)
            .range(from, to) as unknown as PromiseLike<{
            data: Array<Record<string, string | null>> | null;
            error: PageErr | null;
          }>,
        1000,
        { tieBreak: 'enroleeNumber' }
      );
    } catch (e) {
      // Only "this year has no admissions tables" (e.g. a future AY) is skipped.
      const msg = e instanceof Error ? e.message : '';
      if (/PGRST205|42P01|Could not find the table/i.test(msg)) continue;
      throw e;
    }
    const statusRows = await fetchAllPages<Record<string, string | null>>(
      (from, to) =>
        service
          .from(`${prefix}_enrolment_status`)
          .select('"enroleeNumber","registrationInvoice","feeInvoice"')
          .range(from, to) as unknown as PromiseLike<{
          data: Array<Record<string, string | null>> | null;
          error: PageErr | null;
        }>,
      1000,
      { tieBreak: 'enroleeNumber' }
    );
    const typed = new Map<string, string[]>();
    for (const s of statusRows) {
      typed.set(
        s.enroleeNumber!,
        [s.registrationInvoice, s.feeInvoice].filter((v): v is string => !!v)
      );
    }
    for (const a of appRows) {
      const sn = a.studentNumber!;
      const prev = byNumber.get(sn);
      byNumber.set(sn, {
        studentNumber: sn,
        // Years run oldest → newest, so a later year's non-null name wins.
        lastName: a.lastName ?? prev?.lastName ?? null,
        firstName: a.firstName ?? prev?.firstName ?? null,
        typedNumbers: [
          ...new Set([
            ...(prev?.typedNumbers ?? []),
            ...(typed.get(a.enroleeNumber!) ?? []),
          ]),
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

  const [customers, invoices, students, storedRows] = await Promise.all([
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
    // Paged: every stored link must be seen, or a staff choice past the first
    // 1000 rows would be overwritten by an automatic one.
    fetchAllPages<{
      student_number: string;
      qbo_customer_id: string;
      history_loaded_at: string | null;
    }>(
      (from, to) =>
        service
          .from('qbo_customers')
          .select('student_number, qbo_customer_id, history_loaded_at')
          .eq('realm_id', realmId)
          .range(from, to) as unknown as PromiseLike<{
          data: Array<{
            student_number: string;
            qbo_customer_id: string;
            history_loaded_at: string | null;
          }> | null;
          error: { message: string } | null;
        }>,
      1000,
      { tieBreak: 'student_number' }
    ).catch((e: unknown) => {
      throw new Error(
        `Linked customers lookup failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }),
  ]);
  const already = new Set(storedRows.map((r) => r.student_number));
  // customer id → the student holding it (stored links, then this run's).
  const claimed = new Map<string, string>(
    storedRows.map((r) => [r.qbo_customer_id, r.student_number])
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
    historyErrors: [],
    historyLoaded: 0,
  };
  const runStartedAt = new Date().toISOString();
  const links: Array<Record<string, unknown>> = [];
  const reviews: Array<Record<string, unknown>> = [];
  for (const s of students) {
    if (already.has(s.studentNumber)) {
      result.alreadyLinked++;
      continue;
    }
    const p = proposeLink(s, index);
    if (
      p.kind === 'link' &&
      !claimCustomer(claimed, p.customerId, s.studentNumber)
    ) {
      // One customer belongs to one student: a second claim goes to a person.
      result.review++;
      reviews.push({
        student_number: s.studentNumber,
        student_name: [s.lastName, s.firstName].filter(Boolean).join(', '),
        candidates: [
          {
            customerId: p.customerId,
            displayName: index.customers.get(p.customerId)!.displayName,
            reason: ALREADY_LINKED_REASON,
          },
        ],
        computed_at: runStartedAt,
      });
    } else if (p.kind === 'link') {
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
        computed_at: runStartedAt,
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
  // The links are saved: audit them now, whatever happens to the review list.
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
  // The review list is replaced without ever being empty: write this run's rows
  // first, then drop the rows left over from earlier runs (whoever was linked
  // since). A failure part-way leaves the old list intact.
  for (let i = 0; i < reviews.length; i += 500) {
    const { error } = await service
      .from('billing_link_review')
      .upsert(reviews.slice(i, i + 500), { onConflict: 'student_number' });
    if (error)
      throw new Error(`Saving the review list failed: ${error.message}`);
  }
  const del = await service
    .from('billing_link_review')
    .delete()
    .lt('computed_at', runStartedAt);
  if (del.error)
    throw new Error(`Clearing the review list failed: ${del.error.message}`);
  // Load the history of every linked student whose load never finished (no
  // history_loaded_at; not just the newly linked), so a re-run after a
  // timeout resumes where it stopped. One at a time (QuickBooks allows ~500
  // calls a minute; two queries per student). The audit row above is already
  // written, so failures are returned in the result, not the audit.
  const { loadCustomerHistory } = await import('@/lib/billing/history.server');
  const { loadBillingMaps } = await import('@/lib/billing/settings.server');
  const todo = studentsNeedingHistory(
    storedRows.map((r) => ({
      studentNumber: r.student_number,
      historyLoadedAt: r.history_loaded_at,
    })),
    result.newlyLinked
  );
  const preloaded = { realmId, maps: await loadBillingMaps(service) };
  for (const sn of todo) {
    try {
      const h = await loadCustomerHistory(service, sn, preloaded);
      result.historyLoaded++;
      result.historyErrors.push(...h.errors.map((e) => `${sn}: ${e}`));
    } catch (e) {
      result.historyErrors.push(
        `${sn}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return result;
}
