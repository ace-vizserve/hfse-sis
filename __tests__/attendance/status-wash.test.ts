/**
 * The marking washes exist twice — once plain for the grid cells, once with
 * `hover:` and `data-[state=on]:` variants for the Radix toggles in the
 * marking palette. They have to be written out literally, because Tailwind
 * only emits class names it can read in the source and a template string
 * compiles to nothing.
 *
 * Two copies of the same colours is a drift risk that fails QUIETLY: change a
 * wash in one map and the tile keeps its old colour on hover, or on selection,
 * or both. Nothing throws, no test that renders the popover would notice, and
 * it would look like a rendering glitch rather than a stale constant.
 */

import { describe, it, expect } from 'vitest';
import {
  STATUS_CELL_WASH,
  STATUS_SEGMENT_WASH,
  STATUS_TOGGLE_WASH,
} from '@/components/attendance/status-wash';
import { ATTENDANCE_STATUS_VALUES } from '@/lib/schemas/attendance';

describe('marking washes', () => {
  it('covers every attendance status in all three maps', () => {
    for (const status of ATTENDANCE_STATUS_VALUES) {
      expect(STATUS_CELL_WASH[status]).toBeTruthy();
      expect(STATUS_TOGGLE_WASH[status]).toBeTruthy();
      expect(STATUS_SEGMENT_WASH[status]).toBeTruthy();
    }
  });

  it.each(ATTENDANCE_STATUS_VALUES)(
    '%s states the same fill plain, on hover, and when selected',
    (status) => {
      // The first class in the cell wash is the fill (the second is the ink).
      const fill = STATUS_CELL_WASH[status].split(' ')[0];
      expect(fill.startsWith('bg-')).toBe(true);

      const toggle = STATUS_TOGGLE_WASH[status].split(' ');
      expect(
        toggle,
        `${status}: the toggle wash must repeat ${fill} under all three ` +
          `states, or the tile falls back to toggleVariants' grey.`
      ).toEqual([fill, `hover:${fill}`, `data-[state=on]:${fill}`]);
    }
  );

  it.each(ATTENDANCE_STATUS_VALUES)(
    '%s tints the same fill at rest, on hover, and when selected in the track',
    (status) => {
      // The segmented track says something the other two maps do not: an
      // UNCHOSEN mark keeps a quiet share of its paper colour so the legend
      // still reads, and the chosen one takes the whole fill. So the three
      // states are not the same class — but they must all name the same
      // colour, or an unpicked Absent tints in Present's blue.
      const fill = STATUS_CELL_WASH[status].split(' ')[0];
      const segment = STATUS_SEGMENT_WASH[status].split(' ');

      expect(segment).toHaveLength(3);
      const [rest, hover, on] = segment;
      expect(rest, `${status}: rest must tint ${fill}`).toMatch(
        new RegExp(`^${fill}/\\d+$`)
      );
      expect(hover, `${status}: hover must tint ${fill}`).toMatch(
        new RegExp(`^hover:${fill}/\\d+$`)
      );
      expect(
        on,
        `${status}: the picked segment must take the FULL ${fill}, not a tint ` +
          '— it is the one that has to match the grid cell it writes.'
      ).toBe(`data-[state=on]:${fill}`);

      // Rest must be fainter than hover, or hovering dims the segment.
      const share = (c: string) => Number(c.split('/')[1]);
      expect(share(rest)).toBeLessThan(share(hover));
    }
  );

  it('builds no class name from a template', () => {
    // The failure this guards is invisible: Tailwind never emits a class it
    // cannot read literally, so an interpolated wash yields an element with a
    // class attribute that matches no CSS rule at all.
    for (const value of [
      ...Object.values(STATUS_TOGGLE_WASH),
      ...Object.values(STATUS_SEGMENT_WASH),
    ]) {
      expect(value).not.toContain('${');
    }
  });
});
