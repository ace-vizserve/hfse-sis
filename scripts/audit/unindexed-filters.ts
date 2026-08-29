// scripts/audit/unindexed-filters.ts
//
// Every `.eq(`, `.in(`, `.order(` filter column in `lib/` and `app/api/`,
// cross-referenced against every `create index` statement across
// `supabase/migrations/*.sql`. Prints the hot filter columns this scan cannot
// find a matching index for.
//
// WHY THIS EXISTS. docs/context/11-performance-patterns.md §10 already found
// one real gap by hand (the per-AY `ay{YYYY}_enrolment_applications` tables
// have no index beyond `id`, despite dozens of `.eq('enroleeNumber', …)` /
// `.eq('studentNumber', …)` call sites) — found by a human read-only sweep,
// not by anything repeatable. This script is the repeatable version: it
// cannot prove a query plan is a Seq Scan (that needs `explain analyze`
// against real data — see scripts/probe-query-cost.ts, question #2), but it
// can enumerate every candidate so a human doesn't have to re-read the whole
// tree by hand to find the next one.
//
// STATIC TEXT SCAN, no DB credentials, no network. Exits 0 always.
//
// APPROXIMATIONS, STATED RATHER THAN HIDDEN:
//   - The table a filter applies to is resolved by finding the nearest
//     enclosing `.from('table')` / `.rpc('name')` in the SAME statement (see
//     findStatementEnd). A filter chained across a `let`-reassigned query
//     builder spanning multiple statements (a handful of files in this repo
//     build a query incrementally, e.g. `let query = supabase.from(...); if
//     (x) query = query.eq(...);`) will not resolve to that table — it is
//     reported with table "unknown" rather than silently dropped, so a human
//     still sees it.
//   - `id` is skipped as a filter column: every table's primary key is
//     indexed by definition, so `.eq('id', x)` can never be the Seq Scan this
//     script is hunting for. Every OTHER column is reported if this script
//     cannot find it in an explicit `create index`.
//   - A dotted filter column (`.eq('sections.academic_year_id', x)`, a
//     PostgREST embedded-relation filter) is reported under the embedded
//     table name from the dotted path, not the outer `.from()` table — that
//     is the table the filter really runs against.
//   - `create index` parsing is regex-based, not a SQL parser. It handles the
//     forms actually used in this repo's migrations
//     (`create [unique] index [if not exists] name on [schema.]table (cols)`)
//     and a partial/expression index still registers its base columns, which
//     is a conservative (fewer false positives) simplification.
//
// Run:
//   npx tsx scripts/audit/unindexed-filters.ts

import { join } from 'node:path';
import {
  REPO_ROOT,
  findMatchingParen,
  findStatementEnd,
  lineAt,
  maskNoise,
  printFooter,
  printHeader,
  readSource,
  relative,
  walk,
} from './_shared';

type FilterHit = {
  file: string;
  line: number;
  method: 'eq' | 'in' | 'order';
  table: string;
  column: string;
};

// ── 1. Every indexed (table, column) pair from the migrations ──────────────

function loadIndexedColumns(): Set<string> {
  const dir = join(REPO_ROOT, 'supabase', 'migrations');
  const files = walk(dir, ['.sql']);
  const indexed = new Set<string>();

  const indexRe =
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?\S+\s+on\s+(?:only\s+)?([\w."]+)\s*(?:using\s+\w+\s*)?\(([^)]*)\)/gi;

  for (const file of files) {
    const source = readSource(file);
    for (const m of source.matchAll(indexRe)) {
      const rawTable = m[1].replace(/"/g, '');
      const table = rawTable.includes('.')
        ? rawTable.split('.').pop()!
        : rawTable;
      const colsText = m[2];
      // Split on top-level commas; an expression index column may itself
      // contain commas inside a function call — depth-track with a plain
      // paren counter over this short slice, which is safe since colsText
      // never contains string literals in this repo's migrations.
      const cols: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of colsText) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
          cols.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      cols.push(cur);
      for (const raw of cols) {
        // First bare identifier in the column expression — handles plain
        // columns, `col desc`, and `lower(col)` alike (conservative: an
        // expression index still marks its underlying column as indexed).
        const idMatch = /"?(\w+)"?/.exec(raw.trim());
        if (idMatch) indexed.add(`${table}.${idMatch[1]}`.toLowerCase());
      }
    }
  }
  return indexed;
}

// ── 2. Every `.eq()` / `.in()` / `.order()` filter in the app ──────────────

function firstStringArg(callText: string): string | null {
  const m = /^\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/.exec(callText);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

function scanFile(file: string): FilterHit[] {
  const source = readSource(file);
  const masked = maskNoise(source);
  const hits: FilterHit[] = [];

  // Every `.from('table')` / `.rpc('name')` call, with the statement window
  // it opens — used to resolve which table a later filter in the same
  // statement belongs to.
  const tableWindows: { table: string; start: number; end: number }[] = [];
  for (const method of ['from', 'rpc']) {
    const marker = `.${method}(`;
    let at = masked.indexOf(marker);
    while (at !== -1) {
      const openParen = at + method.length + 1;
      const closeParen = findMatchingParen(masked, openParen);
      const arg = firstStringArg(source.slice(openParen, closeParen + 1));
      if (arg) {
        const stmtEnd = findStatementEnd(masked, at);
        tableWindows.push({ table: arg, start: at, end: stmtEnd });
      }
      at = masked.indexOf(marker, at + marker.length);
    }
  }

  function tableFor(index: number): string {
    // Prefer the innermost (latest-starting) window that still contains
    // this index — handles a `.from()` nested inside another statement's
    // callback (rare in this codebase, but cheap to get right).
    let best: { table: string; start: number } | null = null;
    for (const w of tableWindows) {
      if (index >= w.start && index <= w.end) {
        if (!best || w.start > best.start) best = w;
      }
    }
    return best?.table ?? 'unknown';
  }

  for (const method of ['eq', 'in', 'order'] as const) {
    const marker = `.${method}(`;
    let at = masked.indexOf(marker);
    while (at !== -1) {
      const openParen = at + method.length + 1;
      const closeParen = findMatchingParen(masked, openParen);
      const arg = firstStringArg(source.slice(openParen, closeParen + 1));
      if (arg) {
        // A dotted embedded-relation filter (`sections.academic_year_id`)
        // really filters the EMBEDDED table, not the base `.from()` table.
        const dotted = arg.includes('.');
        const table = dotted ? arg.split('.')[0] : tableFor(at);
        const column = dotted ? arg.split('.').slice(1).join('.') : arg;
        if (column !== 'id') {
          hits.push({
            file: relative(file),
            line: lineAt(source, at),
            method,
            table,
            column,
          });
        }
      }
      at = masked.indexOf(marker, at + marker.length);
    }
  }

  return hits;
}

function main() {
  printHeader('UNINDEXED FILTERS — .eq() / .in() / .order() vs create index');

  const indexed = loadIndexedColumns();
  console.log(
    `\n${indexed.size} (table.column) pair(s) found across every create index.\n`
  );

  const files = [
    ...walk(join(REPO_ROOT, 'lib'), ['.ts', '.tsx']),
    ...walk(join(REPO_ROOT, 'app', 'api'), ['.ts', '.tsx']),
  ];

  const allHits = files.flatMap(scanFile);

  const unindexed = allHits.filter(
    (h) => !indexed.has(`${h.table}.${h.column}`.toLowerCase())
  );

  // Group by (table, column) so a hot column filtered from 40 call sites
  // reads as one finding, not 40 — the classification question ("does this
  // table need an index?") is the same at every call site.
  const groups = new Map<string, FilterHit[]>();
  for (const h of unindexed) {
    const key = `${h.table}.${h.column}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(h);
    groups.set(key, bucket);
  }

  const sortedKeys = [...groups.keys()].sort(
    (a, b) => groups.get(b)!.length - groups.get(a)!.length
  );

  for (const key of sortedKeys) {
    const bucket = groups.get(key)!;
    const [table] = key.split('.');
    const suggestion =
      table === 'unknown'
        ? 'table could not be resolved statically — check by hand'
        : `candidate: create index on ${table} (${key.slice(table.length + 1)})`;
    console.log(`\n${key}  —  ${bucket.length} call site(s)  —  ${suggestion}`);
    for (const h of bucket.slice(0, 5)) {
      console.log(`  ${h.file}:${h.line} — .${h.method}('${h.column}', …)`);
    }
    if (bucket.length > 5) {
      console.log(`  … and ${bucket.length - 5} more`);
    }
  }

  printFooter(unindexed.length, 'unindexed filter call site(s)');
  console.log(
    `${sortedKeys.length} distinct (table, column) pair(s) to classify.\n`
  );
}

main();
