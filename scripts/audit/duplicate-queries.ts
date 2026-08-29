// scripts/audit/duplicate-queries.ts
//
// Static pre-filter: the same table queried more than once inside one
// function (or, when no enclosing function can be resolved, one file).
//
// THIS IS NOT THE AUTHORITATIVE CHECK. The real duplicate-query detector is
// runtime: `findDuplicateQueries()` in `__tests__/_utils/counting-supabase.ts`
// compares table + verb + SERIALIZED FILTERS, so it only fires on a query that
// is genuinely identical to another — two `.from('students').eq('id', a)` and
// `.from('students').eq('id', b)` calls are not a duplicate there, correctly.
// This script cannot see filters reliably enough to make that call (a filter
// value is often a variable, not a literal), so it works one level cruder: it
// flags a table touched twice in the same function AT ALL, whether or not the
// filters differ. That is deliberately noisier — the brief calls this script
// "the cheap pre-filter" precisely so a human decides, per hit, whether it is
// a genuine N+1 / duplicate-fetch or two legitimately different reads that
// happen to share a table.
//
// STATIC TEXT SCAN. No DB credentials, no network. Exits 0 always.
//
// APPROXIMATION: "which function is this line in" is resolved by scanning
// backward from each `.from(...)` / `.rpc(...)` call for the nearest
// preceding function-like declaration (`function name(`, `const name = (...)
// =>`, `async function name(`, a class method `name(...) {`). This is a
// heuristic, not a parser — a deeply nested inline callback can attribute to
// the wrong enclosing name. When no such declaration is found above a hit,
// it is grouped at file scope instead of being silently dropped.
//
// Run:
//   npx tsx scripts/audit/duplicate-queries.ts

import { join } from 'node:path';
import {
  REPO_ROOT,
  findMatchingParen,
  lineAt,
  maskNoise,
  printFooter,
  printHeader,
  readSource,
  relative,
  walk,
} from './_shared';

type TableCall = {
  table: string;
  line: number;
  scope: string;
};

const FUNCTION_PATTERNS = [
  /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
  /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
  /(?:export\s+)?const\s+(\w+)\s*:\s*[\w<>[\],. ]+\s*=\s*(?:async\s*)?\(/,
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{?\s*$/,
];

// Control-flow keywords the generic "word(...) {" pattern would otherwise
// mistake for a function name (an `if (...) {` / `for (...) {` reads
// identically to a method declaration to that regex).
const CONTROL_FLOW_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'else',
  'return',
]);

/** Nearest enclosing function-ish name above `lineIndex` (0-based), by
 * scanning upward through raw source lines. Falls back to "(module scope)". */
function enclosingScope(lines: string[], lineIndex: number): string {
  for (let i = lineIndex; i >= 0; i--) {
    for (const re of FUNCTION_PATTERNS) {
      const m = re.exec(lines[i]);
      if (m && m[1] && !CONTROL_FLOW_KEYWORDS.has(m[1])) return m[1];
    }
  }
  return '(module scope)';
}

function firstStringArg(callText: string): string | null {
  const m = /^\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/.exec(callText);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

function scanFile(file: string): TableCall[] {
  const source = readSource(file);
  const masked = maskNoise(source);
  const lines = source.split('\n');
  const hits: TableCall[] = [];

  for (const method of ['from', 'rpc']) {
    const marker = `.${method}(`;
    let at = masked.indexOf(marker);
    while (at !== -1) {
      const openParen = at + method.length + 1;
      const closeParen = findMatchingParen(masked, openParen);
      const arg = firstStringArg(source.slice(openParen, closeParen + 1));
      if (arg) {
        const line = lineAt(source, at);
        hits.push({
          table: `${method === 'rpc' ? 'rpc:' : ''}${arg}`,
          line,
          scope: enclosingScope(lines, line - 1),
        });
      }
      at = masked.indexOf(marker, at + marker.length);
    }
  }
  return hits;
}

function main() {
  printHeader(
    'DUPLICATE QUERIES (static pre-filter) — same table, same function'
  );

  const files = [
    ...walk(join(REPO_ROOT, 'lib'), ['.ts', '.tsx']),
    ...walk(join(REPO_ROOT, 'app'), ['.ts', '.tsx']),
  ];

  let groupCount = 0;
  let hitCount = 0;

  for (const file of files) {
    const hits = scanFile(file);
    if (hits.length < 2) continue;

    const byScope = new Map<string, TableCall[]>();
    for (const h of hits) {
      const key = h.scope;
      const bucket = byScope.get(key) ?? [];
      bucket.push(h);
      byScope.set(key, bucket);
    }

    for (const [scope, calls] of byScope) {
      const byTable = new Map<string, number[]>();
      for (const c of calls) {
        const lines = byTable.get(c.table) ?? [];
        lines.push(c.line);
        byTable.set(c.table, lines);
      }
      for (const [table, lineNums] of byTable) {
        if (lineNums.length < 2) continue;
        groupCount += 1;
        hitCount += lineNums.length;
        console.log(
          `${relative(file)} :: ${scope}() — '${table}' queried ${lineNums.length}x ` +
            `(lines ${lineNums.join(', ')}) — classify: genuine duplicate, or two ` +
            'legitimately different reads that share a table?'
        );
      }
    }
  }

  printFooter(groupCount, 'group(s)');
  console.log(`${hitCount} individual call(s) inside a flagged group.\n`);
}

main();
