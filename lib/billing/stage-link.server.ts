import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction } from '@/lib/audit/log-action';
import type { QbInvoiceFull } from '@/lib/billing/invoice-row';
import { linkStudentToCustomer } from '@/lib/billing/link-student.server';
import { loadBillingMaps } from '@/lib/billing/maps.server';
import { SIS_READ_FAILED, STAGE_NOT_UPDATED } from '@/lib/billing/messages';
import {
  decideStageLink,
  exactMatches,
  linkStatusLabel,
  STAGE_LINK_NAME,
  type StageLinkPreview,
} from '@/lib/billing/stage-link';
import { upsertInvoice } from '@/lib/billing/store.server';
import { rowsOfCustomer } from '@/lib/billing/sync-helpers';
import type { StageTarget } from '@/lib/billing/tie';
import { syncTilesForStudent } from '@/lib/billing/tiles.server';
import { studentDisplayName, todaySg } from '@/lib/billing/view';
import {
  connectedRealmId,
  qbEscape,
  qboErrorMessage,
  qboQuery,
  QboNotConnectedError,
} from '@/lib/qbo/client';
import { invoiceState } from '@/lib/qbo/invoice-snapshot';

// Link an invoice already in QuickBooks to a Registration / Fees stage: Find
// (preview) looks the number up and checks every rule; Link ties it the way
// an invoice created from the stage is tied, then the stage is filled in
// from it. Nothing is written to QuickBooks.

export type StageLinkInput = StageTarget & {
  docNumber: string;
  /** Staff confirmed linking the invoice's customer to the student too. */
  linkCustomer?: boolean;
};

type Actor = { id: string; email: string | null; role: string };

type Refusal = { ok: false; status: number; error: string };

/** The student's application in that AY (with a status row), and their name. */
async function stageRowOf(
  service: SupabaseClient,
  studentNumber: string,
  ayCode: string
): Promise<{ name: string } | null> {
  const slug = ayCode.slice(2).toLowerCase();
  const { data: apps, error } = await service
    .from(`ay${slug}_enrolment_applications`)
    .select(
      '"enroleeNumber","lastName","firstName","middleName","enroleeFullName"'
    )
    .eq('studentNumber', studentNumber);
  if (error) {
    if (/PGRST205|42P01|Could not find the table/i.test(error.message))
      return null;
    throw new Error(`Application lookup failed: ${error.message}`);
  }
  const list = (apps ?? []) as Array<{
    enroleeNumber: string;
    lastName: string | null;
    firstName: string | null;
    middleName: string | null;
    enroleeFullName: string | null;
  }>;
  const enrolees = list.map((a) => a.enroleeNumber).filter(Boolean);
  if (enrolees.length === 0) return null;
  const { data: rows, error: rowErr } = await service
    .from(`ay${slug}_enrolment_status`)
    .select('"enroleeNumber"')
    .in('enroleeNumber', enrolees)
    .limit(1);
  if (rowErr) throw new Error(`Stage lookup failed: ${rowErr.message}`);
  if ((rows ?? []).length === 0) return null;
  return { name: studentDisplayName(list[0]) };
}

/** QuickBooks invoices with this number: as typed, then upper case. */
async function invoicesNumbered(
  service: SupabaseClient,
  docNumber: string
): Promise<QbInvoiceFull[]> {
  const tries = [...new Set([docNumber, docNumber.toUpperCase()])];
  for (const n of tries) {
    const hits = exactMatches(
      (
        await qboQuery<QbInvoiceFull>(
          service,
          'Invoice',
          `DocNumber = '${qbEscape(n)}'`,
          'maxresults 10'
        )
      ).map((inv) => ({ ...inv, docNumber: inv.DocNumber ?? null })),
      docNumber
    );
    if (hits.length > 0) return hits;
  }
  return [];
}

type Checked = {
  ok: true;
  realmId: string;
  invoice: QbInvoiceFull;
  preview: StageLinkPreview;
};

async function check(
  service: SupabaseClient,
  studentNumber: string,
  input: StageLinkInput
): Promise<Checked | Refusal> {
  const docNumber = input.docNumber.trim();
  if (!docNumber)
    return { ok: false, status: 400, error: 'Type the invoice number.' };
  let realmId: string;
  let found: QbInvoiceFull[];
  try {
    const r = await connectedRealmId(service);
    if (!r) throw new QboNotConnectedError();
    realmId = r;
    found = await invoicesNumbered(service, docNumber);
  } catch (e) {
    return { ok: false, status: 502, error: qboErrorMessage(e) };
  }
  const inv = found.length === 1 ? found[0] : null;
  try {
    const stageRow = await stageRowOf(service, studentNumber, input.ayCode);
    const { data: studentLink, error: slErr } = await service
      .from('qbo_customers')
      .select('qbo_customer_id, display_name')
      .eq('student_number', studentNumber)
      .eq('realm_id', realmId)
      .maybeSingle();
    if (slErr) throw new Error(slErr.message);
    let holder: string | null = null;
    let storedTie: {
      studentNumber: string;
      ayCode: string;
      stageKeys: string[];
    } | null = null;
    let stageLiveDoc: string | null | undefined = undefined;
    if (inv) {
      const { data: holders, error: hErr } = await service
        .from('qbo_customers')
        .select('student_number')
        .eq('qbo_customer_id', inv.CustomerRef.value)
        .eq('realm_id', realmId)
        .limit(1);
      if (hErr) throw new Error(hErr.message);
      holder =
        ((holders ?? []) as Array<{ student_number: string }>)[0]
          ?.student_number ?? null;
      const { data: stored, error: sErr } = await service
        .from('qbo_invoices')
        .select('student_number, ay_code, stage_keys')
        .eq('qbo_invoice_id', inv.Id)
        .eq('realm_id', realmId)
        .maybeSingle();
      if (sErr) throw new Error(sErr.message);
      const s = stored as {
        student_number: string;
        ay_code: string | null;
        stage_keys: string[] | null;
      } | null;
      if (s?.ay_code && (s.stage_keys ?? []).length > 0)
        storedTie = {
          studentNumber: s.student_number,
          ayCode: s.ay_code,
          stageKeys: s.stage_keys ?? [],
        };
      // Another live invoice already on this stage (of the linked customer).
      const sl = studentLink as { qbo_customer_id: string } | null;
      if (sl) {
        const { data: tied, error: tErr } = await service
          .from('qbo_invoices')
          .select(
            'qbo_invoice_id, doc_number, state, stage_keys, qbo_customer_id'
          )
          .eq('student_number', studentNumber)
          .eq('realm_id', realmId)
          .eq('ay_code', input.ayCode);
        if (tErr) throw new Error(tErr.message);
        const live = rowsOfCustomer(
          (tied ?? []) as Array<{
            qbo_invoice_id: string;
            doc_number: string | null;
            state: string;
            stage_keys: string[] | null;
            qbo_customer_id: string | null;
          }>,
          sl.qbo_customer_id
        ).find(
          (r) =>
            r.qbo_invoice_id !== inv.Id &&
            r.state !== 'voided' &&
            (r.stage_keys ?? []).includes(input.stage)
        );
        if (live) stageLiveDoc = live.doc_number;
      }
    }
    const sl = studentLink as {
      qbo_customer_id: string;
      display_name: string | null;
    } | null;
    const decision = decideStageLink({
      docNumber,
      stage: input.stage,
      ayCode: input.ayCode,
      studentNumber,
      hasStageRow: !!stageRow,
      found: found.map((f) => ({
        id: f.Id,
        docNumber: f.DocNumber ?? null,
        customerId: f.CustomerRef.value,
        customerName: f.CustomerRef.name ?? 'another customer',
        state: invoiceState(f),
      })),
      invoiceCustomerHolder: holder,
      studentCustomer: sl
        ? {
            id: sl.qbo_customer_id,
            name: sl.display_name ?? 'another customer',
          }
        : null,
      storedTie,
      stageLiveDoc,
    });
    if (!decision.ok) return decision;
    const invoice = inv!;
    const total = Number(invoice.TotalAmt);
    const balance = Number(invoice.Balance);
    const products = [
      ...new Set(
        (invoice.Line ?? [])
          .filter((l) => l.DetailType === 'SalesItemLineDetail')
          .map((l) => l.SalesItemLineDetail?.ItemRef?.name?.trim())
          .filter((n): n is string => !!n)
      ),
    ];
    return {
      ok: true,
      realmId,
      invoice,
      preview: {
        qboInvoiceId: invoice.Id,
        docNumber: invoice.DocNumber ?? docNumber,
        customer: invoice.CustomerRef.name ?? '',
        txnDate: invoice.TxnDate ?? null,
        dueDate: invoice.DueDate ?? null,
        total,
        balance,
        status: linkStatusLabel(
          {
            state: invoiceState(invoice),
            total,
            balance,
            dueDate: invoice.DueDate ?? null,
          },
          todaySg()
        ),
        products,
        linksCustomer: decision.linksCustomer,
        alreadyLinked: decision.alreadyLinked,
        studentName: stageRow!.name,
      },
    };
  } catch (e) {
    console.error('[billing] stage link, lookup:', e);
    return { ok: false, status: 500, error: SIS_READ_FAILED };
  }
}

/** Find: the invoice with that number, if every rule lets it be linked. */
export async function previewStageLink(
  service: SupabaseClient,
  args: { studentNumber: string; input: StageLinkInput }
): Promise<{ ok: true; preview: StageLinkPreview } | Refusal> {
  const r = await check(service, args.studentNumber, args.input);
  return r.ok ? { ok: true, preview: r.preview } : r;
}

export type StageLinkResult =
  | {
      ok: true;
      qboInvoiceId: string;
      docNumber: string;
      warnings: string[];
    }
  | Refusal;

/**
 * Link: tie the invoice to the stage (linking the customer first when staff
 * confirmed it), fill the stage in from it, audit it.
 */
export async function linkInvoiceToStage(
  service: SupabaseClient,
  args: { studentNumber: string; actor: Actor; input: StageLinkInput }
): Promise<StageLinkResult> {
  const { studentNumber, actor, input } = args;
  const c = await check(service, studentNumber, input);
  if (!c.ok) return c;
  const { invoice, preview, realmId } = c;
  const done = {
    ok: true as const,
    qboInvoiceId: invoice.Id,
    docNumber: preview.docNumber,
  };
  if (preview.alreadyLinked) return { ...done, warnings: [] };
  const warnings: string[] = [];
  if (preview.linksCustomer) {
    if (!input.linkCustomer)
      return {
        ok: false,
        status: 409,
        error: `Confirm that ${preview.customer} is linked to this student too.`,
      };
    const l = await linkStudentToCustomer(service, {
      studentNumber,
      customerId: invoice.CustomerRef.value,
      actor,
    });
    if (!l.ok) return l;
    warnings.push(...l.historyErrors);
  }
  const target: StageTarget = { stage: input.stage, ayCode: input.ayCode };
  try {
    const maps = await loadBillingMaps(service, {
      studentNumbers: [studentNumber],
    });
    const placed = await upsertInvoice(service, {
      inv: invoice,
      qboInvoiceId: invoice.Id,
      studentNumber,
      realmId,
      maps,
      tie: target,
    });
    // Loading the new customer's history may have tied it elsewhere by its
    // typed number; then it is not this stage's.
    if (
      placed.after.ayCode !== target.ayCode ||
      !placed.after.stageKeys.includes(target.stage)
    )
      return {
        ok: false,
        status: 409,
        error: `${preview.docNumber} is already on another stage (${placed.after.stageKeys
          .map((s) => STAGE_LINK_NAME[s])
          .join(' and ')} for ${placed.after.ayCode}).`,
      };
  } catch (e) {
    console.error('[billing] stage link, saving the tie:', e);
    return {
      ok: false,
      status: 500,
      error: "The SIS couldn't save the link just now. Try again.",
    };
  }
  const t = await syncTilesForStudent(service, studentNumber, [input.ayCode], {
    realmId,
  }).catch((e: unknown) => ({ changed: 0, errors: [String(e)] }));
  if (t.errors.length > 0) {
    console.error('[billing] tiles after stage link:', t.errors);
    warnings.push(STAGE_NOT_UPDATED);
  }
  await logAction({
    service,
    actor,
    action: 'qbo.invoice.link_stage',
    entityType: 'qbo_invoice',
    entityId: invoice.Id,
    context: {
      studentNumber,
      stage: input.stage,
      ay_code: input.ayCode,
      doc_number: preview.docNumber,
      total: preview.total,
      customer: preview.customer,
      linked_customer: preview.linksCustomer,
    },
  });
  return { ...done, warnings: [...new Set(warnings)] };
}
