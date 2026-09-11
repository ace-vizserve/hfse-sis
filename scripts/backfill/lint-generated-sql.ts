// scripts/backfill/lint-generated-sql.ts
// Structural check on the SQL these generators emit, before anybody runs it
// against production. Catches the mistakes a generator makes that a human
// reading the first twenty lines would not notice.
//
// Written after two real bugs shipped into a generated file:
//   1. a row comment placed AFTER a VALUES row swallowed the comma that
//      separates entries, silently truncating the list;
//   2. a DO block emitted with repeated begin/end pairs instead of one,
//      which does not parse at all.
//
// Checks per file:
//   - begin / commit are balanced and in order
//   - every DO block has exactly one begin and closes with end $$
//   - no line ends with a comment that follows a VALUES row (the comma trap)
//   - every VALUES list is comma-separated and terminated with a semicolon
//   - balanced parentheses and an even number of single quotes per statement
//   - no empty VALUES list
//
// Run: npx tsx scripts/backfill/lint-generated-sql.ts [dir ...]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DIRS = [
  'scripts/backfill/ay2026-t3-attendance-reimport-apply',
  'scripts/backfill/ay2026-t3-attendance-stragglers-apply',
  'scripts/backfill/merge-duplicate-students-apply',
  'scripts/backfill/ay2026-withdrawals-apply',
];

interface Problem {
  file: string;
  line: number;
  message: string;
}

// strips an end-of-line `--` comment, respecting quoted strings
function stripComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") inQuote = !inQuote;
    if (!inQuote && c === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}

function lint(file: string): Problem[] {
  const out: Problem[] = [];
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');

  let depth = 0; // begin/commit
  let doBegins = 0;
  let inDo = false;
  let inValues = false;
  let valuesRows = 0;
  let valuesStart = 0;
  let parens = 0;

  lines.forEach((rawLine, idx) => {
    const n = idx + 1;
    const code = stripComment(rawLine);
    const trimmed = code.trim();
    const lower = trimmed.toLowerCase();

    // the comma trap: a VALUES row whose comment hides the separator
    if (
      inValues &&
      /^\s*\(.*\)\s*--/.test(rawLine) &&
      !/\),\s*--/.test(rawLine)
    ) {
      const isLast = /\);/.test(rawLine);
      if (!isLast)
        out.push({
          file,
          line: n,
          message:
            'VALUES row ends with a comment — the separating comma is inside it',
        });
    }

    if (lower.startsWith('do $$')) {
      inDo = true;
      doBegins = 0;
      return;
    }
    if (inDo) {
      if (/^begin\b/.test(lower)) doBegins++;
      if (/^end\s*\$\$\s*;?$/.test(lower)) {
        if (doBegins !== 1)
          out.push({
            file,
            line: n,
            message: `DO block has ${doBegins} begin(s); it must have exactly one`,
          });
        inDo = false;
      }
      return;
    }

    if (/^begin\s*;$/.test(lower)) depth++;
    if (/^commit\s*;$/.test(lower)) {
      depth--;
      if (depth < 0)
        out.push({ file, line: n, message: 'commit without a matching begin' });
    }

    if (/\bvalues\s*$/.test(lower)) {
      inValues = true;
      valuesRows = 0;
      valuesStart = n;
      return;
    }
    if (inValues) {
      if (/^\(/.test(trimmed)) {
        valuesRows++;
        const endsProperly = /\),$/.test(trimmed) || /\);$/.test(trimmed);
        if (!endsProperly)
          out.push({
            file,
            line: n,
            message: `VALUES row ends with "${trimmed.slice(-3)}" — expected ")," or ");"`,
          });
        if (/\);$/.test(trimmed)) {
          if (valuesRows === 0)
            out.push({ file, line: valuesStart, message: 'empty VALUES list' });
          inValues = false;
        }
      }
    }

    for (const c of code) {
      if (c === '(') parens++;
      if (c === ')') parens--;
    }
    const quotes = (code.match(/'/g) ?? []).length;
    if (quotes % 2 !== 0)
      out.push({ file, line: n, message: 'odd number of single quotes' });
  });

  if (depth !== 0)
    out.push({
      file,
      line: lines.length,
      message: `${depth} begin(s) never committed`,
    });
  if (parens !== 0)
    out.push({
      file,
      line: lines.length,
      message: `parentheses unbalanced by ${parens}`,
    });
  if (inValues)
    out.push({
      file,
      line: valuesStart,
      message: 'VALUES list never terminated',
    });
  if (inDo)
    out.push({ file, line: lines.length, message: 'DO block never closed' });

  return out;
}

function main() {
  const dirs = process.argv.slice(2).length
    ? process.argv.slice(2)
    : DEFAULT_DIRS;
  const problems: Problem[] = [];
  let checked = 0;

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      console.log(`  (skipped ${dir} — not present)`);
      continue;
    }
    for (const f of entries.sort()) {
      const p = join(dir, f);
      if (!statSync(p).isFile() || !f.endsWith('.sql')) continue;
      checked++;
      problems.push(...lint(p));
    }
  }

  console.log(`checked ${checked} generated .sql file(s)`);
  if (problems.length === 0) {
    console.log('no structural problems found');
    return;
  }
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p.file}:${p.line}  ${p.message}`);
  process.exitCode = 1;
}

main();
