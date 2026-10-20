import { describe, it, expect, vi } from 'vitest';

const order = vi.fn(() => ({ limit }));
const limit = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from })),
}));

import {
  getRecentActions,
  recentActionModule,
} from '@/lib/home/recent-actions';

describe('getRecentActions', () => {
  it('scopes strictly to actor_email, orders newest-first, and humanizes each row', async () => {
    limit.mockResolvedValueOnce({
      data: [
        {
          id: 'row-1',
          action: 'sheet.lock',
          context: { sheet_name: 'Math T1' },
          created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        },
        {
          id: 'row-2',
          action: 'sheet.unlock',
          context: null,
          created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        },
      ],
      error: null,
    });

    const actions = await getRecentActions('teacher@hfse.edu.sg');

    expect(from).toHaveBeenCalledWith('audit_log');
    expect(select).toHaveBeenCalledWith('id, action, context, created_at');
    expect(eq).toHaveBeenCalledWith('actor_email', 'teacher@hfse.edu.sg');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(5);

    expect(actions).toHaveLength(2);
    // sheet.lock's auditActionTone falls through every bucket to 'default',
    // which maps to the 'secondary' Badge variant (not 'warning' — only
    // *unlock*/force/overdue/revoke actions get 'warning').
    expect(actions[0].id).toBe('row-1');
    expect(actions[0].label).toBe('Sheet locked');
    expect(actions[0].tone).toBe('secondary');
    expect(actions[0].timeAgo).toBe('5m ago');
    // sheet.unlock matches the 'unlock' substring rule → 'warning' tone.
    expect(actions[1].label).toBe('Sheet unlocked');
    expect(actions[1].tone).toBe('warning');
    expect(actions[1].timeAgo).toBe('2h ago');
  });

  it('returns an empty array on a query error instead of throwing', async () => {
    limit.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    expect(await getRecentActions('user@hfse.edu.sg')).toEqual([]);
  });

  it('respects a custom limit', async () => {
    limit.mockResolvedValueOnce({ data: [], error: null });
    await getRecentActions('user@hfse.edu.sg', 3);
    expect(limit).toHaveBeenCalledWith(3);
  });
});

describe('recentActionModule', () => {
  it('names the module the way the switcher does', () => {
    expect(recentActionModule('sheet.lock')).toBe('Markbook');
    expect(recentActionModule('attendance.daily.update')).toBe('Attendance');
    expect(recentActionModule('pfile.upload')).toBe('P-Files');
    expect(recentActionModule('sis.stage.update')).toBe('Admissions');
    expect(recentActionModule('sis.profile.update')).toBe('Records');
  });

  it('files QuickBooks and Billing actions under Billing, not Admissions', () => {
    expect(recentActionModule('qbo.invoice.create')).toBe('Billing');
    expect(recentActionModule('billing.payment.record')).toBe('Billing');
  });

  it('files classroom actions under Classroom and setup families under SIS Admin', () => {
    expect(recentActionModule('classroom.note.create')).toBe('Classroom');
    expect(recentActionModule('declaration.approve')).toBe('Attendance');
    expect(recentActionModule('assignment.relief.create')).toBe('SIS Admin');
    expect(recentActionModule('ay.create')).toBe('SIS Admin');
    expect(recentActionModule('user.invite')).toBe('SIS Admin');
  });

  it('returns null for an action no module claims', () => {
    expect(recentActionModule('mystery.thing')).toBeNull();
  });
});
