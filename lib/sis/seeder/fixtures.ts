// Canonical fixture data for the Test environment seeder. Mirrors the
// shape of `supabase/seed.sql` (levels, subjects, sections, subject_configs)
// and extends with term dates + virtue themes + grading-lock dates +
// synthetic school-calendar holidays so switch-to-Test yields a fully
// usable school without depending on anything in production.
//
// All constants are TS-only; nothing here references the DB. The structural
// seeder reads these and upserts against Supabase.

import type { DayType } from '@/lib/schemas/attendance';

export type LevelSeed = {
  code: string;
  label: string;
  level_type: 'primary' | 'secondary' | 'preschool';
};

export const LEVELS: LevelSeed[] = [
  { code: 'YS-L', label: 'Youngstarters | Little Stars',     level_type: 'preschool' },
  { code: 'YS-J', label: 'Youngstarters | Junior Stars',     level_type: 'preschool' },
  { code: 'YS-S', label: 'Youngstarters | Senior Stars',     level_type: 'preschool' },
  { code: 'P1',   label: 'Primary One',                       level_type: 'primary'   },
  { code: 'P2',   label: 'Primary Two',                       level_type: 'primary'   },
  { code: 'P3',   label: 'Primary Three',                     level_type: 'primary'   },
  { code: 'P4',   label: 'Primary Four',                      level_type: 'primary'   },
  { code: 'P5',   label: 'Primary Five',                      level_type: 'primary'   },
  { code: 'P6',   label: 'Primary Six',                       level_type: 'primary'   },
  { code: 'S1',   label: 'Secondary One',                     level_type: 'secondary' },
  { code: 'S2',   label: 'Secondary Two',                     level_type: 'secondary' },
  { code: 'S3',   label: 'Secondary Three',                   level_type: 'secondary' },
  { code: 'S4',   label: 'Secondary Four',                    level_type: 'secondary' },
  { code: 'CS1',  label: 'Cambridge Secondary One (Year 8)',  level_type: 'secondary' },
  { code: 'CS2',  label: 'Cambridge Secondary Two (Year 9)',  level_type: 'secondary' },
];

export type SubjectSeed = {
  code: string;
  name: string;
  is_examinable: boolean;
  level_type: 'primary' | 'secondary';
};

export const SUBJECTS: SubjectSeed[] = [
  // Primary
  { code: 'ENG', name: 'English', is_examinable: true, level_type: 'primary' },
  { code: 'MATH', name: 'Mathematics', is_examinable: true, level_type: 'primary' },
  { code: 'MT', name: 'Mother Tongue', is_examinable: true, level_type: 'primary' },
  { code: 'SCI', name: 'Science', is_examinable: true, level_type: 'primary' },
  { code: 'SS', name: 'Social Studies', is_examinable: true, level_type: 'primary' },
  { code: 'MUSIC', name: 'Music Education', is_examinable: true, level_type: 'primary' },
  { code: 'ARTS', name: 'Arts Education', is_examinable: true, level_type: 'primary' },
  { code: 'PE', name: 'Physical Education', is_examinable: true, level_type: 'primary' },
  { code: 'HE', name: 'Health Education', is_examinable: true, level_type: 'primary' },
  { code: 'CL', name: 'Christian Living', is_examinable: true, level_type: 'primary' },
  // Secondary
  { code: 'HIST', name: 'History', is_examinable: true, level_type: 'secondary' },
  { code: 'LIT', name: 'Literature', is_examinable: true, level_type: 'secondary' },
  { code: 'HUM', name: 'Humanities', is_examinable: true, level_type: 'secondary' },
  { code: 'ECON', name: 'Economics', is_examinable: true, level_type: 'secondary' },
  { code: 'CA', name: 'Contemporary Art', is_examinable: true, level_type: 'secondary' },
  { code: 'PEH', name: 'Physical Education and Health', is_examinable: true, level_type: 'secondary' },
  { code: 'PMPD', name: 'Pastoral Ministry and Personal Development', is_examinable: true, level_type: 'secondary' },
  { code: 'CCA', name: 'Co-curricular Activities', is_examinable: false, level_type: 'secondary' },
];

export type SectionSeed = { level_code: string; name: string };

export const SECTIONS: SectionSeed[] = [
  { level_code: 'P1', name: 'Patience' },
  { level_code: 'P1', name: 'Obedience' },
  { level_code: 'P2', name: 'Honesty' },
  { level_code: 'P2', name: 'Humility' },
  { level_code: 'P3', name: 'Courtesy' },
  { level_code: 'P3', name: 'Courageous' },
  { level_code: 'P3', name: 'Responsibility' },
  { level_code: 'P4', name: 'Diligence' },
  { level_code: 'P4', name: 'Trust' },
  { level_code: 'P5', name: 'Commitment' },
  { level_code: 'P5', name: 'Perseverance' },
  { level_code: 'P5', name: 'Tenacity' },
  { level_code: 'P6', name: 'Grit' },
  { level_code: 'P6', name: 'Loyalty' },
  { level_code: 'S1', name: 'Discipline 1' },
  { level_code: 'S1', name: 'Discipline 2' },
  { level_code: 'S2', name: 'Integrity 1' },
  { level_code: 'S2', name: 'Integrity 2' },
  { level_code: 'S3', name: 'Consistency' },
  { level_code: 'S4', name: 'Excellence' },
];

// Term templates pinned to the AY9999 academic calendar. Registrar can
// re-edit via /sis/ay-setup → Dates.
export type TermTemplate = {
  term_number: 1 | 2 | 3 | 4;
  start_date: string;  // ISO
  end_date: string;
  virtue_theme: string | null;
  grading_lock_date: string;
};

export const TERM_TEMPLATES: TermTemplate[] = [
  { term_number: 1, start_date: '2026-08-03', end_date: '2026-10-30', virtue_theme: 'Faith',  grading_lock_date: '2026-10-26' },
  { term_number: 2, start_date: '2026-11-02', end_date: '2027-01-29', virtue_theme: 'Hope',   grading_lock_date: '2027-01-25' },
  { term_number: 3, start_date: '2027-02-01', end_date: '2027-04-30', virtue_theme: 'Love',   grading_lock_date: '2027-04-26' },
  // T4 has no FCA comment section per KD #49 — virtue_theme left null.
  { term_number: 4, start_date: '2027-05-03', end_date: '2027-07-30', virtue_theme: null,     grading_lock_date: '2027-07-26' },
];

// Synthetic holidays & special days pinned to AY9999 term windows.
// Not an attempt at the real SG calendar — defensible stand-ins so the grid
// has a mix of day-types to demo. Registrar can re-classify via the UI.
export type CannedCalendarEntry = {
  date: string;  // ISO yyyy-MM-dd
  day_type: DayType;
  label: string;
};

export const CANNED_CALENDAR: CannedCalendarEntry[] = [
  // ---- T1 (Aug–Oct 2026) ----
  { date: '2026-08-10', day_type: 'no_class',       label: 'Teacher retreat' },
  { date: '2026-09-14', day_type: 'school_holiday', label: 'Staff PD Day' },
  { date: '2026-09-15', day_type: 'school_holiday', label: 'Staff PD Day' },
  { date: '2026-10-19', day_type: 'public_holiday', label: 'Deepavali' },

  // ---- T2 (Nov 2026 – Jan 2027) ----
  { date: '2026-12-25', day_type: 'public_holiday', label: 'Christmas Day' },
  { date: '2026-12-28', day_type: 'school_holiday', label: "Founder's Day" },
  { date: '2027-01-01', day_type: 'public_holiday', label: "New Year's Day" },

  // ---- T3 (Feb–Apr 2027) ----
  { date: '2027-02-17', day_type: 'public_holiday', label: 'CNY Day 1' },
  { date: '2027-02-18', day_type: 'public_holiday', label: 'CNY Day 2' },
  { date: '2027-03-15', day_type: 'hbl',            label: 'HBL Day' },
  { date: '2027-04-02', day_type: 'public_holiday', label: 'Good Friday' },

  // ---- T4 (May–Jul 2027) ----
  { date: '2027-05-13', day_type: 'public_holiday', label: 'Hari Raya Puasa' },
  { date: '2027-05-31', day_type: 'public_holiday', label: 'Labour Day (obs.)' },
  { date: '2027-07-09', day_type: 'public_holiday', label: 'National Day (obs.)' },
];

export type CannedEvent = { start_date: string; end_date: string; label: string };

export const CANNED_EVENTS: CannedEvent[] = [
  { start_date: '2026-10-05', end_date: '2026-10-09', label: 'Assessment Week' },
  { start_date: '2027-03-22', end_date: '2027-03-26', label: 'Mathematics Week' },
];

// School config defaults. Only applied if the singleton row has empty
// strings — never overwrites registrar-edited values.
export const SCHOOL_CONFIG_DEFAULTS = {
  principal_name: 'Test Principal',
  ceo_name: 'Test CEO',
  pei_registration_number: 'AY9999-TEST',
  default_publish_window_days: 30,
} as const;
