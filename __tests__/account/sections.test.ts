import { describe, it, expect, vi } from 'vitest';
import { getTeacherSections } from '@/lib/account/sections';

function fakeSupabase(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      })),
    })),
  } as never;
}

describe('getTeacherSections', () => {
  it('labels a form_adviser row with "Form adviser"', async () => {
    const supabase = fakeSupabase([
      {
        role: 'form_adviser',
        section: { id: 's1', name: 'Primary One Respect' },
        subject: null,
      },
    ]);
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toEqual([
      { sectionName: 'Primary One Respect', roleTag: 'Form adviser' },
    ]);
  });

  it('labels a subject_teacher row with the subject name', async () => {
    const supabase = fakeSupabase([
      {
        role: 'subject_teacher',
        section: { id: 's2', name: 'Primary Four Honesty' },
        subject: { id: 'sub1', name: 'English' },
      },
    ]);
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toEqual([
      { sectionName: 'Primary Four Honesty', roleTag: 'English' },
    ]);
  });

  it('returns one row per assignment (a teacher with 2 subjects in the same section gets 2 rows)', async () => {
    const supabase = fakeSupabase([
      {
        role: 'subject_teacher',
        section: { id: 's2', name: 'Primary Four Honesty' },
        subject: { id: 'sub1', name: 'English' },
      },
      {
        role: 'subject_teacher',
        section: { id: 's2', name: 'Primary Four Honesty' },
        subject: { id: 'sub2', name: 'Math' },
      },
    ]);
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toHaveLength(2);
  });

  it('returns an empty array when the teacher has no assignments', async () => {
    const supabase = fakeSupabase([]);
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toEqual([]);
  });
});
