import type { SlotMeta } from '@/lib/schemas/grading-sheet';

export type SlotKind = 'ww' | 'pt' | 'qa';

/**
 * Required metadata satisfied? WW/PT need label+date; QA needs only a label
 * (passed either as the plain string `slot_labels.qa` or as `{ label }`).
 * Page # never gates. 'Ongoing' counts as a satisfied date — matches the
 * existing date-administered semantics (date-administered-field.tsx).
 */
export function slotMetaSatisfied(
  kind: SlotKind,
  meta: SlotMeta | string | { label?: string | null } | null | undefined
): boolean {
  if (kind === 'qa') {
    const label =
      typeof meta === 'string'
        ? meta
        : (meta as { label?: string | null } | null)?.label;
    return !!(label ?? '').trim();
  }
  const m = (meta ?? null) as SlotMeta | null;
  return !!(m?.label ?? '').trim() && !!(m?.date ?? '').trim();
}

/** Does this slot already hold a committed score anywhere in the given roster? */
export function slotRosterScored(
  kind: SlotKind,
  index: number | null,
  roster: {
    ww_scores: (number | null)[];
    pt_scores: (number | null)[];
    qa_score: number | null;
  }[]
): boolean {
  if (kind === 'qa') return roster.some((r) => r.qa_score != null);
  return roster.some(
    (r) => (kind === 'ww' ? r.ww_scores : r.pt_scores)[index!] != null
  );
}
