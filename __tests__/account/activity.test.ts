import { describe, it, expect, vi } from 'vitest';

const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockEq = vi.fn(() => ({ order: mockOrder }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

import { getRecentActivity, formatRelativeTime } from '@/lib/account/activity';

describe('getRecentActivity', () => {
  it('filters to the given actor_email, orders newest first, and caps at the given limit', async () => {
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue({
      data: [
        {
          id: '1',
          action: 'entry.update',
          entity_type: 'grade_entry',
          context: { subject: 'Filipino' },
          created_at: '2026-07-24T10:00:00.000Z',
        },
      ],
      error: null,
    });

    const rows = await getRecentActivity('maria.t@hfse.edu.sg', 6);

    expect(mockFrom).toHaveBeenCalledWith('audit_log');
    expect(mockEq).toHaveBeenCalledWith('actor_email', 'maria.t@hfse.edu.sg');
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(6);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: '1',
      createdAt: '2026-07-24T10:00:00.000Z',
      label: 'Grade updated',
    });
  });

  it('defaults to a limit of 6 when none is passed', async () => {
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue({ data: [], error: null });
    await getRecentActivity('someone@hfse.edu.sg');
    expect(mockLimit).toHaveBeenCalledWith(6);
  });

  it('returns an empty array (not a throw) when the query errors', async () => {
    mockOrder.mockReturnValue({ limit: mockLimit });
    mockLimit.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const rows = await getRecentActivity('someone@hfse.edu.sg');
    expect(rows).toEqual([]);
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-24T12:00:00.000Z');

  it('renders minutes for under an hour', () => {
    expect(formatRelativeTime('2026-07-24T11:46:00.000Z', now)).toBe(
      '14 min ago'
    );
  });

  it('renders hours for under a day', () => {
    expect(formatRelativeTime('2026-07-24T09:00:00.000Z', now)).toBe(
      '3 hours ago'
    );
  });

  it('renders "Yesterday" for exactly one day back', () => {
    expect(formatRelativeTime('2026-07-23T12:00:00.000Z', now)).toBe(
      'Yesterday'
    );
  });

  it('renders "N days ago" for 2-6 days back', () => {
    expect(formatRelativeTime('2026-07-21T12:00:00.000Z', now)).toBe(
      '3 days ago'
    );
  });
});
