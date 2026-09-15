// lib/sis/backfill/calendar/published-ay2026.ts
// HFSE's PUBLISHED AY2026 school calendar, transcribed verbatim from
// "AY 2026 Calendar.png" at the repo root — the school's own one-page
// calendar, and the authority for what the year is meant to look like.
//
// WHY THIS FILE EXISTS. Every calendar row in production was reverse-
// engineered from finished attendance registers. A register can only report
// what teachers wrote in the columns they were given: it shows THAT a day was
// blank, never WHY; it has no columns for anything with no attendance
// footprint (Partners for Excellence, parents dialogues, term breaks, start of
// term, PTC); each sheet is one section, so primary and secondary sittings of
// the same exam collapse into one row; and it does not exist at all until the
// term is over. AY2026 T4 is the proof — it opened 14 Sep 2026 with 49 rows,
// every one a plain school day, because no T4 register exists yet.
//
// So the published calendar is the SPINE. The registers stay authoritative for
// what actually happened on days already taught (see reconcile.ts).
//
// TRANSCRIPTION RULES FOLLOWED HERE:
//   • Labels are copied exactly as printed, including the school's own
//     spelling ("Labour Day", "In-Lieu of Family Sportsfest", "Yearend").
//   • `levels` records the TRUE scope where the calendar states one
//     ("Primary Six Fieldtrip" → ['P6']). null means whole-school. The
//     database cannot store this yet; see types.ts::audienceFor.
//   • Entries outside every term window (Jan 1, the December block, the term
//     breaks) are kept anyway. Both calendar tables are term-scoped, so they
//     have nowhere to land today — but dropping them here would silently
//     rewrite the school's calendar, and the audit reports them instead.
import type { CalendarEntry } from './types';

const P_ALL = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const;
const S_ALL = ['S1', 'S2', 'S3', 'S4'] as const;

// "UpperPri - Secondary" as printed. AY2025's register spelled the same camp
// out as "(P4-Sec4)", which is what fixes upper primary at P4-P6 here.
const UPPER_PRI_TO_SEC = ['P4', 'P5', 'P6', 'S1', 'S2', 'S3', 'S4'] as const;

const one = (
  date: string,
  label: string,
  kind: CalendarEntry['kind'],
  levels: CalendarEntry['levels'] = null
): CalendarEntry => ({ startDate: date, endDate: date, label, kind, levels });

const span = (
  startDate: string,
  endDate: string,
  label: string,
  kind: CalendarEntry['kind'],
  levels: CalendarEntry['levels'] = null
): CalendarEntry => ({ startDate, endDate, label, kind, levels });

// ── PUBLIC HOLIDAYS ────────────────────────────────────────────────────────
const PUBLIC_HOLIDAYS: CalendarEntry[] = [
  one('2026-01-01', "New Year's Day", 'public_holiday'),
  one('2026-02-17', 'Chinese New Year', 'public_holiday'),
  one('2026-02-18', 'Chinese New Year', 'public_holiday'),
  one('2026-03-21', 'Hari Raya Puasa', 'public_holiday'),
  one('2026-03-23', 'In Lieu of Hari Raya Puasa', 'public_holiday'),
  one('2026-04-03', 'Good Friday', 'public_holiday'),
  one('2026-05-01', 'Labour Day', 'public_holiday'),
  one('2026-05-27', 'Hari Raya Haji', 'public_holiday'),
  one('2026-05-31', 'Vesak Day', 'public_holiday'),
  one('2026-06-01', 'In Lieu of Vesak Day', 'public_holiday'),
  one('2026-07-05', 'Youth Day', 'public_holiday'),
  one('2026-07-06', 'In Lieu of Youth Day', 'public_holiday'),
  one('2026-08-09', 'National Day', 'public_holiday'),
  one('2026-08-10', 'In Lieu of National Day', 'public_holiday'),
  one('2026-09-04', "Teacher's Day", 'public_holiday'),
  one('2026-10-02', "Children's Day", 'public_holiday'),
  one('2026-11-08', 'Deepavali', 'public_holiday'),
  one('2026-11-09', 'In Lieu of Deepavali', 'public_holiday'),
  one('2026-12-25', 'Christmas Day', 'public_holiday'),
];

// ── SCHOOL HOLIDAYS ────────────────────────────────────────────────────────
const SCHOOL_HOLIDAYS: CalendarEntry[] = [
  one('2026-03-06', 'Term 1 Marking Day', 'school_holiday'),
  one('2026-04-10', 'Staff Development Day', 'school_holiday'),
  one('2026-05-22', 'Term 2 Marking Day', 'school_holiday'),
  one('2026-05-25', 'In-Lieu of Family Sportsfest', 'school_holiday'),
  one('2026-07-17', 'Staff Development Day', 'school_holiday'),
  one('2026-08-28', 'Term 3 Marking Day', 'school_holiday'),
  one('2026-10-23', 'Term 4 Marking Day', 'school_holiday'),
  one('2026-11-06', 'Awards Deliberation Day', 'school_holiday'),
  span('2026-11-24', '2026-11-30', 'Yearend School Holiday', 'school_holiday'),
  span('2026-12-01', '2026-12-31', 'Yearend School Holiday', 'school_holiday'),
];

// ── HOMEBASED LEARNING ─────────────────────────────────────────────────────
// Both dates also appear under SCHOOL HOLIDAYS (20 Feb is the Staff
// Development Day the T1 register spells "HBL, Staff Dev't Day"; 17 Jul is
// printed in both lists). That double-labelling is exactly what migration
// 051's `hbl_overlay` exists for: closed on paper, attendance still taken.
const HBL: CalendarEntry[] = [
  one('2026-02-20', 'Homebased Learning (HBL)', 'hbl'),
  one('2026-07-17', 'Homebased Learning (HBL)', 'hbl'),
];

// ── START OF TERM ──────────────────────────────────────────────────────────
const START_OF_TERM: CalendarEntry[] = [
  one('2026-01-08', 'Start of 11th Academic Year', 'start_of_term'),
  one('2026-03-24', 'Start of Term 2', 'start_of_term'),
  one('2026-06-29', 'Start of Term 3', 'start_of_term'),
  one('2026-09-14', 'Start of Term 4', 'start_of_term'),
];

// ── TERM BREAK ─────────────────────────────────────────────────────────────
const TERM_BREAK: CalendarEntry[] = [
  span('2026-03-14', '2026-03-22', 'Term Break', 'term_break'),
  span('2026-05-30', '2026-06-28', 'Term Break', 'term_break'),
  span('2026-09-07', '2026-09-11', 'Term Break', 'term_break'),
];

// ── TERM EXAMINATIONS ──────────────────────────────────────────────────────
// Primary and secondary sit DIFFERENT dates. Production currently stores one
// whole-school row per term on the primary dates; every secondary sitting
// below is absent from the database.
const EXAMS: CalendarEntry[] = [
  span('2026-03-04', '2026-03-05', 'Primary School Term 1 Exam', 'term_exam', [
    ...P_ALL,
  ]),
  span('2026-05-20', '2026-05-21', 'Primary School Term 2 Exam', 'term_exam', [
    ...P_ALL,
  ]),
  span('2026-08-26', '2026-08-27', 'Primary School Term 3 Exam', 'term_exam', [
    ...P_ALL,
  ]),
  span('2026-10-21', '2026-10-22', 'Primary School Term 4 Exam', 'term_exam', [
    ...P_ALL,
  ]),
  span(
    '2026-02-25',
    '2026-02-27',
    'Secondary School Term 1 Exam',
    'term_exam',
    [...S_ALL]
  ),
  span(
    '2026-03-02',
    '2026-03-05',
    'Secondary School Term 1 Exam',
    'term_exam',
    [...S_ALL]
  ),
  span(
    '2026-05-13',
    '2026-05-15',
    'Secondary School Term 2 Exam',
    'term_exam',
    [...S_ALL]
  ),
  span(
    '2026-05-18',
    '2026-05-21',
    'Secondary School Term 2 Exam',
    'term_exam',
    [...S_ALL]
  ),
  span(
    '2026-08-19',
    '2026-08-21',
    'Secondary School Term 3 Exam',
    'term_exam',
    [...S_ALL]
  ),
  span(
    '2026-08-24',
    '2026-08-27',
    'Secondary School Term 3 Exam',
    'term_exam',
    [...S_ALL]
  ),
  span('2026-09-21', '2026-09-25', 'Secondary Four Final Exam', 'term_exam', [
    'S4',
  ]),
  span('2026-09-28', '2026-09-30', 'Secondary Four Final Exam', 'term_exam', [
    'S4',
  ]),
  span(
    '2026-10-14',
    '2026-10-16',
    'Secondary School Term 4 Exam',
    'term_exam',
    [...S_ALL]
  ),
  span(
    '2026-10-19',
    '2026-10-22',
    'Secondary School Term 4 Exam',
    'term_exam',
    [...S_ALL]
  ),
];

// ── SUBJECT WEEK ───────────────────────────────────────────────────────────
const SUBJECT_WEEKS: CalendarEntry[] = [
  span('2026-02-02', '2026-02-06', 'Mathematics Week', 'subject_week'),
  span('2026-04-13', '2026-04-17', 'English Week', 'subject_week'),
  span('2026-04-27', '2026-04-30', 'Science Week', 'subject_week'),
  span('2026-07-27', '2026-07-31', 'STAR Week', 'subject_week'),
  span('2026-08-10', '2026-08-14', 'Mother Tongue Week', 'subject_week'),
];

// ── PARENTS DIALOGUE SESSION ───────────────────────────────────────────────
const PARENTS_DIALOGUE: CalendarEntry[] = [
  one(
    '2026-01-17',
    'First General Parent Engagement Session',
    'parents_dialogue'
  ),
  one('2026-03-13', 'HAPI Community Meeting (6-7:30PM)', 'parents_dialogue'),
  one('2026-05-29', 'HAPI Community Meeting (6-7:30PM)', 'parents_dialogue'),
  one(
    '2026-07-18',
    'Second General Parent Engagement Session',
    'parents_dialogue'
  ),
  one('2026-08-28', 'HAPI Community Meeting (6-7:30PM)', 'parents_dialogue'),
  one('2026-10-30', 'HAPI Community Meeting (6-7:30PM)', 'parents_dialogue'),
];

// ── PARENT-TEACHER-CHILD CONFERENCE ────────────────────────────────────────
const PTC: CalendarEntry[] = [
  span('2026-04-08', '2026-04-09', 'General PTC (Online)', 'ptc'),
  span('2026-11-04', '2026-11-05', 'General PTC (Online)', 'ptc'),
];

// ── PARTNERS FOR EXCELLENCE ────────────────────────────────────────────────
const PFE: CalendarEntry[] = [
  span(
    '2026-03-11',
    '2026-03-13',
    'Eye and Dental Check up / First vaccination',
    'pfe'
  ),
  one('2026-04-12', 'Outreach Programme', 'pfe'),
  one('2026-04-30', "Partner's recognition night", 'pfe'),
  one('2026-05-09', 'Mommies Day Out', 'pfe'),
  one('2026-05-23', 'Family Sportsfest', 'pfe'),
  one('2026-07-31', 'Second Vaccination', 'pfe'),
  one('2026-08-01', 'Daddies Day Out', 'pfe'),
  one('2026-12-04', 'Parent Orientation AY2027', 'pfe'),
  span(
    '2026-12-07',
    '2026-12-11',
    'Collection Day for AY2027 Materials',
    'pfe'
  ),
];

// ── SCHOOL EVENTS ──────────────────────────────────────────────────────────
const SCHOOL_EVENTS: CalendarEntry[] = [
  one('2026-01-12', 'ID Photoshoot Day (New students)', 'school_event'),
  one('2026-01-19', 'ID Photoshoot Day (New students)', 'school_event'),
  one('2026-01-26', 'ID Photoshoot Day (New students)', 'school_event'),
  one(
    '2026-02-07',
    'Learn as your Child Learns (LAYCL-Mathematics)',
    'school_event'
  ),
  one('2026-02-13', 'Friendship Night', 'school_event'),
  one('2026-02-16', 'Chinese New Year Celebration', 'school_event'),
  one('2026-02-27', 'Primary One Fieldtrip', 'school_event', ['P1']),
  one('2026-03-12', 'Primary Four Fieldtrip', 'school_event', ['P4']),
  one('2026-03-13', 'Term 1 End party', 'school_event'),
  one('2026-04-02', 'Student Recollection', 'school_event'),
  one('2026-04-17', 'Primary Two and Three Fieldtrip', 'school_event', [
    'P2',
    'P3',
  ]),
  one('2026-04-24', 'Primary Five Fieldtrip', 'school_event', ['P5']),
  one('2026-05-08', 'Primary Six Fieldtrip', 'school_event', ['P6']),
  one('2026-05-29', 'Secondary One to Four Fieldtrip', 'school_event', [
    ...S_ALL,
  ]),
  one('2026-05-29', 'Term 2 End party', 'school_event'),
  one('2026-07-03', 'Youth Day Celebration', 'school_event'),
  span(
    '2026-07-08',
    '2026-07-10',
    'Leadership Camp (UpperPri - Secondary)',
    'school_event',
    [...UPPER_PRI_TO_SEC]
  ),
  one('2026-07-13', 'Moving up photoshoot', 'school_event'),
  one('2026-07-20', 'Moving up photoshoot', 'school_event'),
  one('2026-07-21', 'Racial Harmony Day Celebration', 'school_event'),
  one('2026-07-27', 'Moving up and Graduation photoshoot', 'school_event'),
  one('2026-08-07', 'National Day Celebration', 'school_event'),
  one('2026-09-03', 'Teachers and ANTS Day Celebration', 'school_event'),
  span('2026-09-17', '2026-09-18', 'Secondary Four Retreat', 'school_event', [
    'S4',
  ]),
  one('2026-10-01', "Children's Day Celebration", 'school_event'),
  one('2026-10-30', 'Primary Six Retreat', 'school_event', ['P6']),
  span(
    '2026-11-10',
    '2026-11-12',
    'Intramurals and Foundation Week',
    'school_event'
  ),
  one('2026-11-13', 'Yearend Party', 'school_event'),
  one('2026-11-16', 'Moving-up ceremony / Baccalaureate Mass', 'school_event'),
  one('2026-11-17', 'Moving-up ceremony', 'school_event'),
  one('2026-11-18', 'Moving-up ceremony', 'school_event'),
  one('2026-11-19', 'Primary | Secondary Graduation', 'school_event'),
  one('2026-11-23', 'HFSE 11th Anniversary', 'school_event'),
];

/** Every entry on HFSE's published AY2026 calendar, in no particular order. */
export const PUBLISHED_AY2026: CalendarEntry[] = [
  ...PUBLIC_HOLIDAYS,
  ...SCHOOL_HOLIDAYS,
  ...HBL,
  ...START_OF_TERM,
  ...TERM_BREAK,
  ...EXAMS,
  ...SUBJECT_WEEKS,
  ...PARENTS_DIALOGUE,
  ...PTC,
  ...PFE,
  ...SCHOOL_EVENTS,
];
