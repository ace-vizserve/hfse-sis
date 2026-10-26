/**
 * The parent API's rate limiter.
 *
 * Each authenticated parent route checks twice: the IP before the token is
 * verified, then the user after. The second check used to go through
 * `rateLimit({ ip, userId })`, which re-ran the IP check, so every request
 * counted twice against the IP — a parent was refused at half the stated
 * limit, and on the declarations route reading the list used up the filing
 * allowance. Found by the parent-portal browser test (e2e/), where the fourth
 * filing of a run was answered "Sent too many just now".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { rateLimit, userRateLimit } from '@/lib/rate-limit';

let n = 0;
const fresh = () => `test-scope-${++n}`;

describe('rateLimit', () => {
  it('allows exactly ipMax requests from one IP, then refuses', () => {
    const scope = fresh();
    for (let i = 0; i < 3; i++) {
      expect(
        rateLimit({ ip: '1.1.1.1', scope, ipMax: 3, windowSecs: 60 }).limited
      ).toBe(false);
    }
    const blocked = rateLimit({
      ip: '1.1.1.1',
      scope,
      ipMax: 3,
      windowSecs: 60,
    });
    expect(blocked.limited).toBe(true);
    // Another IP has its own allowance.
    expect(
      rateLimit({ ip: '2.2.2.2', scope, ipMax: 3, windowSecs: 60 }).limited
    ).toBe(false);
  });
});

describe('userRateLimit', () => {
  it('counts the user only, never the IP again', () => {
    const scope = fresh();
    // The route's pattern: an IP check, then a user check, per request.
    for (let i = 0; i < 3; i++) {
      expect(
        rateLimit({ ip: '3.3.3.3', scope, ipMax: 3, windowSecs: 60 }).limited
      ).toBe(false);
      expect(
        userRateLimit({ userId: 'u1', scope, userMax: 5, windowSecs: 60 })
          .limited
      ).toBe(false);
    }
    // Three requests used three of the IP's three — not six.
    expect(
      rateLimit({ ip: '3.3.3.3', scope, ipMax: 3, windowSecs: 60 }).limited
    ).toBe(true);
  });

  it('refuses a user past userMax', () => {
    const scope = fresh();
    for (let i = 0; i < 2; i++) {
      expect(
        userRateLimit({ userId: 'u2', scope, userMax: 2, windowSecs: 60 })
          .limited
      ).toBe(false);
    }
    expect(
      userRateLimit({ userId: 'u2', scope, userMax: 2, windowSecs: 60 }).limited
    ).toBe(true);
    expect(
      userRateLimit({ userId: 'u3', scope, userMax: 2, windowSecs: 60 }).limited
    ).toBe(false);
  });
});

describe('parent routes use the user-only check after the token', () => {
  const routes = [
    'students',
    'report-card',
    'levels',
    'enrolled-students',
    'declarations',
    'declarations/evidence',
  ];
  for (const r of routes) {
    it(`${r}: no second IP check`, () => {
      const src = readFileSync(
        join(process.cwd(), 'app/api/parent/v2', r, 'route.ts'),
        'utf8'
      );
      expect(src).toContain('userRateLimit({');
      // A `rateLimit({` call that names a userId is the double-count shape.
      expect(src).not.toMatch(/rateLimit\(\{[^}]*userId/);
    });
  }

  it('declarations: reading the list and filing count separately', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/api/parent/v2/declarations/route.ts'),
      'utf8'
    );
    expect(src).toContain("'parent-v2-declarations-read'");
    expect(src).toContain("'parent-v2-declarations-file'");
  });
});
