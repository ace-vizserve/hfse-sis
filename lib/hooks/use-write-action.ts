'use client';

import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { useRefreshTransition } from '@/lib/hooks/use-refresh-transition';

// One lifecycle for every write: pending toast → do the work → let the surface
// react → wait for the screen to actually change → say what happened.
//
// WHAT IT FIXES. Writes were reporting success at the wrong moment. A mutation
// resolves, we toast "Saved", close the dialog and re-enable the button — and
// the list underneath is still the old list, because `router.refresh()` was
// fired and not awaited. The user is told the work is done while it visibly
// is not. Holding the indicator across the re-render closes that gap, which is
// the difference between "slow" and "broken-feeling".
//
// IT WRAPS THE PROMISE, NOT `useMutation`. Deliberate. Replacing `useMutation`
// would mean absorbing every branch its call sites already rely on —
// `onMutate` optimistic snapshots
// (components/admissions/document-validation/validation-queue.tsx:160-169),
// error handlers that open a dialog instead of toasting
// (components/grading/lock-toggle.tsx:77-95) — and the API would either bloat
// to fit them or quietly exclude them. Wrapping is additive: mutations keep
// their `retry: 0`, their `ApiError` typing and their branches, and only the
// toast and refresh lines move.
//
// IT USES `toast.loading` + `toast.dismiss`, NOT `toast.promise`. `toast.promise`
// gives no toast id back (sileo exposes no update-in-place API), and the id is
// what makes three things possible: suppressing the pending toast for a write
// that finishes quickly, dismissing it when the surface answers an error with a
// dialog instead, and cleaning it up on unmount. Without the id a pending toast
// has no owner, and this one has no timeout.

/**
 * How long a write may take before it earns a pending toast. Under this, the
 * work is done before a spinner would have registered and only the success
 * toast shows — no flash. This is `docs/context/09-design-system.md:230`'s
 * 300ms rule applied to the toast channel.
 */
export const PENDING_DELAY_MS = 250;

/**
 * Every toast raised without an id shares sileo's single `"sileo-default"`
 * slot, and dismissing one schedules a delete BY ID 600ms out — which then
 * lands on whatever is in the slot at the time. A pending toast is the one
 * kind that reliably has company (the outcome that replaces it, or a toast the
 * surface raises itself), so it gets a slot nobody else writes to.
 */
let pendingToastSeq = 0;

export type WriteActionOptions<T> = {
  /**
   * Shown while the write is in flight, if it takes longer than
   * PENDING_DELAY_MS.
   *
   * `false` means this surface shows the change itself and a toast would be
   * noise — an optimistic list that has already removed the row, or an inline
   * "Saved" affordance. It is not optional, so every call states a decision,
   * and `pending: false` is greppable.
   */
  pending: string | false;

  /**
   * What to say when it worked. Receives the parsed response body.
   *
   * Return `null` when the surface has already said it — the mirror of
   * `error`'s null. Added for the one case that needed it: an upload can
   * succeed and still come back with `body.warning`, which must be reported as
   * a WARNING and not recoloured as a success
   * (`components/p-files/upload-dialog.tsx`). Without this the choice was a
   * green toast carrying warning text, or two toasts for one action.
   */
  success: ToastMessage | ((data: T) => ToastMessage | null);

  /**
   * What to say when it failed. Receives the thrown error — usually an
   * `ApiError` carrying `.status` and the PARSED `.body`, so route-specific
   * codes can drive the wording. KD #24 forbids flattening those into a
   * generic message, which is why this takes the error rather than a string.
   *
   * Return `null` when the surface answers the error itself (a dialog
   * explaining a 409, say). The pending toast is dismissed and no error toast
   * appears — one signal per action, never a toast and a dialog saying the
   * same thing.
   *
   * Omit it to use the message `apiFetch` already resolved from the body.
   */
  error?: ToastMessage | ((err: unknown) => ToastMessage | null);

  /**
   * Runs after the write resolves and BEFORE the refresh is awaited. Close the
   * dialog here, reset the form here. The split is the point: the surface
   * reacts immediately while the toast keeps holding until the data on screen
   * is really new.
   */
  onResolved?: (data: T) => void;

  /**
   * Whether to wait for a server re-render. Defaults to true. Pass a predicate
   * when only the response can say — `assign-section-dialog.tsx:114-117` swaps
   * the dialog body instead of closing on one branch, and that branch does its
   * own refresh later.
   */
  refresh?: boolean | ((data: T) => boolean);
};

export type WriteAction = <T>(
  work: () => Promise<T>,
  opts: WriteActionOptions<T>
) => Promise<T | undefined>;

/**
 * `apiFetch` already resolves `body.error` / `body.message` into `Error.message`
 * (lib/query/fetcher.ts:31-38), so the server's own wording survives without
 * the call site doing anything.
 */
function defaultErrorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'Something went wrong.';
}

/**
 * Split a message into a toast TITLE and a DESCRIPTION.
 *
 * ⚠ WHY THIS EXISTS. Every outcome used to arrive as one string and land whole
 * in the title, so a toast read as a paragraph in bold. That is not a call-site
 * problem to fix 99 times: the messages are mostly SERVER text, written — as
 * this codebase's rules require — in plain English for school admins, which
 * means "what went wrong. what to do about it." Two sentences, and the second
 * one is a description by construction.
 *
 * So the first sentence becomes the title and the rest becomes the description.
 * A caller that wants control passes `{ title, description }` explicitly and
 * this never runs.
 *
 * ⚠ IT ONLY SPLITS WHEN SPLITTING HELPS. A short message stays whole — a
 * one-line "Saved" must not become a title with an empty description. A single
 * long sentence also stays whole: it is never cut mid-thought, because a
 * truncated title loses the half that said what happened.
 *
 * ⚠ A LONG FIRST SENTENCE STILL SPLITS, and the first version of this bailed
 * out when it was over the cap — which left the worst real message in the app
 * exactly as it was. Moving the remedy into the description is worth doing even
 * when the problem statement is long; the copy is then too long in ONE place
 * instead of two, and that is a sentence to rewrite, not a splitter to tune.
 */
const TITLE_MAX = 60;

/**
 * What a write says when it finishes.
 *
 * A bare string is the common case and is split for you. Pass the object form
 * when the split would land in the wrong place — a title that is not a
 * sentence, or a description that should say something the title does not.
 */
export type ToastMessage = string | { title: string; description?: string };

export function splitToastMessage(message: string): {
  title: string;
  description?: string;
} {
  const text = message.trim();
  if (text.length <= TITLE_MAX) return { title: text };

  // Sentence end followed by a space — not a decimal, not "e.g.", not an
  // abbreviation mid-sentence, because those are not followed by a capital.
  // `[\s\S]` rather than `.` with the `s` flag — this file's tsconfig target
  // predates es2018 and `s` is a compile error there.
  const match = text.match(/^(.+?[.!?])\s+(?=[A-Z(])([\s\S]+)$/);
  if (!match) return { title: text };

  const [, first, rest] = match;

  // Drop a trailing full stop from the title — headings do not take one, and
  // "!"/"?" carry meaning so they stay.
  return { title: first.replace(/\.$/, ''), description: rest.trim() };
}

/**
 * Returns `run`, which NEVER REJECTS: it resolves the parsed body, or
 * `undefined` if the write failed.
 *
 * That removes the `.catch(() => {})` incantation from call sites, and means an
 * unawaited call cannot raise an unhandled rejection (which fails tests rather
 * than merely warning). `undefined` is a safe sentinel — `apiFetch` returns
 * parsed JSON or text, never `undefined` (lib/query/fetcher.ts:48-60).
 */
export function useWriteAction(): WriteAction {
  const awaitRefresh = useRefreshTransition();
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const toastsRef = useRef(new Set<string>());

  // A pending toast has no timeout, so anything still open when this surface
  // goes away would stay on screen for the rest of the session.
  useEffect(() => {
    const timers = timersRef.current;
    const toasts = toastsRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      for (const id of toasts) toast.dismiss(id);
      timers.clear();
      toasts.clear();
    };
  }, []);

  return useCallback(
    async <T>(
      work: () => Promise<T>,
      opts: WriteActionOptions<T>
    ): Promise<T | undefined> => {
      let toastId: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      if (opts.pending !== false) {
        const label = opts.pending;
        timer = setTimeout(() => {
          if (timer) timersRef.current.delete(timer);
          timer = null;
          toastId = toast.loading(label, {
            id: `write-action-${++pendingToastSeq}`,
          });
          toastsRef.current.add(toastId);
        }, PENDING_DELAY_MS);
        timersRef.current.add(timer);
      }

      /**
       * Say how it went, and let go of the pending toast.
       *
       * THE OUTCOME TAKES OVER THE PENDING TOAST'S SLOT RATHER THAN FOLLOWING
       * A DISMISS. Two things about sileo make that necessary. Every toast
       * raised without an id lands in one shared slot; and `dismiss` does not
       * remove a toast on the spot — it flags it as leaving and schedules a
       * delete BY ID 600ms later. So "dismiss the pending toast, then show the
       * outcome" put the outcome into the slot the delete was already aimed
       * at, and it vanished about half a second after appearing. A six-second
       * message lasted ~600ms on every write slow enough to show "Saving…"
       * first, which is most of them.
       *
       * Re-using the pending toast's own id replaces it in place instead
       * (sileo swaps a same-id toast that is not already leaving), so no
       * delete is ever scheduled and the outcome keeps its full duration.
       *
       * `message === null` still dismisses: the surface is reporting the
       * outcome itself, so nothing is coming to take the slot and a pending
       * toast has no timeout of its own. THAT is why the pending toast holds a
       * private id — the surface's own toast sits in the shared slot, so this
       * dismiss can no longer take it down with us. It used to: an upload that
       * warned instead of succeeding, or an enrolment reporting "awaiting
       * class assignment", raised its toast and then had it deleted 600ms
       * later by this very line.
       */
      const settle = (
        raw: string | ToastMessage | null,
        show: (
          message: string,
          opts?: { id?: string; description?: string }
        ) => void
      ) => {
        // An explicit { title, description } is taken as written; a bare string
        // is split on its first sentence (see splitToastMessage).
        const message =
          raw === null
            ? null
            : typeof raw === 'string'
              ? splitToastMessage(raw)
              : { title: raw.title, description: raw.description };
        if (timer) {
          clearTimeout(timer);
          timersRef.current.delete(timer);
          timer = null;
        }
        if (message === null) {
          if (toastId) {
            toast.dismiss(toastId);
            toastsRef.current.delete(toastId);
            toastId = null;
          }
          return;
        }
        // Stop owning it — the outcome carries its own timeout, so the unmount
        // cleanup must not dismiss it later either.
        const slot = toastId;
        if (slot) {
          toastsRef.current.delete(slot);
          toastId = null;
        }
        // No pending toast means no slot to take over, and the outcome is the
        // only toast in flight — so it can have the shared one.
        // ⚠ Pass NO second argument when there is nothing to put in it. An
        // empty `{}` changes the call shape, and the hook's own tests assert
        // `toast.success('Saved')` with one argument — correctly, because a
        // stray options object is a behaviour change in the toast library's
        // hands, not ours.
        const description = message.description;
        if (slot && description) show(message.title, { id: slot, description });
        else if (slot) show(message.title, { id: slot });
        else if (description) show(message.title, { description });
        else show(message.title);
      };

      try {
        const data = await work();

        // The surface reacts now; the toast keeps holding.
        opts.onResolved?.(data);

        const wantsRefresh =
          typeof opts.refresh === 'function'
            ? opts.refresh(data)
            : (opts.refresh ?? true);
        if (wantsRefresh) await awaitRefresh();

        const message =
          typeof opts.success === 'function'
            ? opts.success(data)
            : opts.success;
        // `null` — the surface reported the outcome itself, in a tone this
        // helper cannot pick (a warning on an otherwise-successful write).
        settle(message, toast.success);
        return data;
      } catch (err) {
        const message =
          typeof opts.error === 'function'
            ? opts.error(err)
            : (opts.error ?? defaultErrorMessage(err));
        // `null` — the surface is showing its own explanation.
        settle(message, toast.error);
        return undefined;
      }
    },
    [awaitRefresh]
  );
}
