import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GradingSheetPreview } from '@/components/sis/grading-sheet-preview';

describe('GradingSheetPreview', () => {
  it('renders one column chip per WW/PT slot plus one QA chip, matching the real sheet shape', () => {
    render(
      <GradingSheetPreview
        config={{ ww_max_slots: 5, pt_max_slots: 5, qa_max: 30 } as never}
      />
    );
    expect(screen.getAllByText(/^WW\d$/)).toHaveLength(5);
    expect(screen.getAllByText(/^PT\d$/)).toHaveLength(5);
    expect(screen.getByText('QA')).toBeInTheDocument();
    expect(screen.getByText('/30')).toBeInTheDocument();
  });

  it('scales the column count to a custom slot count', () => {
    render(
      <GradingSheetPreview
        config={{ ww_max_slots: 4, pt_max_slots: 5, qa_max: 40 } as never}
      />
    );
    expect(screen.getAllByText(/^WW\d$/)).toHaveLength(4);
    expect(screen.getByText('/40')).toBeInTheDocument();
  });
});
