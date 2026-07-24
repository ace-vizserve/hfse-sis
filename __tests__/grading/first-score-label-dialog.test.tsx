import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FirstScoreLabelDialog } from '@/components/grading/first-score-label-dialog';

describe('FirstScoreLabelDialog', () => {
  it('WW/PT mode: Save is disabled until BOTH description and date are filled', () => {
    const onConfirm = vi.fn();
    render(
      <FirstScoreLabelDialog
        open
        kind="ww"
        slotCode="W2"
        seedMeta={{ label: '', date: '', page: '' }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Worksheet 2' },
    });
    expect(save).toBeDisabled(); // date still missing

    // DateAdministeredField (components/grading/date-administered-field.tsx)
    // renders a DatePicker (popover + calendar — not practical to drive in
    // jsdom) plus a plain "Mark as ongoing" quick-set button. 'Ongoing' is a
    // valid satisfied date per slotMetaSatisfied, so clicking it is the
    // simplest real interaction that exercises the date requirement.
    fireEvent.click(screen.getByRole('button', { name: /mark as ongoing/i }));
    expect(save).not.toBeDisabled();
  });

  it('QA mode: Save requires only a description, no date/page fields render', () => {
    render(
      <FirstScoreLabelDialog
        open
        kind="qa"
        slotCode="QA"
        seedMeta={{ label: '' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(
      screen.queryByLabelText(/date administered/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/page/i)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Quarterly Exam' },
    });
    expect(save).not.toBeDisabled();
  });

  it('Save fires onConfirm with the entered metadata', () => {
    const onConfirm = vi.fn();
    render(
      <FirstScoreLabelDialog
        open
        kind="qa"
        slotCode="QA"
        seedMeta={{ label: '' }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Quarterly Exam' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Quarterly Exam' })
    );
  });

  it('Cancel fires onCancel, not onConfirm', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <FirstScoreLabelDialog
        open
        kind="ww"
        slotCode="W1"
        seedMeta={{ label: '', date: '', page: '' }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
