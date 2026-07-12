import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApplicationFormLevelPreview } from '@/components/sis/levels-manager-client';
import type { LevelRow } from '@/lib/sis/levels';

// Full real LevelRow shape (id, code, label, levelType, sortOrder,
// nextLevelId, isCore) — the brief's fixture was missing levelType +
// sortOrder, which the real type requires.
const LEVELS: LevelRow[] = [
  {
    id: 'p3',
    code: 'P3',
    label: 'Primary 3',
    levelType: 'primary',
    sortOrder: 3,
    nextLevelId: 'p4',
    isCore: true,
  },
  {
    id: 'p4',
    code: 'P4',
    label: 'Primary 4',
    levelType: 'primary',
    sortOrder: 4,
    nextLevelId: null,
    isCore: true,
  },
  {
    id: 'cs1',
    code: 'CS1',
    label: 'Cambridge Stage 1',
    levelType: 'secondary',
    sortOrder: 14,
    nextLevelId: null,
    isCore: false,
  },
];

describe('ApplicationFormLevelPreview', () => {
  it('shows offered levels as selectable and shelved levels struck through', () => {
    render(
      <ApplicationFormLevelPreview
        levels={LEVELS}
        offeredLevelIds={['p3', 'p4']}
      />
    );
    expect(screen.getByText('Primary 3')).toBeInTheDocument();
    expect(screen.getByText('Primary 4')).toBeInTheDocument();
    expect(
      screen.getByText(/Cambridge Stage 1 — not shown/)
    ).toBeInTheDocument();
  });

  it("marks a returning student's next-level suggestion, when provided", () => {
    render(
      <ApplicationFormLevelPreview
        levels={LEVELS}
        offeredLevelIds={['p3', 'p4']}
        returningFromLevelId="p3"
      />
    );
    expect(screen.getByText(/suggested/)).toBeInTheDocument();
  });

  it('renders a core level as offered even when offeredLevelIds omits it (isCore || has(id))', () => {
    // Core levels never get ay_level_offerings rows (KD #153) — the preview
    // must replicate the main component's `level.isCore || offeredSet.has(id)`
    // check, not just `offeredSet.has(id)` alone, or every core level would
    // incorrectly render "not shown" whenever offeredLevelIds is empty/partial.
    render(
      <ApplicationFormLevelPreview levels={LEVELS} offeredLevelIds={[]} />
    );
    expect(screen.getByText('Primary 3')).toBeInTheDocument();
    expect(screen.getByText('Primary 4')).toBeInTheDocument();
    expect(screen.queryByText(/Primary 3 — not shown/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Primary 4 — not shown/)).not.toBeInTheDocument();
    // The non-core level with no offering row is still correctly shelved.
    expect(
      screen.getByText(/Cambridge Stage 1 — not shown/)
    ).toBeInTheDocument();
  });
});
