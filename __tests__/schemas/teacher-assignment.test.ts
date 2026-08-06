import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_CHANGE_NOTES_MAX,
  ASSIGNMENT_CHANGE_REASON_LABELS,
  ASSIGNMENT_CHANGE_REASON_VALUES,
  ASSIGNMENT_ROLE_LABELS,
  AssignmentRemovalSchema,
} from '@/lib/schemas/teacher-assignment';

describe('AssignmentRemovalSchema', () => {
  it('accepts an empty body — the route decides whether a reason was required', () => {
    // Before the year starts no reason is asked for, and the FCA retry path
    // sends no body at all. Neither may fail validation here.
    expect(AssignmentRemovalSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a preset reason with no notes', () => {
    const parsed = AssignmentRemovalSchema.safeParse({
      change_reason: 'resigned',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a reason outside the list', () => {
    const parsed = AssignmentRemovalSchema.safeParse({
      change_reason: 'because_i_said_so',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires notes when the reason is "Other"', () => {
    const parsed = AssignmentRemovalSchema.safeParse({
      change_reason: 'other',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(['change_notes']);
      expect(parsed.error.issues[0].message).toBe(
        'Add a short note explaining the change.'
      );
    }
  });

  it('treats whitespace-only notes as missing when the reason is "Other"', () => {
    const parsed = AssignmentRemovalSchema.safeParse({
      change_reason: 'other',
      change_notes: '   ',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts "Other" once real notes are supplied', () => {
    const parsed = AssignmentRemovalSchema.safeParse({
      change_reason: 'other',
      change_notes: 'Swapped with Ms Lim for the STEM pilot.',
    });
    expect(parsed.success).toBe(true);
  });

  it('coerces empty notes to null rather than an empty string', () => {
    const parsed = AssignmentRemovalSchema.parse({
      change_reason: 'on_leave',
      change_notes: '',
    });
    expect(parsed.change_notes).toBeNull();
  });

  it('rejects notes longer than the cap', () => {
    const parsed = AssignmentRemovalSchema.safeParse({
      change_reason: 'on_leave',
      change_notes: 'x'.repeat(ASSIGNMENT_CHANGE_NOTES_MAX + 1),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('label coverage', () => {
  it('every reason has a plain-English label', () => {
    for (const value of ASSIGNMENT_CHANGE_REASON_VALUES) {
      expect(ASSIGNMENT_CHANGE_REASON_LABELS[value]).toBeTruthy();
    }
  });

  it('no label leaks the raw database word', () => {
    // These strings land in the audit log, which school admins read.
    for (const value of ASSIGNMENT_CHANGE_REASON_VALUES) {
      expect(ASSIGNMENT_CHANGE_REASON_LABELS[value]).not.toContain('_');
    }
    for (const label of Object.values(ASSIGNMENT_ROLE_LABELS)) {
      expect(label).not.toContain('_');
    }
  });
});
