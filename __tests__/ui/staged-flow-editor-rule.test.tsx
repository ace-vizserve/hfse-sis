/**
 * The approvers screen's "Any one of them approves" / "Everyone must approve"
 * setting (migration 145).
 *
 * Pinned:
 *   1. The one-line summary of a card says "and" for a step that needs everyone.
 *   2. Every step shows the setting; on a form adviser step it is disabled,
 *      with the reason in one line.
 *   3. An "everyone" step with one person says it works the same as "any one".
 *   4. Clicking the other setting saves it straight away, for that step.
 *   5. The Add-step dialog sends the setting, and switching to the adviser
 *      step takes "everyone" off the table.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowConfig, StageApproverView } from '@/lib/approvals/readiness';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(async (..._args: unknown[]) => ({
    ok: true,
    message: 'Saved.',
  })),
}));
vi.mock('@/lib/query/fetcher', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));
// The write lifecycle (toasts, refresh) is covered by its own tests; here only
// what gets sent matters.
vi.mock('@/lib/hooks/use-write-action', () => ({
  useWriteAction:
    () =>
    async (
      work: () => Promise<unknown>,
      opts: { onResolved?: () => void } = {}
    ) => {
      await work();
      opts.onResolved?.();
    },
}));

import { StagedFlowEditor } from '@/components/sis/staged-flow-editor';

function person(displayName: string): StageApproverView {
  return {
    id: `row-${displayName}`,
    userId: `u-${displayName}`,
    email: `${displayName}@hfse.test`,
    displayName,
    role: 'school_admin',
    disabled: false,
    appliesToLevelType: null,
  };
}

const BOARD: FlowConfig = {
  flow: 'markbook.grade_change_aeb',
  stages: [
    {
      id: 'st-adviser',
      flow: 'markbook.grade_change_aeb',
      stageOrder: 1,
      label: 'Form class adviser',
      resolver: 'form_adviser',
      approvalRule: 'any',
      approvers: [],
    },
    {
      id: 'st-board',
      flow: 'markbook.grade_change_aeb',
      stageOrder: 2,
      label: 'Board',
      resolver: 'named',
      approvalRule: 'all',
      approvers: [person('Mr Gary'), person('Ms Nina')],
    },
    {
      id: 'st-chair',
      flow: 'markbook.grade_change_aeb',
      stageOrder: 3,
      label: 'Chair',
      resolver: 'named',
      approvalRule: 'all',
      approvers: [person('Ms Norma')],
    },
    {
      id: 'st-pair',
      flow: 'markbook.grade_change_aeb',
      stageOrder: 4,
      label: 'Pair',
      resolver: 'named',
      approvalRule: 'any',
      approvers: [person('Mr Tan'), person('Ms Lee')],
    },
  ],
};

function renderEditor() {
  return render(<StagedFlowEditor flows={[BOARD]} staff={[]} />);
}

function settingFor(label: string) {
  // A single-choice toggle group is a radio group to assistive technology.
  return screen.getByRole('radiogroup', {
    name: `How many people must approve ${label}`,
  });
}

beforeEach(() => {
  apiFetchMock.mockClear();
});

describe('StagedFlowEditor — one of them, or all of them', () => {
  it('summarises an "everyone" step with "and" and an "any" step with "or"', () => {
    renderEditor();
    const summary = screen.getByRole('list', { name: 'Steps in order' });
    expect(
      within(summary).getByText('Mr Gary and Ms Nina')
    ).toBeInTheDocument();
    expect(within(summary).getByText('Mr Tan or Ms Lee')).toBeInTheDocument();
  });

  it('shows the setting on every step, disabled with a reason on the adviser step', () => {
    renderEditor();
    const adviser = settingFor('Form class adviser');
    for (const item of within(adviser).getAllByRole('radio')) {
      expect(item).toBeDisabled();
    }
    expect(
      screen.getByText(
        'Who advises a class changes when someone covers it, so any one adviser approves this step.'
      )
    ).toBeInTheDocument();

    const board = settingFor('Board');
    expect(
      within(board).getByRole('radio', { name: 'Everyone must approve' })
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      within(board).getByRole('radio', { name: 'Any one of them approves' })
    ).not.toBeDisabled();
  });

  it('says a one-person "everyone" step works the same as "any one"', () => {
    renderEditor();
    expect(
      screen.getByText(
        'Only one person is on this step, so this works the same as “Any one of them approves”.'
      )
    ).toBeInTheDocument();
  });

  it('saves the other setting on click, for that step only', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(
      within(settingFor('Pair')).getByRole('radio', {
        name: 'Everyone must approve',
      })
    );
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetchMock.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe('/api/sis/admin/approval-stages/st-pair');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ approval_rule: 'all' });
  });

  it('does not save when the chosen setting is clicked again', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(
      within(settingFor('Board')).getByRole('radio', {
        name: 'Everyone must approve',
      })
    );
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('adds a step with the setting, and takes "everyone" away from an adviser step', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Add a step' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Step name'), 'Board chair');
    const setting = within(dialog).getByRole('radiogroup', {
      name: 'How many of them must approve',
    });
    await user.click(
      within(setting).getByRole('radio', { name: /Everyone must approve/ })
    );

    // Switching to the adviser step resets and disables the choice.
    await user.click(
      within(dialog).getByRole('radio', {
        name: /The child's form class adviser/,
      })
    );
    const everyone = within(setting).getByRole('radio', {
      name: /Everyone must approve/,
    });
    expect(everyone).toBeDisabled();
    expect(
      within(setting).getByRole('radio', { name: /Any one of them approves/ })
    ).toBeChecked();

    // Back to named people, choose everyone, and add.
    await user.click(
      within(dialog).getByRole('radio', { name: /Specific people/ })
    );
    await user.click(everyone);
    await user.click(
      within(dialog).getByRole('button', { name: 'Add the step' })
    );

    const [url, init] = apiFetchMock.mock.calls.at(-1) as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe('/api/sis/admin/approval-stages');
    expect(JSON.parse(init.body)).toEqual({
      flow: 'markbook.grade_change_aeb',
      label: 'Board chair',
      resolver: 'named',
      approval_rule: 'all',
    });
  });
});
