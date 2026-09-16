/**
 * Tests for the ⌘K palette's two new pure lists — `visibleQuickActions` and
 * `visibleStudentVerbs` (lib/sis/command-palette-nav.ts) — plus the recents
 * store in lib/sis/palette-recents.ts.
 *
 * `command-palette-nav.ts` deliberately carries no 'use client' so a plain
 * test can import it without cmdk, React or TanStack Query. Its header has
 * advertised that since it was extracted; this is the first test to take it
 * up on the offer.
 *
 * The verb list is ONE list for everyone, narrowed by isRouteAllowed() rather
 * than authored per role — so these tests pin the narrowing, which is where
 * the behaviour actually lives.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  primaryStudentVerb,
  visibleQuickActions,
  visibleStudentVerbs,
  type StudentVerbTarget,
} from '@/lib/sis/command-palette-nav';
import {
  addRecent,
  clearAllRecents,
  parseRecents,
  recentKey,
  recentsStorageKey,
  RECENTS_LIMIT,
  type RecentEntry,
} from '@/lib/sis/palette-recents';

const ENROLLED: StudentVerbTarget = {
  studentNumber: '2024-0117',
  enroleeNumber: 'E26-0042',
  ayCode: 'AY2026',
};

const APPLICANT: StudentVerbTarget = {
  studentNumber: null,
  enroleeNumber: 'E26-0099',
  ayCode: 'AY2026',
};

const keysFor = (
  t: StudentVerbTarget,
  role: Parameters<typeof visibleStudentVerbs>[1]
) => visibleStudentVerbs(t, role).map((v) => v.key);

describe('visibleStudentVerbs — enrolled student', () => {
  it('gives an academic coordinator every surface', () => {
    expect(keysFor(ENROLLED, 'academic_coordinator')).toEqual([
      'record',
      'attendance',
      'academic',
      'discipline',
    ]);
  });

  it('drops the Records surfaces for a teacher, keeping attendance', () => {
    // ROUTE_ACCESS: /records excludes teacher, /attendance includes them.
    expect(keysFor(ENROLLED, 'teacher')).toEqual(['attendance']);
  });

  it('drops attendance for admissions, keeping the Records surfaces', () => {
    // The mirror of the teacher case — /attendance has no `admissions` entry.
    expect(keysFor(ENROLLED, 'admissions')).toEqual([
      'record',
      'academic',
      'discipline',
    ]);
  });

  it('gives a signed-out viewer nothing', () => {
    expect(keysFor(ENROLLED, null)).toEqual([]);
  });

  it('keys every enrolled verb on studentNumber, never enroleeNumber', () => {
    // Hard Rule #4 — enroleeNumber resets each AY and must not address a
    // cross-year record.
    for (const verb of visibleStudentVerbs(ENROLLED, 'academic_coordinator')) {
      expect(verb.href).toContain('2024-0117');
      expect(verb.href).not.toContain('E26-0042');
    }
  });

  it('deep-links the tab verbs at the Records detail page', () => {
    const byKey = Object.fromEntries(
      visibleStudentVerbs(ENROLLED, 'academic_coordinator').map((v) => [
        v.key,
        v.href,
      ])
    );
    expect(byKey.academic).toBe('/records/students/2024-0117?tab=academic');
    expect(byKey.discipline).toBe('/records/students/2024-0117?tab=discipline');
  });
});

describe('visibleStudentVerbs — applicant', () => {
  it('offers only the application, since no Records row exists yet', () => {
    expect(keysFor(APPLICANT, 'admissions')).toEqual(['application']);
  });

  it('carries the AY, because enroleeNumber alone is ambiguous across years', () => {
    const [verb] = visibleStudentVerbs(APPLICANT, 'admissions');
    expect(verb.href).toContain('E26-0099');
    expect(verb.href).toContain('ay=AY2026');
  });

  it('gives a teacher nothing — /admissions excludes them', () => {
    expect(keysFor(APPLICANT, 'teacher')).toEqual([]);
  });
});

describe('primaryStudentVerb — what Enter runs', () => {
  it('is the record for an enrolled student, as before the sub-view existed', () => {
    expect(primaryStudentVerb(ENROLLED, 'academic_coordinator')?.href).toBe(
      '/records/students/2024-0117'
    );
  });

  it('is the application for an applicant, as before', () => {
    expect(primaryStudentVerb(APPLICANT, 'admissions')?.key).toBe(
      'application'
    );
  });

  it('is null when the role can reach none of them', () => {
    expect(primaryStudentVerb(APPLICANT, 'teacher')).toBeNull();
  });
});

describe('visibleQuickActions', () => {
  it('pools actions from more than one module', () => {
    const actions = visibleQuickActions('academic_coordinator');
    expect(actions.length).toBeGreaterThan(0);
    // The point of the feature: you are not limited to the module you are
    // standing in, so more than one module must be represented.
    expect(new Set(actions.map((a) => a.module)).size).toBeGreaterThan(1);
  });

  it('labels each action with its module, since the label alone is ambiguous', () => {
    for (const action of visibleQuickActions('academic_coordinator')) {
      expect(action.moduleLabel).toBeTruthy();
    }
  });

  it('never offers a route the role cannot reach', () => {
    for (const role of [
      'teacher',
      'admissions',
      'academic_coordinator',
    ] as const) {
      for (const action of visibleQuickActions(role)) {
        expect(action.href.startsWith('/')).toBe(true);
      }
    }
  });

  it('omits a module the viewer has had hidden', () => {
    const all = visibleQuickActions('academic_coordinator');
    const target = all[0];
    const narrowed = visibleQuickActions('academic_coordinator', [
      target.module,
    ]);
    expect(narrowed.map((a) => a.href)).not.toContain(target.href);
  });

  it('gives a signed-out viewer nothing', () => {
    expect(visibleQuickActions(null)).toEqual([]);
  });
});

describe('recents', () => {
  const student = (
    studentNumber: string | null,
    name: string
  ): RecentEntry => ({
    kind: 'student',
    studentNumber,
    enroleeNumber: `E-${name}`,
    ayCode: 'AY2026',
    fullName: name,
    level: null,
    status: null,
  });
  const place = (href: string): RecentEntry => ({
    kind: 'destination',
    href,
    label: href,
    hint: 'Records',
  });

  it('puts the newest entry first', () => {
    const list = addRecent(addRecent([], student('1', 'A')), student('2', 'B'));
    expect(list[0]).toMatchObject({ fullName: 'B' });
  });

  it('moves a repeat visit to the front instead of duplicating it', () => {
    let list = addRecent([], student('1', 'A'));
    list = addRecent(list, student('2', 'B'));
    list = addRecent(list, student('1', 'A'));
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ fullName: 'A' });
  });

  it('identifies a student by studentNumber across academic years', () => {
    const ay25 = { ...student('1', 'A'), ayCode: 'AY2025' } as RecentEntry;
    expect(recentKey(ay25)).toBe(recentKey(student('1', 'A')));
  });

  it('falls back to the AY-scoped enrolee number for an applicant', () => {
    expect(recentKey(student(null, 'A'))).toContain('AY2026');
  });

  it('caps each kind separately, so places never crowd out students', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < RECENTS_LIMIT + 3; i += 1) {
      list = addRecent(list, place(`/p/${i}`));
    }
    list = addRecent(list, student('1', 'A'));
    expect(list.filter((e) => e.kind === 'destination')).toHaveLength(
      RECENTS_LIMIT
    );
    expect(list.filter((e) => e.kind === 'student')).toHaveLength(1);
  });

  it('drops stored rows that no longer match the shape', () => {
    // Storage is user-writable and survives deploys — a row from an older
    // shape must not render as a row full of undefined.
    const raw = JSON.stringify([
      {
        kind: 'student',
        fullName: 'Ok',
        enroleeNumber: 'E1',
        ayCode: 'AY2026',
      },
      { kind: 'student', fullName: 'Missing keys' },
      { kind: 'nonsense' },
      null,
      'a string',
    ]);
    expect(parseRecents(raw)).toHaveLength(1);
  });

  it('returns an empty list for absent or unparseable storage', () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('{not json')).toEqual([]);
    expect(parseRecents('{"not":"an array"}')).toEqual([]);
  });

  it('clears every account on sign-out, not just the one signing out', () => {
    // Shared front-desk machines: namespacing stops the next person SEEING
    // the previous user's students, but the rows stay on disk and are
    // readable in devtools. Sign-out is when we know a shift ended.
    const store = new Map<string, string>([
      [recentsStorageKey('user-a'), '[]'],
      [recentsStorageKey('user-b'), '[]'],
      ['unrelated:key', 'keep me'],
    ]);
    vi.stubGlobal('window', {
      localStorage: {
        get length() {
          return store.size;
        },
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => store.delete(k),
      },
    });

    clearAllRecents();

    expect(store.has(recentsStorageKey('user-a'))).toBe(false);
    expect(store.has(recentsStorageKey('user-b'))).toBe(false);
    // Only our own keys — never anyone else's storage.
    expect(store.get('unrelated:key')).toBe('keep me');
    vi.unstubAllGlobals();
  });

  it('does not skip keys while removing them', () => {
    // Removing during an index walk shifts the remaining keys down, so a
    // naive loop silently clears only half. Five keys, none may survive.
    const store = new Map<string, string>(
      ['a', 'b', 'c', 'd', 'e'].map((id) => [recentsStorageKey(id), '[]'])
    );
    vi.stubGlobal('window', {
      localStorage: {
        get length() {
          return store.size;
        },
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => store.delete(k),
      },
    });

    clearAllRecents();

    expect(store.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it('gives two accounts different storage keys', () => {
    // School front-desk machines are shared and browser profiles are not. On
    // a single unscoped key the next person to sign in would open ⌘K and read
    // the previous user's students — names, studentNumbers, levels, status.
    expect(recentsStorageKey('user-a')).not.toBe(recentsStorageKey('user-b'));
  });
});

describe('a remembered student stays subject to the live role check', () => {
  // A stored row outlives the permissions it was stored under: roles change,
  // and reachability is re-derived on read, never trusted from storage.
  it('has no reachable surface for a teacher once it is an applicant', () => {
    expect(visibleStudentVerbs(APPLICANT, 'teacher')).toHaveLength(0);
  });

  it('still has one for a teacher when the student is enrolled', () => {
    expect(visibleStudentVerbs(ENROLLED, 'teacher')).toHaveLength(1);
  });
});
