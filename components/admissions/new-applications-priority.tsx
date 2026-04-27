import { PriorityPanel } from '@/components/dashboard/priority-panel';
import { getNewApplicationsPriority } from '@/lib/admissions/priority';

// Server-component wrapper around the Admissions PriorityPanel for the
// new-applications top-of-fold. Mounted from the Admissions dashboard RSC;
// see KD #57 (operational top-of-fold pattern) and KD #58 for the broader
// per-module priority composition.
//
// Wave 3 wires this into app/(admissions)/admissions/page.tsx; this file
// stays inert until then.

export type NewApplicationsPriorityProps = {
  ayCode: string;
};

export async function NewApplicationsPriority({
  ayCode,
}: NewApplicationsPriorityProps) {
  const payload = await getNewApplicationsPriority(ayCode);
  return <PriorityPanel payload={payload} />;
}
