'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type UrlStateConfig = {
  enabled: boolean;
  namespace?: string;
  paramKeys?: {
    search?: string;
    status?: string;
    mine?: string;
  };
  debounceMs?: number;
};

export type UrlStateSnapshot = {
  search?: string;
  status?: string;
  mine?: boolean;
  facets: Record<string, string[]>;
  page?: number;
  pageSize?: number;
};

const DEFAULT_DEBOUNCE = 300;

function key(name: string, ns?: string) {
  return ns ? `${ns}.${name}` : name;
}

export function useUrlState(config: UrlStateConfig) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const {
    enabled,
    namespace,
    paramKeys,
    debounceMs = DEFAULT_DEBOUNCE,
  } = config;
  const searchKey = key(paramKeys?.search ?? 'q', namespace);
  const statusKey = key(paramKeys?.status ?? 'status', namespace);
  const mineKey = key(paramKeys?.mine ?? 'mine', namespace);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const read = useCallback((): UrlStateSnapshot => {
    if (!enabled || !params) return { facets: {} };
    const facets: Record<string, string[]> = {};
    const reservedKeys = new Set([
      searchKey,
      statusKey,
      mineKey,
      key('page', namespace),
      key('pageSize', namespace),
    ]);
    params.forEach((value, k) => {
      if (reservedKeys.has(k)) return;
      const stripped =
        namespace && k.startsWith(`${namespace}.`)
          ? k.slice(namespace.length + 1)
          : k;
      if (!namespace || k.startsWith(`${namespace}.`)) {
        facets[stripped] = value.split(',').filter(Boolean);
      }
    });
    return {
      search: params.get(searchKey) ?? undefined,
      status: params.get(statusKey) ?? undefined,
      mine: params.get(mineKey) === '1' || undefined,
      facets,
      page: params.get(key('page', namespace))
        ? Number(params.get(key('page', namespace)))
        : undefined,
      pageSize: params.get(key('pageSize', namespace))
        ? Number(params.get(key('pageSize', namespace)))
        : undefined,
    };
  }, [enabled, params, searchKey, statusKey, mineKey, namespace]);

  const write = useCallback(
    (
      // A debounced caller can pass a THUNK so the snapshot is resolved at
      // fire time, not schedule time — page/pageSize must reflect the state
      // AFTER the shell's "filter change resets to page 1" effect has run,
      // never a value captured ~300ms earlier.
      snapshot: UrlStateSnapshot | (() => UrlStateSnapshot),
      { debounce = false }: { debounce?: boolean } = {}
    ) => {
      if (!enabled) return;
      const apply = () => {
        debounceRef.current = null;
        const snap = typeof snapshot === 'function' ? snapshot() : snapshot;
        const next = new URLSearchParams(params?.toString() ?? '');
        const set = (k: string, v: string | undefined) => {
          if (v === undefined || v === '') next.delete(k);
          else next.set(k, v);
        };
        set(searchKey, snap.search);
        set(statusKey, snap.status);
        set(mineKey, snap.mine ? '1' : undefined);
        set(
          key('page', namespace),
          snap.page && snap.page > 1 ? String(snap.page) : undefined
        );
        set(
          key('pageSize', namespace),
          snap.pageSize ? String(snap.pageSize) : undefined
        );
        const reserved = new Set([
          searchKey,
          statusKey,
          mineKey,
          key('page', namespace),
          key('pageSize', namespace),
        ]);
        for (const k of Array.from(next.keys())) {
          if (reserved.has(k)) continue;
          if (namespace && !k.startsWith(`${namespace}.`)) continue;
          if (!namespace && k.includes('.')) continue;
          next.delete(k);
        }
        for (const [k, vs] of Object.entries(snap.facets)) {
          if (vs.length === 0) continue;
          next.set(key(k, namespace), vs.join(','));
        }
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      };
      if (debounce) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(apply, debounceMs);
      } else {
        // A non-debounced write carries the FULL current snapshot (the
        // shell's immediate-write effect includes search too) — cancel any
        // pending debounced write so its stale snapshot can't clobber this
        // one when the timer fires.
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        apply();
      }
    },
    [
      enabled,
      params,
      pathname,
      router,
      searchKey,
      statusKey,
      mineKey,
      namespace,
      debounceMs,
    ]
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  return { read, write };
}
