// Overall annual grade (full year) formula — docs/context/02-grading-system.md.
//   Overall = ROUND((T1 × 0.20) + (T2 × 0.20) + (T3 × 0.20) + (T4 × 0.40), 2)
// Term 4 carries double weight (40%) vs T1-T3 (20% each). Total is 100%.
//
// Returns null if ANY term is missing — the spec treats a partial year as
// incomplete and suppresses the overall column on the report card.

export function computeAnnualGrade(
  t1: number | null,
  t2: number | null,
  t3: number | null,
  t4: number | null,
): number | null {
  if (t1 == null || t2 == null || t3 == null || t4 == null) return null;
  const raw = t1 * 0.2 + t2 * 0.2 + t3 * 0.2 + t4 * 0.4;
  return Math.round(raw * 100) / 100;
}

// Descriptor for a numeric quarterly or annual grade per DepEd scale.
// Used by the report card legend column.
export function gradeDescriptor(grade: number | null): string {
  if (grade == null) return '—';
  if (grade >= 90) return 'Outstanding';
  if (grade >= 85) return 'Very Satisfactory';
  if (grade >= 80) return 'Satisfactory';
  if (grade >= 75) return 'Fairly Satisfactory';
  return 'Below Minimum Expectations';
}

// General average across all examinable subjects' final grades.
// Returns null if the list is empty or any grade is null (incomplete year).
export function computeGeneralAverage(
  finalGrades: (number | null)[],
): number | null {
  if (finalGrades.length === 0) return null;
  if (finalGrades.some((g) => g == null)) return null;
  const sum = finalGrades.reduce<number>((acc, g) => acc + g!, 0);
  return Math.round((sum / finalGrades.length) * 100) / 100;
}

// Cumulative attendance percentage across all terms.
// Returns null if any field is null or total school days is zero.
export function computeAttendancePercentage(
  records: { school_days: number | null; days_present: number | null }[],
): number | null {
  if (records.length === 0) return null;
  let totalSchool = 0;
  let totalPresent = 0;
  for (const r of records) {
    if (r.school_days == null || r.days_present == null) return null;
    totalSchool += r.school_days;
    totalPresent += r.days_present;
  }
  if (totalSchool === 0) return null;
  return Math.round((totalPresent / totalSchool) * 10000) / 100;
}

// Self-test: 85/85/85/85 should floor-average to 85.00, and a 70/80/90/95
// sample exercises the weighted double-term.
(function verifyAnnual() {
  const a = computeAnnualGrade(85, 85, 85, 85);
  if (a !== 85) throw new Error(`annual self-test failed: 85/85/85/85 → ${a} (expected 85)`);
  // 70*.2 + 80*.2 + 90*.2 + 95*.4 = 14 + 16 + 18 + 38 = 86
  const b = computeAnnualGrade(70, 80, 90, 95);
  if (b !== 86) throw new Error(`annual self-test failed: 70/80/90/95 → ${b} (expected 86)`);
  const partial = computeAnnualGrade(85, 85, null, 90);
  if (partial !== null) throw new Error(`annual self-test: partial year should be null, got ${partial}`);

  // General average
  const ga1 = computeGeneralAverage([90, 85, 80]);
  if (ga1 !== 85) throw new Error(`general-avg self-test failed: [90,85,80] → ${ga1} (expected 85)`);
  const ga2 = computeGeneralAverage([90, null, 80]);
  if (ga2 !== null) throw new Error(`general-avg self-test: partial should be null, got ${ga2}`);
  const ga3 = computeGeneralAverage([]);
  if (ga3 !== null) throw new Error(`general-avg self-test: empty should be null, got ${ga3}`);

  // Attendance percentage
  const att1 = computeAttendancePercentage([
    { school_days: 50, days_present: 45 },
    { school_days: 50, days_present: 48 },
    { school_days: 50, days_present: 50 },
    { school_days: 50, days_present: 47 },
  ]);
  // (45+48+50+47)/(50+50+50+50) = 190/200 = 95
  if (att1 !== 95) throw new Error(`attendance self-test failed: expected 95, got ${att1}`);
  const att2 = computeAttendancePercentage([
    { school_days: 50, days_present: null },
  ]);
  if (att2 !== null) throw new Error(`attendance self-test: null present should be null, got ${att2}`);
})();
