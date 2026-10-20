import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dateParamChanges,
  useDateFilterParam,
} from '@/components/billing/date-range-filter';

// Billing → Invoices / Sales keep their Date filter in the page URL
// (`?date=`, `?from=`/`?to=` for Custom). Picking a date must write it, and a
// URL changed from outside (a tile link, Back) must re-seed it.
const h = vi.hoisted(() => {
  const replaceCalls: string[] = [];
  const router = {
    refresh: () => {},
    replace: (url: string) => {
      replaceCalls.push(url);
      window.history.replaceState(null, '', url);
    },
    push: () => {},
  };
  return { replaceCalls, router };
});

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/billing/invoices',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(() => {
  h.replaceCalls.length = 0;
  window.history.replaceState(
    null,
    '',
    '/billing/invoices?billing-invoices.status=paid&date=last-365'
  );
});

describe('dateParamChanges', () => {
  it('leaves the default out and keeps from/to only for Custom', () => {
    const none = { from: '', to: '' };
    expect(
      dateParamChanges({ date: 'last-3-months', custom: none }, 'last-3-months')
    ).toEqual({ date: null, from: null, to: null });
    expect(
      dateParamChanges(
        { date: 'all', custom: { from: '2026-01-01', to: '' } },
        'last-3-months'
      )
    ).toEqual({ date: 'all', from: null, to: null });
    expect(
      dateParamChanges(
        { date: 'custom', custom: { from: '2026-01-01', to: '2026-02-01' } },
        'last-3-months'
      )
    ).toEqual({ date: 'custom', from: '2026-01-01', to: '2026-02-01' });
  });
});

describe('useDateFilterParam', () => {
  it('opens on ?date= and falls back for an unknown value', () => {
    expect(
      renderHook(() => useDateFilterParam({ date: 'last-365' })).result.current
        .date
    ).toBe('last-365');
    expect(
      renderHook(() => useDateFilterParam({ date: 'bogus' })).result.current
        .date
    ).toBe('last-3-months');
  });

  it('picking a date writes it to the URL, keeping the other params', () => {
    const { result } = renderHook(() =>
      useDateFilterParam({ date: 'last-365' })
    );
    act(() => result.current.setDate('all'));
    expect(result.current.date).toBe('all');
    expect(h.replaceCalls).toEqual([
      '/billing/invoices?billing-invoices.status=paid&date=all',
    ]);
  });

  it('picking the default takes ?date= out of the URL', () => {
    const { result } = renderHook(() =>
      useDateFilterParam({ date: 'last-365' })
    );
    act(() => result.current.setDate('last-3-months'));
    expect(h.replaceCalls).toEqual([
      '/billing/invoices?billing-invoices.status=paid',
    ]);
  });

  it('a URL changed from outside re-seeds the filter', () => {
    const { result, rerender } = renderHook(
      (p: { date?: string; from?: string; to?: string }) =>
        useDateFilterParam(p),
      {
        initialProps: { date: 'this-year' } as {
          date?: string;
          from?: string;
          to?: string;
        },
      }
    );
    rerender({ date: 'custom', from: '2026-01-01', to: '2026-03-31' });
    expect(result.current.date).toBe('custom');
    expect(result.current.custom).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('its own write arriving late does not undo a newer pick', () => {
    const { result, rerender } = renderHook(
      (p: { date?: string; from?: string; to?: string }) =>
        useDateFilterParam(p),
      { initialProps: { date: 'last-365' } as { date?: string } }
    );
    act(() => result.current.setDate('custom'));
    act(() => result.current.setCustom({ from: '2026-01-01', to: '' }));
    act(() =>
      result.current.setCustom({ from: '2026-01-01', to: '2026-02-01' })
    );
    // The server render for the FIRST write lands after the third pick.
    rerender({ date: 'custom' });
    expect(result.current.custom).toEqual({
      from: '2026-01-01',
      to: '2026-02-01',
    });
  });
});
