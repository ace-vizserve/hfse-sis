/**
 * The "Step name" example in SIS Admin → Approvers → Add a step.
 *
 * It read "Officer in charge" on all three cards. That is the declarations
 * job; over a grade-change card it suggests a post that has nothing to do
 * with grades. Each card now gets an example from its own world — still a job,
 * because the box's help line says "Name the job, not the person".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  STAGE_NAME_EXAMPLES,
  STAGED_APPROVAL_FLOWS,
} from '@/lib/schemas/approval-flows';

describe('STAGE_NAME_EXAMPLES', () => {
  it('gives every card its own example', () => {
    for (const flow of STAGED_APPROVAL_FLOWS) {
      expect(STAGE_NAME_EXAMPLES[flow]?.trim()).toBeTruthy();
    }
    expect(STAGE_NAME_EXAMPLES['attendance.student_declaration']).toBe(
      'Officer in charge'
    );
    expect(STAGE_NAME_EXAMPLES['markbook.grade_change']).not.toBe(
      'Officer in charge'
    );
    expect(STAGE_NAME_EXAMPLES['markbook.grade_change_aeb']).not.toBe(
      'Officer in charge'
    );
  });

  it('is what the Add a step dialog shows, not a fixed string', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../../components/sis/staged-flow-editor.tsx'),
      'utf8'
    );
    expect(source).toContain('placeholder={STAGE_NAME_EXAMPLES[flow]}');
    expect(source).not.toContain('placeholder="Officer in charge"');
  });
});
