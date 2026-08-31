'use client';

import * as React from 'react';
import { sileo, Toaster as SileoToaster, type SileoOptions } from 'sileo';
import 'sileo/styles.css';

type SileoToasterProps = React.ComponentProps<typeof SileoToaster>;

type LegacySonnerProps = {
  richColors?: boolean;
  closeButton?: boolean;
};

export type ToasterProps = SileoToasterProps & LegacySonnerProps;

export function Toaster(props: ToasterProps) {
  const { richColors: _r, closeButton: _c, theme = 'light', ...rest } = props;
  return <SileoToaster theme={theme} {...rest} />;
}

// Sonner's `action: { label, onClick }` shape — translated below into
// sileo's `button: { title, onClick }` so call sites can keep using the
// sonner-shaped API without knowing about the underlying primitive.
type SonnerAction = { label: string; onClick: () => void };

type ToastOpts = Omit<SileoOptions, 'title' | 'type'> & {
  action?: SonnerAction;
  /**
   * Which slot this toast occupies. Sileo reads it (`createToast`) and falls
   * back to the literal `"sileo-default"` when it is absent — so EVERY toast
   * raised without one shares a single id. It is not in `SileoOptions`, which
   * is a gap in the package's types rather than a missing feature: `dismiss`
   * takes an id and `show` returns one, and neither means anything unless a
   * toast can carry its own.
   *
   * Why it matters: `dismiss` does not remove a toast, it flags it as leaving
   * and schedules a delete BY ID 600ms later. With one shared id that delete
   * lands on whatever occupies the slot when it fires — which was reliably the
   * NEXT toast, not the dismissed one. Give a toast its own id whenever
   * something else may be raised near it. See `lib/hooks/use-write-action.ts`.
   */
  id?: string;
};

// Convert the sonner-shaped `action` (if present) into sileo's `button`.
// If both are passed, explicit `button` wins — escape hatch for callers
// that need sileo-native semantics.
function normalizeOpts(opts?: ToastOpts): Omit<SileoOptions, 'title' | 'type'> {
  if (!opts) return {};
  const { action, button, ...rest } = opts;
  const resolvedButton =
    button ??
    (action ? { title: action.label, onClick: action.onClick } : undefined);
  return resolvedButton ? { ...rest, button: resolvedButton } : rest;
}

function show(kind: 'success' | 'error' | 'warning' | 'info' | 'action') {
  return (title: string, opts?: ToastOpts) =>
    sileo[kind]({ title, ...normalizeOpts(opts) });
}

type SonnerPromiseMessages<T> = {
  loading: string | { title: string };
  success: string | ((data: T) => string) | { title: string };
  error: string | ((err: unknown) => string) | { title: string };
};

export const toast = {
  success: show('success'),
  error: show('error'),
  warning: show('warning'),
  info: show('info'),
  // Sileo's "action" state — visually distinct toast with a built-in button
  // slot. Pair with `button: { title, onClick }` (sileo-native) or the
  // sonner-shaped `action: { label, onClick }` — both are normalised below.
  action: show('action'),
  promise<T>(p: Promise<T>, msgs: SonnerPromiseMessages<T>) {
    const loading =
      typeof msgs.loading === 'string' ? { title: msgs.loading } : msgs.loading;

    const success =
      typeof msgs.success === 'string'
        ? { title: msgs.success }
        : typeof msgs.success === 'function'
          ? (data: T) => ({
              title: String((msgs.success as (d: T) => string)(data)),
            })
          : msgs.success;

    const error =
      typeof msgs.error === 'string'
        ? { title: msgs.error }
        : typeof msgs.error === 'function'
          ? (err: unknown) => ({
              title: String((msgs.error as (e: unknown) => string)(err)),
            })
          : msgs.error;

    return sileo.promise(p, { loading, success, error });
  },
  dismiss: (id?: string) => {
    if (id) sileo.dismiss(id);
    else sileo.clear();
  },
  // A pending toast lasts until the work it describes finishes, so it opts out
  // of the auto-dismiss every other toast gets: `duration: null` is sileo's
  // "stay until dismissed". Without it this inherited the default timeout and
  // vanished mid-write, which nobody had noticed because nothing called it.
  //
  // Returns sileo's toast id — the caller MUST keep it and `toast.dismiss(id)`
  // when the work settles, or the toast stays on screen forever. In practice
  // that bookkeeping belongs to `useWriteAction`, not to call sites.
  //
  // An explicit `duration` in opts still wins; the spread is deliberately last.
  loading: (title: string, opts?: ToastOpts): string =>
    sileo.show({
      title,
      type: 'loading',
      duration: null,
      ...normalizeOpts(opts),
    }),
  custom: (node: React.ReactNode) => sileo.show({ description: node }),
  message: (title: string, opts?: ToastOpts) =>
    sileo.show({ title, ...normalizeOpts(opts) }),
};
