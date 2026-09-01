import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from '@/components/ui/sidebar';

// CTRL+B BELONGS TO BOLD, NOT TO THE SIDEBAR.
//
// shadcn's sidebar ships a Ctrl/Cmd+B toggle. Since every multi-line field in
// this app became a formatting editor (KD #205), that is the shortcut for
// bold — and BOTH fired: the editor bolded the selection, the event bubbled
// to the window listener, and the sidebar slid open or shut underneath. Mr
// Ace hit it immediately: bolding a word in a write-up moved the whole page.
//
// ⚠ This is a vendored shadcn component, so `shadcn add sidebar` will put the
// shortcut straight back. That is what this test is for — it will not survive
// an upgrade unless someone reads the note in `sidebar.tsx` and re-removes it.

function Harness() {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar>
        <SidebarContent>
          <span data-testid="sidebar-body">Navigation</span>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

/**
 * The desktop sidebar wrapper carries `data-state="expanded" | "collapsed"`
 * alongside `data-side` and `data-variant`. It has no `data-slot` — reaching
 * for one is what made the first version of this file pass while asserting
 * `undefined === undefined`.
 */
function sidebarState(): string | null | undefined {
  return document
    .querySelector('[data-state][data-side][data-variant]')
    ?.getAttribute('data-state');
}

describe('the sidebar does not claim the bold shortcut', () => {
  // ⚠ Assert the state is a REAL value first, every time. `sidebarState()`
  // returns undefined if the selector ever stops matching, and then
  // `expect(undefined).toBe(undefined)` would pass while testing nothing —
  // the failure mode where this file quietly stops guarding anything.

  it('ignores Ctrl+B', () => {
    render(<Harness />);
    expect(screen.getByTestId('sidebar-body')).toBeInTheDocument();
    expect(sidebarState()).toBe('expanded');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });

    expect(sidebarState()).toBe('expanded');
  });

  it('ignores Cmd+B, which is the same collision on a Mac', () => {
    render(<Harness />);
    expect(sidebarState()).toBe('expanded');

    fireEvent.keyDown(window, { key: 'b', metaKey: true });

    expect(sidebarState()).toBe('expanded');
  });

  it('does not swallow the keystroke either', () => {
    // The old handler called preventDefault(). Even if the sidebar had stopped
    // toggling, eating the event would have stopped bold from ever reaching an
    // editor that had not already handled it.
    render(<Harness />);

    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
