import { SubjectSetupView } from '../subject-setup-view';

// Secondary. Session and capability are guarded by the parent layout, which
// runs for this route too.
export default async function SubjectSetupSecondaryPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const sp = await searchParams;
  return <SubjectSetupView levelType="secondary" ay={sp.ay} />;
}
