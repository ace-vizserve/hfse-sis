import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import {
  linkInvoiceToStage,
  previewStageLink,
} from '@/lib/billing/stage-link.server';
import { QBO_INVOICE_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

const Body = z.object({
  stage: z.enum(['registration', 'fees']),
  ayCode: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(/^AY\d{4}$/)),
  docNumber: z.string().trim().min(1, 'Type the invoice number.').max(40),
  /** Find: check the number and show the invoice; nothing is saved. */
  preview: z.boolean().optional(),
  /** Staff confirmed the invoice's customer gets linked to the student too. */
  linkCustomer: z.boolean().optional(),
});

// POST /api/billing/students/[studentNumber]/stage-link — Link an invoice on
// a Registration / Fees stage: `preview: true` is Find; otherwise the invoice
// is tied to the stage and the stage is filled in from it. Writes nothing to
// QuickBooks.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentNumber: string }> }
) {
  const auth = await requireRole([...QBO_INVOICE_ROLES]);
  if ('error' in auth) return auth.error;
  const { studentNumber } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  const { preview, ...input } = parsed.data;
  const service = createServiceClient();
  if (preview) {
    const r = await previewStageLink(service, { studentNumber, input });
    if (!r.ok)
      return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r.preview);
  }
  const r = await linkInvoiceToStage(service, {
    studentNumber,
    actor: { id: auth.user.id, email: auth.user.email, role: auth.role },
    input,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
