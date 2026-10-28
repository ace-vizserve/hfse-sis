import { describe, expect, it } from 'vitest';

import {
  buildLevelSupplies,
  levelTracks,
  type LevelStudent,
} from '@/lib/sis/supplies/level-counts';
import type { SupplyItemRow } from '@/lib/sis/supplies/types';

const P3 = 'level-p3';
const S1 = 'level-s1';
const YS = 'level-ys';

let n = 0;
function item(p: Partial<SupplyItemRow>): SupplyItemRow {
  n += 1;
  return {
    id: `item-${n}`,
    kind: 'book',
    level_id: P3,
    class_type: null,
    subject: 'English',
    title: `Title ${n}`,
    publisher: null,
    isbn: null,
    sort_order: n,
    ...p,
  };
}

const items: SupplyItemRow[] = [
  item({ id: 'p3-glb-eng', class_type: 'Global', title: 'Grammar G' }),
  item({ id: 'p3-std-eng', class_type: 'Standard', title: 'Grammar S' }),
  item({
    id: 'p3-std-math',
    class_type: 'Standard',
    subject: 'Mathematics',
    title: 'Maths S',
    publisher: 'Star',
    isbn: '978-1',
  }),
  item({ id: 's1-sci', level_id: S1, subject: 'Science', title: 'Sci 1' }),
  item({
    id: 'all-pencil',
    kind: 'supply',
    level_id: null,
    subject: null,
    title: 'Pencil',
  }),
  item({
    id: 'ys-kit',
    kind: 'supply',
    level_id: YS,
    subject: null,
    title: 'YS Kit',
  }),
];

// P3: two Global, two Standard (one in a class with no track), plus a
// duplicate enrolment row that must count once.
const students: LevelStudent[] = [
  { studentNumber: 'G1', classType: 'Global' },
  { studentNumber: 'G2', classType: 'Global' },
  { studentNumber: 'S1', classType: 'Standard' },
  { studentNumber: 'N1', classType: null },
  { studentNumber: 'N1', classType: null },
];

function find(result: ReturnType<typeof buildLevelSupplies>, id: string) {
  return result.groups.flatMap((g) => g.items).find((i) => i.id === id);
}

describe('levelTracks', () => {
  it('names the tracks a level’s books are split by, Global first', () => {
    expect(levelTracks(items, P3)).toEqual(['Global', 'Standard']);
    expect(levelTracks(items, S1)).toEqual([]);
    expect(levelTracks(items, YS)).toEqual([]);
  });
});

describe('buildLevelSupplies', () => {
  it('counts M per track, a class with no track counting as Standard', () => {
    const r = buildLevelSupplies({
      levelId: P3,
      track: 'Standard',
      items,
      students,
      handovers: [
        { item_id: 'p3-std-eng', student_number: 'N1' },
        { item_id: 'all-pencil', student_number: 'S1' },
        // A Global student's tick never counts on the Standard view.
        { item_id: 'all-pencil', student_number: 'G1' },
      ],
    });
    expect(r.track).toBe('Standard');
    expect(r.students).toBe(2);
    expect(find(r, 'p3-std-eng')).toMatchObject({ given: 1, students: 2 });
    expect(find(r, 'p3-std-math')).toMatchObject({
      given: 0,
      students: 2,
      meta: 'Star · 978-1',
    });
    expect(find(r, 'all-pencil')).toMatchObject({ given: 1, students: 2 });
    // The other track's books, other levels and YS-only supplies are not shown.
    expect(find(r, 'p3-glb-eng')).toBeUndefined();
    expect(find(r, 's1-sci')).toBeUndefined();
    expect(find(r, 'ys-kit')).toBeUndefined();
  });

  it('shows the Global list with its own students', () => {
    const r = buildLevelSupplies({
      levelId: P3,
      track: 'Global',
      items,
      students,
      handovers: [
        { item_id: 'p3-glb-eng', student_number: 'G1' },
        { item_id: 'p3-glb-eng', student_number: 'G2' },
      ],
    });
    expect(r.students).toBe(2);
    expect(find(r, 'p3-glb-eng')).toMatchObject({ given: 2, students: 2 });
    expect(find(r, 'p3-std-eng')).toBeUndefined();
  });

  it('the application track wins over the class; unresolved falls back to it', () => {
    // N1 sits in a class with no track but applied Global; G2 sits in a
    // Global class but applied Standard; G1's application is unresolved.
    const mixed: LevelStudent[] = [
      { studentNumber: 'G1', classType: 'Global', applicationTrack: null },
      {
        studentNumber: 'G2',
        classType: 'Global',
        applicationTrack: 'Standard',
      },
      { studentNumber: 'S1', classType: 'Standard' },
      { studentNumber: 'N1', classType: null, applicationTrack: 'Global' },
    ];
    const handovers = [
      { item_id: 'p3-glb-eng', student_number: 'N1' },
      { item_id: 'p3-glb-eng', student_number: 'G2' },
    ];
    const global = buildLevelSupplies({
      levelId: P3,
      track: 'Global',
      items,
      students: mixed,
      handovers,
    });
    expect(global.students).toBe(2); // G1, N1
    // G2's tick no longer counts: G2 is on the Standard list now.
    expect(find(global, 'p3-glb-eng')).toMatchObject({
      given: 1,
      students: 2,
      handedOver: 2,
    });

    const standard = buildLevelSupplies({
      levelId: P3,
      track: 'Standard',
      items,
      students: mixed,
      handovers,
    });
    expect(standard.students).toBe(2); // G2, S1
    expect(find(standard, 'p3-std-eng')).toMatchObject({ students: 2 });
  });

  it('defaults to the first track when none or an unknown one is asked for', () => {
    expect(
      buildLevelSupplies({
        levelId: P3,
        track: null,
        items,
        students,
        handovers: [],
      }).track
    ).toBe('Global');
    expect(
      buildLevelSupplies({
        levelId: P3,
        track: 'Cambridge',
        items,
        students,
        handovers: [],
      }).track
    ).toBe('Global');
  });

  it('without a track split counts every student of the level', () => {
    const s1Students: LevelStudent[] = [
      { studentNumber: 'A', classType: 'Global' },
      { studentNumber: 'B', classType: null },
    ];
    const r = buildLevelSupplies({
      levelId: S1,
      track: 'Global',
      items,
      students: s1Students,
      handovers: [{ item_id: 's1-sci', student_number: 'B' }],
    });
    expect(r.track).toBeNull();
    expect(r.tracks).toEqual([]);
    expect(r.students).toBe(2);
    expect(find(r, 's1-sci')).toMatchObject({ given: 1, students: 2 });
    expect(find(r, 'all-pencil')).toMatchObject({ given: 0, students: 2 });
  });

  it('groups books by subject in sheet order, supplies last', () => {
    const r = buildLevelSupplies({
      levelId: P3,
      track: 'Standard',
      items,
      students,
      handovers: [],
    });
    expect(r.groups.map((g) => [g.kind, g.name])).toEqual([
      ['book', 'English'],
      ['book', 'Mathematics'],
      ['supply', 'Supplies'],
    ]);
  });

  it('counts every handover for Remove, and lists the level’s subjects for the form', () => {
    const r = buildLevelSupplies({
      levelId: P3,
      track: 'Standard',
      items: [
        ...items,
        item({ id: 'p3-none', subject: null, title: 'No subj' }),
      ],
      students,
      handovers: [
        { item_id: 'p3-std-eng', student_number: 'N1' },
        // Not in a P3 Standard class now (withdrawn, moved) — still blocks Remove.
        { item_id: 'p3-std-eng', student_number: 'GONE' },
      ],
    });
    expect(find(r, 'p3-std-eng')).toMatchObject({
      given: 1,
      handedOver: 2,
      kind: 'book',
      subject: 'English',
      classType: 'Standard',
      levelId: P3,
    });
    expect(find(r, 'p3-std-math')).toMatchObject({ handedOver: 0 });
    // Both tracks' subjects, in list order; a book with no subject adds none.
    expect(r.subjects).toEqual(['English', 'Mathematics']);
  });

  it('a level with no classes yet counts zero of zero', () => {
    const r = buildLevelSupplies({
      levelId: YS,
      track: null,
      items,
      students: [],
      handovers: [],
    });
    expect(r.students).toBe(0);
    expect(r.groups.map((g) => g.items.map((i) => i.id))).toEqual([
      ['all-pencil', 'ys-kit'],
    ]);
    expect(find(r, 'ys-kit')).toMatchObject({ given: 0, students: 0 });
  });
});
