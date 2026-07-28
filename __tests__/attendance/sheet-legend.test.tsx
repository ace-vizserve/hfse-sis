import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SheetLegend } from '@/components/attendance/sheet-legend';
import { STATUS_CELL_WASH } from '@/components/attendance/status-wash';

// The Term sheet's key, mounted in the register card above the grid. These
// assertions guard the two things that would silently break it: the swatch
// colours drifting away from the shared STATUS_CELL_WASH map the grid cells
// paint with (§10.2), and the NC mark chip leaking to teachers who can't set
// it.

describe('<SheetLegend>', () => {
  it('lists both groups', () => {
    render(<SheetLegend canWriteNc />);

    expect(screen.getByText('Cell marks')).toBeInTheDocument();
    expect(screen.getByText('Date columns')).toBeInTheDocument();
  });

  it('renders every mark and every date-column tag', () => {
    render(<SheetLegend canWriteNc />);

    for (const label of ['Present', 'Late', 'Excused', 'Absent']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of [
      'School day',
      'Public holiday',
      'School holiday',
      'Home-based, marked',
      'School event',
      'Examination',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // "No class" is both a mark and a day type — the sheet genuinely uses it
    // for both, so the legend shows it twice.
    expect(screen.getAllByText('No class')).toHaveLength(2);
  });

  it('hides the No class MARK when the viewer cannot set it, keeping the day type', () => {
    render(<SheetLegend canWriteNc={false} />);

    // Only the date-column chip survives.
    expect(screen.getAllByText('No class')).toHaveLength(1);
    // The other four marks are unaffected.
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(screen.getByText('Absent')).toBeInTheDocument();
  });

  it('paints mark swatches from the shared STATUS_CELL_WASH map', () => {
    render(<SheetLegend canWriteNc />);

    // The swatch is the sibling before the description label.
    const swatch = screen.getByText('Present').previousElementSibling;
    expect(swatch).not.toBeNull();
    for (const cls of STATUS_CELL_WASH.P.split(' ')) {
      expect(swatch).toHaveClass(cls);
    }
  });
});
