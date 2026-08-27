import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { corsHeaders } from '@/lib/cors';

// The parent portal is a separate application on another origin, so every route
// it can reach advertises its own allowed methods. Until 2026-08-27 that was
// `GET, OPTIONS` for all of them, hardcoded in `lib/cors.ts`.
//
// Declarations made the portal a writer for the first time, which meant
// widening the shared helper. ⚠ THE WIDENING IS THE RISK THIS FILE EXISTS FOR:
// the obvious change — editing the hardcoded string to include POST — would
// have handed `POST` to the report-card and students routes too, silently, on
// the same deploy. So the methods became a per-route argument with a read-only
// default, and these tests hold that line.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('corsHeaders', () => {
  it('defaults to read-only', () => {
    expect(corsHeaders(null)['Access-Control-Allow-Methods']).toBe(
      'GET, OPTIONS'
    );
  });

  it('advertises what the route asks for', () => {
    expect(
      corsHeaders(null, 'GET, POST, OPTIONS')['Access-Control-Allow-Methods']
    ).toBe('GET, POST, OPTIONS');
  });

  it('caches the preflight, which now fires on every write', () => {
    // A JSON POST is not a simple request, so the browser sends OPTIONS first
    // every single time. Without a max-age that is two round trips per
    // submission from a parent on a phone.
    expect(corsHeaders(null)['Access-Control-Max-Age']).toBeTruthy();
  });

  it('never reflects an origin outside the allowlist', () => {
    const headers = corsHeaders(
      'https://not-our-portal.example',
      'POST, OPTIONS'
    );
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });
});

// Every parent-reachable route and exactly what it may advertise. A new route
// under app/api/parent/v2 that is not listed here fails the last test in this
// file, so widening one cannot be done quietly.
//
// ⚠ AN EARLIER VERSION OF THIS GUARD DID NOT WORK. It matched
// `corsHeaders\([^)]*\)` and asserted the match contained no comma — but that
// regex stops at the FIRST `)`, which is the one closing
// `request.headers.get('origin')`. So it never saw the second argument and
// would have stayed green while somebody handed POST to the report-card route.
// It now reads the declared methods instead of inferring them from punctuation.
const ADVERTISED: Record<string, string> = {
  'app/api/parent/v2/students/route.ts': 'GET, OPTIONS',
  'app/api/parent/v2/report-card/route.ts': 'GET, OPTIONS',
  'app/api/parent/v2/levels/route.ts': 'GET, OPTIONS',
  'app/api/parent/v2/enrolled-students/route.ts': 'GET, OPTIONS',
  'app/api/parent/v2/declarations/route.ts': 'GET, POST, OPTIONS',
  'app/api/parent/v2/declarations/evidence/route.ts': 'POST, OPTIONS',
};

/**
 * What a route actually advertises: the `CORS_METHODS` constant it declares,
 * or the helper's read-only default when it declares none.
 */
function advertisedMethods(source: string): string {
  const declared = source.match(/CORS_METHODS\s*=\s*'([^']+)'/);
  if (declared) return declared[1];
  return 'GET, OPTIONS';
}

describe('what each parent route advertises', () => {
  for (const [route, expected] of Object.entries(ADVERTISED)) {
    it(`${route} advertises ${expected}`, () => {
      expect(advertisedMethods(read(route))).toBe(expected);
    });
  }

  it('the guard itself detects a widening', () => {
    // Proves the assertion above can fail. The previous version of this file
    // could not, which is why it is pinned.
    const widened = "const CORS_METHODS = 'GET, POST, OPTIONS';";
    expect(advertisedMethods(widened)).toBe('GET, POST, OPTIONS');
    expect(advertisedMethods('no constant here')).toBe('GET, OPTIONS');
  });

  it('a read-only route exports no write handler', () => {
    for (const [route, methods] of Object.entries(ADVERTISED)) {
      if (methods !== 'GET, OPTIONS') continue;
      expect(read(route), route).not.toMatch(
        /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\s*\(/
      );
    }
  });

  it('a route advertising POST actually exports one', () => {
    for (const [route, methods] of Object.entries(ADVERTISED)) {
      if (!methods.includes('POST')) continue;
      expect(read(route), route).toMatch(
        /export\s+async\s+function\s+POST\s*\(/
      );
    }
  });

  it('covers every route under app/api/parent/v2', () => {
    // A new parent-reachable route must be classified above, or this fails.
    // That is the point of the test: the risk is not a route that advertises
    // the wrong methods, it is one nobody remembered to think about.
    const base = 'app/api/parent/v2';
    const walk = (rel: string): string[] =>
      readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(`${rel}/${entry.name}`)
          : entry.name === 'route.ts'
            ? [`${rel}/${entry.name}`]
            : []
      );

    const found = walk(base);
    expect(found.length).toBeGreaterThan(0);
    expect(found.sort()).toEqual(Object.keys(ADVERTISED).sort());
  });
});
