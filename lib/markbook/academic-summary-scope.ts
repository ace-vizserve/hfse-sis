import 'server-only';
import { requireCurrentAyCode } from '@/lib/academic-year';
import {
  loadMasterfile,
  type MasterfilePayload,
} from '@/lib/markbook/masterfile';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/** Sentinel for "no level — show the whole school". Only honoured by callers
 *  that opt in via `allowAllLevels`; see the note on `resolveAcademicSummaryScope`. */
export const ALL_LEVELS = '__all__';

export type AcademicSummaryScope = {
  ayCode: string;
  academicYearId: string | null;
  ayCodes: string[];
  levels: { id: string; label: string }[];
  selectedLevelId: string | null;
  selectedSectionId: string | null;
  /**
   * true when the caller opted into `allowAllLevels` and no level is selected.
   * `payload` is null in this state — the school-wide view loads its own,
   * much lighter, aggregate instead of a masterfile per level.
   */
  allLevels: boolean;
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

/**
 * Resolve the AY / level / class scope shared by the Academic Summary page and
 * the three relocated quick views.
 *
 * ⚠ `allowAllLevels` is OPT-IN and must stay that way. Three other pages call
 * this — /markbook/awards, /attendance/summary and /evaluation/comments — and
 * every one of them depends on the default behaviour of falling back to the
 * FIRST level when `?level` is absent, because none of them can render without
 * a masterfile payload. Flipping the default would silently blank all three.
 * Only the Academic Summary page passes the flag.
 */
export async function resolveAcademicSummaryScope(
  sp: {
    ay?: string;
    level?: string;
    class?: string;
  },
  opts: { allowAllLevels?: boolean } = {}
): Promise<AcademicSummaryScope> {
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
      academicYearId: null,
      ayCodes,
      levels: [],
      selectedLevelId: null,
      selectedSectionId: null,
      allLevels: false,
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

  // School-wide: only when the caller opted in AND asked for it — either by
  // omitting ?level entirely or by passing the explicit sentinel. Callers
  // without the flag keep falling back to the first level, as they always have.
  const wantsAllLevels =
    opts.allowAllLevels === true &&
    (!sp.level || sp.level === ALL_LEVELS) &&
    levelsFull.length > 0;

  if (wantsAllLevels) {
    return {
      ayCode,
      academicYearId: ayId,
      ayCodes,
      levels,
      selectedLevelId: null,
      selectedSectionId: null,
      allLevels: true,
      payload: null,
      empty: false,
      noAyRow: false,
    };
  }

  const selectedLevelId =
    sp.level && levelsFull.some((l) => l.id === sp.level)
      ? sp.level
      : (levelsFull[0]?.id ?? null);

  if (!selectedLevelId) {
    return {
      ayCode,
      academicYearId: ayId,
      ayCodes,
      levels,
      selectedLevelId: null,
      selectedSectionId: null,
      allLevels: false,
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
    academicYearId: ayId,
    ayCodes,
    levels,
    selectedLevelId,
    selectedSectionId,
    allLevels: false,
    payload: payload ?? null,
    empty: false,
    noAyRow: false,
  };
}
