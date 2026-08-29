// scripts/audit/_shared.ts
//
// Shared plumbing for the five scripts/audit/*.ts scanners built for Phase 0
// of the app-wide query/write pass. Every script in this directory is a pure
// SOURCE-TEXT scanner — no DB credentials, no network calls, safe to run
// offline or in CI. This file holds only what all five need in common
// (file walking, line numbers, comment/string masking) so each script's own
// header can focus on the ONE defect class it looks for.
//
// Every script here follows the same contract:
//   - print every hit as `file:line — <shape>` plus a suggested classification
//   - exit 0 always — these enumerate, they do not gate a build
//   - bias toward OVER-reporting; a human classifies each hit afterward
//
// Run any script directly, e.g.:
//   npx tsx scripts/audit/cache-tags.ts

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(__dirname, '..', '..');

const SKIP_DIRS = new Set([
  '.claude',
  '.git',
  '.next',
  '.superpowers',
  'node_modules',
]);

/** Recursively collect every file under `dir` whose name ends with one of `exts`. */
export function walk(
  dir: string,
  exts: string[],
  out: string[] = []
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** Collect files under `dir` matching an exact basename (e.g. 'page.tsx'). */
export function walkNamed(
  dir: string,
  names: string[],
  out: string[] = []
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkNamed(full, names, out);
    } else if (names.includes(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Repo-relative, forward-slashed path — stable across Windows/POSIX. */
export function relative(file: string): string {
  return file.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');
}

export function readSource(file: string): string {
  return readFileSync(file, 'utf8');
}

/** 1-based line number of a character offset. */
export function lineAt(source: string, index: number): number {
  let line = 1;
  const bound = Math.min(index, source.length);
  for (let i = 0; i < bound; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * Returns a SAME-LENGTH copy of `source` with every `//` line comment,
 * `/* *\/` block comment, and the BODY of every `'...'` / `"..."` /
 * `` `...` `` literal (including template interpolations — not specially
 * preserved, see caveat below) replaced with spaces. Newlines are kept in
 * place so line numbers computed against the masked text still match the
 * original file.
 *
 * WHY THIS EXISTS. Several scripts here need to know when a `(`, `{`, or `;`
 * is real code vs. text sitting inside a string — this codebase's own
 * Supabase relational-select strings are full of literal parentheses
 * (`'section:sections!inner(id, name, ...)'`), which would otherwise wreck
 * any naive brace/paren depth counter. Masking once, up front, lets every
 * later regex or depth-scan in this directory be string-and-comment-safe
 * without re-deriving that logic five times.
 *
 * CAVEAT (documented, not hidden): a template literal's `${...}`
 * interpolation is masked along with the rest of the literal. This is a
 * safe approximation for what these scripts check (call-chain / block
 * structure), never for what's argued to be a filter VALUE. `cache-tags.ts`
 * needs to read what's actually inside `${...}` (that is its whole job), so
 * it works on the ORIGINAL source with its own narrow regex instead of this
 * mask.
 */
export function maskNoise(source: string): string {
  const out: string[] = new Array(source.length);
  const n = source.length;
  let i = 0;
  while (i < n) {
    const c = source[i];
    const c2 = i + 1 < n ? source[i + 1] : '';
    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && source[j] !== '\n') {
        out[j] = ' ';
        j++;
      }
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i;
      while (
        j < n &&
        !(source[j] === '*' && j + 1 < n && source[j + 1] === '/')
      ) {
        out[j] = source[j] === '\n' ? '\n' : ' ';
        j++;
      }
      if (j < n) {
        out[j] = ' ';
        if (j + 1 < n) out[j + 1] = ' ';
        j += 2;
      }
      i = j;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out[i] = ' ';
      let j = i + 1;
      while (j < n && source[j] !== quote) {
        if (source[j] === '\\' && j + 1 < n) {
          out[j] = ' ';
          out[j + 1] = source[j + 1] === '\n' ? '\n' : ' ';
          j += 2;
          continue;
        }
        out[j] = source[j] === '\n' ? '\n' : ' ';
        j++;
      }
      if (j < n) {
        out[j] = ' ';
        j++;
      }
      i = j;
      continue;
    }
    out[i] = c;
    i++;
  }
  return out.join('');
}

/** Index of the `)` matching the `(` at `openIndex` in `masked` text. */
export function findMatchingParen(masked: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return masked.length - 1;
}

/** Index of the `}` matching the `{` at `openIndex` in `masked` text. */
export function findMatchingBrace(masked: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return masked.length - 1;
}

/** Index of the `;` that ends the statement starting at `from`, tracking
 * bracket depth so a `;` inside `(...)`/`{...}`/`[...]` doesn't end it early.
 * Falls back to end-of-text if the statement is never terminated (e.g. the
 * last line of a file with no trailing semicolon). */
export function findStatementEnd(masked: string, from: number): number {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth <= 0) return i;
  }
  return masked.length - 1;
}

export function printHeader(title: string): void {
  console.log('='.repeat(78));
  console.log(title);
  console.log('='.repeat(78));
}

export function printFooter(hitCount: number, noun = 'hits'): void {
  console.log(`\n${'-'.repeat(78)}`);
  console.log(
    `${hitCount} ${noun}. Exit code 0 — this enumerates, it does not gate.`
  );
  console.log('-'.repeat(78));
}
