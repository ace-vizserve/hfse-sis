// scripts/audit/sequential-awaits.ts
//
// COVERAGE LISTER, not a defect classifier. Read this before changing the
// counting logic.
//
// EARLIER DESIGN (abandoned). The first version of this script tried to spot
// the exact bug docs/context/11-performance-patterns.md §2 warns about — two
// back-to-back `await`s where the second doesn't depend on the first — by
// text-matching single-line `const x = await …;` statements and checking
// whether the next one referenced the first's binding. It shipped 73
// "candidate pairs," and ALL 73 turned out to be Next.js boilerplate
// (`const { id } = await params;` followed by `const body = await
// request.json();`) — zero touched a database query.
//
// WHY THAT APPROACH CANNOT WORK HERE. This codebase's real waterfalls run
// through named helper functions, not inline Supabase chains. The known
// ground-truth example is app/(classroom)/classroom/[sectionId]/page.tsx,
// which chains `loadClassroomAccess(...)`, `getTermsForAy(...)`,
// `getSectionAttendanceSummary(...)` and more — none of those call sites
// contain a literal `.from(` for a text scanner to recognise as "a query," so
// the "does the second line depend on the first" test only ever fires on the
// handful of statements that scanner COULD parse (routing boilerplate). Seeing
// through a helper call to know whether it makes a DB round trip requires
// whole-program analysis, which is out of scope for a fast text scan.
//
// THE RULING (current design). Stop trying to classify whether an await is
// "a query," and stop trying to decide whether two awaits are independent of
// each other — that is exactly what a static scanner cannot know, and it is
// what a later phase's RUNTIME harness (the counting-supabase.ts clock, run
// against real pages) is the actual authority on. This script now just
// COUNTS: for each page/layout/route handler, how many sequential top-level
// `await`s does it contain that are not already inside a `Promise.all(...)`?
// A file at the top of this list is a CANDIDATE TO MEASURE, not a confirmed
// defect. It deliberately over-reports — a nested `if` guard, a ternary, a
// closure — anything with an `await` in the function body counts, because
// under-reporting a real waterfall is the worse failure for a worklist whose
// whole job is "don't let a human read-through miss one again."
//
// STATIC TEXT SCAN, line-oriented. No DB credentials, no network. Exits 0.
//
// Run:
//   npx tsx scripts/audit/sequential-awaits.ts

import { join } from 'node:path';
import {
  REPO_ROOT,
  findMatchingBrace,
  findMatchingParen,
  maskNoise,
  printFooter,
  printHeader,
  readSource,
  relative,
  walkNamed,
} from './_shared';

type Span = { start: number; end: number };

type FileTally = {
  file: string;
  sequential: number; // top-level awaits NOT already inside Promise.all/allSettled
  parallel: number; // awaits that ARE `await Promise.all(...)` / `allSettled(...)`
  boilerplate: number; // subset of `sequential` recognised as routing plumbing
};

const HANDLER_NAMES = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

// Recognised routing/plumbing awaits — reported separately so a reader can
// discount them, but NOT dropped from the count (requirement: list, don't
// drop). Matched against the text starting right at the `await` keyword.
const BOILERPLATE_RE =
  /^await\s+(?:params\b|searchParams\b|cookies\s*\(\s*\)|headers\s*\(\s*\)|(?:request|req)\.json\s*\(\s*\))/;

const ALREADY_PARALLEL_RE = /^await\s+Promise\.(?:all|allSettled)\s*\(/;

/** Locate the body `{ ... }` of `export default (async) function Name(...) { ... }`. */
function findDefaultExportBody(masked: string): Span | null {
  const re = /export\s+default\s+(?:async\s+)?function\s*\w*\s*\(/;
  const m = re.exec(masked);
  if (!m) return null;
  const openParen = m.index + m[0].length - 1; // last char of the match is '('
  const closeParen = findMatchingParen(masked, openParen);
  const braceIdx = masked.indexOf('{', closeParen);
  if (braceIdx === -1) return null;
  return { start: braceIdx, end: findMatchingBrace(masked, braceIdx) };
}

/** Locate the body of every named route-handler export (`GET`, `POST`, ...). */
function findHandlerBodies(masked: string): Span[] {
  const spans: Span[] = [];
  for (const name of HANDLER_NAMES) {
    const re = new RegExp(
      `export\\s+(?:default\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`,
      'g'
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const openParen = m.index + m[0].length - 1;
      const closeParen = findMatchingParen(masked, openParen);
      const braceIdx = masked.indexOf('{', closeParen);
      if (braceIdx === -1) continue;
      spans.push({ start: braceIdx, end: findMatchingBrace(masked, braceIdx) });
    }
  }
  return spans;
}

/** Count sequential / already-parallel / boilerplate awaits inside one span. */
function tallySpan(masked: string, span: Span) {
  const slice = masked.slice(span.start, span.end);
  const awaitRe = /\bawait\b/g;
  let sequential = 0;
  let parallel = 0;
  let boilerplate = 0;
  let m: RegExpExecArray | null;
  while ((m = awaitRe.exec(slice))) {
    const context = slice.slice(m.index, m.index + 200);
    if (ALREADY_PARALLEL_RE.test(context)) {
      parallel++;
      continue;
    }
    sequential++;
    if (BOILERPLATE_RE.test(context)) boilerplate++;
  }
  return { sequential, parallel, boilerplate };
}

function tallyFile(file: string): FileTally {
  const masked = maskNoise(readSource(file));
  const isRoute = file.endsWith('route.ts');
  const spans = isRoute
    ? findHandlerBodies(masked)
    : [findDefaultExportBody(masked)];

  let sequential = 0;
  let parallel = 0;
  let boilerplate = 0;
  for (const span of spans) {
    if (!span) continue;
    const t = tallySpan(masked, span);
    sequential += t.sequential;
    parallel += t.parallel;
    boilerplate += t.boilerplate;
  }

  return { file, sequential, parallel, boilerplate };
}

function main() {
  printHeader(
    'SEQUENTIAL AWAITS — coverage list (page.tsx / layout.tsx / route.ts)'
  );

  const pageFiles = walkNamed(join(REPO_ROOT, 'app'), [
    'page.tsx',
    'layout.tsx',
  ]);
  const routeFiles = walkNamed(join(REPO_ROOT, 'app', 'api'), ['route.ts']);

  console.log(
    `\n${pageFiles.length} page.tsx/layout.tsx file(s), ${routeFiles.length} route.ts file(s).\n`
  );
  console.log(
    'A file below is a CANDIDATE TO MEASURE, not a confirmed defect — this\n' +
      'scanner cannot know whether its awaits are independent of each other.\n' +
      'Run the runtime counting harness against the file to find out.\n'
  );

  const allFiles = [...pageFiles, ...routeFiles];
  const tallies = allFiles
    .map(tallyFile)
    .filter((t) => t.sequential >= 2)
    .sort((a, b) => b.sequential - a.sequential);

  for (const t of tallies) {
    const boilerplateNote =
      t.boilerplate > 0
        ? ` (of which ${t.boilerplate} ${t.boilerplate === 1 ? 'is' : 'are'} routing boilerplate)`
        : '';
    console.log(
      `${relative(t.file)} — ${t.sequential} sequential await${t.sequential === 1 ? '' : 's'} ` +
        `(${t.parallel} already in Promise.all)${boilerplateNote}`
    );
  }

  printFooter(tallies.length, 'file(s) with 2+ sequential awaits');
}

main();
