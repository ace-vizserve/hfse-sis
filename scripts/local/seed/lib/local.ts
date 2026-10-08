// The LOCAL-ONLY guard, the service client, and direct SQL against the local
// Postgres container. Every phase gets its clients from here, never from its
// own `createClient`, so the guard cannot be skipped.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LOCAL_URL = /^https?:\/\/(127\.0\.0\.1|localhost)(:(\d+))?(\/|$)/;

/**
 * The local stack as `supabase/config.toml` defines it: the API port the URL
 * must use and the `project_id` the Postgres container is named after. Both
 * guards read the SAME file, so the URL the clients talk to and the container
 * `sql()` runs in are provably one stack.
 */
type LocalStack = { apiPort: number; projectId: string };
let stack: LocalStack | null = null;

function localStack(): LocalStack {
  if (stack) return stack;
  const path = resolve(process.cwd(), 'supabase/config.toml');
  let toml: string;
  try {
    toml = readFileSync(path, 'utf8');
  } catch {
    throw new Error(
      `Refusing to seed: cannot read ${path} (run from the repo root).`
    );
  }
  let section = '';
  let projectId: string | null = null;
  let apiPort: number | null = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const kv = line.match(/^([\w-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (section === '' && key === 'project_id') {
      projectId = value.replace(/^"(.*)"$/, '$1');
    } else if (section === 'api' && key === 'port') {
      apiPort = Number(value);
    }
  }
  if (!projectId || !/^[\w-]+$/.test(projectId)) {
    throw new Error(
      `Refusing to seed: no usable project_id in ${path} (got ${projectId ?? 'none'}).`
    );
  }
  if (!apiPort || !Number.isInteger(apiPort)) {
    throw new Error(`Refusing to seed: no [api] port in ${path}.`);
  }
  stack = { apiPort, projectId };
  return stack;
}

/**
 * Refuses to go on unless the Supabase URL is the local stack. Called once by
 * the runner before any phase, and again by `service()` / `sql()` so a phase
 * imported on its own is still guarded.
 */
export function assertLocal(): {
  url: string;
  serviceKey: string;
  anonKey: string;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const m = url.match(LOCAL_URL);
  if (!m) {
    throw new Error(
      `Refusing to seed: ${url || '(no NEXT_PUBLIC_SUPABASE_URL)'} is not the local stack (127.0.0.1 / localhost only).`
    );
  }
  const { apiPort } = localStack();
  const port = m[3] ? Number(m[3]) : url.startsWith('https') ? 443 : 80;
  if (port !== apiPort) {
    throw new Error(
      `Refusing to seed: ${url} uses port ${port}, but supabase/config.toml's [api] port is ${apiPort} — not this repo's local stack.`
    );
  }
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY is not set.');
  return { url, serviceKey, anonKey };
}

let cached: SupabaseClient | null = null;

/** Service-role client for the LOCAL stack. */
export function service(): SupabaseClient {
  if (cached) return cached;
  const { url, serviceKey } = assertLocal();
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** A fresh anon client (sign-in checks). */
export function anon(): SupabaseClient {
  const { url, anonKey } = assertLocal();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The local stack's Postgres container. `npx supabase start` names it
 * `supabase_db_<project_id>`, and the name is derived from the same
 * `supabase/config.toml` the URL's port was checked against — there is no
 * override. This runs `docker exec`, so it can only ever reach a container on
 * this machine.
 */
function container(): string {
  return `supabase_db_${localStack().projectId}`;
}

/**
 * Runs SQL in the local Postgres as `postgres` and returns psql's unaligned,
 * tuples-only output (rows on lines, columns split by `|`). Stops on the first
 * error. For the few things PostgREST cannot do: the wipe, schema reads.
 */
export function sql(statement: string): string {
  assertLocal();
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container(),
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-t',
      '-A',
    ],
    { input: statement, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  ).trim();
}

/** `sql()` split into rows of columns. */
export function sqlRows(statement: string): string[][] {
  const out = sql(statement);
  if (!out) return [];
  return out.split(/\r?\n/).map((line) => line.split('|'));
}

/** Unwraps a supabase-js `{ data, error }`, naming what failed. No data is a failure too. */
export async function must<T>(
  what: string,
  q: PromiseLike<{ data: T; error: { message: string } | null }>
): Promise<NonNullable<T>> {
  const { data, error } = await q;
  if (error) throw new Error(`${what}: ${error.message}`);
  if (data == null) throw new Error(`${what}: no data returned`);
  return data;
}
