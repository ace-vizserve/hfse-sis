// scripts/backfill/probe-stage-gap-impact.ts
// Read-only. Two jobs:
//
//   1. Find any stage stamped as updated while still holding nothing — the
//      empty-save footprint, so it can be cleared.
//   2. Measure what each candidate new rule would cost. Requirements are
//      enforced on EVERY save, not only when the status changes, so adding one
//      makes existing records at that status un-editable until the field is
//      filled. That backlog is the point ("they requested the enforcement not
//      us"), but its size should be known before the rule ships.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-stage-gap-impact.ts
import { createServiceClient } from '../../lib/supabase/service';

const TABLE = 'ay2026_enrolment_status';

// stage -> [statusCol, updatedDateCol, updatedByCol, ...contentCols]
const STAGES: Record<string, [string, string, string, string[]]> = {
  application: [
    'applicationStatus',
    'applicationUpdatedDate',
    'applicationUpdatedBy',
    ['applicationRemarks', 'applicationTerminalReason'],
  ],
  registration: [
    'registrationStatus',
    'registrationUpdateDate',
    'registrationUpdatedby',
    ['registrationInvoice', 'registrationPaymentDate', 'registrationRemarks'],
  ],
  documents: [
    'documentStatus',
    'documentUpdatedDate',
    'documentUpdatedby',
    ['documentRemarks'],
  ],
  assessment: [
    'assessmentStatus',
    'assessmentUpdatedDate',
    'assessmentUpdatedby',
    [
      'assessmentSchedule',
      'assessmentGradeMath',
      'assessmentGradeEnglish',
      'assessmentMedical',
      'assessmentRemarks',
    ],
  ],
  contract: [
    'contractStatus',
    'contractUpdatedDate',
    'contractUpdatedby',
    ['contractRemarks'],
  ],
  fees: [
    'feeStatus',
    'feeUpdatedDate',
    'feeUpdatedby',
    ['feeInvoice', 'feePaymentDate', 'feeStartDate', 'feeRemarks'],
  ],
  supplies: [
    'suppliesStatus',
    'suppliesUpdatedDate',
    'suppliesUpdatedby',
    ['suppliesClaimedDate', 'suppliesRemarks'],
  ],
  orientation: [
    'orientationStatus',
    'orientationUpdatedDate',
    'orientationUpdateby',
    ['orientationScheduleDate', 'orientationRemarks'],
  ],
};

// The rules being considered: stage -> status -> columns that would become required
const CANDIDATES: Record<string, Record<string, string[]>> = {
  orientation: {
    Pending: ['orientationScheduleDate'],
    Finished: ['orientationScheduleDate'],
  },
  assessment: {
    'Ongoing Assessment': ['assessmentSchedule'],
    Finished: ['assessmentSchedule', 'assessmentMedical'],
  },
  fees: {
    Paid: ['feeStartDate'],
  },
};

async function main() {
  const svc = createServiceClient();

  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc
      .from(TABLE)
      .select('*')
      .range(from, from + 999);
    if (error) throw error;
    const page = (data ?? []) as any[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  console.log(`enrolee rows: ${rows.length}\n`);

  console.log('=== stages stamped as updated while completely empty ===');
  let found = 0;
  for (const [
    stage,
    [statusCol, dateCol, byCol, contentCols],
  ] of Object.entries(STAGES)) {
    const hits = rows.filter((r) => {
      const stamped = r[dateCol] || r[byCol];
      if (!stamped) return false;
      if (r[statusCol]) return false;
      return contentCols.every((c) => !r[c]);
    });
    for (const h of hits) {
      found++;
      console.log(
        `  ${stage.padEnd(13)} ${h.enroleeNumber}  "${h.enroleeName}"  stamped ${h[dateCol]} by ${h[byCol] ?? '?'}`
      );
    }
  }
  if (found === 0) console.log('  none');

  console.log('\n=== what each candidate rule would block ===');
  for (const [stage, byStatus] of Object.entries(CANDIDATES)) {
    const [statusCol] = STAGES[stage];
    console.log(`\n  ${stage}`);
    for (const [status, cols] of Object.entries(byStatus)) {
      const atStatus = rows.filter((r) => (r[statusCol] ?? '') === status);
      const blocked = atStatus.filter((r) => cols.some((c) => !r[c]));
      console.log(
        `    ${status.padEnd(20)} ${atStatus.length} record(s) at this status, ${blocked.length} would be blocked until filled`
      );
      for (const c of cols) {
        const missing = atStatus.filter((r) => !r[c]).length;
        console.log(
          `        ${c.padEnd(26)} missing on ${missing}/${atStatus.length}`
        );
      }
    }
  }

  console.log('\n=== how full each candidate column is overall ===');
  const cols = [
    'orientationScheduleDate',
    'assessmentSchedule',
    'assessmentMedical',
    'assessmentGradeMath',
    'assessmentGradeEnglish',
    'feeStartDate',
    'feeInvoice',
    'feePaymentDate',
  ];
  for (const c of cols) {
    const filled = rows.filter((r) => r[c]).length;
    console.log(`  ${c.padEnd(26)} ${filled}/${rows.length}`);
  }

  console.log('\n=== status spread on the three stages ===');
  for (const stage of ['orientation', 'assessment', 'fees']) {
    const [statusCol] = STAGES[stage];
    const spread = new Map<string, number>();
    for (const r of rows)
      spread.set(
        r[statusCol] ?? '(null)',
        (spread.get(r[statusCol] ?? '(null)') ?? 0) + 1
      );
    console.log(
      `  ${stage}: ${[...spread]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join('  ')}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  });
