import { describe, expect, it } from 'vitest';

import { buildStudentSupplies } from '@/lib/sis/supplies/student-list';
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
  item({
    id: 'p3-std-eng',
    class_type: 'Standard',
    subject: 'English',
    title: 'Grammar P3',
    publisher: 'Marshall Cavendish',
    isbn: '978',
  }),
  item({
    id: 'p3-glb-eng',
    class_type: 'Global',
    subject: 'English',
    title: 'Grammar P3',
  }),
  item({
    id: 'p3-glb-mt',
    class_type: 'Global',
    subject: 'Mother Tongue',
    title: 'YCT 3',
  }),
  item({
    id: 'p3-std-math',
    class_type: 'Standard',
    subject: 'Mathematics',
    title: 'Maths 3A',
  }),
  item({
    id: 'p3-both-sci',
    class_type: null,
    subject: 'Science',
    title: 'Science 3',
  }),
  item({
    id: 's1-lit',
    level_id: S1,
    subject: 'Literature',
    title: 'Animal Farm',
  }),
  item({
    id: 'sup-all',
    kind: 'supply',
    level_id: null,
    subject: null,
    title: 'Exam Pad',
  }),
  item({
    id: 'sup-ys',
    kind: 'supply',
    level_id: YS,
    subject: null,
    title: 'YS Kit',
  }),
];

const ids = (r: ReturnType<typeof buildStudentSupplies>) =>
  'needsClass' in r
    ? null
    : r.groups.map((g) => [g.name, g.items.map((i) => i.id)]);

describe('buildStudentSupplies', () => {
  it('a Standard class gets the Standard books and the both-track books', () => {
    const r = buildStudentSupplies({
      section: { levelId: P3, classType: 'Standard' },
      items,
      handovers: [],
    });
    expect(ids(r)).toEqual([
      ['English', ['p3-std-eng']],
      ['Mathematics', ['p3-std-math']],
      ['Science', ['p3-both-sci']],
      ['Supplies', ['sup-all']],
    ]);
  });

  it('a Global class gets the Global books and the both-track books', () => {
    const r = buildStudentSupplies({
      section: { levelId: P3, classType: 'Global' },
      items,
      handovers: [],
    });
    expect(ids(r)).toEqual([
      ['English', ['p3-glb-eng']],
      ['Mother Tongue', ['p3-glb-mt']],
      ['Science', ['p3-both-sci']],
      ['Supplies', ['sup-all']],
    ]);
  });

  it('a class with no class_type follows the Standard list', () => {
    const r = buildStudentSupplies({
      section: { levelId: P3, classType: null },
      items,
      handovers: [],
    });
    expect(ids(r)).toEqual(
      ids(
        buildStudentSupplies({
          section: { levelId: P3, classType: 'Standard' },
          items,
          handovers: [],
        })
      )
    );
  });

  it('a book with no track fits both tracks of its level only', () => {
    const r = buildStudentSupplies({
      section: { levelId: S1, classType: 'Global' },
      items,
      handovers: [],
    });
    expect(ids(r)).toEqual([
      ['Literature', ['s1-lit']],
      ['Supplies', ['sup-all']],
    ]);
  });

  it('Youngstarters get their own supplies as well as the every-level ones', () => {
    const r = buildStudentSupplies({
      section: { levelId: YS, classType: null },
      items,
      handovers: [],
    });
    expect(ids(r)).toEqual([['Supplies', ['sup-all', 'sup-ys']]]);
  });

  it('no class → needsClass, nothing else', () => {
    expect(
      buildStudentSupplies({ section: null, items, handovers: [] })
    ).toEqual({
      needsClass: true,
    });
  });

  it('marks given items with when and by whom, and builds the meta line', () => {
    const r = buildStudentSupplies({
      section: { levelId: P3, classType: 'Standard' },
      items,
      handovers: [
        {
          item_id: 'p3-std-eng',
          given_at: '2027-01-12T01:00:00Z',
          given_by_name: 'Ms Wynne',
        },
      ],
    });
    if ('needsClass' in r) throw new Error('expected a list');
    const eng = r.groups[0].items[0];
    expect(eng.meta).toBe('Marshall Cavendish · 978');
    expect(eng.given).toEqual({
      at: '2027-01-12T01:00:00Z',
      byName: 'Ms Wynne',
    });
    expect(r.groups[1].items[0].given).toBeNull();
    expect(r.groups[1].items[0].meta).toBeNull();
  });
});
