// The "Term 4 framework" grading sheet type (KD #230).
//
// A standard sheet with a fixed shape, as the school's "Sec 4 Grading Sheets -
// Term 4" template: the WW slot is the student's best T1–T3 grade in this
// subject (filled by the database, migration 187), the PT slot Class
// Performance out of 30, the exam the Term 4 PETA out of 100, weighted
// 50/20/30. The grade formula is the usual one; letter-graded subjects take
// their letter from it as on any sheet (KD #104).
// The database enforces the same shape (grading_sheets_term4_framework_shape_check).

export const SHEET_TYPES = ['standard', 'term4_framework'] as const;
export type SheetType = (typeof SHEET_TYPES)[number];

export const SHEET_TYPE_LABEL: Record<SheetType, string> = {
  standard: 'Standard',
  term4_framework: 'Term 4 framework',
};

export const TERM4_FRAMEWORK_SHAPE = {
  ww_totals: [100],
  pt_totals: [30],
  qa_total: 100,
  ww_weight: 0.5,
  pt_weight: 0.2,
  qa_weight: 0.3,
} as const;

export const TERM4_FRAMEWORK_LABELS = {
  ww: 'Best Overall',
  pt: 'Class Performance',
  qa: 'Term 4 PETA',
} as const;

export function isTerm4Framework(t: string | null | undefined): boolean {
  return t === 'term4_framework';
}
