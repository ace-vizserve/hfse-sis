/**
 * Which module pages have no auth guard of their own, and what the route table
 * says should reach them.
 *
 * Three layers gate a page: the middleware (`lib/supabase/proxy.ts`, which
 * checks the session AND `isRouteAllowed`), the module layout, and the page
 * itself. 78 of 102 module pages carry their own guard; this lists the ones that
 * do not, and resolves the ROUTE_ACCESS rule each falls under — so a guard can
 * be added that MATCHES the table rather than being invented.
 *
 * ⚠ `isRouteAllowed` matches in DECLARATION ORDER, not by longest prefix, and
 * returns TRUE when no rule matches. A path with no row is therefore reachable
 * by any signed-in role — worth knowing before thinning the layers above it.
 *
 * NOT A TEST — reachable only via scripts/vitest.perf.config.ts.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { describe, it } from 'vitest';

import { ROUTE_ACCESS } from '@/lib/auth/roles';

const GROUPS = [
  'app/(sis)',
  'app/(markbook)',
  'app/(attendance)',
  'app/(records)',
  'app/(admissions)',
  'app/(evaluation)',
  'app/(p-files)',
  'app/(classroom)',
];

/** `app/(sis)/sis/ay-setup/page.tsx` → `/sis/ay-setup` */
function urlFor(file: string): string {
  const withoutApp = file.split('app/').join('');
  const withoutGroup = withoutApp.replace(/^\([^)]*\)\//, '');
  return '/' + withoutGroup.replace(/\/page\.tsx$/, '');
}

describe('unguarded module pages', () => {
  it('lists them with the rule that governs each', () => {
    const files = execSync(
      'find ' + GROUPS.map((g) => '"' + g + '"').join(' ') + ' -name page.tsx',
      { encoding: 'utf8' }
    )
      .split('\n')
      .map((s) => s.trim().split('\\').join('/'))
      .filter(Boolean);

    const unguarded = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return !/getSessionUser|requireRole|requireCapability/.test(src);
    });

    console.log(
      '\n  ' +
        unguarded.length +
        ' of ' +
        files.length +
        ' module pages have no guard of their own\n'
    );
    console.log(
      '  ' + 'url'.padEnd(56) + 'rule'.padEnd(28) + 'roles the table allows'
    );
    console.log('  ' + '-'.repeat(104));

    const noRule: string[] = [];
    for (const f of unguarded.sort()) {
      const url = urlFor(f);
      const rule = ROUTE_ACCESS.find((r) =>
        r.exact
          ? url === r.prefix
          : url === r.prefix || url.startsWith(r.prefix + '/')
      );
      if (!rule) noRule.push(url);
      console.log(
        '  ' +
          url.padEnd(56) +
          (rule
            ? rule.prefix.padEnd(28) + rule.allowed.join(', ')
            : '(no row)'.padEnd(28) + 'ANY signed-in role')
      );
    }

    if (noRule.length > 0) {
      console.log(
        '\n  No ROUTE_ACCESS row at all — the middleware lets any signed-in role through:'
      );
      for (const u of noRule) console.log('      ' + u);
    }
  }, 120_000);
});
