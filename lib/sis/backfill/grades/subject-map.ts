export type SubjectMapEntry = { code: string; examinable: boolean };

// Masterfile subject-column label (UPPERCASE) → DB subjects.code. Clean 1:1.
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
