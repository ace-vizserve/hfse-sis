export type SubjectMapEntry = { code: string; examinable: boolean };

// Masterfile subject-column label (UPPERCASE) → DB subjects.code. Clean 1:1.
//
// FROZEN (migration 081, 2026-07-16): MUSIC/ARTS/PE/HE and 'MOTHER TONGUE'
// (MT) below point at codes migration 081 retired from the live catalog
// (MUSIC/ARTS/PE/HE deleted outright; MT kept but stripped of its own
// subject_configs/offerings — it's report-only now, fanned into from
// FIL/MANDARIN). This map is a one-off historical AY2025 masterfile import
// and is NOT repointed to MAPEH/FIL/MANDARIN — those 4 old subjects were
// letter-graded while MAPEH is numeric-graded (20/60/20), and MT/FIL/
// MANDARIN are genuinely different subjects, not a renamed column. Blindly
// repointing would silently import legacy scores under incompatible grading
// semantics. Do not re-run this import against a post-081 database without
// a deliberate remapping decision first.
const MAP: Record<string, SubjectMapEntry> = {
  ENGLISH: { code: 'ENG', examinable: true },
  MATH: { code: 'MATH', examinable: true },
  MATHEMATICS: { code: 'MATH', examinable: true },
  'MOTHER TONGUE': { code: 'MT', examinable: true },
  SCIENCE: { code: 'SCI', examinable: true },
  'SOCIAL STUDIES': { code: 'SS', examinable: true },
  HISTORY: { code: 'HIST', examinable: true },
  LITERATURE: { code: 'LIT', examinable: true },
  HUMANITIES: { code: 'HUM', examinable: true },
  ECONOMICS: { code: 'ECON', examinable: true },
  'MUSIC EDUCATION': { code: 'MUSIC', examinable: false },
  'ARTS EDUCATION': { code: 'ARTS', examinable: false },
  'PHYSICAL EDUCATION': { code: 'PE', examinable: false },
  'HEALTH EDUCATION': { code: 'HE', examinable: false },
  'CONTEMPORARY ART': { code: 'CA', examinable: false },
  'PHYSICAL EDUCATION AND HEALTH': { code: 'PEH', examinable: false },
};

export function mapSubjectColumn(label: string): SubjectMapEntry | null {
  return MAP[label.trim().toUpperCase()] ?? null;
}
