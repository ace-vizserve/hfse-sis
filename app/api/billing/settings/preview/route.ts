import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireRole } from '@/lib/auth/require-role';
import { overlapMessage } from '@/lib/billing/classify';
import { isRealDate, tilesSweepBlocker } from '@/lib/billing/settings-helpers';
import {
  loadBillingMaps,
  previewReclassify,
} from '@/lib/billing/settings.server';
import { QBO_ADMIN_ROLES } from '@/lib/qbo/roles';
import { createServiceClient } from '@/lib/supabase/service';

export const maxDuration = 120;

const Row = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stage: z.enum(['registration', 'fees', 'none']),
});
const Date10 = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, 'That is not a real date.');
const Body = z.object({
  accounts: z.array(Row).max(500).optional(),
  items: z.array(Row).max(2000).optional(),
  ranges: z
    .array(
      z.object({
        ayCode: z.string().regex(/^AY\d{4}$/),
        startsOn: Date10,
        endsOn: Date10,
      })
    )
    .max(20)
    .optional(),
});

// POST /api/billing/settings/preview — what saving these settings would move
// (Registration / Fees, per year), computed exactly as the save does, without
// saving. Anything not sent keeps its saved value.
export async function POST(request: Request) {
  const auth = await requireRole([...QBO_ADMIN_ROLES]);
  if ('error' in auth) return auth.error;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
      { status: 400 }
    );
  if (parsed.data.ranges) {
    const overlap = overlapMessage(parsed.data.ranges);
    if (overlap) return NextResponse.json({ error: overlap }, { status: 400 });
  }
  const service = createServiceClient();
  try {
    const saved = await loadBillingMaps(service);
    const maps = {
      accounts: parsed.data.accounts
        ? new Map(parsed.data.accounts.map((r) => [r.id, r.stage] as const))
        : saved.accounts,
      items: parsed.data.items
        ? new Map(parsed.data.items.map((r) => [r.id, r.stage] as const))
        : saved.items,
      ranges: parsed.data.ranges ?? saved.ranges,
    };
    const preview = await previewReclassify(service, maps);
    return NextResponse.json({
      ...preview,
      tilesSkipped: tilesSweepBlocker(maps),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The preview failed.' },
      { status: 500 }
    );
  }
}
