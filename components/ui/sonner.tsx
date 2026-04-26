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

type ToastOpts = Omit<SileoOptions, 'title' | 'type'>;

function show(kind: 'success' | 'error' | 'warning' | 'info') {
  return (title: string, opts?: ToastOpts) =>
    sileo[kind]({ title, ...(opts ?? {}) });
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
  promise<T>(p: Promise<T>, msgs: SonnerPromiseMessages<T>) {
    const loading =
      typeof msgs.loading === 'string' ? { title: msgs.loading } : msgs.loading;

    const success =
      typeof msgs.success === 'string'
        ? { title: msgs.success }
        : typeof msgs.success === 'function'
          ? (data: T) => ({ title: String((msgs.success as (d: T) => string)(data)) })
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
  loading: (title: string, opts?: ToastOpts) =>
    sileo.show({ title, type: 'loading', ...(opts ?? {}) }),
  custom: (node: React.ReactNode) => sileo.show({ description: node }),
  message: (title: string, opts?: ToastOpts) =>
    sileo.show({ title, ...(opts ?? {}) }),
};
