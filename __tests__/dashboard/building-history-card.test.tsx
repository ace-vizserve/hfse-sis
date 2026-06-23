/**
 * Tests for the BuildingHistoryCard variants.
 *
 * Verifies:
 * - Default (no variant / variant='building'): title includes "— building history…"
 * - variant='no-data': title renders the label verbatim, no "— building history…" suffix
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BuildingHistoryCard } from '@/components/dashboard/insights/building-history-card';

describe('BuildingHistoryCard', () => {
  it('default render contains "— building history…"', () => {
    render(<BuildingHistoryCard label="Seasonal trends" />);
    expect(screen.getByText(/— building history…/i)).toBeInTheDocument();
  });

  it('no variant prop renders with building suffix', () => {
    render(<BuildingHistoryCard label="Grade performance" />);
    expect(
      screen.getByText('Grade performance — building history…')
    ).toBeInTheDocument();
  });

  it('explicit variant="building" renders with building suffix', () => {
    render(<BuildingHistoryCard label="Attendance" variant="building" />);
    expect(
      screen.getByText('Attendance — building history…')
    ).toBeInTheDocument();
  });

  it('variant="no-data" renders the label verbatim without the "— building history…" suffix', () => {
    render(
      <BuildingHistoryCard label="No data for AY2025" variant="no-data" />
    );
    expect(screen.getByText('No data for AY2025')).toBeInTheDocument();
    expect(screen.queryByText(/— building history…/i)).not.toBeInTheDocument();
  });

  it('variant="no-data" uses the no-data default detail when none is supplied', () => {
    render(<BuildingHistoryCard label="Test" variant="no-data" />);
    expect(
      screen.getByText(
        /This year doesn't have enough data on record to compare against/i
      )
    ).toBeInTheDocument();
  });

  it('variant="no-data" renders a supplied custom detail', () => {
    render(
      <BuildingHistoryCard
        label="Custom"
        variant="no-data"
        detail="Pick another year."
      />
    );
    expect(screen.getByText('Pick another year.')).toBeInTheDocument();
  });
});
