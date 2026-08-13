/**
 * A COMPLETE mock of the toast facade, for tests that mock `sonner`.
 *
 * WHY THIS EXISTS. `sonner` is not a real package here — it is a path alias
 * (`tsconfig.json:23`) onto the hand-written sileo facade at
 * `components/ui/sonner.tsx`, which exports ten methods. Every test that mocked
 * it supplied two: `{ success, error }`. That was sufficient only for as long
 * as call sites used nothing else.
 *
 * The moment a component shows a pending toast it calls `toast.loading` and
 * `toast.dismiss`, and a two-method mock fails with `undefined is not a
 * function` — in a file whose subject is the component, not the toast, so the
 * failure reads as a bug in the thing under test. Fourteen suites would have
 * broken at once, mid-sweep, all pointing at the wrong culprit.
 *
 * HOW TO USE IT. `vi.mock` is hoisted above imports, so its factory cannot
 * reference an imported symbol — but the factory may be async, and a dynamic
 * import inside it resolves to the same module instance as a normal top-level
 * import. Keep your own `vi.hoisted` spies for whatever you assert on and let
 * this fill in the rest:
 *
 *   vi.mock('sonner', async () => ({
 *     toast: {
 *       ...(await import('../_utils/mock-toast')).createToastMock(),
 *       success: toastSuccess,   // your hoisted spies still win
 *       error: toastError,
 *     },
 *   }));
 *
 * `loading` returns a stable id so code that keeps the id and dismisses it
 * later behaves as it does in the browser. Reset with `vi.clearAllMocks()` in
 * `afterEach`, which these suites already do.
 */
import { vi } from 'vitest';

/** The id `loading` hands back, so a test can assert the dismiss matches. */
export const MOCK_TOAST_ID = 'mock-toast-id';

export function createToastMock() {
  return {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    action: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
    loading: vi.fn(() => MOCK_TOAST_ID),
    // Mirrors the facade: runs the promise and resolves to the same value, so
    // a caller awaiting it is not left hanging.
    promise: vi.fn(<T>(p: Promise<T>) => p),
  };
}

export type ToastMock = ReturnType<typeof createToastMock>;
