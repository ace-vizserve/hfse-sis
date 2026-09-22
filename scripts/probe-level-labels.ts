// Read-only: what does levels.label actually hold in production?
// Decides whether "spell out Primary Six" is an email change or a data fix.
// Usage: npx tsx --env-file=.env.local scripts/probe-level-labels.ts
import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

async function main() {
  const { data, error } = await sb
    .from('levels')
    .select('id, code, label')
    .order('code');
  if (error) throw error;
  console.log('levels rows:', data?.length);
  for (const r of data ?? []) console.log(`  ${r.code}  ->  "${r.label}"`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
