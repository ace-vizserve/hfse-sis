// Extends Vitest's `expect` with jest-dom matchers (toBeInTheDocument,
// toBeDisabled, …) and registers RTL's automatic cleanup via the global
// afterEach (test.globals = true).
import '@testing-library/jest-dom/vitest';

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
