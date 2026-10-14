import { NextResponse } from 'next/server';
import { z } from 'zod';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  QboError,
  QboNotConnectedError,
  qbEscape,
  qboErrorMessage,
  qboQuery,
  qboRequest,
} from '@/lib/qbo/client';
import {
  buildInvoiceLines,
  createdButNotSaved,
  linkRefusal,
} from '@/lib/qbo/invoice-actions';
import { invoiceState, type QbInvoice } from '@/lib/qbo/invoice-snapshot';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { readStageSnapshot, writeStageFromQbo } from '@/lib/qbo/stage-write';
import { isQboStageKey, stageOnNewInvoice } from '@/lib/qbo/stage-state';
import { paymentDateFor } from '@/lib/qbo/sync';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';

const Date10 = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Common = {
  ayCode: z.string().regex(/^AY\d{4}$/i),
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  matchedBy: z.enum(['auto', 'staff']),
};
const Body = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('create'),
    ...Common,
    lines: z
      .array(
        z.object({
          itemId: z.string().min(1),
          description: z.string().max(4000).optional(),
          qty: z.number().positive(),
          unitPrice: z.number().nonnegative(),
        })
      )
      .min(1)
      .max(50),
    txnDate: Date10,
    dueDate: Date10.nullable().optional(),
    memo: z.string().max(1000).optional(),
  }),
  z.object({
    mode: z.literal('link'),
    ...Common,
    qboInvoiceId: z.string().min(1),
  }),
]);

// POST /api/sis/students/[enroleeNumber]/stage/[stageKey]/invoice
// QuickBooks FIRST: only once QuickBooks has the invoice does the SIS record
// it and move the stage. If QuickBooks refuses, nothing is saved.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; stageKey: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { enroleeNumber, stageKey } = await params;
  if (!isQboStageKey(stageKey)) {
    return NextResponse.json(
      { error: `Stage "${stageKey}" doesn't take QuickBooks invoices.` },
      { status: 400 }
    );
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const ayCode = body.ayCode.toUpperCase();
  const prefix = `ay${ayCode.slice(2)}`;
  const service = createServiceClient();

  const { data: app } = await createAdmissionsClient()
    .from(`${prefix}_enrolment_applications`)
    .select('studentNumber')
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  const studentNumber =
    (app as { studentNumber: string | null } | null)?.studentNumber ?? null;
  if (!studentNumber) {
    return NextResponse.json(
      {
        error:
          "This applicant has no student number yet, so their QuickBooks customer can't be remembered. Give them one first.",
      },
      { status: 422 }
    );
  }
  const current = await readStageSnapshot(
    service,
    ayCode,
    enroleeNumber,
    stageKey
  );
  if (!current) {
    return NextResponse.json(
      { error: 'No status row for this enrolee in this year.' },
      { status: 404 }
    );
  }
  if (current.status === 'Cancelled') {
    return NextResponse.json(
      {
        error:
          'This stage is Cancelled. Change its status first if a new invoice is needed.',
      },
      { status: 422 }
    );
  }

  // 1) QuickBooks.
  let invoice: QbInvoice;
  try {
    if (body.mode === 'link') {
      invoice = (
        await qboRequest<{ Invoice: QbInvoice }>(
          service,
          'GET',
          `/invoice/${encodeURIComponent(body.qboInvoiceId)}`
        )
      ).Invoice;
      const { data: other } = await service
        .from('qbo_invoices')
        .select('ay_code, enrolee_number, stage_key')
        .eq('qbo_invoice_id', invoice.Id)
        .maybeSingle();
      const refusal = linkRefusal({
        invoice,
        customerId: body.customerId,
        alreadyLinked: other
          ? {
              ayCode: other.ay_code,
              enroleeNumber: other.enrolee_number,
              stage: other.stage_key,
            }
          : null,
      });
      if (refusal)
        return NextResponse.json({ error: refusal }, { status: 409 });
    } else {
      const ids = Array.from(new Set(body.lines.map((l) => l.itemId)));
      const items = await qboQuery<{
        Id: string;
        Name: string;
        SalesTaxCodeRef?: { value: string };
      }>(
        service,
        'Item',
        `Id in (${ids.map((i) => `'${qbEscape(i)}'`).join(', ')})`
      );
      const lines = buildInvoiceLines(
        body.lines,
        new Map(items.map((i) => [i.Id, i]))
      );
      const { data: who } = await service.auth.admin.getUserById(auth.user.id);
      const staffName =
        (who?.user?.user_metadata?.full_name as string | undefined) ??
        auth.user.email ??
        'staff';
      invoice = (
        await qboRequest<{ Invoice: QbInvoice }>(service, 'POST', '/invoice', {
          CustomerRef: { value: body.customerId },
          TxnDate: body.txnDate,
          ...(body.dueDate ? { DueDate: body.dueDate } : {}),
          Line: lines,
          ...(body.memo?.trim()
            ? { CustomerMemo: { value: body.memo.trim() } }
            : {}),
          PrivateNote: `Created from SIS by ${staffName}`,
          AutoDocNumber: true,
        })
      ).Invoice;
    }
  } catch (e) {
    // buildInvoiceLines throws a plain Error with a sentence meant for staff.
    const message =
      e instanceof Error &&
      !(e instanceof QboError) &&
      !(e instanceof QboNotConnectedError) &&
      e.message.startsWith('One of the items')
        ? e.message
        : qboErrorMessage(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 2) The SIS remembers the invoice. Looking up the payment date reaches
  // QuickBooks again, so a failure there is handled like a failed save.
  const state = invoiceState(invoice);
  let paymentDate: string | null = null;
  const saved = await (async () => {
    try {
      if (state === 'paid')
        paymentDate = await paymentDateFor(service, invoice);
    } catch (e) {
      return qboErrorMessage(e);
    }
    const { error: cErr } = await service.from('qbo_customers').upsert({
      student_number: studentNumber,
      qbo_customer_id: body.customerId,
      display_name: body.customerName,
      matched_by:
        body.matchedBy === 'auto' ? 'auto' : (auth.user.email ?? 'staff'),
      matched_at: new Date().toISOString(),
    });
    if (cErr) return cErr.message;
    const { error: oldErr } = await service
      .from('qbo_invoices')
      .update({ is_current: false })
      .eq('ay_code', ayCode)
      .eq('enrolee_number', enroleeNumber)
      .eq('stage_key', stageKey)
      .eq('is_current', true);
    if (oldErr) return oldErr.message;
    const { error: insErr } = await service.from('qbo_invoices').insert({
      ay_code: ayCode,
      enrolee_number: enroleeNumber,
      student_number: studentNumber,
      stage_key: stageKey,
      qbo_invoice_id: invoice.Id,
      doc_number: invoice.DocNumber ?? null,
      total: Number(invoice.TotalAmt),
      balance: Number(invoice.Balance),
      state,
      payment_date: paymentDate,
      sync_token: invoice.SyncToken,
      source: body.mode === 'create' ? 'created' : 'linked',
      created_by: auth.user.id,
      created_by_email: auth.user.email,
      is_current: true,
    });
    return insErr?.message ?? null;
  })();
  if (saved) {
    console.error(
      '[qbo invoice] SIS save failed after QuickBooks accepted:',
      saved
    );
    return NextResponse.json(
      {
        error:
          body.mode === 'create'
            ? createdButNotSaved(invoice.DocNumber)
            : `The SIS couldn't save the link: ${saved}`,
      },
      { status: 500 }
    );
  }

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    action: body.mode === 'create' ? 'qbo.invoice.create' : 'qbo.invoice.link',
    entityType: 'qbo_invoice',
    entityId: invoice.Id,
    context: {
      ay_code: ayCode,
      enroleeNumber,
      studentNumber,
      stage: stageKey,
      doc_number: invoice.DocNumber ?? null,
      total: Number(invoice.TotalAmt),
      customer: body.customerName,
    },
  });

  // 3) The stage.
  let stageWarning: string | null = null;
  const patch = stageOnNewInvoice(stageKey, current, {
    docNumber: invoice.DocNumber ?? invoice.Id,
    state,
    paymentDate,
  });
  if (patch) {
    const res = await writeStageFromQbo(service, {
      ayCode,
      enroleeNumber,
      stage: stageKey,
      patch,
      actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
      updatedBy: auth.user.email ?? '(unknown)',
      docNumber: invoice.DocNumber ?? null,
      trigger: body.mode,
    });
    if (!res.ok)
      stageWarning = `Saved in QuickBooks, but the stage wasn't updated: ${res.error}`;
  }
  return NextResponse.json({
    ok: true,
    docNumber: invoice.DocNumber ?? null,
    stageWarning,
  });
}
