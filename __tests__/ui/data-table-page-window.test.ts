import { describe, expect, it } from 'vitest';

import { pageWindow } from '@/components/ui/data-table/pagination';

// The numbered pages the shared table pager shows: first, last, the current
// page and its neighbours, with an ellipsis for each gap of two or more.
describe('pageWindow', () => {
  it('shows every page when there are seven or fewer', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('treats an empty table as one page', () => {
    expect(pageWindow(1, 0)).toEqual([1]);
  });

  it('keeps five pages at the start', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 20]);
    expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 20]);
  });

  it('puts the current page between two gaps in the middle', () => {
    expect(pageWindow(10, 20)).toEqual([
      1,
      'ellipsis',
      9,
      10,
      11,
      'ellipsis',
      20,
    ]);
  });

  it('keeps five pages at the end', () => {
    expect(pageWindow(20, 20)).toEqual([1, 'ellipsis', 16, 17, 18, 19, 20]);
    expect(pageWindow(17, 20)).toEqual([1, 'ellipsis', 16, 17, 18, 19, 20]);
  });

  it('shows a single hidden page instead of an ellipsis', () => {
    expect(pageWindow(5, 8)).toEqual([1, 'ellipsis', 4, 5, 6, 7, 8]);
    expect(pageWindow(4, 8)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 8]);
  });
});
