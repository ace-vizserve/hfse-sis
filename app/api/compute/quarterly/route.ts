import { NextResponse, type NextRequest } from 'next/server';
import { requireRole } from '@/lib/auth/require-role';
import { computeQuarterly, type ComputeInput } from '@/lib/compute/quarterly';

// Stateless compute endpoint. All authenticated roles can call it â€” useful for
// sanity checks and for the UI to preview a grade without persisting.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['teacher', 'registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as Partial<ComputeInput> | null;
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  // Minimal shape validation â€” the formula itself tolerates nulls.
  const required: (keyof ComputeInput)[] = [
    'ww_scores', 'ww_totals', 'pt_scores', 'pt_totals',
    'qa_score', 'qa_total', 'ww_weight', 'pt_weight', 'qa_weight',
  ];
  for (const k of required) {
    if (!(k in body)) {
      return NextResponse.json({ error: `missing field: ${k}` }, { status: 400 });
    }
  }

  return NextResponse.json(computeQuarterly(body as ComputeInput));
}
