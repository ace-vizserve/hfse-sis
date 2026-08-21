/**
 * In-page links must point somewhere the viewer can actually go.
 *
 * KD #159 pins nav <-> ROUTE_ACCESS, and KD #173 pins the four link sources
 * (nav / quick-actions / to-dos / command palette) against each page's
 * capability guard. Neither sees a plain `<Link href="...">` written inside a
 * page or component — and that is exactly where the classroom's dead link to
 * /records/students lived, unnoticed, on a surface every form adviser opens.
 *
 * WHAT THIS CAN AND CANNOT DO — read before extending it.
 *
 * It walks the classroom module's own files and collects the STATIC PREFIX of
 * every href (the text up to the first `${`), then asserts `isRouteAllowed`
 * for every role that can open /classroom. That works here only because the
 * fix moved the /records URL out of the module and into
 * components/ui/student-record-link.tsx, which owns it and takes a required
 * `canOpen`. So the rule this file enforces is really: "the classroom module
 * contains no hardcoded link to a route its own viewers may be blocked from."
 *
 * It CANNOT see:
 *   - links inside shared components (components/ui/**, components/sis/**),
 *     since reachability there depends on props threaded in at runtime;
 *   - JSX conditional gating — `{canX && <Link .../>}` is invisible without
 *     dataflow analysis.
 * A fully general in-page-link guard is not feasible for that second reason.
 * KD #159 and KD #173 get their leverage from one guard per route; in-page
 * links have no such anchor. This is a bounded net, not a proof.
 *
 * Extending it to another module is deliberate work, not a free win: check
 * first that the module has no legitimate hardcoded cross-module links, or
 * you will be adding allowlist entries instead of finding bugs.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { isRouteAllowed, type Role } from '@/lib/auth/roles';

/** Directories scanned, paired with the roles that can open the module. */
const SCANNED = [
  {
    module: '/classroom',
    dirs: ['app/(classroom)', 'components/classroom'],
    roles: [
      'teacher',
      'academic_coordinator',
      'school_admin',
      'superadmin',
    ] as Role[],
  },
];

/**
 * Deliberately empty. An entry here means "this hardcoded link is correct
 * even though some viewers of the module cannot open it" — which is only
 * true if the JSX gates it, and if you are sure of that you should say why.
 * Keyed `relativePath:hrefPrefix`.
 */
const ALLOWLIST: Record<string, string> = {
  // The "Manage teachers" link on the Classroom staff panel. Rendered inside
  // `{canManage && ...}`, and the page passes `canManage={capability ===
  // 'oversight'}` — which resolves to academic_coordinator | school_admin |
  // superadmin, exactly the role set /sis/sections/[id] admits. A teacher
  // never sees it, so the link cannot dead-end (KD #173). Verified by
  // __tests__/classroom/classroom-staff-panel.test.tsx, which asserts both
  // halves: absent without the flag, present with it.
  'components/classroom/classroom-staff-panel.tsx:/sis/sections/':
    'Gated on capability === oversight, the same role set the target page admits.',
  // Each teacher's name on the same panel, linked to their staff page. Same
  // gate, same reasoning: `<Person>` returns plain text unless `canManage`, and
  // /sis/admin/staff is coordinator | school_admin | superadmin — see the nav
  // entry in lib/auth/roles.ts. Both halves are asserted in
  // __tests__/classroom/classroom-staff-panel.test.tsx.
  'components/classroom/classroom-staff-panel.tsx:/sis/admin/staff/':
    'Gated on capability === oversight, the same role set the target page admits.',
};

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** The literal text before the first interpolation — `/records/students/`. */
function staticPrefix(node: ts.Node): string | null {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  return null;
}

function collectHrefs(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const found: string[] = [];

  const visit = (node: ts.Node) => {
    // <Link href="..."> and <Link href={`...`}>
    if (ts.isJsxAttribute(node) && node.name.getText() === 'href') {
      const init = node.initializer;
      const expr =
        init && ts.isJsxExpression(init) ? init.expression : (init ?? null);
      const prefix = expr ? staticPrefix(expr) : null;
      if (prefix?.startsWith('/')) found.push(prefix);
    }
    // { href: '...' } in a config object
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText().replace(/['"]/g, '') === 'href'
    ) {
      const prefix = staticPrefix(node.initializer);
      if (prefix?.startsWith('/')) found.push(prefix);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

describe('in-page links must be reachable by the module’s own viewers', () => {
  for (const { module, dirs, roles } of SCANNED) {
    it(`${module}: every hardcoded href is open to every role that can open the module`, () => {
      const violations: string[] = [];

      for (const dir of dirs) {
        for (const file of walk(dir)) {
          const rel = file.replace(/\\/g, '/');
          for (const href of collectHrefs(file)) {
            if (ALLOWLIST[`${rel}:${href}`]) continue;
            for (const role of roles) {
              if (!isRouteAllowed(href, role)) {
                violations.push(`${rel} links to ${href}, blocked for ${role}`);
              }
            }
          }
        }
      }

      expect(violations).toEqual([]);
    });
  }

  it('actually extracts hrefs, so the check cannot pass vacuously', () => {
    // Guards the two ways this file could go quietly dead: a directory rename
    // making `walk` return nothing, or an AST change making `collectHrefs`
    // match nothing. Either would turn every assertion above into a no-op
    // that reports success. The classroom module has many internal links, so
    // both counts are comfortably above these floors today.
    const files = SCANNED.flatMap(({ dirs }) => dirs.flatMap(walk));
    expect(files.length).toBeGreaterThan(10);

    const hrefs = files.flatMap(collectHrefs);
    expect(hrefs.length).toBeGreaterThan(5);

    // And it must be finding real routes, not fragments.
    expect(hrefs.some((h) => h.startsWith('/classroom'))).toBe(true);
  });
});
