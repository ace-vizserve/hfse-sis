// The "Term 4 framework" grading sheet type (KD #230).
//
// A standard sheet with a fixed shape: the WW slot is the student's best
// T1–T3 term average (filled by the database, migration 184), the PT slot the
// teacher's recommendation out of 30, the exam a revision task or mock exam
// out of 100, weighted 50/20/30. The grade formula is the usual one.
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
  ww: 'Best term average',
  pt: "Teacher's recommendation",
  qa: 'Revision task / Mock exam',
} as const;

export function parseSheetType(v: unknown): SheetType | null {
  if (v == null) return 'standard';
  return typeof v === 'string' && (SHEET_TYPES as readonly string[]).includes(v)
    ? (v as SheetType)
    : null;
}

export function isTerm4Framework(t: string | null | undefined): boolean {
  return t === 'term4_framework';
}
