// Canonical fixture data for the Test environment seeder. Mirrors the
// shape of `supabase/seed.sql` (levels, subjects, sections, subject_configs)
// and extends with term dates + virtue themes + grading-lock dates +
// school-calendar holidays so switch-to-Test yields a fully usable school
// without depending on anything in production.
//
// Term dates + calendar entries are based on HFSE's actual AY 2026 calendar.
// All constants are TS-only; nothing here references the DB. The structural
// seeder reads these and upserts against Supabase.

import type {
  DayType,
  EventCategory,
  Audience,
} from '@/lib/schemas/attendance';
import type { Schedule } from '@/lib/schemas/section';

// sort_order + is_core mirror migration 078's canonical order + core-band
// backfill (lib/sis/levels.ts LEVEL_CODES order; P1-P6/S1-S4 = core). The
// structural seeder's upsert uses `ignoreDuplicates: true` against the
// shared, already-migrated project, so these two fields are normally masked
// on conflict — kept correct anyway so the fixture is right on a genuinely
// fresh install and doesn't silently drift from the real schema. Trimmed to
// the fixed 10-row catalog by migration 086 (KD #153) — the volatile
// Youngstarters preschool tiers + Cambridge Secondary levels (and the
// per-AY offered/shelved concept) were removed outright; is_core is
// trivially true for every row now.
export type LevelSeed = {
  code: string;
  label: string;
  level_type: 'primary' | 'secondary';
  sort_order: number;
  is_core: boolean;
};

export const LEVELS: LevelSeed[] = [
  {
    code: 'P1',
    label: 'Primary One',
    level_type: 'primary',
    sort_order: 1,
    is_core: true,
  },
  {
    code: 'P2',
    label: 'Primary Two',
    level_type: 'primary',
    sort_order: 2,
    is_core: true,
  },
  {
    code: 'P3',
    label: 'Primary Three',
    level_type: 'primary',
    sort_order: 3,
    is_core: true,
  },
  {
    code: 'P4',
    label: 'Primary Four',
    level_type: 'primary',
    sort_order: 4,
    is_core: true,
  },
  {
    code: 'P5',
    label: 'Primary Five',
    level_type: 'primary',
    sort_order: 5,
    is_core: true,
  },
  {
    code: 'P6',
    label: 'Primary Six',
    level_type: 'primary',
    sort_order: 6,
    is_core: true,
  },
  {
    code: 'S1',
    label: 'Secondary One',
    level_type: 'secondary',
    sort_order: 7,
    is_core: true,
  },
  {
    code: 'S2',
    label: 'Secondary Two',
    level_type: 'secondary',
    sort_order: 8,
    is_core: true,
  },
  {
    code: 'S3',
    label: 'Secondary Three',
    level_type: 'secondary',
    sort_order: 9,
    is_core: true,
  },
  {
    code: 'S4',
    label: 'Secondary Four',
    level_type: 'secondary',
    sort_order: 10,
    is_core: true,
  },
];

export type SubjectSeed = {
  code: string;
  name: string;
  is_examinable: boolean;
  level_type: 'primary' | 'secondary';
  /**
   * Optional: restricts subject_level_offerings to only these level CODES
   * within the matching level_type — e.g. Mandarin is Primary but only
   * P1–P5, not the full P1–P6 (migration 081's resolved-data table; this
   * seeder always targets a "current" test AY, so it uses the
   * AY2026-onward P1–P5 range, not the older P1–P4-only range). Omitted
   * for every pre-081 entry — unchanged behaviour (every level whose
   * level_type matches gets an offering row).
   */
  levelCodes?: string[];
  /**
   * Optional: true for subjects that exist in the catalog + fan into
   * another subject's report-card column via subject_report_map, but never
   * get their own subject_configs / subject_level_offerings rows — e.g.
   * Mother Tongue post-081 (Filipino/Mandarin carry the real scores now).
   * When true, the structural seeder inserts the `subjects` catalog row
   * only; no config/offering rows are generated for it.
   */
  reportOnly?: boolean;
};

export const SUBJECTS: SubjectSeed[] = [
  // Primary
  { code: 'ENG', name: 'English', is_examinable: true, level_type: 'primary' },
  {
    code: 'MATH',
    name: 'Mathematics',
    is_examinable: true,
    level_type: 'primary',
  },
  // Mother Tongue is report-only as of migration 081 — Filipino/Mandarin
  // (below) carry the real per-student scores and fan into this subject's
  // report-card column via subject_report_map. Kept in the catalog (name
  // + is_examinable) so it can still be a subject_report_map target.
  {
    code: 'MT',
    name: 'Mother Tongue',
    is_examinable: true,
    level_type: 'primary',
    reportOnly: true,
  },
  {
    code: 'FIL',
    name: 'Filipino',
    is_examinable: true,
    level_type: 'primary',
  },
  {
    code: 'FIL',
    name: 'Filipino',
    is_examinable: true,
    level_type: 'secondary',
  },
  {
    code: 'MANDARIN',
    name: 'Mandarin',
    is_examinable: true,
    level_type: 'primary',
    levelCodes: ['P1', 'P2', 'P3', 'P4', 'P5'],
  },
  { code: 'SCI', name: 'Science', is_examinable: true, level_type: 'primary' },
  {
    code: 'SS',
    name: 'Social Studies',
    is_examinable: true,
    level_type: 'primary',
  },
  // MAPEH replaces MUSIC/ARTS/PE/HE (migration 081) — one combined,
  // numeric-graded subject (20/60/20 via MAPEH_FAMILY_CODES below), not 4
  // independent letter-graded ones.
  {
    code: 'MAPEH',
    name: 'MAPEH',
    is_examinable: true,
    level_type: 'primary',
  },
  {
    code: 'CL',
    name: 'Christian Living',
    is_examinable: true,
    level_type: 'primary',
  },
  // Secondary
  {
    code: 'HIST',
    name: 'History',
    is_examinable: true,
    level_type: 'secondary',
  },
  {
    code: 'LIT',
    name: 'Literature',
    is_examinable: true,
    level_type: 'secondary',
  },
  {
    code: 'HUM',
    name: 'Humanities',
    is_examinable: true,
    level_type: 'secondary',
  },
  {
    code: 'ECON',
    name: 'Economics',
    is_examinable: true,
    level_type: 'secondary',
  },
  {
    code: 'CA',
    name: 'Contemporary Art',
    is_examinable: true,
    level_type: 'secondary',
  },
  {
    code: 'PEH',
    name: 'Physical Education and Health',
    is_examinable: true,
    level_type: 'secondary',
  },
  {
    code: 'PMPD',
    name: 'Pastoral Ministry and Personal Development',
    is_examinable: true,
    level_type: 'secondary',
  },
  {
    code: 'CCA',
    name: 'Co-curricular Activities',
    is_examinable: false,
    level_type: 'secondary',
  },
];

// Known-correct WW/PT/QA weight per subject CODE now lives in
// lib/sis/subjects/weight-defaults.ts (weightBucketForSubjectCode) — that
// module is also the Subject Setup page's create-mode default-weight
// source (promoted out of here so the seeder's verified data and the real
// admin UI can never drift). See that file's header for the full DepEd
// Order No. 8 s.2015 bucket rationale.

export type SectionSeed = {
  level_code: string;
  name: string;
  schedule: Schedule;
};

// HFSE's official virtue sections + schedules (mirrors migration 074's template
// reset, so the test environment reflects the real per-level section list).
// Name = the virtue only (level is the FK; schedule its own field). YS omitted —
// the Faith/Love tier+schedule mapping is unconfirmed (deferred, KD #144).
export const SECTIONS: SectionSeed[] = [
  { level_code: 'P1', name: 'Obedience', schedule: 'morning' },
  { level_code: 'P1', name: 'Patience', schedule: 'morning' },
  { level_code: 'P1', name: 'Respect', schedule: 'afternoon' },
  { level_code: 'P2', name: 'Honesty', schedule: 'morning' },
  { level_code: 'P2', name: 'Humility', schedule: 'morning' },
  { level_code: 'P2', name: 'Gentleness', schedule: 'afternoon' },
  { level_code: 'P3', name: 'Courageous', schedule: 'morning' },
  { level_code: 'P3', name: 'Courtesy', schedule: 'morning' },
  { level_code: 'P3', name: 'Responsibility', schedule: 'afternoon' },
  { level_code: 'P4', name: 'Diligence', schedule: 'morning' },
  { level_code: 'P4', name: 'Trust', schedule: 'morning' },
  { level_code: 'P4', name: 'Compassion', schedule: 'afternoon' },
  { level_code: 'P5', name: 'Commitment', schedule: 'morning' },
  { level_code: 'P5', name: 'Tenacity', schedule: 'morning' },
  { level_code: 'P5', name: 'Perseverance', schedule: 'afternoon' },
  { level_code: 'P6', name: 'Grit', schedule: 'morning' },
  { level_code: 'P6', name: 'Loyalty', schedule: 'afternoon' },
  { level_code: 'S1', name: 'Discipline', schedule: 'whole_day' },
  { level_code: 'S2', name: 'Integrity', schedule: 'whole_day' },
  { level_code: 'S3', name: 'Consistency', schedule: 'whole_day' },
  { level_code: 'S4', name: 'Excellence', schedule: 'whole_day' },
];

// Term templates mirroring HFSE's actual AY 2026 academic calendar (KD #13:
// HFSE AY runs January through November of a single calendar year). The
// year is parameterised so AY9999 and AY9998 get the same term shape.
// Registrar can re-edit dates via /sis/ay-setup → Dates.
export type TermTemplate = {
  term_number: 1 | 2 | 3 | 4;
  start_date: string; // ISO yyyy-MM-dd
  end_date: string;
  virtue_theme: string | null;
  grading_lock_date: string;
};

/**
 * Builds the four-term calendar for `targetYear`. Mirrors HFSE's AY 2026
 * term structure:
 *   T1: Jan 8 – Mar 13   (term break Mar 14–22)
 *   T2: Mar 24 – May 29  (term break May 30 – Jun 28)
 *   T3: Jun 29 – Sep 6   (term break Sep 7–13)
 *   T4: Sep 14 – Nov 21
 */
export function buildTermTemplates(targetYear: number): TermTemplate[] {
  const y = String(targetYear);
  return [
    {
      term_number: 1,
      start_date: `${y}-01-08`,
      end_date: `${y}-03-13`,
      virtue_theme: 'Faith',
      grading_lock_date: `${y}-03-09`,
    },
    {
      term_number: 2,
      start_date: `${y}-03-24`,
      end_date: `${y}-05-29`,
      virtue_theme: 'Hope',
      grading_lock_date: `${y}-05-25`,
    },
    {
      term_number: 3,
      start_date: `${y}-06-29`,
      end_date: `${y}-09-06`,
      virtue_theme: 'Love',
      grading_lock_date: `${y}-09-02`,
    },
    // T4 has no FCA comment per KD #49 — virtue_theme left null.
    {
      term_number: 4,
      start_date: `${y}-09-14`,
      end_date: `${y}-11-21`,
      virtue_theme: null,
      grading_lock_date: `${y}-11-17`,
    },
  ];
}

/** Backwards-compat alias — points at current calendar year. Existing callers keep working. */
// fallow-ignore-next-line unused-export
export const TERM_TEMPLATES: TermTemplate[] = buildTermTemplates(
  new Date().getFullYear()
);

// School calendar entries based on HFSE's AY 2026 official calendar.
// Only includes dates that fall within the term windows defined above —
// public/school holidays that fall during term breaks are omitted because
// school_calendar rows are per-term.
//
// `hblOverlay` (migration 051): when true, a school_holiday day is also an
// HBL day — teachers deliver home-based learning while students have no class.
// Applies to Marking Days and Awards Deliberation Day per HFSE's published
// calendar (which shows both labels on those cells).
export type CannedCalendarEntry = {
  date: string; // ISO yyyy-MM-dd
  day_type: DayType;
  label: string;
  hblOverlay?: boolean; // only meaningful when day_type='school_holiday'
};

/**
 * Public holidays + school holidays + HBL days based on HFSE's AY 2026
 * calendar, parameterised by `targetYear`. Only dates that fall within
 * the four term windows are included.
 *
 * HBL-overlay holidays (Marking Days + Awards Deliberation) have
 * `hblOverlay: true` — they are school_holiday for students but encodable
 * as attendance for teachers (Path B, migration 051).
 */
export function buildCannedCalendar(targetYear: number): CannedCalendarEntry[] {
  const y = String(targetYear);
  return [
    // ── T1 (Jan 8 – Mar 13) ────────────────────────────────────────────
    {
      date: `${y}-02-17`,
      day_type: 'public_holiday',
      label: 'Chinese New Year (Day 1)',
    },
    {
      date: `${y}-02-18`,
      day_type: 'public_holiday',
      label: 'Chinese New Year (Day 2)',
    },
    { date: `${y}-02-20`, day_type: 'hbl', label: 'Homebased Learning (HBL)' },
    {
      date: `${y}-03-06`,
      day_type: 'school_holiday',
      label: 'Term 1 Marking Day',
      hblOverlay: true,
    },

    // ── T2 (Mar 24 – May 29) ───────────────────────────────────────────
    // Hari Raya Puasa (Mar 21) and its In Lieu (Mar 23) fall in the
    // term break (Mar 14–22) — not within any term, so omitted here.
    { date: `${y}-04-03`, day_type: 'public_holiday', label: 'Good Friday' },
    {
      date: `${y}-04-10`,
      day_type: 'school_holiday',
      label: 'Staff Development Day',
    },
    { date: `${y}-05-01`, day_type: 'public_holiday', label: 'Labour Day' },
    {
      date: `${y}-05-22`,
      day_type: 'school_holiday',
      label: 'Term 2 Marking Day',
      hblOverlay: true,
    },
    {
      date: `${y}-05-25`,
      day_type: 'school_holiday',
      label: 'In-Lieu of Family Sportsfest',
    },

    // ── T3 (Jun 29 – Sep 6) ────────────────────────────────────────────
    // Vesak Day (May 31) + In Lieu (Jun 1) fall in the break — omitted.
    { date: `${y}-07-05`, day_type: 'public_holiday', label: 'Youth Day' },
    {
      date: `${y}-07-06`,
      day_type: 'public_holiday',
      label: 'In Lieu of Youth Day',
    },
    { date: `${y}-07-08`, day_type: 'hbl', label: 'Homebased Learning (HBL)' },
    { date: `${y}-07-17`, day_type: 'hbl', label: 'Homebased Learning (HBL)' },
    {
      date: `${y}-07-24`,
      day_type: 'school_holiday',
      label: 'Staff Development Day',
    },
    { date: `${y}-08-09`, day_type: 'public_holiday', label: 'National Day' },
    {
      date: `${y}-08-10`,
      day_type: 'public_holiday',
      label: 'In Lieu of National Day',
    },
    {
      date: `${y}-08-28`,
      day_type: 'school_holiday',
      label: 'Term 3 Marking Day',
      hblOverlay: true,
    },
    { date: `${y}-09-04`, day_type: 'public_holiday', label: "Teacher's Day" },

    // ── T4 (Sep 14 – Nov 21) ───────────────────────────────────────────
    { date: `${y}-10-02`, day_type: 'public_holiday', label: "Children's Day" },
    {
      date: `${y}-10-23`,
      day_type: 'school_holiday',
      label: 'Term 4 Marking Day',
      hblOverlay: true,
    },
    {
      date: `${y}-11-06`,
      day_type: 'school_holiday',
      label: 'Awards Deliberation Day',
      hblOverlay: true,
    },
    { date: `${y}-11-08`, day_type: 'public_holiday', label: 'Deepavali' },
    {
      date: `${y}-11-09`,
      day_type: 'public_holiday',
      label: 'In Lieu of Deepavali',
    },
  ];
}

// Calendar events (informational overlay on the calendar grid). Mirrors the
// events section of HFSE's AY 2026 calendar. Each event is placed within
// the term that contains its start_date.
export type CannedEvent = {
  start_date: string;
  end_date: string;
  label: string;
  category: EventCategory;
  audience: Audience;
};

export function buildCannedEvents(targetYear: number): CannedEvent[] {
  const y = String(targetYear);
  return [
    // ── T1 events ──────────────────────────────────────────────────────
    {
      start_date: `${y}-01-08`,
      end_date: `${y}-01-08`,
      label: 'Start of 11th Academic Year',
      category: 'start_of_term',
      audience: 'all',
    },
    {
      start_date: `${y}-02-02`,
      end_date: `${y}-02-06`,
      label: 'Mathematics Week',
      category: 'subject_week',
      audience: 'all',
    },
    {
      start_date: `${y}-02-25`,
      end_date: `${y}-02-27`,
      label: 'Secondary School Term 1 Exam',
      category: 'term_exam',
      audience: 'secondary',
    },
    {
      start_date: `${y}-03-02`,
      end_date: `${y}-03-05`,
      label: 'Secondary School Term 1 Exam',
      category: 'term_exam',
      audience: 'secondary',
    },
    {
      start_date: `${y}-03-04`,
      end_date: `${y}-03-05`,
      label: 'Primary School Term 1 Exam',
      category: 'term_exam',
      audience: 'primary',
    },

    // ── T2 events ──────────────────────────────────────────────────────
    {
      start_date: `${y}-03-24`,
      end_date: `${y}-03-24`,
      label: 'Start of Term 2',
      category: 'start_of_term',
      audience: 'all',
    },
    {
      start_date: `${y}-04-08`,
      end_date: `${y}-04-09`,
      label: 'General PTC (Online)',
      category: 'ptc',
      audience: 'all',
    },
    {
      start_date: `${y}-04-13`,
      end_date: `${y}-04-17`,
      label: 'English Week',
      category: 'subject_week',
      audience: 'all',
    },
    {
      start_date: `${y}-04-27`,
      end_date: `${y}-04-30`,
      label: 'Science Week',
      category: 'subject_week',
      audience: 'all',
    },
    {
      start_date: `${y}-05-13`,
      end_date: `${y}-05-15`,
      label: 'Secondary School Term 2 Exam',
      category: 'term_exam',
      audience: 'secondary',
    },
    {
      start_date: `${y}-05-20`,
      end_date: `${y}-05-21`,
      label: 'Primary School Term 2 Exam',
      category: 'term_exam',
      audience: 'primary',
    },

    // ── T3 events ──────────────────────────────────────────────────────
    {
      start_date: `${y}-06-29`,
      end_date: `${y}-06-29`,
      label: 'Start of Term 3',
      category: 'start_of_term',
      audience: 'all',
    },
    {
      start_date: `${y}-07-27`,
      end_date: `${y}-07-31`,
      label: 'STAR Week',
      category: 'subject_week',
      audience: 'all',
    },
    {
      start_date: `${y}-08-10`,
      end_date: `${y}-08-14`,
      label: 'Mother Tongue Week',
      category: 'subject_week',
      audience: 'all',
    },
    {
      start_date: `${y}-08-18`,
      end_date: `${y}-08-21`,
      label: 'Secondary School Term 3 Exam',
      category: 'term_exam',
      audience: 'secondary',
    },
    {
      start_date: `${y}-08-26`,
      end_date: `${y}-08-27`,
      label: 'Primary School Term 3 Exam',
      category: 'term_exam',
      audience: 'primary',
    },

    // ── T4 events ──────────────────────────────────────────────────────
    {
      start_date: `${y}-09-14`,
      end_date: `${y}-09-14`,
      label: 'Start of Term 4',
      category: 'start_of_term',
      audience: 'all',
    },
    {
      start_date: `${y}-10-14`,
      end_date: `${y}-10-16`,
      label: 'Secondary School Term 4 Exam',
      category: 'term_exam',
      audience: 'secondary',
    },
    {
      start_date: `${y}-10-19`,
      end_date: `${y}-10-22`,
      label: 'Secondary School Term 4 Final Exam',
      category: 'term_exam',
      audience: 'secondary',
    },
    {
      start_date: `${y}-10-21`,
      end_date: `${y}-10-22`,
      label: 'Primary School Term 4 Exam',
      category: 'term_exam',
      audience: 'primary',
    },
    {
      start_date: `${y}-11-04`,
      end_date: `${y}-11-05`,
      label: 'General PTC (Online)',
      category: 'ptc',
      audience: 'all',
    },
  ];
}

// School config defaults. Only applied if the singleton row has empty
// strings — never overwrites registrar-edited values.
export const SCHOOL_CONFIG_DEFAULTS = {
  principal_name: 'Test Principal',
  ceo_name: 'Test CEO',
  pei_registration_number: 'AY9999-TEST',
  default_publish_window_days: 30,
} as const;
