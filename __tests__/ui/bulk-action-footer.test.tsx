/**
 * `BulkActionFooter` — first tests it has had.
 *
 * `BulkAction.onTrigger` has always been typed `void | Promise<void>`
 * (bulk-action-footer.tsx:11) and the footer never awaited it, so a slow bulk
 * action showed nothing and could be fired twice. All three consumers today are
 * synchronous — they open a dialog that carries its own feedback — so these
 * tests exist to pin the contract before the first async consumer arrives,
 * which is exactly when nobody will think to check it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Mail } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BulkActionFooter } from '@/components/ui/data-table/bulk-action-footer';

type Row = { id: string };

const ROWS: Row[] = [{ id: 'a' }, { id: 'b' }];

/** A promise whose settling this test controls, so "in flight" is observable. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('BulkActionFooter', () => {
  it('renders nothing when the selection is empty', () => {
    const { container } = render(
      <BulkActionFooter<Row>
        selectedRows={[]}
        actions={[
          { key: 'notify', label: 'Send reminders', onTrigger: vi.fn() },
        ]}
        onClear={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('passes the selected rows to the action', async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(
      <BulkActionFooter<Row>
        selectedRows={ROWS}
        actions={[{ key: 'notify', label: 'Send reminders', onTrigger }]}
        onClear={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: /send reminders/i }));
    expect(onTrigger).toHaveBeenCalledWith(ROWS);
  });

  it('reports the count and clears the selection', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <BulkActionFooter<Row>
        selectedRows={ROWS}
        actions={[
          { key: 'notify', label: 'Send reminders', onTrigger: vi.fn() },
        ]}
        onClear={onClear}
      />
    );
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  describe('while an async action is in flight', () => {
    it('shows the triggering button as busy and disables everything else', async () => {
      const user = userEvent.setup();
      const gate = deferred();
      render(
        <BulkActionFooter<Row>
          selectedRows={ROWS}
          actions={[
            {
              key: 'notify',
              label: 'Send reminders',
              icon: Mail,
              onTrigger: () => gate.promise,
            },
            { key: 'archive', label: 'Archive', onTrigger: vi.fn() },
          ]}
          onClear={vi.fn()}
        />
      );

      const notify = screen.getByRole('button', { name: /send reminders/i });
      await user.click(notify);

      expect(notify).toHaveAttribute('aria-busy', 'true');
      expect(notify).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
      // Clearing would empty the selection and unmount the footer, taking the
      // running action's only progress indicator with it.
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();

      gate.resolve();
      await vi.waitFor(() => expect(notify).not.toHaveAttribute('aria-busy'));
      expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
    });

    it('ignores a second click on the same action', async () => {
      const user = userEvent.setup();
      const gate = deferred();
      const onTrigger = vi.fn(() => gate.promise);
      render(
        <BulkActionFooter<Row>
          selectedRows={ROWS}
          actions={[{ key: 'notify', label: 'Send reminders', onTrigger }]}
          onClear={vi.fn()}
        />
      );

      const notify = screen.getByRole('button', { name: /send reminders/i });
      await user.click(notify);
      await user.click(notify);
      expect(onTrigger).toHaveBeenCalledTimes(1);

      gate.resolve();
      await vi.waitFor(() => expect(notify).toBeEnabled());
    });
  });

  describe('when the action rejects', () => {
    // The footer can't word the error — only the action knows what it was
    // doing — but it must not leave the button spinning forever, and the
    // failure must land somewhere rather than vanishing.
    let consoleError: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      consoleError.mockRestore();
    });

    it('re-enables the buttons and logs the failure', async () => {
      const user = userEvent.setup();
      render(
        <BulkActionFooter<Row>
          selectedRows={ROWS}
          actions={[
            {
              key: 'notify',
              label: 'Send reminders',
              onTrigger: () => Promise.reject(new Error('nope')),
            },
          ]}
          onClear={vi.fn()}
        />
      );

      const notify = screen.getByRole('button', { name: /send reminders/i });
      await user.click(notify);

      await vi.waitFor(() => expect(notify).toBeEnabled());
      expect(notify).not.toHaveAttribute('aria-busy');
      expect(consoleError).toHaveBeenCalledWith(
        'Bulk action "notify" failed',
        expect.any(Error)
      );
    });
  });

  it('survives unmounting mid-action', async () => {
    const user = userEvent.setup();
    const gate = deferred();
    const { rerender } = render(
      <BulkActionFooter<Row>
        selectedRows={ROWS}
        actions={[
          {
            key: 'notify',
            label: 'Send reminders',
            onTrigger: () => gate.promise,
          },
        ]}
        onClear={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /send reminders/i }));

    // An action that clears the selection on success empties the footer while
    // its promise is still settling.
    rerender(
      <BulkActionFooter<Row>
        selectedRows={[]}
        actions={[
          {
            key: 'notify',
            label: 'Send reminders',
            onTrigger: () => gate.promise,
          },
        ]}
        onClear={vi.fn()}
      />
    );
    gate.resolve();
    await gate.promise;

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });
});
