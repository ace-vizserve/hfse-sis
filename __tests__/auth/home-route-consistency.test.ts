// __tests__/auth/home-route-consistency.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ROLES } from '@/lib/auth/roles';

vi.mock('@/lib/dashboard/windows', () => ({
  getDashboardWindows: vi.fn(async () => ({
    term: {},
    ay: { thisAY: { from: '2026-01-01', to: '2026-07-24' } },
    activeTermFallback: false,
  })),
}));
vi.mock('@/lib/change-requests/sidebar-counts', () => ({
  getSidebarChangeRequestCount: vi.fn(async () => 0),
}));
vi.mock('@/lib/markbook/dashboard', () => ({
  getMarkbookKpisRange: vi.fn(async () => ({ current: { lockedPct: 0 } })),
}));
vi.mock('@/lib/attendance/dashboard', () => ({
  getAttendanceKpisRange: vi.fn(async () => ({
    current: { attendancePct: 0 },
  })),
}));
vi.mock('@/lib/evaluation/dashboard', () => ({
  getEvaluationKpisRange: vi.fn(async () => ({
    current: { submissionPct: 0 },
  })),
}));
vi.mock('@/lib/sis/readiness', () => ({
  getAyReadiness: vi.fn(async () => ({
    ayCode: 'AY2026',
    steps: [],
    complete: 0,
    total: 7,
  })),
}));
vi.mock('@/lib/admissions/dashboard', () => ({
  getAdmissionsKpisRange: vi.fn(async () => ({
    current: { applicationsInRange: 0, conversionPct: 0 },
  })),
}));
vi.mock('@/lib/sis/dashboard', () => ({
  getRecordsKpisRange: vi.fn(async () => ({
    current: { activeEnrolled: 0 },
  })),
}));
vi.mock('@/lib/p-files/dashboard', () => ({
  getSlotStatusMix: vi.fn(async () => ({
    valid: 0,
    pending: 0,
    rejected: 0,
    missing: 0,
  })),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({})),
}));

import { getModuleCards } from '@/lib/home/module-cards';
import { isRouteAllowed } from '@/lib/auth/roles';

const ALL_HREFS = [
  '/admissions',
  '/records',
  '/p-files',
  '/markbook',
  '/attendance',
  '/evaluation',
  '/sis',
];

describe('home page module-card set never drifts from ROUTE_ACCESS', () => {
  for (const role of ROLES) {
    it(`matches isRouteAllowed for ${role}`, async () => {
      const cards = await getModuleCards(role, 'AY2026', 'user-1');
      const expectedHrefs = ALL_HREFS.filter((h) => isRouteAllowed(h, role));
      expect(cards.map((c) => c.href).sort()).toEqual(expectedHrefs.sort());
    });
  }
});
