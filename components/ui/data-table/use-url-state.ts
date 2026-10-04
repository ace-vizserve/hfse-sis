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

/**
 * The slice of the query string this table owns, in a stable order — keys
 * under its namespace, or every undotted key when it has none (the same
 * ownership rule `write` uses). Two URLs with equal signatures mean the same
 * table state, whatever else the query carries.
 */
export function urlStateSignature(
  params: URLSearchParams | { forEach: URLSearchParams['forEach'] } | null,
  namespace?: string
): string {
  if (!params) return '';
  const own: string[] = [];
  params.forEach((value, k) => {
    const mine = namespace ? k.startsWith(`${namespace}.`) : !k.includes('.');
    if (mine) own.push(`${k}=${value}`);
  });
  return own.sort().join('&');
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

  // The table's own slice of the URL as it stands now. When it changes to
  // something this hook did not write, the URL was changed from OUTSIDE the
  // table — a link into the page with new filters — and the table must
  // re-seed from it. That matters because `cacheComponents` keeps a visited
  // page alive in React <Activity>: its useState survives navigation, so
  // filters seeded only at mount would otherwise stay at whatever the first
  // visit set (and the write effects would push that stale filter back into
  // the URL).
  //
  // `pending` holds what we wrote but have not seen arrive yet: router.replace
  // commits only after the server render, so two quick filter clicks can
  // write twice before the first lands — that first arrival is still ours.
  const signature = enabled ? urlStateSignature(params, namespace) : '';
  const observedRef = useRef<string>(signature);
  const pendingRef = useRef<string[]>([]);
  useEffect(() => {
    const i = pendingRef.current.indexOf(signature);
    if (i >= 0) pendingRef.current.splice(0, i + 1);
    observedRef.current = signature;
  }, [signature]);

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
        // Nothing changed — skip the navigation, and don't queue a signature
        // that will never "arrive".
        if (next.toString() === (params?.toString() ?? '')) return;
        pendingRef.current = [
          ...pendingRef.current,
          urlStateSignature(next, namespace),
        ].slice(-10);
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

  /** True when the table's slice of the URL changed and this hook did not
   *  write the new value — the caller should re-seed its state from `read()`. */
  const isExternal =
    enabled &&
    signature !== observedRef.current &&
    !pendingRef.current.includes(signature);

  return { read, write, signature, isExternal };
}
