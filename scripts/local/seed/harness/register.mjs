// Preloaded into the LOCAL seeder process (`--import`) so it can call the
// app's real `lib/**` writers without touching them.
//
// Two things stand between a plain Node process and `lib/**`:
//
//   1. `import 'server-only'` — the package throws unless resolved under the
//      `react-server` export condition. Solved on the command line, not here:
//      the runner starts with `--conditions=react-server`, which makes
//      `server-only` resolve to its empty file (and `react` to its server build,
//      which is where `cache` lives anyway).
//
//   2. `next/cache` — `revalidateTag` / `unstable_cache` throw outside a Next
//      request. This file redirects that ONE specifier to ./next-cache-stub.cjs,
//      for both resolution paths:
//        * CommonJS `require` (tsx compiles lib/*.ts to CJS in this package) —
//          by wrapping Module._resolveFilename;
//        * ESM `import` (dynamic imports, .mjs) — by a module.register hook.
//
//   3. `next/server`'s `after()` — throws outside a request; the markbook
//      phase meets it in the grade-change decision handler. Stubbed to drop
//      the (mail-only) callback; see ./next-server-stub.cjs.
//
// Plus one ALIAS (below): `@tiptap/html` under `require` → its server build.
//
// Nothing else is redirected. Add to STUBS only when a later phase meets a
// Next-only module it genuinely cannot run without.
import Module, { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ── No mail, ever ─────────────────────────────────────────────────────────
// The seeder runs the app's real writers, some of which email people when
// RESEND_API_KEY is set. Forced empty HERE — this file is preloaded by
// `--import`, so it runs after `--env-file` and before the runner or any
// lib/** module is evaluated — so no phase can send mail whatever the env
// file holds. Every lib/notifications/* sender no-ops on an empty key.
process.env.RESEND_API_KEY = '';

const STUBS = {
  'next/cache': new URL('./next-cache-stub.cjs', import.meta.url),
  // `after()` throws outside a request; the markbook phase decides grade
  // change requests through lib/change-requests/approval-handler.ts, which
  // calls it for its emails. Everything else in next/server is the real one.
  'next/server': new URL('./next-server-stub.cjs', import.meta.url),
};

// Not stubs — the package's OWN server build. `@tiptap/html` declares
// conditional exports: under `import` it picks `node` → dist/server (what
// Next's server bundle gets), but under `require` it has one entry, the
// browser build, whose generateJSON throws outside a browser. tsx compiles
// lib/** to CommonJS, so lib/rich-text's `proseLength` (the change-request and
// correction routes' 20-character floor) would get the browser build. The
// alias sends `require` to the same server build Next uses.
const ALIASES = {
  '@tiptap/html': '@tiptap/html/server',
};

// ── CommonJS ──────────────────────────────────────────────────────────────
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveWithStubs(request, ...rest) {
  const stub = STUBS[request];
  if (stub) return fileURLToPath(stub);
  const alias = ALIASES[request];
  if (alias) return originalResolve.call(this, alias, ...rest);
  return originalResolve.call(this, request, ...rest);
};

// ── ESM ───────────────────────────────────────────────────────────────────
const hooks = `
const STUBS = ${JSON.stringify(
  Object.fromEntries(Object.entries(STUBS).map(([k, v]) => [k, v.href]))
)};
export async function resolve(specifier, context, next) {
  const url = STUBS[specifier];
  if (url) return { url, shortCircuit: true, format: 'commonjs' };
  return next(specifier, context);
}
`;
register(
  `data:text/javascript,${encodeURIComponent(hooks)}`,
  pathToFileURL('./')
);
