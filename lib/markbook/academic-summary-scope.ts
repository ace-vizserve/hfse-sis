import 'server-only';
import { requireCurrentAyCode } from '@/lib/academic-year';
import {
  loadMasterfile,
  type MasterfilePayload,
} from '@/lib/markbook/masterfile';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export type AcademicSummaryScope = {
  ayCode: string;
  ayCodes: string[];
  levels: { id: string; label: string }[];
  selectedLevelId: string | null;
  selectedSectionId: string | null;
  payload: MasterfilePayload | null;
  /** true when no level has sections this AY (caller renders empty state). */
  empty: boolean;
  /**
   * true when the requested ayCode resolved to no row in academic_years —
   * distinct from empty (which means the AY exists but has no sections).
   * Callers use this to show "No academic year configured." instead of the
   * "No levels with sections" dashed box.
   */
  noAyRow: boolean;
};

export async function resolveAcademicSummaryScope(sp: {
  ay?: string;
  level?: string;
  class?: string;
}): Promise<AcademicSummaryScope> {
  const supabase = await createClient();
  const service = createServiceClient();
  const currentAyCode = await requireCurrentAyCode(service);

  // Allow the demo / cross-AY review to pick a different AY via ?ay=.
  // Validates the requested code resolves to a real AY before honoring it.
  let ayCode = currentAyCode;
  if (sp.ay && /^AY\d{4}$/.test(sp.ay)) {
    const { data } = await supabase
      .from('academic_years')
      .select('ay_code')
      .eq('ay_code', sp.ay)
      .maybeSingle();
    if (data) ayCode = (data as { ay_code: string }).ay_code;
  }

  // List every AY (both prod + test) so the toolbar can offer cross-AY
  // review — useful for the demo (flip between AY9999 active and AY9998
  // closed) and for legitimate prior-year audits.
  const { data: allAysRaw } = await supabase
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  const ayCodes = ((allAysRaw ?? []) as { ay_code: string }[]).map(
    (a) => a.ay_code
  );

  // Resolve AY id and pull every level that has at least one section
  // configured this AY (so the picker doesn't list empty levels).
  const { data: ayRow } = await supabase
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) {
    return {
      ayCode,
      ayCodes,
      levels: [],
      selectedLevelId: null,
      selectedSectionId: null,
      payload: null,
      empty: true,
      noAyRow: true,
    };
  }
  const ayId = (ayRow as { id: string }).id;

  const { data: sectionLevelRows } = await supabase
    .from('sections')
    .select('level:levels(id, code, label, level_type)')
    .eq('academic_year_id', ayId);

  type LvlLite = {
    id: string;
    code: string;
    label: string;
    level_type: string;
  };
  const levelMap = new Map<string, LvlLite>();
  for (const row of (sectionLevelRows ?? []) as {
    level: LvlLite | LvlLite[] | null;
  }[]) {
    const lvl = Array.isArray(row.level) ? row.level[0] : row.level;
    if (lvl) levelMap.set(lvl.id, lvl);
  }
  const levelsFull = Array.from(levelMap.values()).sort((a, b) => {
    // Primary first, then Secondary; alphabetical within each group.
    if (a.level_type !== b.level_type) {
      return a.level_type === 'primary' ? -1 : 1;
    }
    return a.code.localeCompare(b.code);
  });
  const levels = levelsFull.map((l) => ({ id: l.id, label: l.label }));

  const selectedLevelId =
    sp.level && levelsFull.some((l) => l.id === sp.level)
      ? sp.level
      : (levelsFull[0]?.id ?? null);

  if (!selectedLevelId) {
    return {
      ayCode,
      ayCodes,
      levels,
      selectedLevelId: null,
      selectedSectionId: null,
      payload: null,
      empty: true,
      noAyRow: false,
    };
  }

  const payload = await loadMasterfile({
    ayCode,
    levelId: selectedLevelId,
    sectionIds: sp.class ? [sp.class] : undefined,
  });

  const selectedSectionId =
    sp.class && payload?.sections.some((s) => s.id === sp.class)
      ? sp.class
      : null;

  return {
    ayCode,
    ayCodes,
    levels,
    selectedLevelId,
    selectedSectionId,
    payload: payload ?? null,
    empty: false,
    noAyRow: false,
  };
}
