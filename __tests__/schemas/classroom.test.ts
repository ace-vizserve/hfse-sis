import { describe, expect, it } from 'vitest';

import { ClassroomNoteSchema, MAX_NOTE_LENGTH } from '@/lib/schemas/classroom';

describe('ClassroomNoteSchema', () => {
  it('accepts ordinary text', () => {
    const r = ClassroomNoteSchema.safeParse({
      content: 'Remember the field trip permission slips.',
    });
    expect(r.success).toBe(true);
  });

  it('accepts an empty string (clearing the note is a valid save)', () => {
    const r = ClassroomNoteSchema.safeParse({ content: '' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.content).toBe('');
  });

  it('trims surrounding whitespace', () => {
    const r = ClassroomNoteSchema.safeParse({ content: '  hello  ' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.content).toBe('hello');
  });

  it('accepts content exactly at the max length', () => {
    const r = ClassroomNoteSchema.safeParse({
      content: 'a'.repeat(MAX_NOTE_LENGTH),
    });
    expect(r.success).toBe(true);
  });

  it('rejects content over the max length', () => {
    const r = ClassroomNoteSchema.safeParse({
      content: 'a'.repeat(MAX_NOTE_LENGTH + 1),
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing content field', () => {
    expect(ClassroomNoteSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-string content', () => {
    expect(ClassroomNoteSchema.safeParse({ content: 42 }).success).toBe(false);
  });
});
