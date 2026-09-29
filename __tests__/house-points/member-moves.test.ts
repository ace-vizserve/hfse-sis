import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { planHouseAdds } from '@/lib/house-points/member-moves';
import {
  HouseMemberRemoveSchema,
  HouseMembersAddSchema,
} from '@/lib/schemas/house-points';
import { houseAuditContext } from '@/lib/sis/house-audit';

// The house page's member add/remove: the pure planning, the shared audit
// context, the payload schemas, and a source-reading guard on the route (a
// route module reaches for next/server and cookies at import time, so it is
// read, not imported — same technique as ./api-guards.test.ts).

const student = (
  sectionStudentId: string,
  studentId: string,
  houseId: string | null
) => ({
  sectionStudentId,
  studentId,
  studentNumber: `SN-${studentId}`,
  name: `STUDENT, ${studentId}`,
  houseId,
});

const ROSTER = [
  student('ss-a', 'a', null),
  student('ss-b', 'b', 'h2'),
  student('ss-c', 'c', 'h1'),
  // d moved class: two roster rows, one student.
  student('ss-d1', 'd', 'h3'),
  student('ss-d2', 'd', 'h3'),
];

describe('planHouseAdds', () => {
  it('changes students not in the house and skips those already in it', () => {
    const plan = planHouseAdds(ROSTER, ['ss-a', 'ss-b', 'ss-c'], 'h1');
    expect(plan.change.map((s) => s.studentId)).toEqual(['a', 'b']);
    expect(plan.skipped).toBe(1);
    expect(plan.unknownIds).toEqual([]);
  });

  it('changes a student with two roster rows once', () => {
    const plan = planHouseAdds(ROSTER, ['ss-d1', 'ss-d2', 'ss-d1'], 'h1');
    expect(plan.change.map((s) => s.studentId)).toEqual(['d']);
    expect(plan.skipped).toBe(0);
  });

  it('reports ids that are not on the enrolled roster', () => {
    const plan = planHouseAdds(ROSTER, ['ss-a', 'ss-gone'], 'h1');
    expect(plan.unknownIds).toEqual(['ss-gone']);
  });
});

describe('houseAuditContext', () => {
  const nameById = new Map([
    ['h1', 'Blue House'],
    ['h2', 'Red House'],
  ]);

  it('keeps the single-student route shape, names resolved', () => {
    expect(
      houseAuditContext({
        enroleeNumber: 'E1',
        studentNumber: 'S1',
        studentId: 'id1',
        before: 'h2',
        after: 'h1',
        nameById,
      })
    ).toEqual({
      enroleeNumber: 'E1',
      studentNumber: 'S1',
      student_id: 'id1',
      before: 'h2',
      after: 'h1',
      before_name: 'Red House',
      after_name: 'Blue House',
    });
  });

  it('adds source when given, and a cleared house reads null', () => {
    const ctx = houseAuditContext({
      enroleeNumber: null,
      studentNumber: 'S1',
      studentId: 'id1',
      before: 'h1',
      after: null,
      nameById,
      source: 'house-page',
    });
    expect(ctx).toMatchObject({
      after: null,
      after_name: null,
      before_name: 'Blue House',
      source: 'house-page',
    });
  });
});

describe('house member schemas', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';

  it('takes 1 to 200 students and an AY', () => {
    expect(
      HouseMembersAddSchema.safeParse({
        ayCode: 'AY2026',
        sectionStudentIds: [uuid],
      }).success
    ).toBe(true);
    expect(
      HouseMembersAddSchema.safeParse({
        ayCode: 'AY2026',
        sectionStudentIds: [],
      }).success
    ).toBe(false);
    expect(
      HouseMembersAddSchema.safeParse({
        ayCode: 'AY2026',
        sectionStudentIds: Array(201).fill(uuid),
      }).success
    ).toBe(false);
    expect(
      HouseMembersAddSchema.safeParse({ sectionStudentIds: [uuid] }).success
    ).toBe(false);
  });

  it('removes one student by uuid', () => {
    expect(
      HouseMemberRemoveSchema.safeParse({
        ayCode: 'AY2026',
        sectionStudentId: uuid,
      }).success
    ).toBe(true);
    expect(
      HouseMemberRemoveSchema.safeParse({
        ayCode: 'AY2026',
        sectionStudentId: 'nope',
      }).success
    ).toBe(false);
  });
});

describe('the house members route enforces its gate and audits', () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      'app',
      'api',
      'sis',
      'houses',
      '[code]',
      'members',
      'route.ts'
    ),
    'utf8'
  );

  it('exports POST and DELETE', () => {
    expect(source).toMatch(/export async function POST\(/);
    expect(source).toMatch(/export async function DELETE\(/);
  });

  it('gates BOTH handlers on requireRole([...ENROLMENT_PLACEMENT_WRITERS])', () => {
    const gates = source.match(
      /requireRole\(\[\.\.\.ENROLMENT_PLACEMENT_WRITERS\]\)/g
    );
    expect(gates?.length ?? 0).toBe(2);
  });

  it('writes sis.house.update audit rows via logAction/logActions', () => {
    expect(source).toMatch(/logActions?\(/);
    expect(source).toContain("'sis.house.update'");
    expect(source).toContain('houseAuditContext(');
  });
});
