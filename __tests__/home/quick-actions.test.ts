import { describe, it, expect } from 'vitest';
import { getQuickActions } from '@/lib/home/quick-actions';

describe('getQuickActions', () => {
  it('returns the 3 teacher shortcuts', () => {
    const actions = getQuickActions('teacher');
    expect(actions).toEqual([
      { label: 'Enter grades', href: '/markbook/grading' },
      { label: 'Mark attendance', href: '/attendance/sections' },
      { label: 'Write evaluation', href: '/evaluation' },
    ]);
  });

  it('returns the 3 school_admin shortcuts', () => {
    const actions = getQuickActions('school_admin');
    expect(actions).toEqual([
      { label: 'Validate documents', href: '/admissions/document-validation' },
      { label: 'AY Setup', href: '/sis/ay-setup' },
      { label: 'Manage staff', href: '/sis/admin/staff' },
    ]);
  });

  it('returns [] for roles that never reach the home page', () => {
    expect(getQuickActions('p_file_officer')).toEqual([]);
    expect(getQuickActions('admissions')).toEqual([]);
  });
});
