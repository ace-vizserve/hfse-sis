import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(
  join(__dirname, '..', '..', 'components', 'sis', 'student-data-table.tsx'),
  'utf8'
);

describe('StudentDataTable export config', () => {
  it('declares both export presets', () => {
    expect(SRC).toContain("label: 'Full application record'");
    expect(SRC).toContain("label: 'Full record + pipeline'");
    expect(SRC).toMatch(/sourceIds:\s*\['applications'\]/);
    expect(SRC).toMatch(/sourceIds:\s*\['applications',\s*'status'\]/);
  });

  it('no longer declares the status extraColumns superseded by the presets', () => {
    // All 8 lived on _enrolment_status, which the "+ pipeline" preset now
    // exports in full — keeping them would offer the same data twice.
    for (const id of [
      'enroleeType',
      'enrolmentDate',
      'assessmentStatus',
      'assessmentGradeMath',
      'assessmentGradeEnglish',
      'contractStatus',
      'feeStatus',
      'registrationStatus',
    ]) {
      expect(SRC).not.toContain(`id: '${id}',`);
    }
    expect(SRC).not.toContain('extraColumns:');
  });
});
