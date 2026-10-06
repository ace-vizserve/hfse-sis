import 'server-only';

import { deriveOptions, type DerivedLevel } from '@/lib/admissions/options';
import { loadAdmissionOptions } from '@/lib/admissions/options-loader';
import { loadLevelLabelResolver } from '@/lib/sis/levels';
import { createServiceClient } from '@/lib/supabase/service';

// The year's enrolment-form options for the Edit profile sheet's Level applied
// / Class type / Preferred schedule dropdowns. Closed options are included:
// staff correct a record to what the child is actually in, which can be a
// level no longer open to new applications. A failed read returns [] and the
// sheet falls back to its old fields — it never blocks editing a profile.
//
// Each level name carries what it counts as ("Year 10" → Secondary Three), so
// the dropdown says which SIS level a choice puts the child under.
export async function loadProfileAdmissionOptions(
  ayCode: string
): Promise<DerivedLevel[]> {
  try {
    const service = createServiceClient();
    const [rows, resolveLevel] = await Promise.all([
      loadAdmissionOptions(service, ayCode),
      loadLevelLabelResolver(service),
    ]);
    return deriveOptions(rows.map((r) => ({ ...r, is_open: true }))).map(
      (l) => {
        const resolved = resolveLevel(l.levelLabel);
        return {
          ...l,
          countsAs:
            resolved && resolved !== l.levelLabel.trim() ? resolved : null,
        };
      }
    );
  } catch (e) {
    console.error(
      '[profile-options] admission options read failed:',
      e instanceof Error ? e.message : e
    );
    return [];
  }
}
