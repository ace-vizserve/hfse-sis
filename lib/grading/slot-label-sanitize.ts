import type { SlotMeta, SlotLabels } from '@/lib/schemas/grading-sheet';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Sanitize per-field: trim, enforce max length, coerce empty to null. Lifted
// verbatim from app/api/grading-sheets/[id]/labels/route.ts (KD #105) so the
// entries route (first-score gate) can share the exact same rules — a slot's
// 'Ongoing'/ISO-date/trim/cap behavior must never drift between the two
// write paths.
export function sanitizeLabel(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim().slice(0, 120);
  return t || null;
}

export function sanitizePage(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim().slice(0, 40);
  return t || null;
}

export function sanitizeDate(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === 'Ongoing') return 'Ongoing';
  return ISO_DATE_RE.test(t) ? t : null;
}

export function sanitizeMeta(m: SlotMeta | null | undefined): SlotMeta | null {
  if (m == null) return null;
  return {
    label: sanitizeLabel(m.label),
    date: sanitizeDate(m.date),
    page: sanitizePage(m.page),
  };
}

export type SlotLabelChange = {
  /** As a teacher names it: "WW3", "PT1", "QA". */
  slot: string;
  old: SlotMeta | string | null;
  new: SlotMeta | string | null;
};

/** A slot with nothing in it, whatever shape it was stored in. */
function slotKey(v: unknown): string {
  if (v == null) return '';
  // Legacy rows hold a bare string label (pre-KD #105).
  if (typeof v === 'string')
    return JSON.stringify([v.trim() || null, null, null]);
  const m = v as SlotMeta;
  const parts = [m.label ?? null, m.date ?? null, m.page ?? null];
  return parts.every((p) => p == null) ? '' : JSON.stringify(parts);
}

/**
 * Which activity labels actually changed between the stored `slot_labels` and
 * an incoming patch — for the audit row. Only the keys present in `incoming`
 * are compared, matching the labels route's top-level merge.
 */
export function diffSlotLabels(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>
): SlotLabelChange[] {
  const out: SlotLabelChange[] = [];
  for (const kind of ['ww', 'pt'] as const) {
    if (!(kind in incoming)) continue;
    const before = (current[kind] as unknown[] | null | undefined) ?? [];
    const after = (incoming[kind] as unknown[] | null | undefined) ?? [];
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      if (slotKey(before[i]) === slotKey(after[i])) continue;
      out.push({
        slot: `${kind.toUpperCase()}${i + 1}`,
        old: (before[i] as SlotMeta | string | null | undefined) ?? null,
        new: (after[i] as SlotMeta | string | null | undefined) ?? null,
      });
    }
  }
  if ('qa' in incoming) {
    const before = (current.qa as string | null | undefined) ?? null;
    const after = (incoming.qa as string | null | undefined) ?? null;
    if ((before?.trim() || null) !== (after?.trim() || null)) {
      out.push({ slot: 'QA', old: before, new: after });
    }
  }
  return out;
}

/**
 * Patches ONE slot's metadata into a full slot_labels object, preserving
 * every other slot untouched. Used by the entries route's first-score gate
 * (Task 2), which — unlike the labels route's full-array replace — only
 * ever knows about the single slot the teacher just unlocked.
 */
export function mergeSlotLabel(
  current: SlotLabels | null,
  incoming: {
    kind: 'ww' | 'pt' | 'qa';
    index: number | null;
    meta: SlotMeta | { label: string | null };
  }
): SlotLabels {
  const base: SlotLabels = {
    ww: current?.ww ?? [],
    pt: current?.pt ?? [],
    qa: current?.qa ?? null,
  };
  if (incoming.kind === 'qa') {
    return {
      ...base,
      qa: sanitizeLabel((incoming.meta as { label: string | null }).label),
    };
  }
  const arrKey = incoming.kind;
  const arr = [...(base[arrKey] ?? [])];
  const idx = incoming.index as number;
  while (arr.length <= idx) arr.push(null);
  arr[idx] = sanitizeMeta(incoming.meta as SlotMeta);
  return { ...base, [arrKey]: arr };
}
