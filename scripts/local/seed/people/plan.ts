// The cohort plan for the `people` phase: which invented children exist, which
// year(s) they apply in, at which level, with what outcome, and which class
// they are meant to end up in. Pure and deterministic — every draw comes from a
// keyed stream (lib/random.ts), and the only inputs are the setup data copied
// from production (sections, terms). Nothing here writes.
//
// Shapes (production profile, 2026-10-07, scaled down):
//   AY2025 class list ~240 (18 withdrawn, 8 late T1–T3)
//   AY2026 class list ~250 (~175 returning from AY2025, ~74 new; 12 late T3)
//   AY2027 class list 4; ~30 applications, ~25 returning from AY2026
//   ~100 legacy students with no class row and no application at all
//   (production: 198 of 777 — a quarter of the students table).

import { allocate, pickFrom, type Distribution } from '../lib/distribution';
import {
  CHILD_FIRST_NAMES,
  FAMILY_NAMES,
  SECOND_FIRST_NAMES,
} from '../lib/names';
import { rng, type Rng } from '../lib/random';
import {
  AYS,
  GENDER,
  LEVEL_ORDER,
  NATIONALITY,
  nextLevel,
  type Ay,
  type LevelCode,
} from './vocab';

// ── Inputs ────────────────────────────────────────────────────────────────

export type SectionInfo = {
  id: string;
  ay: Ay;
  level: LevelCode;
  name: string;
};

export type TermInfo = { ay: Ay; term: number; start: string; end: string };

// ── Outputs ───────────────────────────────────────────────────────────────

export type Child = {
  key: string;
  /** The system key (`students.student_number`). */
  studentNumber: string;
  /** What the portal stored on the application, quirks included (one carries a trailing space). */
  appStudentNumber: string;
  first: string;
  middle: string | null;
  last: string;
  gender: 'Male' | 'Female';
  birthDay: string;
  nationality: string;
  /** Has a class row in some AY (i.e. becomes a `students` row via the sync). */
  placed: boolean;
};

export type Outcome =
  | 'enrolled' // joins a class through syncOneStudent
  | 'enrolled_unplaced' // Enrolled, but the admissions row names no class
  | 'submitted'
  | 'cancelled'
  | 'withdrawn_pre' // withdrew before ever joining a class
  | 'legacy_app_only' // AY2025 import: application row, no status row
  | 'status_only'; // AY2025 import / AY2027 stray: status row, no application row

export type AppSpec = {
  ay: Ay;
  child: Child;
  category: 'Current' | 'New' | 'VizSchool Current';
  level: LevelCode;
  outcome: Outcome;
  /** The class to sync into (outcome 'enrolled'). */
  section: SectionInfo | null;
  /** A class Directus set on a not-enrolled row (sync holds them back). */
  presetSection: SectionInfo | null;
  /** Late enrollee: joins after T1 starts. */
  late: { term: number; date: string } | null;
  /** AY2025: withdrawn from the class list (planned; AY2026 ones are picked at run time). */
  withdraw: boolean;
  /** AY2025 legacy shape: the application row is lost after the sync, the status row stays. */
  dropAppAfterSync: boolean;
  /** AY2026 Youngstarters: on the class list while admissions reads Submitted, class blank. */
  ysSubmittedFlip: boolean;
  /** Excluded from the AY2026 run-time withdrawal pick (they go on to AY2027 etc.). */
  protected: boolean;
  /** App created (ISO timestamp, SGT). */
  createdAt: string;
  /** Filled after the AY's rows are ordered: E + YY + 4 digits. */
  enroleeNumber: string;
  hasApp: boolean;
  hasStatus: boolean;
  hasDocs: boolean;
  /** A half-written portal row: no enrolee number, no student number. */
  blankKeys?: boolean;
};

export type Orphan = {
  studentNumber: string;
  first: string;
  middle: string | null;
  last: string;
  isActive: boolean;
};

export type Plan = {
  children: Child[];
  apps: Record<Ay, AppSpec[]>;
  orphans: Orphan[];
  /** Pairs of distinct children deliberately given the same (last, first). */
  duplicateNamePairs: Array<[string, string]>;
  /** The one AY2026 child moved between P3 classes by transfer_student_section. */
  transferKey: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dateBetween(r: Rng, from: string, to: string): string {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const days = Math.max(0, Math.round((b - a) / 86_400_000));
  return addDays(from, r.int(0, days));
}

/** An SGT timestamp on a given day. */
export function stampOn(r: Rng, day: string): string {
  return `${day}T${pad(r.int(8, 21), 2)}:${pad(r.int(0, 59), 2)}:${pad(r.int(0, 59), 2)}.${pad(r.int(0, 999999), 6)}+08:00`;
}

const ayYear = (ay: Ay) => Number(ay.slice(2));
const yy = (ay: Ay) => ay.slice(4);

/** Birth year production shows for a level in a given AY (AY2026 P1 → 2019). */
function birthYear(ay: Ay, level: LevelCode): number {
  const y = ayYear(ay);
  if (level === 'YS') return y - 5;
  const n = Number(level.slice(1));
  return level.startsWith('P') ? y - 6 - n : y - 12 - n;
}

// ── Names: unique (last, first) for everyone, duplicates only on purpose ───

class NameBank {
  private used = new Set<string>();
  private r: Rng;
  constructor(key: string) {
    this.r = rng(key);
  }
  next(): { first: string; middle: string | null; last: string } {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const stem = this.r.pick(CHILD_FIRST_NAMES);
      // Production: 486 of 777 children have a space in their first name.
      const first = this.r.chance(0.62)
        ? `${stem} ${this.r.pick(SECOND_FIRST_NAMES)}`
        : stem;
      const last = this.r.pick(FAMILY_NAMES);
      const k = `${last}|${first}`;
      if (this.used.has(k)) continue;
      this.used.add(k);
      let middle: string | null = this.r.pick(FAMILY_NAMES);
      if (middle === last) middle = this.r.pick(FAMILY_NAMES);
      return { first, middle, last };
    }
    throw new Error('NameBank exhausted');
  }
}

// ── The planner ───────────────────────────────────────────────────────────

// Production class-list sizes per level (incl. withdrawn), the shape we scale.
const AY2025_LEVEL_WEIGHTS: Distribution<LevelCode> = [
  ['P1', 40],
  ['P2', 36],
  ['P3', 40],
  ['P4', 58],
  ['P5', 56],
  ['P6', 53],
  ['S1', 44],
  ['S2', 24],
  ['S3', 37],
  ['S4', 26],
];
const AY2026_LEVEL_TARGET: Record<string, number> = {
  P1: 33,
  P2: 43,
  P3: 39,
  P4: 40,
  P5: 56,
  P6: 59,
  S1: 48,
  S2: 33,
  S3: 30,
  S4: 36,
};

const COUNTS = {
  ay2025Roster: 240,
  ay2025Withdrawn: 18,
  ay2025Late: [
    [1, 2],
    [2, 2],
    [3, 4],
  ] as const,
  returning: 175,
  ay2026New: 74,
  ay2026Ys: 9,
  ay2026YsFlipped: 7,
  ay2026TestSection: 2,
  ay2026Late: 12,
  ay2025DropApps: 70,
  // Production: AY2025 31 of 828 status rows not Enrolled but holding a class.
  ay2025Presets: 11,
  // Production: 10 students hold an old `Y` number that admissions holds too.
  yNumbered: 4,
  // Production: 198 of 777 students have no application in any AY — about a
  // third as many again as the children who applied. Nearly all of them have
  // no middle name (777 − 555 blank, only ~5% of applicants blank).
  orphans: 100,
};

export function buildPlan(
  sections: SectionInfo[],
  terms: TermInfo[],
  /** School days per AY from `school_calendar` (day_type 'school_day'), sorted. */
  teachingDays: Record<Ay, string[]>
): Plan {
  const names = new NameBank('people:names');
  const children: Child[] = [];
  const apps: Record<Ay, AppSpec[]> = { AY2025: [], AY2026: [], AY2027: [] };
  const seq: Record<string, number> = {};
  const nextNumber = (prefix: string) => {
    seq[prefix] = (seq[prefix] ?? 0) + 1;
    return `${prefix}${pad(seq[prefix], 4)}`;
  };

  const sectionsOf = (ay: Ay, level: LevelCode) =>
    sections
      .filter(
        (s) => s.ay === ay && s.level === level && s.name !== 'Test Section'
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  const termOf = (ay: Ay, n: number) => {
    const t = terms.find((x) => x.ay === ay && x.term === n);
    if (!t) throw new Error(`No ${ay} T${n} dates`);
    return t;
  };

  const makeChild = (
    key: string,
    entryAy: Ay,
    entryLevel: LevelCode,
    numberPrefix: string
  ): Child => {
    const r = rng(`people:child:${key}`);
    const n = names.next();
    const by = birthYear(entryAy, entryLevel) - (r.chance(0.1) ? 1 : 0);
    const studentNumber = nextNumber(numberPrefix);
    const c: Child = {
      key,
      studentNumber,
      appStudentNumber: studentNumber,
      first: n.first,
      // Production: ~5% of applications leave the middle name blank (the
      // legacy students with no application carry the rest of the blanks).
      middle: r.chance(0.95) ? n.middle : null,
      last: n.last,
      gender: pickFrom(r, GENDER) as 'Male' | 'Female',
      birthDay: `${by}-${pad(r.int(1, 12), 2)}-${pad(r.int(1, 28), 2)}`,
      nationality: pickFrom(r, NATIONALITY[entryAy]),
      placed: false,
    };
    children.push(c);
    return c;
  };

  const spec = (
    ay: Ay,
    child: Child,
    level: LevelCode,
    category: AppSpec['category'],
    outcome: Outcome,
    extra: Partial<AppSpec> = {}
  ): AppSpec => {
    const s: AppSpec = {
      ay,
      child,
      category,
      level,
      outcome,
      section: null,
      presetSection: null,
      late: null,
      withdraw: false,
      dropAppAfterSync: false,
      ysSubmittedFlip: false,
      protected: false,
      createdAt: '',
      enroleeNumber: '',
      hasApp: outcome !== 'status_only',
      hasStatus: outcome !== 'legacy_app_only',
      hasDocs: true,
      ...extra,
    };
    if (outcome === 'enrolled') child.placed = true;
    apps[ay].push(s);
    return s;
  };

  /** Uneven split of a level's children across its sections. */
  const spreadOverSections = (
    key: string,
    ay: Ay,
    level: LevelCode,
    n: number
  ): SectionInfo[] => {
    const secs = sectionsOf(ay, level);
    if (secs.length === 0) throw new Error(`No ${ay} ${level} section`);
    const r = rng(`people:spread:${key}:${ay}:${level}`);
    const weights: Distribution<SectionInfo> = secs.map((s) => [
      s,
      0.55 + r.next(),
    ]);
    return allocate(r, weights, n);
  };

  // ── AY2025 class list ─────────────────────────────────────────────────
  const r25 = rng('people:ay2025');
  const levels25 = allocate(r25, AY2025_LEVEL_WEIGHTS, COUNTS.ay2025Roster);
  const byLevel25 = new Map<LevelCode, number>();
  for (const l of levels25) byLevel25.set(l, (byLevel25.get(l) ?? 0) + 1);
  const roster25: AppSpec[] = [];
  for (const level of LEVEL_ORDER) {
    const n = byLevel25.get(level) ?? 0;
    if (n === 0) continue;
    const secs = spreadOverSections('roster', 'AY2025', level, n);
    for (let i = 0; i < n; i++) {
      // Production AY2025 enrolled: 318 Current / 66 New.
      const isNew = r25.chance(0.17);
      const child = makeChild(
        `ay2025:${level}:${i}`,
        'AY2025',
        level,
        isNew
          ? `H${yy('AY2025')}`
          : `H${r25.pick(['19', '20', '21', '22', '23', '24'])}`
      );
      roster25.push(
        spec('AY2025', child, level, isNew ? 'New' : 'Current', 'enrolled', {
          section: secs[i],
        })
      );
    }
  }
  // Late enrollees (New intake joining after T1 began).
  const lateable25 = r25.shuffle(roster25.filter((a) => a.level !== 'S4'));
  let li = 0;
  for (const [term, n] of COUNTS.ay2025Late) {
    const t = termOf('AY2025', term);
    for (let k = 0; k < n; k++) {
      const a = lateable25[li++];
      a.category = 'New';
      // The AY2025 backfill rule: a historical late enrollee's first day is
      // its term's start date exactly (the real day was never recorded).
      a.late = { term, date: t.start };
    }
  }
  // Withdrawn — not the late ones, never returning.
  const withdrawable25 = r25.shuffle(roster25.filter((a) => !a.late));
  for (let i = 0; i < COUNTS.ay2025Withdrawn; i++)
    withdrawable25[i].withdraw = true;

  // ── Who returns for AY2026 ────────────────────────────────────────────
  const eligible = r25.shuffle(
    roster25.filter((a) => !a.withdraw && a.level !== 'S4')
  );
  const returners = eligible.slice(0, COUNTS.returning);
  const returnerKeys = new Set(returners.map((a) => a.child.key));
  const leavers25 = roster25.filter((a) => !returnerKeys.has(a.child.key));

  // AY2025 legacy shape: ~70 enrolled children whose application row was lost
  // in the import (status row only). Mostly children who left.
  const dropPool = [
    ...r25.shuffle(leavers25).slice(0, 48),
    ...r25.shuffle(returners).slice(0, COUNTS.ay2025DropApps - 48),
  ];
  for (const a of dropPool) a.dropAppAfterSync = true;

  // AY2025 applicants who never joined a class.
  const nonEnrolled25: Array<[Outcome, number]> = [
    ['submitted', 40],
    ['cancelled', 10],
    ['withdrawn_pre', 5],
    ['legacy_app_only', 75],
    ['status_only', 5],
  ];
  const applicants25: AppSpec[] = [];
  for (const [outcome, n] of nonEnrolled25) {
    for (let i = 0; i < n; i++) {
      const level = pickFrom(r25, AY2025_LEVEL_WEIGHTS);
      const isNew = r25.chance(0.45);
      const child = makeChild(
        `ay2025:app:${outcome}:${i}`,
        'AY2025',
        level,
        isNew ? 'H25' : `H${r25.pick(['22', '23', '24'])}`
      );
      applicants25.push(
        spec('AY2025', child, level, isNew ? 'New' : 'Current', outcome, {
          // Production AY2025: 672 documents rows to 822 applications.
          hasDocs: r25.chance(outcome === 'legacy_app_only' ? 0.4 : 0.6),
        })
      );
    }
  }
  for (const a of roster25) {
    a.hasDocs = r25.chance(a.dropAppAfterSync ? 0.5 : 0.85);
  }
  // Submitted rows Directus had already given a class (the sync holds them back).
  for (const a of r25
    .shuffle(applicants25.filter((x) => x.outcome === 'submitted'))
    .slice(0, COUNTS.ay2025Presets)) {
    a.presetSection = r25.pick(sectionsOf('AY2025', a.level));
  }

  // ── AY2026 class list ─────────────────────────────────────────────────
  const r26 = rng('people:ay2026');
  const roster26: AppSpec[] = [];
  const returningByLevel = new Map<LevelCode, AppSpec[]>();
  for (const a of returners) {
    const lvl = nextLevel(a.level as LevelCode)!;
    const list = returningByLevel.get(lvl) ?? [];
    list.push(a);
    returningByLevel.set(lvl, list);
  }
  // New children: Youngstarters + the Test Section pair + the rest spread to
  // where the returning cohort leaves each level short of production's shape.
  const restNew = COUNTS.ay2026New - COUNTS.ay2026Ys - COUNTS.ay2026TestSection;
  const deficit: Distribution<LevelCode> = (
    Object.keys(AY2026_LEVEL_TARGET) as LevelCode[]
  ).map((l) => [
    l,
    Math.max(
      0.5,
      (AY2026_LEVEL_TARGET[l] * 250) / 432 -
        (returningByLevel.get(l)?.length ?? 0)
    ),
  ]);
  const newLevels = allocate(r26, deficit, restNew);
  const newByLevel = new Map<LevelCode, number>();
  for (const l of newLevels) newByLevel.set(l, (newByLevel.get(l) ?? 0) + 1);

  // AY2025 applicants who did not join then, and do now (Current, as
  // production labels a family already known to the school).
  const comeback = r26.shuffle(
    applicants25.filter(
      (a) => a.outcome === 'submitted' || a.outcome === 'legacy_app_only'
    )
  );
  const comebackUsed = new Set<AppSpec>();

  for (const level of LEVEL_ORDER) {
    if (level === 'YS') continue;
    const back = returningByLevel.get(level) ?? [];
    const fresh = newByLevel.get(level) ?? 0;
    const secs = spreadOverSections(
      'roster',
      'AY2026',
      level,
      back.length + fresh
    );
    let i = 0;
    for (const prev of back) {
      roster26.push(
        spec('AY2026', prev.child, level, 'Current', 'enrolled', {
          section: secs[i++],
        })
      );
    }
    for (let k = 0; k < fresh; k++) {
      let child: Child;
      let category: AppSpec['category'] = 'New';
      // ~14 of the new joiners applied for AY2025 and never came.
      const prevApp =
        comebackUsed.size < 14
          ? comeback.find(
              (x) => !comebackUsed.has(x) && nextLevel(x.level) === level
            )
          : undefined;
      if (prevApp) {
        child = prevApp.child;
        category = 'Current';
        comebackUsed.add(prevApp);
      } else {
        child = makeChild(`ay2026:new:${level}:${k}`, 'AY2026', level, 'H26');
      }
      roster26.push(
        spec('AY2026', child, level, category, 'enrolled', {
          section: secs[i++],
        })
      );
    }
  }
  // Youngstarters: their own number series (production: Y + 6 digits).
  const ysSection = sections.find((s) => s.ay === 'AY2026' && s.level === 'YS');
  if (!ysSection) throw new Error('No AY2026 Youngstarters section');
  for (let k = 0; k < COUNTS.ay2026Ys; k++) {
    const child = makeChild(`ay2026:ys:${k}`, 'AY2026', 'YS', 'Y26');
    roster26.push(
      spec('AY2026', child, 'YS', 'New', 'enrolled', {
        section: ysSection,
        ysSubmittedFlip: k < COUNTS.ay2026YsFlipped,
        protected: true,
      })
    );
  }
  const testSection = sections.find(
    (s) => s.ay === 'AY2026' && s.name === 'Test Section'
  );
  if (testSection) {
    for (let k = 0; k < COUNTS.ay2026TestSection; k++) {
      const child = makeChild(`ay2026:test:${k}`, 'AY2026', 'P1', 'H26');
      roster26.push(
        spec('AY2026', child, 'P1', 'New', 'enrolled', {
          section: testSection,
          protected: true,
        })
      );
    }
  }
  // Late enrollees: all Term 3, all new children (production: 21 of 21 in T3).
  const t3 = termOf('AY2026', 3);
  // A first day is a school day (the registrar enters a real date).
  const t3Days = teachingDays.AY2026.filter(
    (d) => d >= t3.start && d <= addDays(t3.start, 46)
  );
  if (t3Days.length === 0) throw new Error('No AY2026 T3 school days');
  const lateable26 = r26.shuffle(
    roster26.filter(
      (a) =>
        a.category === 'New' &&
        a.level !== 'YS' &&
        a.section?.name !== 'Test Section'
    )
  );
  for (let i = 0; i < COUNTS.ay2026Late; i++) {
    lateable26[i].late = {
      term: 3,
      date: r26.pick(t3Days),
    };
    lateable26[i].protected = true;
  }
  // The transfer: a returning P3 child in Courageous, moved to Responsibility.
  const transfer = roster26.find(
    (a) => a.level === 'P3' && a.section?.name === 'Courageous' && !a.late
  );
  if (!transfer) throw new Error('No P3 Courageous child to transfer');
  transfer.protected = true;

  // AY2026 applicants who never joined: AY2025 leavers re-applying, brand-new
  // families, the VizSchool four, two children whose class was preset in
  // Directus while still Submitted, and two half-filled portal rows.
  const nonEnrolled26: AppSpec[] = [];
  const leaverPool = r26.shuffle(
    leavers25.filter((a) => !a.withdraw && a.level !== 'S4')
  );
  let lp = 0;
  const reapply = (outcome: Outcome, n: number) => {
    for (let i = 0; i < n; i++) {
      const prev = leaverPool[lp++];
      if (!prev) return;
      const level = nextLevel(prev.level as LevelCode)!;
      nonEnrolled26.push(spec('AY2026', prev.child, level, 'Current', outcome));
    }
  };
  reapply('cancelled', 10);
  reapply('withdrawn_pre', 10);
  reapply('submitted', 8);
  for (let i = 0; i < 6; i++) {
    const level = pickFrom(r26, AY2025_LEVEL_WEIGHTS);
    const child = makeChild(`ay2026:app:${i}`, 'AY2026', level, 'H26');
    nonEnrolled26.push(
      spec(
        'AY2026',
        child,
        level,
        'New',
        pickFrom(r26, [
          ['submitted', 3],
          ['cancelled', 2],
          ['withdrawn_pre', 1],
        ] as Distribution<Outcome>)
      )
    );
  }
  for (let i = 0; i < 4; i++) {
    const level = pickFrom(r26, AY2025_LEVEL_WEIGHTS);
    const child = makeChild(`ay2026:viz:${i}`, 'AY2026', level, 'V26');
    nonEnrolled26.push(
      spec(
        'AY2026',
        child,
        level,
        'VizSchool Current',
        i === 3 ? 'withdrawn_pre' : 'submitted'
      )
    );
  }
  for (let i = 0; i < 2; i++) {
    const level: LevelCode = i === 0 ? 'P2' : 'S1';
    const child = makeChild(`ay2026:preset:${i}`, 'AY2026', level, 'H26');
    nonEnrolled26.push(
      spec('AY2026', child, level, 'New', 'submitted', {
        presetSection: sectionsOf('AY2026', level)[0],
      })
    );
  }
  // Two half-written portal rows with no enrolee or student number (production: 2).
  for (let i = 0; i < 2; i++) {
    const child = makeChild(`ay2026:blank:${i}`, 'AY2026', 'P1', 'H26');
    nonEnrolled26.push(
      spec('AY2026', child, 'P1', 'New', 'submitted', {
        hasStatus: false,
        hasDocs: false,
        blankKeys: true,
      })
    );
  }
  // Three Submitted rows whose status row has not been created yet.
  for (let i = 0; i < 3; i++) {
    const level = pickFrom(r26, AY2025_LEVEL_WEIGHTS);
    const child = makeChild(`ay2026:nostatus:${i}`, 'AY2026', level, 'H26');
    nonEnrolled26.push(
      spec('AY2026', child, level, 'New', 'submitted', { hasStatus: false })
    );
  }

  // ── AY2027 ────────────────────────────────────────────────────────────
  const r27 = rng('people:ay2027');
  const stayers = r27.shuffle(
    roster26.filter(
      (a) =>
        a.level !== 'S4' &&
        a.level !== 'YS' &&
        a.section?.name !== 'Test Section' &&
        !a.late &&
        a !== transfer
    )
  );
  const sec27 = (level: LevelCode) => {
    const s = sections.find((x) => x.ay === 'AY2027' && x.level === level);
    if (!s) throw new Error(`No AY2027 ${level} section`);
    return s;
  };
  const used27 = new Set<string>();
  const takeStayer = (fromLevel: LevelCode) => {
    const a = stayers.find(
      (x) => x.level === fromLevel && !used27.has(x.child.key)
    );
    if (!a) throw new Error(`No AY2026 ${fromLevel} child for AY2027`);
    used27.add(a.child.key);
    a.protected = true;
    return a;
  };
  // Two returning children placed (AY2026 P2 → P3, P4 → P5) …
  for (const [from, to] of [
    ['P2', 'P3'],
    ['P4', 'P5'],
  ] as Array<[LevelCode, LevelCode]>) {
    const prev = takeStayer(from);
    spec('AY2027', prev.child, to, 'Current', 'enrolled', {
      section: sec27(to),
    });
  }
  // … one Enrolled whose admissions row names no class yet …
  {
    const prev = takeStayer('P6');
    spec('AY2027', prev.child, 'S1', 'Current', 'enrolled_unplaced');
  }
  // … and 22 more returning, still Submitted.
  for (const prev of stayers) {
    if (apps.AY2027.filter((a) => a.category === 'Current').length >= 25) break;
    if (used27.has(prev.child.key)) continue;
    used27.add(prev.child.key);
    prev.protected = true;
    spec(
      'AY2027',
      prev.child,
      nextLevel(prev.level as LevelCode)!,
      'Current',
      'submitted'
    );
  }
  // Five new families: two placed (P1, S1), three Submitted.
  for (const level of ['P1', 'S1'] as LevelCode[]) {
    const child = makeChild(`ay2027:new:${level}`, 'AY2027', level, 'H27');
    spec('AY2027', child, level, 'New', 'enrolled', { section: sec27(level) });
  }
  for (let i = 0; i < 3; i++) {
    const level = pickFrom(r27, AY2025_LEVEL_WEIGHTS);
    const child = makeChild(`ay2027:new:sub:${i}`, 'AY2027', level, 'H27');
    spec('AY2027', child, level, 'New', 'submitted');
  }
  // Production's one AY2027 status row with no application and nothing in it.
  {
    const child = makeChild('ay2027:stray', 'AY2027', 'P1', 'H27');
    spec('AY2027', child, 'P1', 'Current', 'status_only', { hasDocs: false });
  }

  // ── Dates and enrolee numbers ─────────────────────────────────────────
  for (const ay of AYS) {
    const r = rng(`people:dates:${ay}`);
    for (const a of apps[ay]) a.createdAt = stampOn(r, applicationDay(r, a));
    // The portal numbers applications in arrival order: E + YY + 4 digits.
    apps[ay].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    apps[ay].forEach((a, i) => {
      a.enroleeNumber = `E${yy(ay)}${pad(i + 1, 4)}`;
    });
  }

  // ── Student numbers: the school's rule ────────────────────────────────
  // New → the child's first enrolee number with E swapped for H
  // (E260516 → H260516). Current → the number the child already had, REUSED
  // every year — that reuse is the cross-year key. So a child's number is
  // fixed by its FIRST application: New there means E→H of that one; Current
  // there means a number from before AY2025 (the H19–H24 series makeChild
  // drew). Youngstarters follow the rule too: their `Y` class-list numbers
  // are the school's own and go in `school_student_number` (migration 169).
  const firstApp = new Map<Child, AppSpec>();
  for (const ay of AYS)
    for (const a of apps[ay])
      if (!firstApp.has(a.child)) firstApp.set(a.child, a);
  for (const [child, a] of firstApp) {
    if (a.category !== 'New' || a.blankKeys) continue;
    child.studentNumber = `H${a.enroleeNumber.slice(1)}`;
    child.appStudentNumber = child.studentNumber;
  }

  // ── Student-number quirks production has — Current / legacy only ──────
  // The trailing space and the 8-character number go on children whose
  // FIRST application was Current (so no E→H number is disturbed) and who
  // first join a class in AY2026 — the AY2025 applicants who came back — and
  // do not go on to AY2027. (A trailing space on an application whose child
  // already has a students row would make syncOneStudent miss the row — it
  // looks the student up by the UNtrimmed number — and fail on the unique key.)
  const quirkPool = roster26.filter(
    (a) =>
      a.category === 'Current' &&
      !a.late &&
      !a.protected &&
      !used27.has(a.child.key) &&
      firstApp.get(a.child)?.ay === 'AY2025' &&
      firstApp.get(a.child)?.category === 'Current' &&
      [...comebackUsed].some((x) => x.child === a.child)
  );
  if (quirkPool.length < 2) throw new Error('No comeback children for quirks');
  // One application number with production's trailing space (the sync trims
  // it, so students.student_number does not carry it).
  const spaced = quirkPool[0];
  spaced.child.appStudentNumber = `${spaced.child.studentNumber} `;
  // One 8-character number (production has exactly one).
  const longOne = quirkPool[1];
  longOne.child.studentNumber = `${longOne.child.studentNumber}7`;
  longOne.child.appStudentNumber = longOne.child.studentNumber;
  // A few older `Y` numbers that admissions holds too (production: 10) — on
  // AY2025 Current children who return, so the number threads both years.
  const yPool = r25.shuffle(
    returners.filter(
      (a) => a.category === 'Current' && firstApp.get(a.child) === a
    )
  );
  for (const a of yPool.slice(0, COUNTS.yNumbered)) {
    a.child.studentNumber = nextNumber(`Y${r25.pick(['19', '20', '21'])}`);
    a.child.appStudentNumber = a.child.studentNumber;
  }

  // ── Legacy students: no class row, no application (production: 237 / 198) ─
  const rOrph = rng('people:orphans');
  const orphans: Orphan[] = [];
  for (let i = 0; i < COUNTS.orphans; i++) {
    const n = names.next();
    // Production: 98 students carry a 12-character number from the old
    // system — about half the legacy students — and one old `Y` number here.
    const studentNumber =
      i < 50
        ? `H${rOrph.pick(['2019', '2020', '2021', '2022'])}${pad(rOrph.int(0, 9999999), 7)}`
        : i === 60
          ? nextNumber('Y20')
          : nextNumber(`H${rOrph.pick(['21', '22', '23', '24'])}`);
    orphans.push({
      studentNumber,
      first: n.first,
      // Production: the legacy students carry nearly all the blank middle names.
      middle: rOrph.chance(0.03) ? n.middle : null,
      last: n.last,
      isActive: i !== 3,
    });
  }

  // ── Deliberate duplicate names (production: 55 pairs) ─────────────────
  const placed = children.filter((c) => c.placed);
  const dupPairs: Array<[Child, Child]> = [
    [placed[3], placed[150]],
    [placed[40], placed[260]],
    [placed[90], placed[200]],
  ];
  for (const [a, b] of dupPairs) {
    b.first = a.first;
    b.last = a.last;
  }

  return {
    children,
    apps,
    orphans,
    duplicateNamePairs: dupPairs.map(([a, b]) => [a.key, b.key]),
    transferKey: transfer.child.key,
  };
}

/** The day an application arrived, per AY and outcome (production ranges). */
function applicationDay(r: Rng, a: AppSpec): string {
  if (a.late) return addDays(a.late.date, -r.int(3, 14));
  switch (a.ay) {
    case 'AY2025':
      if (a.outcome === 'legacy_app_only' && r.chance(0.2))
        return dateBetween(r, '2025-01-15', '2025-12-29');
      return a.category === 'New'
        ? dateBetween(r, '2024-08-01', '2024-12-20')
        : dateBetween(r, '2024-06-18', '2024-11-30');
    case 'AY2026':
      if (r.chance(0.04)) return dateBetween(r, '2026-01-05', '2026-10-01');
      return a.category === 'New'
        ? dateBetween(r, '2025-07-01', '2025-12-15')
        : dateBetween(r, '2025-06-18', '2025-10-31');
    case 'AY2027': {
      // Production: Mar 6, Apr 5, May 5, Jun 5, Jul 197, Aug 54, Sep 33, Oct 4.
      const month = pickFrom(r, [
        ['03', 6],
        ['04', 5],
        ['05', 5],
        ['06', 5],
        ['07', 197],
        ['08', 54],
        ['09', 33],
        ['10', 4],
      ] as Distribution<string>);
      const last = month === '10' ? 4 : 28;
      return `2026-${month}-${pad(r.int(month === '03' ? 25 : 1, last), 2)}`;
    }
  }
}
