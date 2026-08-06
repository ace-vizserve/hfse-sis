import { redirect } from 'next/navigation';

import { SubjectSetupView } from './subject-setup-view';

// Primary — Subject Setup's default level. Session and capability are guarded
// by the layout.
export default async function SubjectSetupPrimaryPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string; level?: string }>;
}) {
  const sp = await searchParams;

  // Level used to be `?level=`. That URL was linkable and may be bookmarked,
  // so it keeps working — carrying the chosen AY across with it.
  if (sp.level === 'secondary') {
    redirect(
      `/sis/admin/subjects/secondary${sp.ay ? `?ay=${encodeURIComponent(sp.ay)}` : ''}`
    );
  }

  return <SubjectSetupView levelType="primary" ay={sp.ay} />;
}
