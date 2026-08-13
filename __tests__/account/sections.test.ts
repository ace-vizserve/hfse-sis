import { describe, it, expect, vi } from 'vitest';
import { getTeacherSections } from '@/lib/account/sections';

// Two reads of ONE table now: the classes this teacher holds
// (`teacher_user_id`), and the ones they are standing in on for an absent
// colleague (`relief_teacher_user_id`, migration 117). Both are a plain
// `.select().eq()` — cover has no date window to chain onto.
function fakeSupabase(rows: unknown[], coverRows: unknown[] = []) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((column: string) =>
          Promise.resolve({
            data: column === 'relief_teacher_user_id' ? coverRows : rows,
            error: null,
          })
        ),
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

  // Relief teachers (migration 117). "Your sections" is the one place a
  // substitute should find the class they were asked to take — without it they
  // are told to go to a class that does not appear on their own profile.
  it('lists a class this teacher is covering, marked as cover', async () => {
    const supabase = fakeSupabase(
      [],
      [
        {
          role: 'subject_teacher',
          section: { id: 's3', name: 'Secondary One Discipline 2' },
          subject: { id: 'sub9', name: 'English' },
        },
      ]
    );
    const rows = await getTeacherSections(supabase, 'user-1');
    expect(rows).toEqual([
      {
        sectionName: 'Secondary One Discipline 2',
        roleTag: 'English — covering',
      },
    ]);
  });

  it('never lets cover masquerade as a permanent posting', async () => {
    const supabase = fakeSupabase(
      [
        {
          role: 'form_adviser',
          section: { id: 's1', name: 'Primary One Patience' },
          subject: null,
        },
      ],
      [
        {
          role: 'form_adviser',
          section: { id: 's4', name: 'Primary Five Tenacity' },
          subject: null,
        },
      ]
    );
    const rows = await getTeacherSections(supabase, 'user-1');
    // Their own class reads plainly; the covered one always says so.
    expect(rows[0]).toEqual({
      sectionName: 'Primary One Patience',
      roleTag: 'Form adviser',
    });
    expect(rows[1].roleTag).toContain('covering');
  });
});
