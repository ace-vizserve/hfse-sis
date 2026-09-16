// scripts/verify-category-document-gate.ts
//
// WHAT EACH STUDENT NOW SEES ON THEIR FILE, RUN THROUGH THE REAL EVALUATOR.
//
// Not a re-implementation of the rule: this imports `DOCUMENT_SLOTS` and
// `isSlotApplicable` from lib/p-files/document-config.ts and feeds them the
// same facts bag the loaders build, so what it prints is what the app decides.
//
// The canonical check is the one Mr Ace can repeat in the browser: open a
// Current student's P-Files page and the five New-only school forms are gone;
// open a New student's and they are there. This says the same thing for all
// ~1,300 students at once, and would catch the failure mode that matters —
// a gate that reads blank and silently hides a form from EVERYBODY.
//
// STRICTLY READ-ONLY.
//
// Run:
//   npx tsx --env-file=.env.local scripts/verify-category-document-gate.ts
import { createAdmissionsClient } from '../lib/supabase/admissions';
import {
  CURRENT_CATEGORIES,
  DOCUMENT_SLOTS,
  NEW_CATEGORIES,
  isSlotApplicable,
  resolveCategory,
} from '../lib/p-files/document-config';
import { loadLateEnrolleeNumbers } from '../lib/p-files/late-enrollees';

const NEW_ONLY_KEYS = [
  'lastSchoolRecommendation',
  'assessmentResult',
  'newStudentChecksheet',
  'pfilesChecklist',
  'preCounsellingAck',
];

async function main() {
  const admissions = createAdmissionsClient();

  for (const ay of ['ay2025', 'ay2026', 'ay2027']) {
    const { data: statusRows, error } = await admissions
      .from(`${ay}_enrolment_status`)
      .select('enroleeNumber, applicationStatus, enroleeType');
    if (error) {
      console.log(`${ay}: ${error.message}`);
      continue;
    }
    const statuses = (statusRows ?? []) as unknown as {
      enroleeNumber: string;
      applicationStatus: string | null;
      enroleeType: string | null;
    }[];
    if (statuses.length === 0) continue;

    const { data: appRows } = await admissions
      .from(`${ay}_enrolment_applications`)
      .select('enroleeNumber, category, fatherEmail, guardianEmail');
    const apps = new Map(
      ((appRows ?? []) as unknown as Record<string, unknown>[]).map((a) => [
        String(a.enroleeNumber),
        a,
      ])
    );

    console.log(`\n══ ${ay.toUpperCase()} (${statuses.length} students) ══`);

    // Slot counts per category, and the specific question: does anybody
    // see the five New-only forms, and does anybody wrongly still see them?
    const perCategory = new Map<
      string,
      { n: number; totalSlots: number; sawNewOnly: number }
    >();
    let hiddenFromEveryone = 0;

    // Bucket by the SAME resolver the gate uses, not by one of the two raw
    // columns — otherwise this reports the known column disagreements as gate
    // failures. They are listed separately below instead.
    const disagreements: string[] = [];
    for (const s of statuses) {
      const appRow = apps.get(s.enroleeNumber) ?? {};
      const facts = {
        app: {
          ...appRow,
          applicationStatus: s.applicationStatus,
          enroleeType: s.enroleeType,
        },
      };
      const cat = resolveCategory(facts.app) || '(blank)';
      const rawApps = String(appRow.category ?? '').trim();
      const rawStatus = String(s.enroleeType ?? '').trim();
      if (rawApps !== rawStatus) {
        disagreements.push(
          `${s.enroleeNumber}: category='${rawApps || '—'}' vs enroleeType='${rawStatus || '—'}' → using '${cat}'`
        );
      }
      const applicable = DOCUMENT_SLOTS.filter((slot) =>
        isSlotApplicable(slot, facts)
      );
      const newOnlySeen = applicable.filter((slot) =>
        NEW_ONLY_KEYS.includes(slot.key)
      ).length;
      if (newOnlySeen === 0 && NEW_CATEGORIES.includes(cat as never))
        hiddenFromEveryone += 1;

      const bucket = perCategory.get(cat) ?? {
        n: 0,
        totalSlots: 0,
        sawNewOnly: 0,
      };
      bucket.n += 1;
      bucket.totalSlots += applicable.length;
      bucket.sawNewOnly += newOnlySeen;
      perCategory.set(cat, bucket);
    }

    for (const [cat, b] of [...perCategory].sort((x, y) => y[1].n - x[1].n)) {
      const expected = NEW_CATEGORIES.includes(cat as never)
        ? 5
        : CURRENT_CATEGORIES.includes(cat as never)
          ? 0
          : 0;
      const avgNewOnly = b.sawNewOnly / b.n;
      const ok = Math.abs(avgNewOnly - expected) < 0.001;
      console.log(
        `  ${cat.padEnd(20)} ${String(b.n).padStart(4)} students · ` +
          `avg ${(b.totalSlots / b.n).toFixed(1)} slots on file · ` +
          `New-only forms shown: ${avgNewOnly.toFixed(2)}/5 ` +
          `(expected ${expected}) ${ok ? '✅' : '❌'}`
      );
    }

    if (hiddenFromEveryone > 0) {
      console.log(
        `  ❌ ${hiddenFromEveryone} NEW students see none of the five forms ` +
          `— the gate is reading blank`
      );
    } else {
      console.log('  ✅ every New student sees all five New-only forms');
    }

    // The two stored copies of the category, where they disagree. NOT a code
    // fault — a data question only the office can settle. Listed so somebody
    // can, rather than being averaged away into a percentage.
    if (disagreements.length > 0) {
      console.log(
        `  ⚠ ${disagreements.length} students where the two category columns disagree:`
      );
      for (const d of disagreements.slice(0, 20)) console.log(`      ${d}`);
      if (disagreements.length > 20)
        console.log(`      … and ${disagreements.length - 20} more`);
    }

    // ── The Late Enrolment Form, which was invisible to everyone ──────────
    //
    // Gated on the roster, not on admissions, so it is checked through the
    // same helper the loaders use rather than a second copy of the rule.
    const lateNumbers = await loadLateEnrolleeNumbers(ay.toUpperCase());
    const lateSlot = DOCUMENT_SLOTS.find((s) => s.key === 'lateEnrolmentForm');
    if (!lateSlot) throw new Error('lateEnrolmentForm slot is gone');
    let shownToLate = 0;
    let shownToOnTime = 0;
    for (const s of statuses) {
      const isLate = lateNumbers.includes(s.enroleeNumber);
      const applies = isSlotApplicable(lateSlot, {
        app: {
          ...(apps.get(s.enroleeNumber) ?? {}),
          enroleeType: s.enroleeType,
        },
        isLateEnrollee: isLate,
      });
      if (applies && isLate) shownToLate += 1;
      if (applies && !isLate) shownToOnTime += 1;
    }
    console.log(
      `  Late Enrolment Form: ${lateNumbers.length} late enrollees, ` +
        `form shown to ${shownToLate} of them, and to ${shownToOnTime} others ` +
        `${shownToLate === lateNumbers.length && shownToOnTime === 0 ? '✅' : '❌'}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
