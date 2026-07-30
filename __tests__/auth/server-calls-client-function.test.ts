/**
 * A Server Component must not CALL a plain function exported from a
 * `'use client'` module.
 *
 * Every export of a client module is a client reference. A Server Component can
 * render one as a component or pass it as a prop, but calling it throws at
 * request time:
 *
 *   "Attempted to call lockedRoleNote() from the server but lockedRoleNote is
 *    on the client."
 *
 * `next build` does NOT catch this — nothing about it is a type error, and the
 * page compiles. It surfaces only when someone opens the page. It shipped
 * exactly once, on /sis/admin/roles, and this test exists so the next one is a
 * red test instead of a broken page.
 *
 * Scope: pages and layouts that are NOT themselves client modules, importing
 * from a module that IS. Only lowercase-initial identifiers are checked —
 * components are capitalised by convention and are legitimately rendered, while
 * a lowercase import followed by `(` is a function call.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globSync } from 'tinyglobby';

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function isClientModule(source: string): boolean {
  // The directive must be the first statement; a mention in a comment is not
  // one, so anchor to the top of the file.
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*['"]use client['"]/.test(
    source
  );
}

/** Resolve a `@/...` import to a real file, trying the usual extensions. */
function resolveAlias(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const base = spec.slice(2);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (existsSync(join(ROOT, candidate))) return candidate;
  }
  return null;
}

type NamedImport = { name: string; from: string };

function namedImports(source: string): NamedImport[] {
  const out: NamedImport[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) {
    const names = m[1]
      .split(',')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      // `type Foo` imports vanish at runtime and can never be called.
      .filter((chunk) => !chunk.startsWith('type '))
      // `a as b` — the local binding is what gets called.
      .map((chunk) => {
        const parts = chunk.split(/\s+as\s+/);
        return (parts[1] ?? parts[0]).trim();
      });
    for (const name of names) out.push({ name, from: m[2] });
  }
  return out;
}

describe('server components never call client functions', () => {
  const serverFiles = globSync(['app/**/page.tsx', 'app/**/layout.tsx'], {
    cwd: ROOT,
  }).filter((file) => !isClientModule(read(file)));

  it('found server files to check', () => {
    // Guards against a glob or filter change silently emptying this test.
    expect(serverFiles.length).toBeGreaterThan(80);
  });

  it('no page or layout calls a function imported from a client module', () => {
    const offenders: string[] = [];

    for (const file of serverFiles) {
      const source = read(file);
      for (const imported of namedImports(source)) {
        // Components are capitalised and are rendered, not called.
        if (!/^[a-z]/.test(imported.name)) continue;
        const target = resolveAlias(imported.from);
        if (!target) continue;
        if (!isClientModule(read(target))) continue;
        // `name(` anywhere after the import line is a call.
        const called = new RegExp(`\\b${imported.name}\\s*\\(`, 'g').test(
          source.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '')
        );
        if (called) {
          offenders.push(`${file} calls ${imported.name}() from ${target}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
