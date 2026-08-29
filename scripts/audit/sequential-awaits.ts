// scripts/audit/sequential-awaits.ts
//
// Every `page.tsx` / `layout.tsx` under `app/`, plus every `app/api/**/route.ts`,
// scanned for back-to-back `const x = await …; const y = await …;` where the
// second statement's expression does not reference the first's binding — the
// exact waterfall shape docs/context/11-performance-patterns.md §2 calls a bug
// ("Two sequential `await supabase.from(...)` calls in a page is a bug. Use
// `Promise.all([...])`"), and which that same doc's changelog records fixing
// by hand at least twice already (`lib/evaluation/dashboard.ts::loadWriteupsUncached`,
// `app/(attendance)/attendance/page.tsx`). This script is the repeatable sweep
// so the NEXT one doesn't wait for a human read-through to notice.
//
// STATIC TEXT SCAN, line-oriented. No DB credentials, no network. Exits 0.
//
// APPROXIMATION, STATED RATHER THAN HIDDEN: this scanner matches a single-line
// `const|let <binding> = await <expr>;` statement — which is the shape every
// fixed example in this codebase's own history actually had. A statement
// whose `await <expr>` spans multiple lines (a long argument list, a chained
// `.select(...)` broken across lines) will not be matched, which is a false
// NEGATIVE, not a false positive — the opposite bias to the rest of this
// directory. Chosen anyway because a naive multi-line join would either
// require real statement parsing (out of scope for a fast text scan) or
// produce enough false positives on ordinary multi-line chains to bury the
// real hits. "Consecutive" means "next non-blank, non-comment line", not
// "next line" literally.
//
// Run:
//   npx tsx scripts/audit/sequential-awaits.ts

import { join } from 'node:path';
import {
  REPO_ROOT,
  printFooter,
  printHeader,
  readSource,
  relative,
  walkNamed,
} from './_shared';

type AwaitStmt = {
  line: number;
  bindings: string[];
  rhs: string;
  raw: string;
};

const AWAIT_LINE_RE =
  /^\s*(?:export\s+)?(?:const|let)\s+([^=]+?)\s*=\s*(await\s+.+?);?\s*$/;

/** Every bound identifier on the LHS, whether plain, destructured object, or
 * destructured array. Good enough for a "does the next line MENTION this" check. */
function bindingNames(lhs: string): string[] {
  return [...lhs.matchAll(/[A-Za-z_$][\w$]*/g)]
    .map((m) => m[0])
    .filter((w) => !['const', 'let'].includes(w));
}

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return (
    t.length === 0 ||
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*')
  );
}

function referencesAny(text: string, names: string[]): boolean {
  return names.some((n) => new RegExp(`\\b${n}\\b`).test(text));
}

function scanFile(file: string): string[] {
  const source = readSource(file);
  const lines = source.split('\n');
  const findings: string[] = [];

  const awaitLines: Array<{ index: number; stmt: AwaitStmt }> = [];
  lines.forEach((line, i) => {
    const m = AWAIT_LINE_RE.exec(line);
    if (!m) return;
    const rhs = m[2];
    // Already parallel — not a candidate.
    if (/^await\s+Promise\.(all|allSettled)\s*\(/.test(rhs)) return;
    awaitLines.push({
      index: i,
      stmt: {
        line: i + 1,
        bindings: bindingNames(m[1]),
        rhs,
        raw: line.trim(),
      },
    });
  });

  for (let k = 0; k < awaitLines.length - 1; k++) {
    const cur = awaitLines[k];
    const next = awaitLines[k + 1];

    // "Consecutive" — nothing but blank/comment lines between them.
    let onlyBlankBetween = true;
    for (let i = cur.index + 1; i < next.index; i++) {
      if (!isBlankOrComment(lines[i])) {
        onlyBlankBetween = false;
        break;
      }
    }
    if (!onlyBlankBetween) continue;

    if (referencesAny(next.stmt.rhs, cur.stmt.bindings)) continue; // genuine wave 2

    findings.push(
      `${relative(file)}:${cur.stmt.line} — sequential awaits, second does not reference first:\n` +
        `    L${cur.stmt.line}: ${cur.stmt.raw}\n` +
        `    L${next.stmt.line}: ${next.stmt.raw}\n` +
        '    suggest: Promise.all([...]) unless there is a reason not shown in these two lines'
    );
  }

  return findings;
}

function main() {
  printHeader('SEQUENTIAL AWAITS — page.tsx / layout.tsx / route.ts');

  const pageFiles = walkNamed(join(REPO_ROOT, 'app'), [
    'page.tsx',
    'layout.tsx',
  ]);
  const routeFiles = walkNamed(join(REPO_ROOT, 'app', 'api'), ['route.ts']);

  console.log(
    `\n${pageFiles.length} page.tsx/layout.tsx file(s), ${routeFiles.length} route.ts file(s).\n`
  );

  const allFiles = [...pageFiles, ...routeFiles];
  const allFindings = allFiles.flatMap(scanFile);

  for (const f of allFindings) console.log(f + '\n');

  printFooter(allFindings.length, 'candidate pair(s)');
}

main();
