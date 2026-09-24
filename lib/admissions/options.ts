// Admission options (migration 174): the per-AY level / class type / schedule
// combinations the parent enrolment forms offer.
//
// Pure — no DB access, no `server-only`. The endpoint, the admin page, the
// seed script and the parity check all derive the portal's three dropdowns
// through `deriveOptions`, so they cannot disagree about what "open" yields.

export const ADMISSION_SCHEDULES = [
  'morning',
  'afternoon',
  'whole_day',
] as const;
export type AdmissionSchedule = (typeof ADMISSION_SCHEDULES)[number];

export const ADMISSION_TRACKS = ['Global', 'Standard'] as const;
export type AdmissionTrack = (typeof ADMISSION_TRACKS)[number];

/** The portal's own words for each schedule — what lands in `preferredSchedule`. */
export const PORTAL_SCHEDULE_LABEL: Record<AdmissionSchedule, PortalSchedule> =
  {
    morning: 'Morning',
    afternoon: 'Afternoon',
    whole_day: 'Whole Day',
  };
export type PortalSchedule = 'Morning' | 'Afternoon' | 'Whole Day';

/**
 * The reverse of `PORTAL_SCHEDULE_LABEL`: a `preferredSchedule` as the portal
 * wrote it ("Morning", "Afternoon", "Whole Day") → the SIS vocabulary. Case and
 * spacing are forgiven ("whole  day", " MORNING "); anything else is null.
 */
export function scheduleFromPortal(
  raw: string | null | undefined
): AdmissionSchedule | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const s of ADMISSION_SCHEDULES) {
    if (PORTAL_SCHEDULE_LABEL[s].toLowerCase() === v) return s;
  }
  return null;
}

/** The columns `deriveOptions` needs; a full `admission_options` row satisfies it. */
export type AdmissionOptionRow = {
  level_label: string;
  class_type_label: string;
  schedule: AdmissionSchedule;
  is_open: boolean;
  sort_order: number;
};

export type DerivedClassType = {
  classTypeLabel: string;
  schedules: PortalSchedule[];
};

export type DerivedLevel = {
  levelLabel: string;
  classTypes: DerivedClassType[];
};

/**
 * Open rows → the three dropdowns, as the portal builds them:
 *   levels     = distinct level labels with at least one open row;
 *   classTypes = open rows for that level;
 *   schedules  = open rows for that level and type, in portal words.
 * A closed row contributes nothing, so a level or type whose every row is
 * closed disappears. Levels and types keep the order of their lowest
 * `sort_order`; schedules are always Morning, Afternoon, Whole Day.
 */
export function deriveOptions(
  rows: readonly AdmissionOptionRow[]
): DerivedLevel[] {
  const open = rows
    .filter((r) => r.is_open)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const levels = new Map<string, Map<string, Set<AdmissionSchedule>>>();
  for (const r of open) {
    let types = levels.get(r.level_label);
    if (!types) {
      types = new Map();
      levels.set(r.level_label, types);
    }
    let schedules = types.get(r.class_type_label);
    if (!schedules) {
      schedules = new Set();
      types.set(r.class_type_label, schedules);
    }
    schedules.add(r.schedule);
  }

  return [...levels].map(([levelLabel, types]) => ({
    levelLabel,
    classTypes: [...types].map(([classTypeLabel, schedules]) => ({
      classTypeLabel,
      schedules: ADMISSION_SCHEDULES.filter((s) => schedules.has(s)).map(
        (s) => PORTAL_SCHEDULE_LABEL[s]
      ),
    })),
  }));
}

// ── the public read endpoint (/api/parent/v2/admission-options) ──────────
// Kept here, pure, so the route handler is only wiring and the two rules that
// matter — which years may be served, and what a parent is shown — are
// unit-tested without a database (__tests__/admissions/options-endpoint.test.ts).

/**
 * The `?ay=` value, normalised to `AY2027` form, or null when it is not an AY
 * code at all. Case-insensitive on the prefix; surrounding whitespace is
 * forgiven, anything else is not.
 */
export function normalizeAyParam(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return /^AY\d{4}$/.test(v) ? v : null;
}

/** The `academic_years` columns `isServableAy` decides on. */
export type ServableAyCandidate = {
  ay_code: string;
  is_current: boolean;
  accepting_applications: boolean;
};

/**
 * Whether the public endpoint may serve this year's options: only the current
 * year or one taking applications, and never a test year (`AY9…`, KD #52).
 * The endpoint answers without a token, so this is the whole of its gate —
 * a closed past year or a future year nobody has opened stays private even
 * though its rows exist.
 */
export function isServableAy(
  ay: ServableAyCandidate | null | undefined
): boolean {
  if (!ay) return false;
  if (/^AY9/i.test(ay.ay_code)) return false;
  return ay.is_current === true || ay.accepting_applications === true;
}

/** An `admission_options` row joined with its level's code, as the loader returns it. */
export type AdmissionOptionWithLevel = AdmissionOptionRow & {
  level_code: string | null;
};

/** One entry in the endpoint's `options` array. */
export type PublicAdmissionOption = {
  levelLabel: string;
  levelCode: string | null;
  classTypeLabel: string;
  schedule: PortalSchedule;
  sortOrder: number;
};

/**
 * Rows → the endpoint's `options`: open rows only (a closed row must vanish
 * from the form, not arrive flagged), schedule in the portal's own words,
 * ordered by `sort_order`. The sort is stable, so rows sharing a sort_order
 * keep the loader's order.
 */
export function toPublicOptions(
  rows: readonly AdmissionOptionWithLevel[]
): PublicAdmissionOption[] {
  return rows
    .filter((r) => r.is_open)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      levelLabel: r.level_label,
      levelCode: r.level_code,
      classTypeLabel: r.class_type_label,
      schedule: PORTAL_SCHEDULE_LABEL[r.schedule],
      sortOrder: r.sort_order,
    }));
}

// ── what a saved level name means (create / group-edit) ─────────────────
// A level name parents see must resolve to the SIS level the option says it
// counts as, or the application lands on /records/level-mismatches. Saving an
// option therefore also records the name as a `level_aliases` row — unless the
// SIS already reads it that way. `raw_label` is globally unique (one name can
// mean one level, across every year), so a name that already means a
// DIFFERENT level is refused rather than re-pointed: re-pointing would quietly
// change how every past application carrying that name resolves.

/** A level as `planLevelAlias` needs it — `LevelRow` satisfies this. */
export type AliasPlanLevel = { id: string; label: string };
/** An alias row as `planLevelAlias` needs it — `LevelAliasRow` satisfies this. */
export type AliasPlanAlias = { raw_label: string; level_id: string };

export type LevelAliasPlan =
  /** The SIS already reads the name as this level — nothing to write. */
  | { kind: 'none' }
  /** Record `raw_label = label → levelId`. */
  | { kind: 'insert' }
  /** The name already means another level. `levelLabel` names it for the message. */
  | { kind: 'conflict'; levelId: string; levelLabel: string };

/**
 * What saving `label` as "counts as `levelId`" needs from `level_aliases`.
 * Resolution order matches `resolveLevelIdFromCatalog` (lib/sis/levels.ts):
 * an exact level label first, then the legacy digit spelling, then an alias.
 * Only the first match counts — it is the one the SIS will actually use.
 */
export function planLevelAlias(
  label: string,
  levelId: string,
  levels: readonly AliasPlanLevel[],
  aliases: readonly AliasPlanAlias[],
  canonicalize: (raw: string) => string | null = (raw) => raw.trim() || null
): LevelAliasPlan {
  const trimmed = label.trim();
  const labelOf = (id: string) =>
    levels.find((l) => l.id === id)?.label ?? 'another level';
  const decide = (existing: string): LevelAliasPlan =>
    existing === levelId
      ? { kind: 'none' }
      : { kind: 'conflict', levelId: existing, levelLabel: labelOf(existing) };

  const direct = levels.find((l) => l.label === trimmed);
  if (direct) return decide(direct.id);

  const canonical = canonicalize(trimmed);
  if (canonical && canonical !== trimmed) {
    const viaLegacy = levels.find((l) => l.label === canonical);
    if (viaLegacy) return decide(viaLegacy.id);
  }

  const alias = aliases.find((a) => a.raw_label === trimmed);
  if (alias) return decide(alias.level_id);

  return { kind: 'insert' };
}

/** One `admission_options` row carrying the level name being re-counted. */
export type NameRow = { id: string; level_id: string; ayCode: string };

/** Rows grouped by the level they held before — what a failed alias write puts back. */
export type RowRevert = { levelId: string; ids: string[] };

export type CountsAsChangePlan =
  /** Cannot be changed from here; `message` says why, in plain English. */
  | { kind: 'refuse'; message: string }
  | {
      kind: 'recount';
      /**
       * What happens to `level_aliases` after the rows move:
       *   'none'   — the SIS already reads the name as the new level;
       *   'insert' — the name was never aliased; record it;
       *   remap    — compare-and-set the alias from `fromLevelId`.
       */
      alias:
        | 'none'
        | 'insert'
        | { fromLevelId: string; fromLevelLabel: string };
      /** Rows whose level_id changes — every row with the name not already on the new level. */
      updateIds: string[];
      /** How to put those rows back if the alias write fails. */
      revert: RowRevert[];
      /** Every year whose rows change — each one's cache tag must be busted. */
      touchedAyCodes: string[];
    };

/**
 * An edit that keeps the level NAME but changes which SIS level it counts as.
 *
 * What a name counts as is a property of the NAME, not of one option: the
 * resolver reads `level_aliases`, whose `raw_label` is unique, so every
 * application carrying the name follows the alias. So the change moves EVERY
 * `admission_options` row with that name — every year, every class type — and
 * then re-points the alias, keeping the options and the resolver in step.
 *
 * The one refusal: a name that IS a level's own label (or its legacy digit
 * spelling). The resolver matches it before any alias, so nothing written here
 * could change what it means.
 *
 * `rows` is every `admission_options` row whose level_label is the name.
 */
export function planCountsAsChange(input: {
  label: string;
  newLevelId: string;
  levels: readonly AliasPlanLevel[];
  aliases: readonly AliasPlanAlias[];
  rows: readonly NameRow[];
  canonicalize?: (raw: string) => string | null;
}): CountsAsChangePlan {
  const {
    newLevelId,
    levels,
    aliases,
    rows,
    canonicalize = (raw: string) => raw.trim() || null,
  } = input;
  const label = input.label.trim();
  const labelOf = (id: string) =>
    levels.find((l) => l.id === id)?.label ?? 'another level';

  const canonical = canonicalize(label);
  const own =
    levels.find((l) => l.label === label) ??
    (canonical && canonical !== label
      ? levels.find((l) => l.label === canonical)
      : undefined);
  if (own && own.id !== newLevelId) {
    return {
      kind: 'refuse',
      message: `"${label}" is the SIS's own name for ${own.label}, so it always counts as ${own.label}. To offer it as ${labelOf(newLevelId)}, use a different level name.`,
    };
  }

  const moving = rows.filter((r) => r.level_id !== newLevelId);
  const byLevel = new Map<string, string[]>();
  for (const r of moving) {
    const ids = byLevel.get(r.level_id) ?? [];
    ids.push(r.id);
    byLevel.set(r.level_id, ids);
  }
  const touchedAyCodes = [...new Set(moving.map((r) => r.ayCode))].sort();

  const alias = aliases.find((a) => a.raw_label === label);
  return {
    kind: 'recount',
    alias: own
      ? 'none'
      : !alias
        ? 'insert'
        : alias.level_id === newLevelId
          ? 'none'
          : {
              fromLevelId: alias.level_id,
              fromLevelLabel: labelOf(alias.level_id),
            },
    updateIds: moving.map((r) => r.id),
    revert: [...byLevel].map(([levelId, ids]) => ({ levelId, ids })),
    touchedAyCodes,
  };
}

/** How far a level name reaches: the options (year × class type) that use it. */
export type NameReach = { options: number; ayCodes: string[] };

/**
 * Every level name → how many options (distinct year × class type) use it and
 * in which years, oldest first. Keyed by the exact label.
 */
export function nameReachByLabel(
  rows: readonly {
    ayCode: string;
    levelLabel: string;
    classTypeLabel: string;
  }[]
): Record<string, NameReach> {
  const combos = new Map<string, Set<string>>();
  const years = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!combos.has(r.levelLabel)) {
      combos.set(r.levelLabel, new Set());
      years.set(r.levelLabel, new Set());
    }
    combos.get(r.levelLabel)!.add(`${r.ayCode}\u0000${r.classTypeLabel}`);
    years.get(r.levelLabel)!.add(r.ayCode);
  }
  const out: Record<string, NameReach> = {};
  for (const [label, set] of combos) {
    out[label] = {
      options: set.size,
      ayCodes: [...years.get(label)!].sort(),
    };
  }
  return out;
}

/**
 * The drawer's warning when "Counts as" changes on an unchanged name, e.g.
 * "This name is used by 4 options across AY2026 and AY2027. All of them will
 * count as Primary One."
 */
export function describeNameReach(
  reach: NameReach,
  newLevelLabel: string
): string {
  const tail = 'Applications that used this name will be read that way too.';
  if (reach.options <= 1) {
    return `This name is only used by this option. It will count as ${newLevelLabel}. ${tail}`;
  }
  const years =
    reach.ayCodes.length <= 1
      ? `in ${reach.ayCodes[0] ?? 'this year'}`
      : `across ${reach.ayCodes.slice(0, -1).join(', ')} and ${reach.ayCodes[reach.ayCodes.length - 1]}`;
  return `This name is used by ${reach.options} options ${years}. All of them will count as ${newLevelLabel}. ${tail}`;
}

/**
 * The refusal a create / edit answers with when the name already means
 * another level. Plain English for school admins — it names both levels and
 * says what to do instead.
 */
export function levelAliasConflictMessage(
  label: string,
  existingLevelLabel: string,
  targetLevelLabel: string
): string {
  return `"${label}" already counts as ${existingLevelLabel} in the SIS, so it can't also count as ${targetLevelLabel}. Use a different level name, or set "Counts as" to ${existingLevelLabel}.`;
}

/** "Primary Three — Standard Class": how a toast and the audit log name a row. */
export function optionDisplayName(
  levelLabel: string,
  classTypeLabel: string
): string {
  return `${levelLabel} — ${classTypeLabel}`;
}

/** Staff-facing schedule words ("Whole day", sentence case) — the page and its toasts. */
export const STAFF_SCHEDULE_LABEL: Record<AdmissionSchedule, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  whole_day: 'Whole day',
};

// ── the admin page's grouping (/sis/admin/admission-options) ─────────────

/** A row as the admin page needs it — `AdmissionOptionRecord` satisfies this. */
export type AdminOptionInput = {
  id: string;
  level_label: string;
  level_id: string;
  class_type_label: string;
  track: AdmissionTrack;
  schedule: AdmissionSchedule;
  is_open: boolean;
  sort_order: number;
};

export type AdminOptionSession = {
  id: string;
  schedule: AdmissionSchedule;
  isOpen: boolean;
};

/** One (parent-facing level name, class type) combination and its sessions. */
export type AdminOptionCombo = {
  levelLabel: string;
  classTypeLabel: string;
  levelId: string;
  track: AdmissionTrack;
  /** In Morning, Afternoon, Whole day order — only the sessions it has. */
  sessions: AdminOptionSession[];
};

export type AdminOptionGroup = {
  levelId: string;
  levelCode: string;
  levelLabel: string;
  combos: AdminOptionCombo[];
};

/**
 * Rows → one group per SIS level, in the levels' `sort_order`, each holding
 * its combinations in the order of their lowest row `sort_order`. A level with
 * no rows is left out. A row whose level is not in `levels` is left out too —
 * the foreign key makes that impossible, and there is no level card to put it
 * under.
 */
export function groupOptionsForAdmin(
  rows: readonly AdminOptionInput[],
  levels: readonly {
    id: string;
    code: string;
    label: string;
    sortOrder: number;
  }[]
): AdminOptionGroup[] {
  const sorted = rows.slice().sort((a, b) => a.sort_order - b.sort_order);
  const byLevel = new Map<string, Map<string, AdminOptionCombo>>();
  for (const r of sorted) {
    let combos = byLevel.get(r.level_id);
    if (!combos) {
      combos = new Map();
      byLevel.set(r.level_id, combos);
    }
    // U+0000 cannot occur in either label, so the key cannot collide.
    const key = `${r.level_label}\u0000${r.class_type_label}`;
    let combo = combos.get(key);
    if (!combo) {
      combo = {
        levelLabel: r.level_label,
        classTypeLabel: r.class_type_label,
        levelId: r.level_id,
        track: r.track,
        sessions: [],
      };
      combos.set(key, combo);
    }
    combo.sessions.push({ id: r.id, schedule: r.schedule, isOpen: r.is_open });
  }

  return levels
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((l) => byLevel.has(l.id))
    .map((l) => ({
      levelId: l.id,
      levelCode: l.code,
      levelLabel: l.label,
      combos: [...byLevel.get(l.id)!.values()].map((c) => ({
        ...c,
        sessions: ADMISSION_SCHEDULES.flatMap((s) =>
          c.sessions.filter((x) => x.schedule === s)
        ),
      })),
    }));
}

// ── the admin page's matrix: filters, closed summary, bulk plan ───────────

/** One row of the matrix — a combination's identity across renders. */
export function adminComboKey(
  combo: Pick<AdminOptionCombo, 'levelLabel' | 'classTypeLabel'>
): string {
  // U+0000 cannot occur in either label, so the key cannot collide.
  return `${combo.levelLabel}\u0000${combo.classTypeLabel}`;
}

export type AdminOptionTrackFilter = 'all' | AdmissionTrack;

export type AdminOptionFilter = {
  track: AdminOptionTrackFilter;
  /** SIS level codes. Empty means every level. */
  levelCodes: readonly string[];
  /** Only combinations with at least one closed session. */
  closedOnly: boolean;
};

export const NO_ADMIN_OPTION_FILTER: AdminOptionFilter = {
  track: 'all',
  levelCodes: [],
  closedOnly: false,
};

export function isAdminOptionFilterActive(f: AdminOptionFilter): boolean {
  return f.track !== 'all' || f.levelCodes.length > 0 || f.closedOnly;
}

function comboPasses(
  combo: AdminOptionCombo,
  f: Pick<AdminOptionFilter, 'track' | 'closedOnly'>
): boolean {
  if (f.track !== 'all' && combo.track !== f.track) return false;
  if (f.closedOnly && combo.sessions.every((s) => s.isOpen)) return false;
  return true;
}

/**
 * The groups the matrix shows under a filter. Order is kept; a group left with
 * no combinations is dropped, so an empty level never shows a bare header.
 */
export function filterAdminGroups(
  groups: readonly AdminOptionGroup[],
  f: AdminOptionFilter
): AdminOptionGroup[] {
  const levels = new Set(f.levelCodes);
  return groups
    .filter((g) => levels.size === 0 || levels.has(g.levelCode))
    .map((g) => ({ ...g, combos: g.combos.filter((c) => comboPasses(c, f)) }))
    .filter((g) => g.combos.length > 0);
}

/**
 * Per-tab counts for the track tabs: every other filter applies, the track
 * one does not — so a tab says how many rows picking it would show.
 */
export function countAdminCombosByTrack(
  groups: readonly AdminOptionGroup[],
  f: AdminOptionFilter
): Record<AdminOptionTrackFilter, number> {
  const out: Record<AdminOptionTrackFilter, number> = {
    all: 0,
    Global: 0,
    Standard: 0,
  };
  for (const g of filterAdminGroups(groups, { ...f, track: 'all' })) {
    for (const c of g.combos) {
      out.all += 1;
      out[c.track] += 1;
    }
  }
  return out;
}

export type ClosedSessionEntry = {
  /** The SIS level's own label ("Primary Three"). */
  levelLabel: string;
  classTypeLabel: string;
  track: AdmissionTrack;
};

export type ClosedSessionSummary = {
  schedule: AdmissionSchedule;
  entries: ClosedSessionEntry[];
  /** Set when every entry is on one track — "19 classes (all Global)". */
  onlyTrack: AdmissionTrack | null;
};

/**
 * What is closed right now, one line per session in Morning, Afternoon, Whole
 * day order. A session with nothing closed is left out.
 */
export function summarizeClosedSessions(
  groups: readonly AdminOptionGroup[]
): ClosedSessionSummary[] {
  return ADMISSION_SCHEDULES.flatMap((schedule) => {
    const entries: ClosedSessionEntry[] = [];
    for (const g of groups) {
      for (const c of g.combos) {
        if (c.sessions.some((s) => s.schedule === schedule && !s.isOpen)) {
          entries.push({
            levelLabel: g.levelLabel,
            classTypeLabel: c.classTypeLabel,
            track: c.track,
          });
        }
      }
    }
    if (entries.length === 0) return [];
    const tracks = new Set(entries.map((e) => e.track));
    return [
      {
        schedule,
        entries,
        onlyTrack: tracks.size === 1 ? entries[0].track : null,
      },
    ];
  });
}

/** Sessions at least one of these combinations has, in schedule order. */
export function sessionsAmong(
  combos: readonly AdminOptionCombo[]
): AdmissionSchedule[] {
  return ADMISSION_SCHEDULES.filter((s) =>
    combos.some((c) => c.sessions.some((x) => x.schedule === s))
  );
}

export type BulkSessionPlan = {
  /** The rows to write — only sessions that exist and are not already there. */
  optionIds: string[];
  /** Combinations already in the state asked for. */
  alreadyCount: number;
  /** Combinations that have no row for this session. */
  missingCount: number;
};

/** Open or close one session across many combinations: what actually changes. */
export function planBulkSessionChange(
  combos: readonly AdminOptionCombo[],
  schedule: AdmissionSchedule,
  isOpen: boolean
): BulkSessionPlan {
  const plan: BulkSessionPlan = {
    optionIds: [],
    alreadyCount: 0,
    missingCount: 0,
  };
  for (const c of combos) {
    const s = c.sessions.find((x) => x.schedule === schedule);
    if (!s) plan.missingCount += 1;
    else if (s.isOpen === isOpen) plan.alreadyCount += 1;
    else plan.optionIds.push(s.id);
  }
  return plan;
}

/** "Morning closed for 7 classes" — the bulk bar's toast. */
export function bulkSessionMessage(
  schedule: AdmissionSchedule,
  isOpen: boolean,
  changed: number
): string {
  const session = STAFF_SCHEDULE_LABEL[schedule];
  if (changed === 0) {
    return `Nothing to change — ${session} is already ${isOpen ? 'open' : 'closed'} for every selected class`;
  }
  return `${session} ${isOpen ? 'reopened' : 'closed'} for ${changed} ${changed === 1 ? 'class' : 'classes'}`;
}

/** Where a year sits against the current one — the page's year badge. */
export type AyRelation = 'current' | 'upcoming' | 'past';

export function ayRelation(ayCode: string, currentAyCode: string): AyRelation {
  const a = ayCode.toUpperCase();
  const c = currentAyCode.toUpperCase();
  if (a === c) return 'current';
  // `AY` + four digits, so string order is year order.
  return a > c ? 'upcoming' : 'past';
}

/**
 * Track for a class type label. "Global" anywhere in the label (any case)
 * means Global — which covers the Cambridge types, all spelled
 * "Global Class-Cambridge…" / "Global Class (CAMBRIDGE)"; Cambridge is the
 * Global track, not a third one (Mr Ace, 2026-09-24). Everything else is
 * Standard.
 */
export function trackForClassType(classTypeLabel: string): AdmissionTrack {
  return classTypeLabel.toLowerCase().includes('global')
    ? 'Global'
    : 'Standard';
}

// ── the section picker's "Matches their application" hint ────────────────
// The only SIS-side consumer of an option's track and schedule. A hint only:
// nothing is filtered, reordered or blocked by it — staff still choose.

/** What an application asked for, in section vocabulary. */
export type ApplicationFit = {
  track: AdmissionTrack | null;
  schedule: AdmissionSchedule | null;
};

/**
 * An application's (levelApplied, classType, preferredSchedule) → the track
 * and schedule a section would need to match it.
 *
 * Track: the AY's own `admission_options` row for that exact level name and
 * class type decides it. When no row matches — an old application carrying a
 * label since retired — `trackForClassType` guesses from the words. A blank
 * class type has no track at all.
 */
export function deriveApplicationFit(
  app: {
    levelApplied: string | null | undefined;
    classType: string | null | undefined;
    preferredSchedule: string | null | undefined;
  },
  options: readonly {
    level_label: string;
    class_type_label: string;
    track: AdmissionTrack;
  }[]
): ApplicationFit {
  const classType = (app.classType ?? '').trim();
  const level = (app.levelApplied ?? '').trim();
  let track: AdmissionTrack | null = null;
  if (classType) {
    const row = options.find(
      (o) =>
        o.level_label.trim() === level &&
        o.class_type_label.trim() === classType
    );
    track = row ? row.track : trackForClassType(classType);
  }
  return { track, schedule: scheduleFromPortal(app.preferredSchedule) };
}

/**
 * Does this section match what the application asked for?
 *
 * Deliberately strict: BOTH the track and the schedule must be known on the
 * application AND on the section, and both must be equal. An application that
 * gave only one of the two gets no mark anywhere — a half-match would mark
 * every section on that track (or in that session) and stop meaning anything.
 * A section with no `class_type` or no `schedule` recorded never matches.
 */
export function sectionMatchesApplication(
  section: { classType: string | null; schedule: string | null },
  fit: ApplicationFit | null | undefined
): boolean {
  if (!fit || !fit.track || !fit.schedule) return false;
  if (!section.classType || !section.schedule) return false;
  return section.classType === fit.track && section.schedule === fit.schedule;
}
