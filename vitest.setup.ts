// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument,
// toBeDisabled, …) and registers RTL's automatic cleanup via the global
// afterEach (test.globals = true).
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Every screen in the app renders inside the `TooltipProvider` in
// app/layout.tsx, so any component carrying a `HoverHint` has one above it. A
// component test renders that component on its own with no layout above it,
// and Radix's `Tooltip` THROWS OUTRIGHT — "`Tooltip` must be used within
// `TooltipProvider`" — rather than degrading, so the moment a `title=`
// becomes a `HoverHint` every existing test of that component dies for a
// reason that has nothing to do with what it was testing.
//
// So `render()` supplies the same provider the real tree does, with the same
// delays app/layout.tsx sets. A test that passes its own `wrapper` keeps it,
// nested inside.
vi.mock('@testing-library/react', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@testing-library/react')>();
  const React = await import('react');
  const { TooltipProvider } = await import('./components/ui/tooltip');

  type Options = Parameters<typeof actual.render>[1];

  return {
    ...actual,
    render: (ui: React.ReactNode, options?: Options) => {
      const Inner = options?.wrapper;
      const Wrapper = ({ children }: { children?: React.ReactNode }) =>
        React.createElement(TooltipProvider, {
          delayDuration: 200,
          skipDelayDuration: 300,
          children: Inner
            ? React.createElement(Inner, null, children)
            : children,
        });
      return actual.render(ui, { ...options, wrapper: Wrapper });
    },
  };
});

// next/server's after() requires Next's internal request-scope
// (AsyncLocalStorage) to be live, which only exists while Next itself is
// invoking a route handler for a real request. Route/lib unit tests call
// the exported handlers directly, so after() throws "called outside a
// request scope" — mock it to just fire the callback (matching its
// don't-block-the-response semantics) so tests can exercise route logic
// without spinning up a real Next server.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (fn: () => unknown) => {
      void fn();
    },
  };
});

// jsdom is missing a handful of DOM APIs that Radix UI primitives (Sheet,
// Dialog, Select, …) call during interaction. Polyfill them so component
// tests that open these primitives don't throw.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
