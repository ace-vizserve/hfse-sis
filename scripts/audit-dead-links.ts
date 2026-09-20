// scripts/audit-dead-links.ts
// Every internal link in the app, checked against the routes that exist.
//
// WHY. A `<Link href="/foo">` to a route that was renamed or deleted compiles
// fine, type-checks fine, and 404s only when somebody clicks it. Nothing in the
// build catches it.
//
// HOW. Two sets, compared:
//   ROUTES   — every directory under app/ holding a page.tsx, with route
//              groups `(x)` stripped and `[param]` segments kept as wildcards.
//   LINKS    — every `href="/..."` and `href={`/...`}` in app/ and components/.
//
// ⚠ A dynamic segment matches anything, so `/records/students/[studentNumber]`
// makes `/records/students/H260357` valid. That is why the comparison is
// segment-by-segment rather than a string match.
//
// ⚠ WHAT THIS CANNOT SEE, and the report says so rather than implying
// completeness: links built at runtime from a variable (`href={row.href}`),
// hrefs assembled from fragments, and API routes. Those need reading, not
// grepping.
//
// Reads only. Usage:
//   npx tsx scripts/audit-dead-links.ts

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

// ── The routes that exist ──────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const appFiles = walk(join(ROOT, 'app'));

/** app/(records)/records/students/[studentNumber]/page.tsx → /records/students/[studentNumber] */
function routeOf(file: string): string | null {
  const rel = relative(join(ROOT, 'app'), file).split(sep);
  const leaf = rel.pop();
  if (leaf !== 'page.tsx') return null;
  const segs = rel.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  return '/' + segs.join('/');
}

const routes = appFiles
  .map(routeOf)
  .filter((r): r is string => r !== null)
  .map((r) => (r === '/' ? '/' : r.replace(/\/$/, '')));

const routeSegs = routes.map((r) => r.split('/').filter(Boolean));

function matches(path: string): boolean {
  const want = path.split('/').filter(Boolean);
  return routeSegs.some((segs) => {
    if (segs.length !== want.length) return false;
    return segs.every((s, i) => {
      if (s.startsWith('[') && s.endsWith(']')) return true; // dynamic
      return s === want[i] || want[i] === 'X'; // X = a ${…} hole
    });
  });
}

/**
 * ⚠ A trailing `${…}` is usually a QUERY STRING, not a path segment — the
 * codebase writes `` `/markbook/grading${scopeQuery}` `` and
 * `` `/classroom/${id}/grades${termQuery}` ``. Substituting a placeholder makes
 * those read as `/markbook/gradingX`, which matches no route and looks exactly
 * like a dead link. The first run of this script reported 9 of them and every
 * one was this. So a path whose last segment ENDS with the placeholder is also
 * tried with that suffix removed.
 */
function routeExists(path: string): boolean {
  if (matches(path)) return true;
  const segs = path.split('/');
  const last = segs[segs.length - 1];
  if (last.length > 1 && last.endsWith('X')) {
    return matches([...segs.slice(0, -1), last.slice(0, -1)].join('/'));
  }
  return false;
}

// ── The links the code contains ────────────────────────────────────────────

const sourceFiles = [
  ...walk(join(ROOT, 'app')),
  ...walk(join(ROOT, 'components')),
  ...walk(join(ROOT, 'lib')),
].filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

type Hit = { file: string; line: number; href: string; raw: string };
const hits: Hit[] = [];
const dynamicHrefs: Hit[] = [];

// Two shapes, and the second one matters more than it looks.
//
//   href="/..."   JSX attributes — what a <Link> renders.
//   href: '/...'  OBJECT PROPERTIES — how every nav menu in lib/auth/roles.ts
//                 declares its items. The first version of this script matched
//                 only the attribute form and reported a clean sweep while
//                 never once looking at the sidebar, which is the set of links
//                 users actually click.
const RE =
  /href\s*[=:]\s*(?:"(\/[^"]*)"|'(\/[^']*)'|`(\/[^`]*)`|\{\s*`(\/[^`]*)`\s*\}|\{\s*'(\/[^']*)'\s*\}|\{\s*"(\/[^"]*)"\s*\})/g;

// 🔴 A THIRD SHAPE, and it is where the real risk lives. Route literals are
// frequently returned from a helper rather than written at the link:
//
//   return `/records/students/${encodeURIComponent(row.studentNumber)}`;
//
// No `href` anywhere on the line, so the two patterns above never see it — and
// these helpers back the identifier links in every cohort table, the movements
// table, the classroom sub-nav and the document drill. Matching only `href`
// would have declared a clean sweep while never reading any of them.
//
// Scoped to strings whose FIRST SEGMENT is a real top-level route, so ordinary
// strings that merely start with "/" are not dragged in.
const topLevel = new Set(
  routeSegs.map((s) => s[0]).filter((s): s is string => Boolean(s))
);
const ROUTE_LITERAL = new RegExp(
  `(?:\`|')(/(?:${[...topLevel].map((s) => s.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')).join('|')})[^\`']*)(?:\`|')`,
  'g'
);

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(ROUTE_LITERAL)) {
      const raw = m[1];
      const path = raw.split('?')[0].split('#')[0];
      hits.push({
        file: relative(ROOT, file),
        line: i + 1,
        href: path.replace(/\$\{[^}]*\}/g, 'X'),
        raw,
      });
    }
    for (const m of line.matchAll(RE)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? '';
      if (!raw.startsWith('/')) continue;
      // Drop the query/hash, and treat a ${...} interpolation as a wildcard.
      const path = raw.split('?')[0].split('#')[0];
      const hit = {
        file: relative(ROOT, file),
        line: i + 1,
        href: path,
        raw,
      };
      if (path.includes('${')) {
        // A template hole IS a value — replace it with a placeholder segment so
        // the shape can still be checked.
        hits.push({ ...hit, href: path.replace(/\$\{[^}]*\}/g, 'X') });
      } else {
        hits.push(hit);
      }
    }
    if (/href=\{(?!\s*[`'"])/.test(line)) {
      dynamicHrefs.push({
        file: relative(ROOT, file),
        line: i + 1,
        href: '(computed)',
        raw: line.trim().slice(0, 100),
      });
    }
  });
}

// ── Compare ────────────────────────────────────────────────────────────────

// Four classes of false positive, every one of which the first run reported as
// a dead link. Named rather than silently dropped, so the next reader can tell
// a filter from a blind spot:
//
//  1. GLOB / TAG PATTERNS — `/records/*` in lib/auth/roles.ts is a prefix test
//     and `/records/cohorts/*` is a cache tag. Neither is ever navigated to.
//  2. FILE PATHS IN PROSE — a comment citing `/records/unsynced/page.tsx`.
//  3. COMMENTS ABOUT ROUTES THAT ARE GONE — `/sis/admin/levels` (removed by
//     migration 086) and `/records/discipline` (moved to /classroom on
//     2026-09-11) are both explanations of a removal, not links to it.
//  4. NESTED TEMPLATES — `` `/records/movements${qs ? `?${qs}` : ''}` `` ends
//     the outer literal at the INNER backtick, leaving a ragged `${qs ` tail.
//     Truncating at an unclosed `${` recovers the real path.
/** Is this line a comment? A route named in prose is not a link. */
const fileLines = new Map<string, string[]>();
function isComment(file: string, line: number): boolean {
  if (!fileLines.has(file)) {
    fileLines.set(file, readFileSync(join(ROOT, file), 'utf8').split('\n'));
  }
  const text = (fileLines.get(file) ?? [])[line - 1] ?? '';
  return /^\s*(\/\/|\*|\/\*)/.test(text);
}

const checked = hits
  .map((h) => {
    const open = h.href.indexOf('${');
    // An unclosed hole means the match was cut short by a nested template.
    if (open >= 0 && !h.href.slice(open).includes('}')) {
      return { ...h, href: h.href.slice(0, open) };
    }
    return h;
  })
  .filter(
    (h) =>
      !h.href.startsWith('/api/') &&
      !h.href.startsWith('//') &&
      !h.href.includes('*') &&
      !/\.(png|jpg|svg|ico|webmanifest|txt|xml|pdf|css|js|tsx?|md|sql)$/i.test(
        h.href
      ) &&
      !isComment(h.file, h.line)
  );

const dead = checked.filter((h) => !routeExists(h.href));

const byHref = new Map<string, Hit[]>();
for (const d of dead) byHref.set(d.href, [...(byHref.get(d.href) ?? []), d]);

console.log(`routes with a page.tsx : ${routes.length}`);
console.log(`literal internal links : ${checked.length}`);
console.log(
  `→ pointing at NO route : ${dead.length} (${byHref.size} distinct)\n`
);

if (byHref.size) {
  console.log('DEAD LINKS');
  for (const [href, list] of [...byHref].sort()) {
    console.log(`\n  ${href}`);
    for (const h of list) console.log(`     ${h.file}:${h.line}`);
  }
}

// The unresolvable ones split in two, and only the second half is a real gap.
// `href={item.href}` is a PASS-THROUGH: the literal lives wherever `item` is
// built, and this script already checked it there. Counting those as unchecked
// made the gap look four times bigger than it is.
const PASSTHROUGH =
  /href=\{\s*[A-Za-z_$][\w$]*(?:\.[\w$]+)*\s*(?:\??\?\?)?\s*[}\s]/;
const passthrough = dynamicHrefs.filter((d) => PASSTHROUGH.test(d.raw));
const computed = dynamicHrefs.filter((d) => !PASSTHROUGH.test(d.raw));

console.log(`\nhref={…} expressions: ${dynamicHrefs.length}`);
console.log(
  `  ${passthrough.length} pass a prop straight through (href={item.href}) — the literal is`
);
console.log('     defined elsewhere and was checked there.');
console.log(
  `  ${computed.length} genuinely built at run time — a grep cannot resolve these, and they`
);
console.log(
  '     are listed so the gap is visible rather than counted as passing.'
);
if (computed.length && process.argv.includes('--show-dynamic')) {
  for (const d of computed) console.log(`     ${d.file}:${d.line}  ${d.raw}`);
}
