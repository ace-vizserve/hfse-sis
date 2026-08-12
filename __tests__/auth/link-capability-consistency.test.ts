/**
 * A page that guards on a CAPABILITY — or on a ROLE — must never be advertised
 * to a viewer the page will bounce.
 *
 * THE BUG THIS EXISTS FOR (KD #173). Page guards were migrated to capabilities;
 * the things that LINK to those pages were not. Every link source resolves
 * visibility from Role — `NAV_BY_MODULE`, the home quick actions, the home
 * to-do panel, the Cmd+K palette — so when migration 106 took
 * `documents_pre_enrolment.read` off the academic coordinator, five surfaces
 * went on offering her `/admissions/document-validation` and the page bounced
 * her from all five. The to-do was the worst: it sat on `/`, the page she was
 * redirected TO, so clicking it looped.
 *
 * WHY THE EXISTING GUARD MISSED IT. `nav-route-consistency-all-modules.test.ts`
 * checks nav against ROUTE_ACCESS, and says in its own header that it is
 * PREFIX-only and cannot see a page-level guard. `/admissions` admits the
 * coordinator, so the nav item was correct at every layer that test can see.
 * This is the missing layer.
 *
 * SCOPE. Evaluated against `DEFAULT_ROLE_CAPABILITIES`, not the live
 * `role_permissions` table — the job here is that the CODE is self-consistent.
 * The live-vs-code check is `scripts/audit-role-permissions.ts`, which is a
 * separate, deliberately-manual pre-flight.
 *
 * THE SECOND HALF (added 2026-08-08). The same defect exists one layer over,
 * with roles instead of capabilities, and neither this test nor
 * `nav-route-consistency-all-modules.test.ts` could see it. A page may guard
 * on `sessionUser.role` directly — 41 pages and layouts do — and that guard can
 * be STRICTER than both the nav item and ROUTE_ACCESS. `/attendance/audit-log`
 * was exactly that: the nav row carries no `requiresRoles`, ROUTE_ACCESS admits
 * teachers under the broad `/attendance` prefix, and the page redirects anyone
 * who is not a coordinator or admin. A teacher saw the link, clicked it, and
 * landed on the home page with no explanation. The nav and the route agreed
 * with each other, which is why the prefix test passed; the page was the odd
 * one out.
 *
 * The guard map is read from source with the TypeScript compiler API because
 * `app/**\/page.tsx` files are async server components that cannot be imported
 * and inspected at runtime — the same constraint (and the same technique) as
 * `__tests__/ui/data-table-column-label-coverage.test.ts`. Regex was rejected
 * for the reason given there: it crosses statement boundaries.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ROLE_CAPABILITIES,
  isCapability,
  type Capability,
} from '@/lib/auth/capabilities';
import {
  flattenNavItems,
  resolveSectionsForRole,
} from '@/lib/auth/nav-visibility';
import { ROLES, isRouteAllowed, type Role } from '@/lib/auth/roles';
import { getQuickActions } from '@/lib/home/quick-actions';
import { HOME_TODO_SOURCES } from '@/lib/home/todos';
import { visibleNavEntries } from '@/lib/sis/command-palette-nav';
import { MODULE_ORDER, SIDEBAR_REGISTRY } from '@/lib/sidebar/registry';

const REPO_ROOT = join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.claude', 'node_modules', '.next', '.git']);

/** A teacher holding BOTH jobs, so the job filter (KD #170) never masks a row
 *  this test is trying to inspect. */
// Every job, including adviser-of-record — this sweep asks "is every link this
// role could ever see reachable", so it must not narrow the surface.
const BOTH_JOBS = {
  advises: true,
  advisesSubstantively: true,
  teachesSubject: true,
} as const;

function capsOf(role: Role): Capability[] {
  return DEFAULT_ROLE_CAPABILITIES[role];
}

// ─── the guard map: which capability does each page demand? ──────────────────

type PageGuard = {
  route: string;
  /** Holding ANY ONE of these satisfies the guard — see the `||` note below. */
  requiredAnyOf: Capability[];
};

// LAYOUTS COUNT AS GUARDS. When a page's sub-views became their own routes, the
// session/role/capability check moved up into the shared `layout.tsx` so it
// covers the whole subtree — and a scanner that only reads `page.tsx` stops
// seeing the guard entirely, reporting a guarded route as unguarded. Same
// failure mode as enumerating `section.items` and missing nav children.
function walkPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkPages(full, out);
    else if (entry === 'page.tsx' || entry === 'layout.tsx') out.push(full);
  }
  return out;
}

/** `app/(admissions)/admissions/document-validation/page.tsx`
 *   → `/admissions/document-validation` */
function routeFor(file: string): string {
  const rel = file.slice(REPO_ROOT.length).replace(/\\/g, '/');
  const segments = rel
    .replace(/^\/app\//, '')
    .replace(/\/(page|layout)\.tsx$/, '')
    .split('/')
    .filter((s) => s.length > 0 && !(s.startsWith('(') && s.endsWith(')')));
  return '/' + segments.join('/');
}

function collect(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => collect(child, visit));
}

/** The capability argument of a `can(caps, 'x.y')` call, if it is one. */
function capabilityOfCanCall(node: ts.Node): Capability | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'can') {
    return null;
  }
  const arg = node.arguments[1];
  if (!arg || !ts.isStringLiteral(arg)) return null;
  // Validated, so a typo'd capability fails loudly here rather than being
  // silently skipped and leaving the page uncovered.
  return isCapability(arg.text) ? arg.text : null;
}

function guardsFor(file: string): PageGuard | null {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  // Pass 1 — local aliases. The P-Files page reads
  //   const canReadPre = can(capabilities, 'documents_pre_enrolment.read');
  // and only later tests `if (!canReadPost && !canReadPre) redirect('/')`, so
  // the capability never appears inside the condition itself.
  const aliases = new Map<string, Capability>();
  collect(src, (n) => {
    if (!ts.isVariableDeclaration(n) || !n.initializer) return;
    if (!ts.isIdentifier(n.name)) return;
    const capability = capabilityOfCanCall(n.initializer);
    if (capability) aliases.set(n.name.text, capability);
  });

  // Pass 2 — if-statements that bounce the viewer.
  const required = new Set<Capability>();
  let sawDisjunction = false;

  collect(src, (n) => {
    if (!ts.isIfStatement(n)) return;

    let bounces = false;
    collect(n.thenStatement, (t) => {
      if (
        ts.isCallExpression(t) &&
        ts.isIdentifier(t.expression) &&
        (t.expression.text === 'redirect' || t.expression.text === 'notFound')
      ) {
        bounces = true;
      }
    });
    if (!bounces) return;

    const found = new Set<Capability>();
    collect(n.expression, (c) => {
      const direct = capabilityOfCanCall(c);
      if (direct) found.add(direct);
      else if (ts.isIdentifier(c) && aliases.has(c.text)) {
        found.add(aliases.get(c.text)!);
      }
    });
    if (found.size === 0) return;

    // `if (!a && !b) bounce` means "you need a OR b" — the shape both real
    // pages use. `if (!a || !b) bounce` would mean "you need BOTH", which this
    // model would get backwards, so refuse to guess.
    if (found.size > 1) {
      collect(n.expression, (c) => {
        if (
          ts.isBinaryExpression(c) &&
          c.operatorToken.kind === ts.SyntaxKind.BarBarToken
        ) {
          sawDisjunction = true;
        }
      });
    }
    for (const capability of found) required.add(capability);
  });

  if (sawDisjunction) {
    throw new Error(
      `${routeFor(file)} bounces on an OR of capability checks, which means ` +
        `"must hold ALL of them". This test models a guard as "any of" — the ` +
        `shape every page used when it was written. Extend PageGuard with an ` +
        `allOf arm before shipping that page.`
    );
  }

  if (required.size === 0) return null;
  return { route: routeFor(file), requiredAnyOf: [...required] };
}

const GUARDS: PageGuard[] = walkPages(join(REPO_ROOT, 'app'))
  .map(guardsFor)
  .filter((g): g is PageGuard => g !== null);

// A route can be guarded twice — once in its layout, once in its own page.
// Merged into one entry rather than letting the later file win, because losing
// either half would understate what the route demands.
//
// The merge is a union under `requiredAnyOf`. In reality a layout guard and a
// page guard compose as AND, so this reads LOOSER than the route behaves. That
// is the safe direction for what this map is for — catching a nav link offered
// to someone the page will bounce — but it means the map cannot be used to
// prove a route is reachable, only that a link is not obviously dead.
const GUARD_BY_ROUTE = new Map<string, PageGuard>();
for (const guard of GUARDS) {
  const existing = GUARD_BY_ROUTE.get(guard.route);
  GUARD_BY_ROUTE.set(
    guard.route,
    existing
      ? {
          route: guard.route,
          requiredAnyOf: [
            ...new Set([...existing.requiredAnyOf, ...guard.requiredAnyOf]),
          ],
        }
      : guard
  );
}

// ─── the role guard map: which roles does each page let stay? ───────────────

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * The role literal in a `x.role !== 'teacher'` (or bare `role !== 'teacher'`)
 * comparison, if it is one.
 */
function roleOfInequality(node: ts.Node): Role | null {
  if (!ts.isBinaryExpression(node)) return null;
  const op = node.operatorToken.kind;
  if (
    op !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    op !== ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return null;
  }

  const [subject, literal] = ts.isStringLiteral(node.right)
    ? [node.left, node.right]
    : ts.isStringLiteral(node.left)
      ? [node.right, node.left]
      : [null, null];
  if (!subject || !literal) return null;

  const readsRole = ts.isPropertyAccessExpression(subject)
    ? subject.name.text === 'role'
    : ts.isIdentifier(subject) && subject.text === 'role';
  if (!readsRole) return null;

  return isRole(literal.text) ? literal.text : null;
}

/**
 * Which roles may stay on a page, read from its own bouncing `if`s.
 *
 * MODELLED SHAPE, and only this one:
 *
 *   if (role !== 'a' && role !== 'b') redirect('/')   →  allowed = [a, b]
 *
 * Anything else is skipped rather than guessed at, and each skip is deliberate:
 *
 *   * `||` between role checks inverts the meaning, exactly as it does for
 *     capabilities above — refused for the same reason.
 *   * An `if` that mixes a role comparison with a `can()` call is a disjunction
 *     across two vocabularies ("superadmin OR holds the capability"), so the
 *     role half alone reads stricter than the page behaves. The capability map
 *     covers those pages already.
 *   * `role === 'x'` bouncing means "everyone EXCEPT x", which is a different
 *     shape and is not in use today. `roleGuardCoverage` below fails if that
 *     stops being true, so this stays a decision rather than an oversight.
 */
function roleGuardsFor(file: string): Role[] | null {
  const src = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  const allowed = new Set<Role>();

  collect(src, (n) => {
    if (!ts.isIfStatement(n)) return;

    let bounces = false;
    collect(n.thenStatement, (t) => {
      if (
        ts.isCallExpression(t) &&
        ts.isIdentifier(t.expression) &&
        (t.expression.text === 'redirect' || t.expression.text === 'notFound')
      ) {
        bounces = true;
      }
    });
    if (!bounces) return;

    const found = new Set<Role>();
    let mixesCapability = false;
    let disjoint = false;
    collect(n.expression, (c) => {
      const role = roleOfInequality(c);
      if (role) found.add(role);
      if (capabilityOfCanCall(c)) mixesCapability = true;
      if (
        ts.isBinaryExpression(c) &&
        c.operatorToken.kind === ts.SyntaxKind.BarBarToken
      ) {
        disjoint = true;
      }
    });

    if (found.size === 0 || mixesCapability || disjoint) return;
    for (const role of found) allowed.add(role);
  });

  if (allowed.size === 0) return null;
  return [...allowed];
}

/**
 * The routes a guard file covers.
 *
 * A LAYOUT COVERS ITS SUBTREE, and `routeFor` cannot say so on its own: a route
 * group contributes no URL segment, so `app/(records)/layout.tsx` derives as
 * `/`. Taken literally that would register the Records role guard against the
 * home page and flag every link in the app. The scope is therefore read from
 * the file tree — the pages actually sitting beneath that layout — which is
 * also how Next.js decides it.
 */
function scopeOf(file: string): string[] {
  if (!file.endsWith('layout.tsx')) return [routeFor(file)];
  return walkPages(dirname(file))
    .filter((f) => f.endsWith('page.tsx'))
    .map(routeFor);
}

// A layout guard and a page guard both have to be satisfied, so two guards on
// one route INTERSECT. That is the opposite direction from the capability map
// above, which unions — and deliberately so. There, a union reads looser than
// the route behaves, which is safe for "is this link obviously dead". Here the
// same reasoning points the other way: a role must clear both gates, so the
// intersection is what the viewer actually meets.
const ROLE_GUARD_BY_ROUTE = new Map<string, Role[]>();
for (const file of walkPages(join(REPO_ROOT, 'app'))) {
  const allowed = roleGuardsFor(file);
  if (!allowed) continue;
  for (const route of scopeOf(file)) {
    const existing = ROLE_GUARD_BY_ROUTE.get(route);
    ROLE_GUARD_BY_ROUTE.set(
      route,
      existing ? existing.filter((r) => allowed.includes(r)) : allowed
    );
  }
}

// ─── what each role is actually offered ─────────────────────────────────────

type Link = { source: string; label: string; href: string };

function pathOf(href: string): string {
  return href.split(/[?#]/)[0];
}

/** Mirrors the module switcher: a role that cannot open a module's root never
 *  sees that sidebar at all, so its items are not "advertised" to them. */
function seesModule(moduleName: string, role: Role): boolean {
  const root =
    SIDEBAR_REGISTRY[moduleName as keyof typeof SIDEBAR_REGISTRY]?.primaryHref;
  return !!root && isRouteAllowed(root, role);
}

function linksFor(role: Role): Link[] {
  const caps = capsOf(role);
  const links: Link[] = [];

  for (const moduleName of MODULE_ORDER) {
    if (!seesModule(moduleName, role)) continue;
    // Flattened: a child row is a link like any other, and an unguarded child
    // would be KD #173's defect one level down.
    for (const item of flattenNavItems(
      resolveSectionsForRole(moduleName, role, caps)
    )) {
      links.push({
        source: `nav/${moduleName}`,
        label: item.label,
        href: item.href,
      });
    }
  }

  for (const action of getQuickActions(role, [], BOTH_JOBS, caps)) {
    links.push({
      source: 'home/quick-actions',
      label: action.label,
      href: action.href,
    });
  }

  for (const source of HOME_TODO_SOURCES) {
    if (!source.roles.includes(role)) continue;
    if (
      source.requiresCapability &&
      !caps.includes(source.requiresCapability)
    ) {
      continue;
    }
    links.push({
      source: 'home/todos',
      label: source.id,
      href: source.href,
    });
  }

  for (const entry of visibleNavEntries(role, caps, [])) {
    links.push({
      source: 'command-palette',
      label: entry.label,
      href: entry.href,
    });
  }

  return links;
}

// ─── assertions ─────────────────────────────────────────────────────────────

describe('a capability-guarded page is never advertised to a role without it', () => {
  it.each(ROLES)('%s is offered nothing that would bounce them', (role) => {
    const caps = capsOf(role);
    const offences: string[] = [];

    for (const link of linksFor(role)) {
      const guard = GUARD_BY_ROUTE.get(pathOf(link.href));
      if (!guard) continue;
      if (guard.requiredAnyOf.some((c) => caps.includes(c))) continue;
      offences.push(
        `${link.source}: "${link.label}" -> ${link.href} is visible to ` +
          `${role}, but that page redirects unless you hold one of ` +
          `[${guard.requiredAnyOf.join(', ')}]`
      );
    }

    expect(offences).toEqual([]);
  });
});

describe('a role-guarded page is never advertised to a role it bounces', () => {
  it.each(ROLES)('%s is offered nothing that would bounce them', (role) => {
    const offences: string[] = [];

    for (const link of linksFor(role)) {
      const allowed = ROLE_GUARD_BY_ROUTE.get(pathOf(link.href));
      if (!allowed) continue;
      if (allowed.includes(role)) continue;
      offences.push(
        `${link.source}: "${link.label}" -> ${link.href} is visible to ` +
          `${role}, but that page redirects anyone who is not ` +
          `[${[...allowed].sort().join(', ')}]`
      );
    }

    expect([...new Set(offences)]).toEqual([]);
  });
});

describe('the role guard map is really looking at something', () => {
  it('found a plausible number of role-guarded routes', () => {
    expect(ROLE_GUARD_BY_ROUTE.size).toBeGreaterThanOrEqual(30);
  });

  it('reads the attendance audit log as coordinator-and-above', () => {
    // The route that prompted this half of the test. Pinned by name so a
    // future widening of the page guard has to come here and say so.
    expect(
      [...(ROLE_GUARD_BY_ROUTE.get('/attendance/audit-log') ?? [])].sort()
    ).toEqual(['academic_coordinator', 'school_admin', 'superadmin']);
  });

  it('scopes a group layout to its own subtree, not to the home page', () => {
    // `app/(records)/layout.tsx` derives as `/` under a naive reading. If that
    // ever regresses, the home page acquires a role guard and every assertion
    // above turns into noise.
    expect(ROLE_GUARD_BY_ROUTE.has('/')).toBe(false);
    expect(ROLE_GUARD_BY_ROUTE.has('/records/students')).toBe(true);
  });

  it('reads a role-guarded route that admits teachers as admitting them', () => {
    // A one-sided map — everything coordinator-and-above — would satisfy every
    // assertion above while being useless, since no teacher link would ever
    // match a route in it. Evaluation sections is the counter-example.
    expect(
      [...(ROLE_GUARD_BY_ROUTE.get('/evaluation/sections') ?? [])].sort()
    ).toEqual([
      'academic_coordinator',
      'school_admin',
      'superadmin',
      'teacher',
    ]);
  });

  // ON THE SHAPES NOT MODELLED. `if (role === 'x') redirect()` is common in
  // `app/` and is almost never a guard: it is a branch choosing a friendlier
  // destination inside an outer guard (`(admissions)/layout.tsx` sends a
  // teacher to /markbook rather than /), or a whole alternate render
  // (`attendance/page.tsx` returns the adviser dashboard). Ten files match it
  // and none of them are the defect this test looks for, so treating the shape
  // as a guard would produce ten false reports and no true one.
});

describe('the guard map is really looking at something', () => {
  // Floors, so the walk cannot silently start covering nothing — a broken
  // route derivation or a renamed `can` helper would otherwise turn every
  // assertion above into a no-op that still passes.
  it('walked a plausible number of pages', () => {
    expect(walkPages(join(REPO_ROOT, 'app')).length).toBeGreaterThanOrEqual(40);
  });

  it('found the two capability-guarded pages by name', () => {
    expect(GUARD_BY_ROUTE.has('/admissions/document-validation')).toBe(true);
    expect(GUARD_BY_ROUTE.has('/p-files/document-validation')).toBe(true);
  });

  it('reads the P-Files OR-guard as either capability', () => {
    const guard = GUARD_BY_ROUTE.get('/p-files/document-validation')!;
    expect([...guard.requiredAnyOf].sort()).toEqual([
      'documents_post_enrolment.read',
      'documents_pre_enrolment.read',
    ]);
  });

  it('at least one nav item declares requiresCapability', () => {
    const tagged = MODULE_ORDER.flatMap((m) =>
      ROLES.flatMap((r) =>
        flattenNavItems(resolveSectionsForRole(m, r, undefined))
      )
    );
    // Resolved with NO capabilities, so a `requiresCapability` item is hidden
    // — which is the fail-closed behaviour, and is itself worth pinning.
    expect(tagged.some((i) => i.requiresCapability)).toBe(false);

    const withCaps = MODULE_ORDER.flatMap((m) =>
      ROLES.flatMap((r) =>
        flattenNavItems(resolveSectionsForRole(m, r, capsOf(r)))
      )
    );
    expect(withCaps.some((i) => i.requiresCapability)).toBe(true);
  });
});

describe('every module layout passes capabilities to the sidebar', () => {
  // The fail-closed default means a layout that forgets the prop silently
  // strips its capability-gated rows. That is the safe direction, but it is
  // still a bug, and it is invisible without this check.
  const layouts = readdirSync(join(REPO_ROOT, 'app'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('('))
    .map((d) => join(REPO_ROOT, 'app', d.name, 'layout.tsx'))
    .filter((f) => {
      try {
        return readFileSync(f, 'utf8').includes('<ModuleSidebar');
      } catch {
        return false;
      }
    });

  it('found the layouts', () => {
    expect(layouts.length).toBeGreaterThanOrEqual(8);
  });

  it.each(layouts)('%s passes capabilities', (file) => {
    expect(readFileSync(file, 'utf8')).toContain('capabilities={');
  });
});

describe('requiresRoles lists agree with the guard they stand in for', () => {
  // An item that guards by ROLE while its page guards by CAPABILITY is only
  // correct while the two sets coincide. /p-files/document-validation is
  // deliberately in that position (its page guard is an OR of two
  // capabilities, which NavItem.requiresCapability cannot express), so the
  // equivalence has to be asserted rather than assumed.
  it('every role in a requiresRoles list satisfies that href guard', () => {
    const offences: string[] = [];

    for (const moduleName of MODULE_ORDER) {
      for (const role of ROLES) {
        {
          for (const item of flattenNavItems(
            resolveSectionsForRole(moduleName, role, capsOf(role))
          )) {
            if (!item.requiresRoles) continue;
            const guard = GUARD_BY_ROUTE.get(pathOf(item.href));
            if (!guard) continue;
            for (const listed of item.requiresRoles) {
              const caps = capsOf(listed);
              if (guard.requiredAnyOf.some((c) => caps.includes(c))) continue;
              offences.push(
                `nav/${moduleName}: "${item.label}" lists ${listed} in ` +
                  `requiresRoles, but ${item.href} needs one of ` +
                  `[${guard.requiredAnyOf.join(', ')}]`
              );
            }
          }
        }
      }
    }

    expect([...new Set(offences)]).toEqual([]);
  });
});
